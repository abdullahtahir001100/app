"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useGateway } from "@/hooks/use-gateway";
import {
  FRAME_FILE_BINARY,
  b64ToBlob,
  blobToBase64,
  defaultRootFromList,
  mimeForName,
  normalizePath,
  pathsEqual,
} from "@/lib/file-manager/utils";
import { unwrapDeviceBinaryFrame } from "@/lib/binary-frame";
import type {
  CloudBackupEntry,
  FileEntry,
  FileSortKey,
  FileTelemetryPacket,
  FileViewMode,
  QuickRoot,
  VirtualFolderOption,
} from "@/lib/file-manager/types";
import { parseApiResponse } from "@/lib/parse-api-response";

const MEDIA_CLOUD_ROOTS: QuickRoot[] = [
  { label: "Screenshots / Camera", path: "/Screenshots/Camera", kind: "folder" },
  { label: "Screenshots / Screen", path: "/Screenshots/Screen", kind: "folder" },
  { label: "Recordings / Camera", path: "/Recordings/Camera", kind: "folder" },
  { label: "Recordings / Screen", path: "/Recordings/Screen", kind: "folder" },
];

export type FileBrowseSurface = "local" | "cloud" | "trash";

type PendingRequest = {
  action: string;
  resolve: (packet: FileTelemetryPacket) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export function useFileAgent() {
  const searchParams = useSearchParams();
  const requestedDevice = searchParams.get("device") || "";
  const { isConnected, devices, dispatch: gatewayDispatch, refreshDevices, resolveTarget, subscribe, isDeviceOnline, ensureConnected } = useGateway();

  const [selectedDevice, setSelectedDevice] = useState("");
  const [currentPath, setCurrentPath] = useState("");
  const [homePath, setHomePath] = useState("");
  const [items, setItems] = useState<FileEntry[]>([]);
  const [searchResults, setSearchResults] = useState<FileEntry[] | null>(null);
  const [quickRoots, setQuickRoots] = useState<QuickRoot[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<FileViewMode>("list");
  const [sortKey, setSortKey] = useState<FileSortKey>("name");
  const [sortAsc, setSortAsc] = useState(true);
  const [localFilter, setLocalFilter] = useState("");
  const [previewPath, setPreviewPath] = useState("");
  const [previewText, setPreviewText] = useState("");
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [metaTags, setMetaTags] = useState("");
  const [metaCategory, setMetaCategory] = useState("");
  const [cloudBackups, setCloudBackups] = useState<CloudBackupEntry[]>([]);
  const [cloudUploadFolder, setCloudUploadFolder] = useState("/");
  const [cloudFolderOptions, setCloudFolderOptions] = useState<VirtualFolderOption[]>([
    { label: "Cloud Drive (root)", value: "/" },
  ]);
  const [browseSurface, setBrowseSurface] = useState<FileBrowseSurface>("local");
  const [cloudCurrentFolder, setCloudCurrentFolder] = useState("/");
  const [cloudItems, setCloudItems] = useState<CloudBackupEntry[]>([]);

  const selectedDeviceRef = useRef("");
  const currentPathRef = useRef("");
  const pendingRef = useRef<PendingRequest[]>([]);
  const pendingDownloadRef = useRef<{ name: string; resolve?: () => void } | null>(null);
  const pathHistoryRef = useRef<string[]>([]);
  const historyIndexRef = useRef(0);
  const previewBlobUrlRef = useRef<string | null>(null);
  const initInFlightRef = useRef(false);
  const initializedDeviceRef = useRef("");
  const gatewayDispatchRef = useRef(gatewayDispatch);
  gatewayDispatchRef.current = gatewayDispatch;

  useEffect(() => {
    selectedDeviceRef.current = selectedDevice;
  }, [selectedDevice]);

  useEffect(() => {
    if (!isConnected) return;
    if (devices.length > 0) return;
    void refreshDevices();
  }, [devices.length, isConnected, refreshDevices]);

  useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);

  useEffect(() => {
    ensureConnected();
    void refreshDevices(true);
  }, [ensureConnected, refreshDevices]);

  useEffect(() => {
    if (devices.length === 0) return;
    const knownIds = devices.map((d) => d.value);
    const fromQuery =
      requestedDevice && knownIds.includes(requestedDevice) ? requestedDevice : "";
    if (fromQuery && selectedDeviceRef.current !== fromQuery) {
      selectedDeviceRef.current = fromQuery;
      setSelectedDevice(fromQuery);
      return;
    }
    if (!selectedDeviceRef.current || !knownIds.includes(selectedDeviceRef.current)) {
      const online = devices.find((d) => d.status === "online");
      const next = (online || devices[0]).value;
      selectedDeviceRef.current = next;
      setSelectedDevice(next);
    }
  }, [devices, requestedDevice]);

  useEffect(() => {
    if (!selectedDevice) return;
    if (initializedDeviceRef.current && initializedDeviceRef.current !== selectedDevice) {
      initializedDeviceRef.current = "";
      initInFlightRef.current = false;
      setItems([]);
      setCurrentPath("");
      setHomePath("");
    }
  }, [selectedDevice]);

  const clearPreviewBlob = useCallback(() => {
    if (previewBlobUrlRef.current) {
      URL.revokeObjectURL(previewBlobUrlRef.current);
      previewBlobUrlRef.current = null;
    }
    setPreviewBlobUrl(null);
  }, []);

  const pushHistory = useCallback((path: string) => {
    const history = pathHistoryRef.current;
    const idx = historyIndexRef.current;
    const next = history.slice(0, idx + 1);
    if (next[next.length - 1] !== path) {
      next.push(path);
      pathHistoryRef.current = next;
      historyIndexRef.current = next.length - 1;
    }
  }, []);

  const resolvePending = useCallback((action: string, packet: FileTelemetryPacket, error?: string) => {
    const idx = pendingRef.current.findIndex((p) => p.action === action);
    if (idx < 0) return;
    const [pending] = pendingRef.current.splice(idx, 1);
    clearTimeout(pending.timer);
    if (error) pending.reject(new Error(error));
    else pending.resolve(packet);
  }, []);

  const dispatchToAgent = useCallback(
    (action: string, payload: Record<string, unknown> = {}, targetOverride?: string) => {
      const target = targetOverride || selectedDeviceRef.current || resolveTarget(devices[0]?.value);
      if (!target) {
        toast.error("No live Rust agent. Run: cd zenvora_agent && cargo run");
        return { ok: false as const };
      }
      if (!selectedDeviceRef.current) {
        selectedDeviceRef.current = target;
        setSelectedDevice(target);
      }
      return gatewayDispatch(action, payload, target);
    },
    [devices, gatewayDispatch, resolveTarget]
  );

  const execHttp = useCallback(
    async (action: string, payload: Record<string, unknown> = {}) => {
      const target = selectedDeviceRef.current || resolveTarget(devices[0]?.value);
      if (!target) {
        toast.error("No live Rust agent. Run: cd zenvora_agent && cargo run");
        throw new Error("no-agent");
      }
      if (!selectedDeviceRef.current) {
        selectedDeviceRef.current = target;
        setSelectedDevice(target);
      }

      const requestId = crypto.randomUUID();
      const normalizedPayload: Record<string, unknown> = { ...payload, _requestId: requestId };
      if (typeof normalizedPayload.path === "string") {
        normalizedPayload.path = normalizePath(normalizedPayload.path);
      }
      if (typeof normalizedPayload.dest_path === "string") {
        normalizedPayload.dest_path = normalizePath(normalizedPayload.dest_path);
      }

      const response = await fetch("/api/files/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, targetDeviceId: target, payload: normalizedPayload }),
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.message || `Failed: ${action}`);
      }

      return {
        type: "file_telemetry_stream",
        action: data.action || action,
        message: data.message,
        file_result: data.file_result,
      } as FileTelemetryPacket;
    },
    [devices, resolveTarget]
  );

  const exec = useCallback(
    (action: string, payload: Record<string, unknown> = {}) => execHttp(action, payload),
    [execHttp]
  );

  const applyList = useCallback(
    (fileResult: Record<string, unknown>) => {
      if (typeof fileResult.path === "string") {
        const nextPath = normalizePath(fileResult.path);
        setCurrentPath(nextPath);
        currentPathRef.current = nextPath;
        pushHistory(nextPath);
      }
      if (Array.isArray(fileResult.items)) {
        setItems(fileResult.items as FileEntry[]);
        setSearchResults(null);
      }
    },
    [pushHistory]
  );

  const listDirectory = useCallback(
    async (path?: string, silent = false) => {
      if (!silent) setLoading(true);
      try {
        const packet = await exec("FILE_LIST_DIR", { path: path ?? currentPathRef.current });
        const result = (packet.file_result || {}) as Record<string, unknown>;
        if (result.error) throw new Error(String(result.error));
        applyList(result);
        if (packet.message) toast.success(String(packet.message));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "List failed");
      } finally {
        setLoading(false);
      }
    },
    [applyList, exec]
  );

  const applyListRef = useRef(applyList);
  applyListRef.current = applyList;

  const refreshVirtualFiles = useCallback(async () => {
    const deviceId = selectedDeviceRef.current;
    if (!deviceId) return;
    try {
      const res = await fetch(`/api/virtual-files/folders?deviceId=${encodeURIComponent(deviceId)}`);
      const data = await parseApiResponse<{ success?: boolean; folders?: VirtualFolderOption[]; message?: string }>(res);
      if (data.success && Array.isArray(data.folders)) {
        setCloudFolderOptions(data.folders);
      } else if (data.message) {
        toast.error(data.message);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load cloud folders");
    }
  }, []);

  const resolveDeviceId = useCallback(() => {
    return selectedDeviceRef.current || resolveTarget(devices[0]?.value) || "";
  }, [devices, resolveTarget]);

  const browseCloudFolder = useCallback(
    async (folder = "/") => {
      const deviceId = resolveDeviceId();
      if (!deviceId) {
        toast.error("Select a live agent device first");
        return;
      }
      setLoading(true);
      setBrowseSurface("cloud");
      setSearchResults(null);
      try {
        const res = await fetch(
          `/api/virtual-files/browse?deviceId=${encodeURIComponent(deviceId)}&folder=${encodeURIComponent(folder)}`
        );
        const data = await parseApiResponse<{
          success?: boolean;
          message?: string;
          folder?: string;
          items?: CloudBackupEntry[];
        }>(res);
        if (!data.success) throw new Error(data.message || "Browse failed");
        setCloudCurrentFolder(data.folder || folder);
        setCloudItems(data.items || []);
        setCloudBackups(data.items || []);
        setSelectedPaths([]);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not load cloud folder");
      } finally {
        setLoading(false);
      }
    },
    [resolveDeviceId]
  );

  const browseTrash = useCallback(async () => {
    const deviceId = resolveDeviceId();
    if (!deviceId) {
      toast.error("Select a live agent device first");
      return;
    }
    setLoading(true);
    setBrowseSurface("trash");
    setSearchResults(null);
    try {
      const res = await fetch(`/api/virtual-files/trash?deviceId=${encodeURIComponent(deviceId)}`);
      const data = await parseApiResponse<{
        success?: boolean;
        message?: string;
        items?: CloudBackupEntry[];
      }>(res);
      if (!data.success) throw new Error(data.message || "Trash load failed");
      setCloudCurrentFolder("/.Trash");
      setCloudItems(data.items || []);
      setSelectedPaths([]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load trash");
    } finally {
      setLoading(false);
    }
  }, [resolveDeviceId]);

  const returnToLocalBrowse = useCallback(() => {
    setBrowseSurface("local");
    setCloudCurrentFolder("/");
    setCloudItems([]);
    setSelectedPaths([]);
  }, []);

  const openCloudEntry = useCallback(
    (entry: CloudBackupEntry) => {
      if (entry.kind === "folder" && entry.virtualPath) {
        void browseCloudFolder(entry.virtualPath);
      }
    },
    [browseCloudFolder]
  );

  const deleteCloudSelected = useCallback(async () => {
    const item = cloudItems.find((i) => i.id === selectedPaths[0]);
    if (!item || item.kind === "folder") return;
    setLoading(true);
    try {
      const res = await fetch(`/api/virtual-files/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      const data = await parseApiResponse<{ success?: boolean; message?: string }>(res);
      if (!data.success) throw new Error(data.message || "Delete failed");
      if (browseSurface === "trash") await browseTrash();
      else await browseCloudFolder(cloudCurrentFolder);
      setSelectedPaths([]);
      toast.success(browseSurface === "trash" ? "Deleted" : "Moved to trash");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setLoading(false);
    }
  }, [browseCloudFolder, browseSurface, browseTrash, cloudCurrentFolder, cloudItems, selectedPaths]);

  const restoreCloudSelected = useCallback(async () => {
    const item = cloudItems.find((i) => i.id === selectedPaths[0]);
    if (!item || item.kind === "folder") return;
    setLoading(true);
    try {
      const res = await fetch(`/api/virtual-files/${encodeURIComponent(item.id)}/restore`, { method: "POST" });
      const data = await parseApiResponse<{ success?: boolean; message?: string }>(res);
      if (!data.success) throw new Error(data.message || "Restore failed");
      await browseTrash();
      setSelectedPaths([]);
      toast.success("Restored from trash");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setLoading(false);
    }
  }, [browseTrash, cloudItems, selectedPaths]);

  const purgeCloudSelected = useCallback(async () => {
    const item = cloudItems.find((i) => i.id === selectedPaths[0]);
    if (!item || item.kind === "folder") return;
    setLoading(true);
    try {
      const res = await fetch(`/api/virtual-files/${encodeURIComponent(item.id)}/permanent`, { method: "DELETE" });
      const data = await parseApiResponse<{ success?: boolean; message?: string }>(res);
      if (!data.success) throw new Error(data.message || "Permanent delete failed");
      await browseTrash();
      setSelectedPaths([]);
      toast.success("Permanently deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Permanent delete failed");
    } finally {
      setLoading(false);
    }
  }, [browseTrash, cloudItems, selectedPaths]);

  const createCloudFolder = useCallback(
    async (name: string, parentPath = "/") => {
      const deviceId = resolveDeviceId();
      if (!deviceId) throw new Error("Select a live agent device first");
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Folder name is required.");

      const res = await fetch("/api/virtual-files/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId,
          parentPath,
          name: trimmed,
        }),
      });
      const data = await parseApiResponse<{
        success?: boolean;
        message?: string;
        item?: CloudBackupEntry;
      }>(res);
      if (!data.success || !data.item?.virtualPath) {
        throw new Error(data.message || "Create folder failed");
      }

      await refreshVirtualFiles();
      setCloudUploadFolder(data.item.virtualPath);
      toast.success(`Cloud folder created: ${data.item.virtualPath}`);
      return data.item.virtualPath;
    },
    [refreshVirtualFiles, resolveDeviceId]
  );

  const dispatchToAgentRef = useRef(dispatchToAgent);
  dispatchToAgentRef.current = dispatchToAgent;

  const listDirectoryRef = useRef(listDirectory);
  listDirectoryRef.current = listDirectory;

  const refreshVirtualFilesRef = useRef(refreshVirtualFiles);
  refreshVirtualFilesRef.current = refreshVirtualFiles;

  useEffect(() => {
    if (!selectedDevice) return;
    setBrowseSurface("local");
    void refreshVirtualFiles();
  }, [selectedDevice, refreshVirtualFiles]);

  const initExplorer = useCallback(async () => {
    const target = selectedDeviceRef.current || devices[0]?.value;
    if (!target) {
      toast.error("No live Rust agent. Run: cd zenvora_agent && cargo run");
      return;
    }
    if (initInFlightRef.current) return;
    if (initializedDeviceRef.current === target && items.length > 0) return;

    initInFlightRef.current = true;
    setLoading(true);
    setItems([]);
    setSearchResults(null);

    try {
      const rootsPacket = await execHttp("FILE_GET_ROOTS", {});
      const roots = (rootsPacket.file_result || {}) as Record<string, unknown>;
      if (roots.error) throw new Error(String(roots.error));

      if (Array.isArray(roots.roots)) setQuickRoots(roots.roots as QuickRoot[]);
      const home = String(
        roots.home || defaultRootFromList((roots.roots as QuickRoot[]) || [])
      );
      setHomePath(home);
      pushHistory(home);

      const listPacket = await execHttp("FILE_LIST_DIR", { path: home });
      const listResult = (listPacket.file_result || {}) as Record<string, unknown>;
      if (listResult.error) throw new Error(String(listResult.error));
      applyList(listResult);

      initializedDeviceRef.current = target;
      await refreshVirtualFiles();
      toast.success("Filesystem loaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load filesystem");
    } finally {
      initInFlightRef.current = false;
      setLoading(false);
    }
  }, [applyList, devices, execHttp, items.length, pushHistory, refreshVirtualFiles]);

  const initExplorerRef = useRef(initExplorer);
  initExplorerRef.current = initExplorer;

  useEffect(() => {
    if (!isConnected || !selectedDevice) return;
    if (initializedDeviceRef.current === selectedDevice && items.length > 0) return;
    void initExplorerRef.current();
  }, [isConnected, selectedDevice, items.length]);

  const handleFileTelemetryRef = useRef<(packet: FileTelemetryPacket & Record<string, unknown>) => void>(() => {});
  handleFileTelemetryRef.current = (packet) => {
    const action = String(packet.action || "");
    const fileResult = (packet.file_result || {}) as Record<string, unknown>;
    const err = fileResult.error ? String(fileResult.error) : undefined;

    resolvePending(action, packet, err);

    if (err) {
      initInFlightRef.current = false;
      setLoading(false);
      toast.error(err);
      return;
    }

    if (packet.message && action !== "FILE_LIST_DIR") {
      toast.success(String(packet.message));
    }

    switch (action) {
      case "FILE_LIST_DIR":
        applyListRef.current(fileResult);
        {
          const wasInit = initInFlightRef.current;
          initInFlightRef.current = false;
          initializedDeviceRef.current = selectedDeviceRef.current;
          void refreshVirtualFilesRef.current();
          setLoading(false);
          if (wasInit) toast.success("Filesystem loaded");
        }
        break;
      case "FILE_GET_ROOTS": {
        if (Array.isArray(fileResult.roots)) setQuickRoots(fileResult.roots as QuickRoot[]);
        const home = String(
          fileResult.home || defaultRootFromList((fileResult.roots as QuickRoot[]) || [])
        );
        if (home) {
          setHomePath(home);
          pushHistory(home);
          dispatchToAgentRef.current("FILE_LIST_DIR", { path: home }, selectedDeviceRef.current);
        } else {
          initInFlightRef.current = false;
          setLoading(false);
        }
        break;
      }
      case "FILE_SEARCH":
        if (Array.isArray(fileResult.results)) {
          setSearchResults(fileResult.results as FileEntry[]);
          toast.message(`Found ${fileResult.count ?? fileResult.results.length} items`);
        }
        setLoading(false);
        break;
      case "FILE_READ_TEXT":
        if (typeof fileResult.content === "string") {
          setPreviewText(fileResult.content);
          setEditContent(fileResult.content);
          setPreviewPath(String(fileResult.path || ""));
          clearPreviewBlob();
          setEditMode(false);
        }
        setLoading(false);
        break;
      case "FILE_DOWNLOAD":
        if (fileResult.inline && typeof fileResult.content_b64 === "string") {
          const name = String(fileResult.name || "download.bin");
          const blob = b64ToBlob(fileResult.content_b64, mimeForName(name));
          const url = URL.createObjectURL(blob);
          clearPreviewBlob();
          previewBlobUrlRef.current = url;
          setPreviewBlobUrl(url);
          const link = document.createElement("a");
          link.href = url;
          link.download = name;
          link.click();
          toast.success(`Downloaded ${name}`);
        } else {
          pendingDownloadRef.current = {
            name: String(fileResult.name || "download.bin"),
          };
        }
        setLoading(false);
        break;
      case "FILE_GET_METADATA":
        setMetaTags(Array.isArray(fileResult.tags) ? (fileResult.tags as string[]).join(", ") : "");
        setMetaCategory(String(fileResult.category || ""));
        setLoading(false);
        break;
      case "FILE_DELETE":
      case "FILE_RENAME":
      case "FILE_MOVE":
      case "FILE_COPY":
      case "FILE_UPLOAD":
      case "FILE_WRITE_TEXT":
      case "FILE_MKDIR":
      case "FILE_COMPRESS":
      case "FILE_DECOMPRESS":
      case "FILE_SET_METADATA":
      case "FILE_SET_PERMISSIONS":
        void listDirectoryRef.current(currentPathRef.current, true);
        setLoading(false);
        break;
      default:
        setLoading(false);
    }
  };

  useEffect(() => {
    return subscribe((event) => {
      if (event.type === "binary") {
        const pending = pendingDownloadRef.current;
        if (!pending) return;
        void (async () => {
          const buffer = event.data instanceof Blob ? await event.data.arrayBuffer() : event.data;
          const raw = new Uint8Array(buffer);
          const { deviceId, frame: bytes } = unwrapDeviceBinaryFrame(raw);
          const selected = selectedDeviceRef.current || "";
          if (deviceId && selected && deviceId !== selected) return;
          if (bytes[0] !== FRAME_FILE_BINARY || bytes.length < 2) return;
          const blob = new Blob([bytes.slice(1)], { type: mimeForName(pending.name) });
          const url = URL.createObjectURL(blob);
          clearPreviewBlob();
          previewBlobUrlRef.current = url;
          setPreviewBlobUrl(url);
          const link = document.createElement("a");
          link.href = url;
          link.download = pending.name;
          link.click();
          pending.resolve?.();
          pendingDownloadRef.current = null;
          toast.success(`Downloaded ${pending.name}`);
        })();
        return;
      }

      if (event.type !== "json") return;
      const packet = event.packet as FileTelemetryPacket & Record<string, unknown>;

      if (packet.type === "sys_error") {
        initInFlightRef.current = false;
        setLoading(false);
        toast.error(String(packet.message || "Operation failed"));
        return;
      }

      if (packet.type === "file_telemetry_stream") {
        const sender = typeof packet.senderAgentId === "string" ? packet.senderAgentId : "";
        if (sender && selectedDeviceRef.current && sender !== selectedDeviceRef.current) {
          return;
        }
      }

      const isFileStream = packet.type === "file_telemetry_stream";
      const isFileAck =
        packet.type === "sys_ack" &&
        (packet.channel === "files" || Boolean(packet.file_result));

      if (!isFileStream && !isFileAck) return;

      if (isFileAck && !isFileStream) {
        handleFileTelemetryRef.current({
          type: "file_telemetry_stream",
          action: String(packet.last_action || packet.action || ""),
          message: packet.message as string | null,
          file_result: packet.file_result as Record<string, unknown>,
        });
        return;
      }

      handleFileTelemetryRef.current(packet);
    });
  }, [subscribe]);

  const refreshListing = useCallback(
    async (silent = true) => {
      if (!currentPathRef.current) return;
      await listDirectory(currentPathRef.current, silent);
    },
    [listDirectory]
  );

  const navigateTo = useCallback(
    (path: string) => {
      const target = normalizePath(path);
      if (!target) return;
      setSelectedPaths([]);
      clearPreviewBlob();
      setPreviewText("");
      setPreviewPath("");
      void listDirectory(target);
    },
    [clearPreviewBlob, listDirectory]
  );

  const goUp = useCallback(() => {
    const norm = currentPathRef.current.replace(/\\/g, "/").replace(/\/$/, "");
    const idx = norm.lastIndexOf("/");
    if (idx <= 0) return;
    const parent =
      /^[A-Za-z]:$/.test(norm.slice(0, idx)) ? `${norm.slice(0, idx)}/` : norm.slice(0, idx);
    navigateTo(parent);
  }, [navigateTo]);

  const goBack = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    const path = pathHistoryRef.current[historyIndexRef.current];
    if (path) void listDirectory(path);
  }, [listDirectory]);

  const goForward = useCallback(() => {
    if (historyIndexRef.current >= pathHistoryRef.current.length - 1) return;
    historyIndexRef.current += 1;
    const path = pathHistoryRef.current[historyIndexRef.current];
    if (path) void listDirectory(path);
  }, [listDirectory]);

  const openEntry = useCallback(
    (entry: FileEntry) => {
      if (entry.kind === "folder") {
        navigateTo(entry.path);
        return;
      }
      setSelectedPaths([entry.path]);
      setPreviewPath(entry.path);
      if (isTextFile(entry.name)) {
        setLoading(true);
        void exec("FILE_READ_TEXT", { path: entry.path })
          .catch((err) => toast.error(err instanceof Error ? err.message : "Read failed"))
          .finally(() => setLoading(false));
      } else {
        setPreviewText("");
        setLoading(true);
        void exec("FILE_DOWNLOAD", { path: entry.path })
          .then((packet) => {
            const fr = (packet.file_result || {}) as Record<string, unknown>;
            if (fr.inline && typeof fr.content_b64 === "string") {
              const name = String(fr.name || entry.name);
              const blob = b64ToBlob(fr.content_b64, mimeForName(name));
              const url = URL.createObjectURL(blob);
              clearPreviewBlob();
              previewBlobUrlRef.current = url;
              setPreviewBlobUrl(url);
            } else if (fr.inline === false) {
              pendingDownloadRef.current = { name: String(fr.name || entry.name) };
            }
          })
          .catch((err) => toast.error(err instanceof Error ? err.message : "Download failed"))
          .finally(() => setLoading(false));
      }
    },
    [clearPreviewBlob, exec, navigateTo]
  );

  const runAgentSearch = useCallback(
    async (query: string) => {
      if (query.trim().length < 2) {
        setSearchResults(null);
        return;
      }
      setLoading(true);
      try {
        await exec("FILE_SEARCH", { path: currentPathRef.current, query: query.trim() });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Search failed");
        setLoading(false);
      }
    },
    [exec]
  );

  const uploadFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList?.length) return;
      setLoading(true);
      for (const file of Array.from(fileList)) {
        if (file.size > 16 * 1024 * 1024) {
          toast.error(`${file.name} exceeds 16MB limit`);
          continue;
        }
        try {
          const content_b64 = await blobToBase64(file);
          await exec("FILE_UPLOAD", {
            path: currentPathRef.current,
            file_name: file.name,
            content_b64,
          });
        } catch (err) {
          toast.error(err instanceof Error ? err.message : `Upload failed: ${file.name}`);
        }
      }
      await refreshListing(true);
      setLoading(false);
    },
    [exec, refreshListing]
  );

  const downloadSelected = useCallback(async () => {
    const entry = items.find((i) => i.path === selectedPaths[0]);
    if (!entry || entry.kind !== "file") {
      toast.error("Select a file to download");
      return;
    }
    setLoading(true);
    try {
      const packet = await exec("FILE_DOWNLOAD", { path: entry.path });
      const fr = (packet.file_result || {}) as Record<string, unknown>;
      if (fr.inline && typeof fr.content_b64 === "string") {
        const name = String(fr.name || entry.name);
        const blob = b64ToBlob(fr.content_b64, mimeForName(name));
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = name;
        link.click();
        URL.revokeObjectURL(url);
        toast.success(`Downloaded ${name}`);
      } else {
        pendingDownloadRef.current = { name: String(fr.name || entry.name) };
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed");
    } finally {
      setLoading(false);
    }
  }, [exec, items, selectedPaths]);

  const deleteSelected = useCallback(async () => {
    const path = selectedPaths[0];
    if (!path) return;
    setLoading(true);
    try {
      await exec("FILE_DELETE", { path });
      setSelectedPaths([]);
      await refreshListing(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setLoading(false);
    }
  }, [exec, refreshListing, selectedPaths]);

  const renameSelected = useCallback(
    async (newName: string) => {
      const path = selectedPaths[0];
      if (!path || !newName.trim()) return;
      setLoading(true);
      try {
        await exec("FILE_RENAME", { path, new_name: newName.trim() });
        await refreshListing(true);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Rename failed");
      } finally {
        setLoading(false);
      }
    },
    [exec, refreshListing, selectedPaths]
  );

  const transferSelected = useCallback(
    async (destPath: string, mode: "copy" | "move") => {
      const path = selectedPaths[0];
      if (!path || !destPath.trim()) return;
      setLoading(true);
      try {
        await exec(mode === "copy" ? "FILE_COPY" : "FILE_MOVE", {
          path,
          dest_path: destPath.trim(),
        });
        await refreshListing(true);
        toast.success(mode === "copy" ? "Copied successfully" : "Moved successfully");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : `${mode} failed`);
      } finally {
        setLoading(false);
      }
    },
    [exec, refreshListing, selectedPaths]
  );

  const mkdirInFlightRef = useRef(false);

  const createFolder = useCallback(
    async (name: string) => {
      if (!name.trim() || mkdirInFlightRef.current) return;
      mkdirInFlightRef.current = true;
      setLoading(true);
      try {
        await exec("FILE_MKDIR", { path: currentPathRef.current, name: name.trim() });
        await listDirectory(currentPathRef.current, true);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Create folder failed");
        setLoading(false);
      } finally {
        mkdirInFlightRef.current = false;
      }
    },
    [exec, listDirectory]
  );

  const saveEdit = useCallback(async () => {
    if (!previewPath) return;
    setLoading(true);
    try {
      await exec("FILE_WRITE_TEXT", { path: previewPath, content: editContent });
      setEditMode(false);
      setPreviewText(editContent);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
      setLoading(false);
    }
  }, [editContent, exec, previewPath]);

  const saveMetadata = useCallback(async () => {
    const path = selectedPaths[0];
    if (!path) return;
    setLoading(true);
    try {
      await exec("FILE_SET_METADATA", {
        path,
        tags: metaTags.split(",").map((t) => t.trim()).filter(Boolean),
        category: metaCategory,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Metadata save failed");
      setLoading(false);
    }
  }, [exec, metaCategory, metaTags, selectedPaths]);

  const loadMetadata = useCallback(async () => {
    const path = selectedPaths[0];
    if (!path) return;
    setLoading(true);
    try {
      await exec("FILE_GET_METADATA", { path });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Metadata load failed");
      setLoading(false);
    }
  }, [exec, selectedPaths]);

  const toggleReadonly = useCallback(async () => {
    const entry = items.find((i) => i.path === selectedPaths[0]);
    if (!entry) return;
    setLoading(true);
    try {
      await exec("FILE_SET_PERMISSIONS", { path: entry.path, readonly: !entry.readonly });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Permission update failed");
      setLoading(false);
    }
  }, [exec, items, selectedPaths]);

  const compressInFlightRef = useRef(false);

  const compressSelected = useCallback(async () => {
    const entry = items.find((i) => i.path === selectedPaths[0]);
    if (!entry || compressInFlightRef.current) return;
    compressInFlightRef.current = true;
    setLoading(true);
    try {
      await exec("FILE_COMPRESS", { path: entry.path, zip_name: `${entry.name}.zip` });
      await refreshListing(true);
      toast.success("Compressed successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Compress failed");
    } finally {
      compressInFlightRef.current = false;
      setLoading(false);
    }
  }, [exec, items, refreshListing, selectedPaths]);

  const decompressSelected = useCallback(async () => {
    const path = selectedPaths[0];
    if (!path) return;
    setLoading(true);
    try {
      await exec("FILE_DECOMPRESS", { path });
      await refreshListing(true);
      toast.success("Extracted successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Extract failed");
    } finally {
      setLoading(false);
    }
  }, [exec, refreshListing, selectedPaths]);

  const uploadToVirtualCloud = useCallback(
    async (blob: Blob, fileName: string, originalPath = "", targetFolder?: string) => {
      const formData = new FormData();
      formData.append("file", blob, fileName);
      formData.append("deviceId", resolveDeviceId() || selectedDeviceRef.current);
      formData.append("virtualFolder", targetFolder ?? cloudUploadFolder);
      formData.append("originalPath", originalPath);
      const res = await fetch("/api/virtual-files/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!data.success || !data.item) {
        throw new Error(data.message || "Cloud upload failed");
      }
      return data.item as CloudBackupEntry;
    },
    [cloudUploadFolder]
  );

  const uploadDropToCloud = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList?.length) return;
      setLoading(true);
      try {
        for (const file of Array.from(fileList)) {
          const formData = new FormData();
          formData.append("file", file);
          formData.append("deviceId", resolveDeviceId() || selectedDeviceRef.current);
          formData.append("virtualFolder", cloudUploadFolder);
          const res = await fetch("/api/virtual-files/upload", { method: "POST", body: formData });
          const data = await res.json();
          if (!data.success) throw new Error(data.message || "Upload failed");
        }
        toast.success("Uploaded to cloud vault");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Cloud upload failed");
      } finally {
        setLoading(false);
      }
    },
    [cloudUploadFolder]
  );

  const backupEntryToCloud = useCallback(
    async (entry: FileEntry) => {
      if (entry.kind !== "file") {
        toast.error("Only files can be backed up");
        return;
      }
      setLoading(true);
      try {
        const packet = await exec("FILE_DOWNLOAD", { path: entry.path });
        const fr = (packet.file_result || {}) as Record<string, unknown>;
        if (!fr.inline || typeof fr.content_b64 !== "string") {
          throw new Error("File too large for cloud backup in this view");
        }
        const blob = b64ToBlob(fr.content_b64, mimeForName(entry.name));
        await uploadToVirtualCloud(blob, entry.name, entry.path);
        await exec("FILE_SET_METADATA", {
          path: entry.path,
          add_version: {
            id: String(Date.now()),
            label: "cloud-backup",
            cloud_url: entry.path,
            created_at: new Date().toISOString(),
          },
        });
        toast.success(`${entry.name} backed up to cloud`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Backup failed");
      } finally {
        setLoading(false);
      }
    },
    [exec, uploadToVirtualCloud]
  );

  const backupToCloud = useCallback(async () => {
    const entry = items.find((i) => i.path === selectedPaths[0]);
    if (!entry || entry.kind !== "file") {
      toast.error("Select a file to backup");
      return;
    }
    await backupEntryToCloud(entry);
  }, [backupEntryToCloud, items, selectedPaths]);

  const handleLocalDragToCloud = useCallback(
    async (entry: FileEntry) => {
      await backupEntryToCloud(entry);
    },
    [backupEntryToCloud]
  );

  const shareCloudFile = useCallback(async (fileId: string) => {
    try {
      const res = await fetch(`/api/virtual-files/${encodeURIComponent(fileId)}/share`, {
        method: "POST",
      });
      const data = await res.json();
      if (!data.success || !data.item?.shareUrl) {
        throw new Error(data.message || "Share failed");
      }
      await navigator.clipboard.writeText(data.item.shareUrl);
      setCloudBackups((prev) =>
        prev.map((f) =>
          f.id === fileId
            ? { ...f, shareUrl: data.item.shareUrl, shareToken: data.item.shareToken }
            : f
        )
      );
      toast.success("Share link copied");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Share failed");
    }
  }, []);

  const restoreFromCloud = useCallback(
    async (url: string, fileName: string) => {
      setLoading(true);
      try {
        const res = await fetch(url);
        const blob = await res.blob();
        const content_b64 = await blobToBase64(blob);
        await exec("FILE_UPLOAD", {
          path: currentPathRef.current,
          file_name: fileName,
          content_b64,
        });
        toast.success("Restored from Cloudinary");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Restore failed");
      } finally {
        setLoading(false);
      }
    },
    [exec]
  );

  const handleCloudDragToLocal = useCallback(
    async (backup: CloudBackupEntry) => {
      await restoreFromCloud(backup.url, backup.name);
    },
    [restoreFromCloud]
  );

  const selectedEntry = items.find((i) => i.path === selectedPaths[0]) || null;
  const cloudSelectedEntry = cloudItems.find((i) => i.id === selectedPaths[0]) || null;
  const activeSelectedEntry =
    browseSurface === "local"
      ? selectedEntry
      : cloudSelectedEntry
        ? {
            name: cloudSelectedEntry.name,
            path: cloudSelectedEntry.id,
            kind: (cloudSelectedEntry.kind === "folder" ? "folder" : "file") as FileEntry["kind"],
            size: cloudSelectedEntry.size || 0,
            size_label: cloudSelectedEntry.size_label || "--",
            modified: cloudSelectedEntry.time || "—",
          }
        : null;

  return {
    isConnected: Boolean(selectedDevice) && isDeviceOnline(selectedDevice) && isConnected,
    devices,
    selectedDevice,
    setSelectedDevice,
    currentPath,
    homePath,
    items,
    searchResults,
    setSearchResults,
    quickRoots,
    loading,
    selectedPaths,
    setSelectedPaths,
    viewMode,
    setViewMode,
    sortKey,
    setSortKey,
    sortAsc,
    setSortAsc,
    localFilter,
    setLocalFilter,
    previewPath,
    previewText,
    previewBlobUrl,
    editContent,
    setEditContent,
    editMode,
    setEditMode,
    metaTags,
    setMetaTags,
    metaCategory,
    setMetaCategory,
    cloudBackups,
    cloudUploadFolder,
    setCloudUploadFolder,
    cloudFolderOptions,
    browseSurface,
    cloudCurrentFolder,
    cloudItems,
    mediaCloudRoots: MEDIA_CLOUD_ROOTS,
    selectedEntry: activeSelectedEntry,
    initExplorer,
    listDirectory,
    navigateTo,
    goUp,
    goBack,
    goForward,
    openEntry,
    runAgentSearch,
    uploadFiles,
    downloadSelected,
    deleteSelected,
    renameSelected,
    transferSelected,
    createFolder,
    saveEdit,
    saveMetadata,
    loadMetadata,
    toggleReadonly,
    compressSelected,
    decompressSelected,
    backupToCloud,
    backupEntryToCloud,
    restoreFromCloud,
    shareCloudFile,
    handleLocalDragToCloud,
    uploadDropToCloud,
    refreshVirtualFiles,
    createCloudFolder,
    browseCloudFolder,
    browseTrash,
    returnToLocalBrowse,
    openCloudEntry,
    deleteCloudSelected,
    restoreCloudSelected,
    purgeCloudSelected,
    ensureConnected,
  };
}

function isTextFile(name: string) {
  return /\.(txt|md|json|js|ts|tsx|jsx|css|html|xml|yaml|yml|log|csv|env|rs|py|toml|ini|cfg)$/i.test(name);
}

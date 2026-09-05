"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { CloudBackupEntry, FileEntry, MediaQuickRoot, VirtualFolderOption } from "@/lib/file-manager/types";
import { blobToBase64 } from "@/lib/file-manager/utils";
import { parseApiResponse } from "@/lib/parse-api-response";

const DEFAULT_QUICK_ROOTS: MediaQuickRoot[] = [
  { label: "Screenshots", path: "/Screenshots" },
  { label: "Screenshots / Camera", path: "/Screenshots/Camera" },
  { label: "Screenshots / Screen", path: "/Screenshots/Screen" },
  { label: "Recordings", path: "/Recordings" },
  { label: "Recordings / Camera", path: "/Recordings/Camera" },
  { label: "Recordings / Screen", path: "/Recordings/Screen" },
];

function toFileEntry(item: CloudBackupEntry): FileEntry {
  return {
    name: item.name,
    path: item.id,
    kind: item.kind === "folder" ? "folder" : "file",
    size: item.size || 0,
    size_label: item.size_label || "--",
    modified: item.time || "—",
    category: item.pageType,
    tags: item.fileType ? [item.fileType] : undefined,
  };
}

export function useCloudVault(deviceId: string, initialFolder = "/") {
  const [currentFolder, setCurrentFolder] = useState(initialFolder);
  const [trashMode, setTrashMode] = useState(false);
  const [items, setItems] = useState<CloudBackupEntry[]>([]);
  const [rawItems, setRawItems] = useState<CloudBackupEntry[]>([]);
  const [quickRoots, setQuickRoots] = useState<MediaQuickRoot[]>(DEFAULT_QUICK_ROOTS);
  const [folderOptions, setFolderOptions] = useState<VirtualFolderOption[]>([
    { label: "Cloud Drive (root)", value: "/" },
  ]);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [localFilter, setLocalFilter] = useState("");
  const currentFolderRef = useRef(currentFolder);
  const trashModeRef = useRef(trashMode);
  currentFolderRef.current = currentFolder;
  trashModeRef.current = trashMode;

  const loadFolders = useCallback(async () => {
    if (!deviceId) return;
    try {
      const res = await fetch(`/api/virtual-files/folders?deviceId=${encodeURIComponent(deviceId)}`);
      const data = await parseApiResponse<{
        success?: boolean;
        folders?: VirtualFolderOption[];
        quickRoots?: MediaQuickRoot[];
        message?: string;
      }>(res);
      if (data.success && Array.isArray(data.folders)) {
        setFolderOptions(data.folders);
      }
      if (Array.isArray(data.quickRoots)) {
        setQuickRoots(data.quickRoots);
      }
      if (!data.success && data.message) {
        toast.error(data.message);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load cloud folders");
    }
  }, [deviceId]);

  const browse = useCallback(
    async (folder?: string) => {
      if (!deviceId) return;
      const target = folder ?? currentFolderRef.current;
      setLoading(true);
      setTrashMode(false);
      try {
        const res = await fetch(
          `/api/virtual-files/browse?deviceId=${encodeURIComponent(deviceId)}&folder=${encodeURIComponent(target)}`
        );
        const data = await parseApiResponse<{
          success?: boolean;
          message?: string;
          folder?: string;
          items?: CloudBackupEntry[];
          quickRoots?: MediaQuickRoot[];
        }>(res);
        if (!data.success) throw new Error(data.message || "Browse failed");
        setCurrentFolder(data.folder || target);
        setRawItems(data.items || []);
        setItems(data.items || []);
        if (Array.isArray(data.quickRoots)) setQuickRoots(data.quickRoots);
        setSelectedIds([]);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not load cloud folder");
      } finally {
        setLoading(false);
      }
    },
    [deviceId]
  );

  const browseTrash = useCallback(async () => {
    if (!deviceId) return;
    setLoading(true);
    setTrashMode(true);
    try {
      const res = await fetch(`/api/virtual-files/trash?deviceId=${encodeURIComponent(deviceId)}`);
      const data = await parseApiResponse<{
        success?: boolean;
        message?: string;
        items?: CloudBackupEntry[];
      }>(res);
      if (!data.success) throw new Error(data.message || "Trash load failed");
      setCurrentFolder("/.Trash");
      setRawItems(data.items || []);
      setItems(data.items || []);
      setSelectedIds([]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load trash");
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => {
    if (!deviceId) return;
    void (async () => {
      await loadFolders();
      if (initialFolder === "/.Trash") {
        await browseTrash();
      } else {
        await browse(initialFolder);
      }
    })();
  }, [deviceId, initialFolder, browse, browseTrash, loadFolders]);

  const displayRows = useMemo(() => {
    const q = localFilter.trim().toLowerCase();
    const filtered = q ? items.filter((i) => i.name.toLowerCase().includes(q)) : items;
    return filtered.map(toFileEntry);
  }, [items, localFilter]);

  const selectedItem = rawItems.find((i) => i.id === selectedIds[0]) || null;

  const navigateToFolder = useCallback(
    (folderPath: string) => {
      if (folderPath === "/.Trash") {
        void browseTrash();
        return;
      }
      void browse(folderPath);
    },
    [browse, browseTrash]
  );

  const openEntry = useCallback(
    (entry: FileEntry) => {
      const item = rawItems.find((i) => i.id === entry.path);
      if (!item) return;
      if (item.kind === "folder" && item.virtualPath) {
        navigateToFolder(item.virtualPath);
      }
    },
    [navigateToFolder, rawItems]
  );

  const goUp = useCallback(() => {
    if (trashModeRef.current) {
      void browse("/");
      return;
    }
    const folder = currentFolderRef.current;
    if (folder === "/") return;
    const idx = folder.lastIndexOf("/");
    const parent = idx <= 0 ? "/" : folder.slice(0, idx);
    navigateToFolder(parent || "/");
  }, [browse, navigateToFolder]);

  const uploadFiles = useCallback(
    async (fileList: FileList | null, targetFolder?: string) => {
      if (!fileList?.length || !deviceId) return;
      setLoading(true);
      const folder = targetFolder ?? currentFolderRef.current;
      for (const file of Array.from(fileList)) {
        try {
          const formData = new FormData();
          formData.append("file", file);
          formData.append("deviceId", deviceId);
          formData.append("virtualFolder", folder);
          formData.append("pageType", "file");
          const res = await fetch("/api/virtual-files/upload", { method: "POST", body: formData });
          const data = await parseApiResponse<{ success?: boolean; message?: string }>(res);
          if (!data.success) throw new Error(data.message || "Upload failed");
        } catch (err) {
          toast.error(err instanceof Error ? err.message : `Upload failed: ${file.name}`);
        }
      }
      await browse(folder);
      await loadFolders();
      toast.success("Uploaded to cloud vault");
      setLoading(false);
    },
    [browse, deviceId, loadFolders]
  );

  const uploadBlob = useCallback(
    async (blob: Blob, fileName: string, originalPath = "", targetFolder?: string) => {
      if (!deviceId) return;
      const folder = targetFolder ?? currentFolderRef.current;
      const formData = new FormData();
      formData.append("file", blob, fileName);
      formData.append("deviceId", deviceId);
      formData.append("virtualFolder", folder);
      formData.append("originalPath", originalPath);
      formData.append("pageType", "file");
      const res = await fetch("/api/virtual-files/upload", { method: "POST", body: formData });
      const data = await parseApiResponse<{ success?: boolean; message?: string; item?: CloudBackupEntry }>(res);
      if (!data.success) throw new Error(data.message || "Upload failed");
      await browse(folder);
      await loadFolders();
      return data.item as CloudBackupEntry;
    },
    [browse, deviceId, loadFolders]
  );

  const createFolder = useCallback(
    async (name: string, parentPath?: string) => {
      if (!deviceId || !name.trim()) return;
      setLoading(true);
      try {
        const res = await fetch("/api/virtual-files/folders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            deviceId,
            parentPath: parentPath ?? currentFolderRef.current,
            name: name.trim(),
          }),
        });
        const data = await parseApiResponse<{ success?: boolean; message?: string }>(res);
        if (!data.success) throw new Error(data.message || "Create folder failed");
        const targetParent = parentPath ?? currentFolderRef.current;
        await browse(targetParent);
        await loadFolders();
        toast.success("Folder created");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Create folder failed");
      } finally {
        setLoading(false);
      }
    },
    [browse, deviceId, loadFolders]
  );

  const deleteSelected = useCallback(async () => {
    const item = rawItems.find((i) => i.id === selectedIds[0]);
    if (!item) return;
    setLoading(true);
    try {
      const endpoint =
        item.kind === "folder"
          ? `/api/virtual-files/folders/${encodeURIComponent(item.id)}`
          : `/api/virtual-files/${encodeURIComponent(item.id)}`;
      const res = await fetch(endpoint, { method: "DELETE" });
      const data = await parseApiResponse<{ success?: boolean; message?: string }>(res);
      if (!data.success) throw new Error(data.message || "Delete failed");
      if (trashModeRef.current) {
        await browseTrash();
      } else {
        await browse(currentFolderRef.current);
      }
      await loadFolders();
      setSelectedIds([]);
      toast.success(item.kind === "folder" ? "Folder deleted" : "Moved to trash");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setLoading(false);
    }
  }, [browse, browseTrash, loadFolders, rawItems, selectedIds]);

  const restoreSelected = useCallback(async () => {
    const item = rawItems.find((i) => i.id === selectedIds[0]);
    if (!item || item.kind === "folder") return;
    setLoading(true);
    try {
      const res = await fetch(`/api/virtual-files/${encodeURIComponent(item.id)}/restore`, {
        method: "POST",
      });
      const data = await parseApiResponse<{ success?: boolean; message?: string }>(res);
      if (!data.success) throw new Error(data.message || "Restore failed");
      await browseTrash();
      setSelectedIds([]);
      toast.success("Restored from trash");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setLoading(false);
    }
  }, [browseTrash, rawItems, selectedIds]);

  const purgeSelected = useCallback(async () => {
    const item = rawItems.find((i) => i.id === selectedIds[0]);
    if (!item || item.kind === "folder") return;
    setLoading(true);
    try {
      const res = await fetch(`/api/virtual-files/${encodeURIComponent(item.id)}/permanent`, {
        method: "DELETE",
      });
      const data = await parseApiResponse<{ success?: boolean; message?: string }>(res);
      if (!data.success) throw new Error(data.message || "Permanent delete failed");
      await browseTrash();
      setSelectedIds([]);
      toast.success("Permanently deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Permanent delete failed");
    } finally {
      setLoading(false);
    }
  }, [browseTrash, rawItems, selectedIds]);

  const renameSelected = useCallback(
    async (newName: string) => {
      const item = rawItems.find((i) => i.id === selectedIds[0]);
      if (!item || item.kind === "folder" || !newName.trim()) return;
      setLoading(true);
      try {
        const res = await fetch(`/api/virtual-files/${encodeURIComponent(item.id)}/rename`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newName.trim() }),
        });
        const data = await parseApiResponse<{ success?: boolean; message?: string }>(res);
        if (!data.success) throw new Error(data.message || "Rename failed");
        if (trashModeRef.current) await browseTrash();
        else await browse(currentFolderRef.current);
        toast.success("Renamed");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Rename failed");
      } finally {
        setLoading(false);
      }
    },
    [browse, browseTrash, rawItems, selectedIds]
  );

  const moveSelected = useCallback(
    async (destFolder: string) => {
      const item = rawItems.find((i) => i.id === selectedIds[0]);
      if (!item || item.kind === "folder" || !destFolder.trim()) return;
      setLoading(true);
      try {
        const res = await fetch(`/api/virtual-files/${encodeURIComponent(item.id)}/move`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ virtualFolder: destFolder.trim() }),
        });
        const data = await parseApiResponse<{ success?: boolean; message?: string }>(res);
        if (!data.success) throw new Error(data.message || "Move failed");
        await browse(currentFolderRef.current);
        toast.success("Moved");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Move failed");
      } finally {
        setLoading(false);
      }
    },
    [browse, rawItems, selectedIds]
  );

  const shareSelected = useCallback(async () => {
    const item = rawItems.find((i) => i.id === selectedIds[0]);
    if (!item || item.kind === "folder") return;
    try {
      const res = await fetch(`/api/virtual-files/${encodeURIComponent(item.id)}/share`, {
        method: "POST",
      });
      const data = await parseApiResponse<{
        success?: boolean;
        message?: string;
        item?: CloudBackupEntry;
      }>(res);
      if (!data.success || !data.item?.shareUrl) throw new Error(data.message || "Share failed");
      await navigator.clipboard.writeText(data.item.shareUrl);
      toast.success("Share link copied");
      if (trashModeRef.current) await browseTrash();
      else await browse(currentFolderRef.current);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Share failed");
    }
  }, [browse, browseTrash, rawItems, selectedIds]);

  const downloadSelected = useCallback(async () => {
    const item = rawItems.find((i) => i.id === selectedIds[0]);
    if (!item || item.kind === "folder" || !item.url) return;
    try {
      const res = await fetch(item.url);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = item.name;
      link.click();
      URL.revokeObjectURL(url);
      toast.success(`Downloaded ${item.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed");
    }
  }, [rawItems, selectedIds]);

  const restoreToAgent = useCallback(
    async (
      item: CloudBackupEntry,
      agentDeviceId: string,
      localPath: string,
      execUpload: (path: string, fileName: string, content_b64: string) => Promise<void>
    ) => {
      if (!item.url || item.kind === "folder") return;
      setLoading(true);
      try {
        const res = await fetch(item.url);
        const blob = await res.blob();
        const content_b64 = await blobToBase64(blob);
        await execUpload(localPath, item.name, content_b64);
        toast.success(`Restored ${item.name} to agent`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Restore failed");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const breadcrumbs = useMemo(() => {
    if (trashMode) {
      return [
        { label: "Cloud Drive", path: "/" },
        { label: "Trash", path: "/.Trash" },
      ];
    }
    const folder = currentFolder === "/" ? [] : currentFolder.split("/").filter(Boolean);
    const crumbs = [{ label: "Cloud Drive", path: "/" }];
    let acc = "";
    for (const part of folder) {
      acc += `/${part}`;
      crumbs.push({ label: part, path: acc });
    }
    return crumbs;
  }, [currentFolder, trashMode]);

  return {
    currentFolder,
    trashMode,
    items,
    rawItems,
    folderOptions,
    quickRoots,
    loading,
    selectedIds,
    setSelectedIds,
    selectedItem,
    viewMode,
    setViewMode,
    localFilter,
    setLocalFilter,
    displayRows,
    breadcrumbs,
    browse,
    browseTrash,
    loadFolders,
    navigateToFolder,
    openEntry,
    goUp,
    uploadFiles,
    uploadBlob,
    createFolder,
    deleteSelected,
    restoreSelected,
    purgeSelected,
    renameSelected,
    moveSelected,
    shareSelected,
    downloadSelected,
    restoreToAgent,
  };
}

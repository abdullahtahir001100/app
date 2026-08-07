"use client";

import { useMemo, useRef, useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Select from "react-select";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Cloud,
  CloudUpload,
  Copy,
  Download,
  Edit2,
  ExternalLink,
  FolderPlus,
  Grid3X3,
  Home,
  LayoutList,
  Move,
  RefreshCw,
  Search,
  Share2,
  Shield,
  Trash2,
  Upload,
  Camera,
  Film,
  Maximize2,
  Minimize2,
  Info,
} from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Toaster } from "@/components/ui/sonner";
import { FileDataTable } from "@/components/file-manager/file-data-table";
import {
  CloudFolderCreateDialog,
  CloudFolderPickerDialog,
} from "@/components/file-manager/cloud-folder-picker-dialog";
import { useFileAgent } from "@/hooks/use-file-agent";
import type { DeviceOption } from "@/lib/gateway-client";
import type { FileEntry } from "@/lib/file-manager/types";
import {
  filterEntries,
  getFileIcon,
  isImageFile,
  isTextFile,
  parseBreadcrumbs,
  pathsEqual,
  sortEntries,
} from "@/lib/file-manager/utils";

type DialogKind = "rename" | "move" | "copy" | "mkdir" | null;

export function FileManager() {
  const agent = useFileAgent();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [agentSearch, setAgentSearch] = useState("");
  const [dialogKind, setDialogKind] = useState<DialogKind>(null);
  const [dialogValue, setDialogValue] = useState("");
  const [cloudPickerOpen, setCloudPickerOpen] = useState(false);
  const [cloudMkdirOpen, setCloudMkdirOpen] = useState(false);
  const [cloudMkdirName, setCloudMkdirName] = useState("");
  const [cloudMkdirParent, setCloudMkdirParent] = useState("/");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [metaDialogOpen, setMetaDialogOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const deviceOption = agent.devices.find((d) => d.value === agent.selectedDevice) || null;
  const driveRoots = useMemo(
    () => agent.quickRoots.filter((r) => r.kind === "drive" || /^[A-Za-z]:\/?$/.test(r.path)),
    [agent.quickRoots]
  );
  const folderRoots = useMemo(
    () => agent.quickRoots.filter((r) => !driveRoots.some((d) => d.path === r.path)),
    [agent.quickRoots, driveRoots]
  );
  const breadcrumbs = useMemo(() => {
    if (agent.browseSurface === "trash") {
      return [
        { label: "Cloud Drive", path: "/" },
        { label: "Trash", path: "/.Trash" },
      ];
    }
    if (agent.browseSurface === "cloud") {
      const folder =
        agent.cloudCurrentFolder === "/"
          ? []
          : agent.cloudCurrentFolder.split("/").filter(Boolean);
      const crumbs = [{ label: "Cloud Drive", path: "/" }];
      let acc = "";
      for (const part of folder) {
        acc += `/${part}`;
        crumbs.push({ label: part, path: acc });
      }
      return crumbs;
    }
    return parseBreadcrumbs(agent.currentPath);
  }, [agent.browseSurface, agent.cloudCurrentFolder, agent.currentPath]);

  const cloudDisplayRows = useMemo(() => {
    return agent.cloudItems.map((item) => ({
      name: item.name,
      path: item.id,
      kind: (item.kind === "folder" ? "folder" : "file") as FileEntry["kind"],
      size: item.size || 0,
      size_label: item.size_label || "--",
      modified: item.time || "—",
      category: item.pageType,
      tags: item.fileType ? [item.fileType] : undefined,
    }));
  }, [agent.cloudItems]);

  const displayRows = useMemo(() => {
    if (agent.browseSurface !== "local") {
      const q = agent.localFilter.trim().toLowerCase();
      const filtered = q
        ? cloudDisplayRows.filter((i) => i.name.toLowerCase().includes(q))
        : cloudDisplayRows;
      return sortEntries(filtered, agent.sortKey, agent.sortAsc);
    }
    const source = agent.searchResults ?? agent.items;
    const filtered = filterEntries(source, agent.localFilter);
    return sortEntries(filtered, agent.sortKey, agent.sortAsc);
  }, [
    agent.browseSurface,
    agent.items,
    agent.searchResults,
    agent.localFilter,
    agent.sortKey,
    agent.sortAsc,
    cloudDisplayRows,
  ]);

  const selectedCloudItem = useMemo(
    () => agent.cloudItems.find((i) => i.id === agent.selectedPaths[0]) || null,
    [agent.cloudItems, agent.selectedPaths]
  );

  const agentRef = useRef(agent);
  useEffect(() => {
    agentRef.current = agent;
  }, [agent]);

  const openDialog = useCallback((kind: DialogKind, initial = "") => {
    setDialogKind(kind);
    setDialogValue(initial);
  }, []);

  const handleSelectPaths = useCallback((paths: string[]) => {
    agentRef.current.setSelectedPaths(paths);
  }, []);

  const submitDialog = async () => {
    if (!dialogKind || !dialogValue.trim() || agent.loading) return;
    switch (dialogKind) {
      case "rename":
        await agent.renameSelected(dialogValue);
        break;
      case "move":
        await agent.transferSelected(dialogValue, "move");
        break;
      case "copy":
        await agent.transferSelected(dialogValue, "copy");
        break;
      case "mkdir":
        await agent.createFolder(dialogValue);
        break;
    }
    setDialogKind(null);
    setDialogValue("");
  };

  const handleContextAction = useCallback((entry: FileEntry, action: string) => {
    const a = agentRef.current;
    a.setSelectedPaths([entry.path]);
    if (a.browseSurface !== "local") {
      const cloudItem = a.cloudItems.find((i) => i.id === entry.path);
      switch (action) {
        case "open":
          if (cloudItem?.kind === "folder") a.openCloudEntry(cloudItem);
          else if (cloudItem?.url) window.open(cloudItem.url, "_blank");
          break;
        case "delete":
          if (confirm(`Move ${entry.name} to trash?`)) void a.deleteCloudSelected();
          break;
        case "restore":
          void a.restoreCloudSelected();
          break;
        case "purge":
          if (confirm(`Permanently delete ${entry.name}?`)) void a.purgeCloudSelected();
          break;
      }
      return;
    }
    switch (action) {
      case "open":
        a.openEntry(entry);
        break;
      case "download":
        void a.downloadSelected();
        break;
      case "rename":
        openDialog("rename", entry.name);
        break;
      case "delete":
        if (confirm(`Delete ${entry.name}?`)) void a.deleteSelected();
        break;
      case "copy":
        openDialog("copy", a.currentPath);
        break;
      case "move":
        openDialog("move", a.currentPath);
        break;
      case "zip":
        void a.compressSelected();
        break;
      case "unzip":
        void a.decompressSelected();
        break;
      case "backup":
        void a.backupEntryToCloud(entry);
        break;
      case "readonly":
        void a.toggleReadonly();
        break;
    }
  }, [openDialog]);

  const toggleFullscreen = useCallback(async () => {
    const el = rootRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch {
      toast.error("Fullscreen not available");
    }
  }, []);

  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const openMetadataPopup = useCallback(async () => {
    await agent.loadMetadata();
    setMetaDialogOpen(true);
  }, [agent]);

  const handleOpenEntry = useCallback((entry: FileEntry) => {
    const a = agentRef.current;
    if (a.browseSurface !== "local") {
      const cloudItem = a.cloudItems.find((i) => i.id === entry.path);
      if (cloudItem?.kind === "folder") {
        a.openCloudEntry(cloudItem);
      } else if (cloudItem?.url) {
        window.open(cloudItem.url, "_blank");
      }
      return;
    }
    a.openEntry(entry);
  }, []);

  if (agent.loading && !agent.items.length && !agent.cloudItems.length) {
    return (
      <div className="flex h-screen bg-background">
        <aside className="hidden xl:flex w-64 flex-col gap-4 border-r border-border bg-muted p-6">
          <Skeleton className="h-12 w-32" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-40" />
          <div className="space-y-3 pt-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/6" />
          </div>
        </aside>
        <main className="flex-1 p-6">
          <div className="space-y-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-3">
                <Skeleton className="h-10 w-64" />
                <Skeleton className="h-4 w-48" />
              </div>
              <Skeleton className="h-10 w-28" />
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="flex h-screen bg-background">
      <AppSidebar />
      <Toaster richColors position="top-right" />

      <main className="flex flex-1 flex-col lg:ml-64 min-h-0">
        {/* Header */}
        <div className="border-b border-border px-4 py-4 lg:px-6 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl lg:text-3xl font-display tracking-tight">File Manager</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Live filesystem on Rust agent PC • secured user folders
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => void toggleFullscreen()} title="Fullscreen">
                {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                <span className="ml-1.5 hidden sm:inline">{isFullscreen ? "Exit" : "Fullscreen"}</span>
              </Button>
              <Badge variant={agent.isConnected ? "default" : "destructive"} className="gap-1.5">
                <span className={`h-2 w-2 rounded-full ${agent.isConnected ? "bg-emerald-400" : "bg-rose-400"}`} />
                {agent.isConnected ? "Agent online" : "Offline"}
              </Badge>
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="border-b border-border px-4 py-2 flex flex-wrap items-center gap-2 shrink-0 bg-card/40">
          <Select<DeviceOption, false>
            instanceId="file-manager-device"
            value={deviceOption}
            onChange={(opt) => {
              if (opt) {
                agent.setSelectedDevice(opt.value);
              }
            }}
            options={agent.devices}
            className="min-w-[200px] flex-1 max-w-xs"
            classNamePrefix="react-select"
            placeholder="Select agent…"
            isDisabled={agent.devices.length === 0}
          />

          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" onClick={agent.goBack} title="Back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={agent.goForward} title="Forward">
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                if (agent.browseSurface === "trash") {
                  if (agent.cloudCurrentFolder === "/.Trash") void agent.browseTrash();
                  else agent.returnToLocalBrowse();
                } else if (agent.browseSurface === "cloud") {
                  if (agent.cloudCurrentFolder === "/") agent.returnToLocalBrowse();
                  else {
                    const idx = agent.cloudCurrentFolder.lastIndexOf("/");
                    const parent = idx <= 0 ? "/" : agent.cloudCurrentFolder.slice(0, idx);
                    void agent.browseCloudFolder(parent || "/");
                  }
                } else {
                  agent.goUp();
                }
              }}
              title="Up"
            >
              <ChevronRight className="h-4 w-4 -rotate-90" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                if (agent.browseSurface === "trash") void agent.browseTrash();
                else if (agent.browseSurface === "cloud") void agent.browseCloudFolder(agent.cloudCurrentFolder);
                else void agent.listDirectory();
              }}
              disabled={agent.loading}
              title="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${agent.loading ? "animate-spin" : ""}`} />
            </Button>
          </div>

          <Separator orientation="vertical" className="h-8 hidden sm:block" />

          {agent.browseSurface === "trash" ? (
            <>
              <Button size="sm" variant="outline" disabled={!agent.selectedEntry} onClick={() => void agent.restoreCloudSelected()}>
                <ArchiveRestore className="h-4 w-4 mr-1.5" /> Restore
              </Button>
              <Button size="sm" variant="destructive" disabled={!agent.selectedEntry} onClick={() => agent.selectedEntry && confirm(`Delete ${agent.selectedEntry.name} forever?`) && void agent.purgeCloudSelected()}>
                <Trash2 className="h-4 w-4 mr-1.5" /> Delete forever
              </Button>
              <Button size="sm" variant="outline" onClick={() => agent.returnToLocalBrowse()}>
                Back to local PC
              </Button>
            </>
          ) : agent.browseSurface === "cloud" ? (
            <>
              <Button size="sm" variant="outline" onClick={() => agent.returnToLocalBrowse()}>
                Back to local PC
              </Button>
              <Button size="sm" variant="destructive" disabled={!agent.selectedEntry} onClick={() => agent.selectedEntry && confirm(`Move ${agent.selectedEntry.name} to trash?`) && void agent.deleteCloudSelected()}>
                <Trash2 className="h-4 w-4 mr-1.5" /> Move to trash
              </Button>
            </>
          ) : null}

          {agent.browseSurface === "local" && (
            <>
          <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4 mr-1.5" /> Upload
          </Button>
          <Button size="sm" variant="outline" onClick={() => openDialog("mkdir")}>
            <FolderPlus className="h-4 w-4 mr-1.5" /> New folder
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!agent.selectedEntry}
            onClick={() => void agent.downloadSelected()}
          >
            <Download className="h-4 w-4 mr-1.5" /> Download
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!agent.selectedEntry}
            onClick={() => openDialog("rename", agent.selectedEntry?.name || "")}
          >
            <Edit2 className="h-4 w-4 mr-1.5" /> Rename
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={!agent.selectedEntry}
            onClick={() => {
              if (agent.selectedEntry && confirm(`Delete ${agent.selectedEntry.name}?`)) {
                void agent.deleteSelected();
              }
            }}
          >
            <Trash2 className="h-4 w-4 mr-1.5" /> Delete
          </Button>
            </>
          )}

          <div className="ml-auto flex items-center gap-1">
            <Button
              size="icon"
              variant={agent.viewMode === "list" ? "secondary" : "ghost"}
              onClick={() => agent.setViewMode("list")}
            >
              <LayoutList className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant={agent.viewMode === "grid" ? "secondary" : "ghost"}
              onClick={() => agent.setViewMode("grid")}
            >
              <Grid3X3 className="h-4 w-4" />
            </Button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => void agent.uploadFiles(e.target.files)}
          />
        </div>

        {/* Breadcrumb + search */}
        <div className="px-4 py-2 flex flex-col sm:flex-row gap-2 shrink-0 border-b border-border/60">
          <div className="flex items-center gap-1 flex-wrap text-sm min-w-0 flex-1">
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => {
              if (agent.browseSurface === "trash") void agent.browseTrash();
              else if (agent.browseSurface === "cloud") void agent.browseCloudFolder("/");
              else if (agent.homePath) agent.navigateTo(agent.homePath);
            }}>
              <Home className="h-3.5 w-3.5" />
            </Button>
            {breadcrumbs.map((crumb) => (
              <div key={crumb.path} className="flex items-center gap-1 min-w-0">
                <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                <button
                  type="button"
                  className="truncate max-w-[140px] hover:text-foreground text-muted-foreground"
                  onClick={() => {
                    if (crumb.path === "/.Trash") void agent.browseTrash();
                    else if (agent.browseSurface !== "local") void agent.browseCloudFolder(crumb.path);
                    else agent.navigateTo(crumb.path);
                  }}
                >
                  {crumb.label}
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2 sm:w-auto w-full">
            <div className="relative flex-1 sm:w-48">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={agent.localFilter}
                onChange={(e) => agent.setLocalFilter(e.target.value)}
                placeholder="Filter current folder…"
                className="pl-8 h-8 text-sm"
              />
            </div>
            <Input
              value={agentSearch}
              onChange={(e) => setAgentSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void agent.runAgentSearch(agentSearch)}
              placeholder="Deep search (agent)…"
              className="h-8 text-sm sm:w-52"
              disabled={agent.browseSurface !== "local"}
            />
          </div>
        </div>

        {/* Main panels */}
        <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
          <ResizablePanel defaultSize={18} minSize={14} maxSize={28} className="min-h-0">
            <ScrollArea className="h-full border-r border-border bg-sidebar/30">
              <div className="p-3 space-y-4">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    This PC
                  </p>
                  <div className="space-y-1">
                    {driveRoots.length === 0 ? (
                      <p className="text-xs text-muted-foreground px-2">
                        {agent.loading ? "Loading drives…" : "No drives found"}
                      </p>
                    ) : (
                      driveRoots.map((root) => (
                        <button
                          key={root.path}
                          type="button"
                          onClick={() => agent.navigateTo(root.path)}
                          className={`w-full text-left rounded-md px-2.5 py-2 text-sm transition-colors ${
                            pathsEqual(agent.currentPath, root.path)
                              ? "bg-accent text-accent-foreground font-medium"
                              : "hover:bg-accent/50 text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {root.label}
                        </button>
                      ))
                    )}
                  </div>
                </div>
                <Separator />
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    Quick access
                  </p>
                  <div className="space-y-1">
                    {folderRoots.map((root) => (
                      <button
                        key={root.path}
                        type="button"
                        onClick={() => agent.navigateTo(root.path)}
                        className={`w-full text-left rounded-md px-2.5 py-2 text-sm transition-colors ${
                          pathsEqual(agent.currentPath, root.path)
                            ? "bg-accent text-accent-foreground font-medium"
                            : "hover:bg-accent/50 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {root.label}
                      </button>
                    ))}
                  </div>
                </div>
                <Separator />
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    Camera & screen media
                  </p>
                  <div className="space-y-1 mb-2">
                    {agent.mediaCloudRoots.map((root) => (
                      <button
                        key={root.path}
                        type="button"
                        onClick={() => void agent.browseCloudFolder(root.path)}
                        className={`w-full text-left rounded-md px-2.5 py-2 text-xs transition-colors flex items-center gap-1.5 ${
                          agent.browseSurface === "cloud" && agent.cloudCurrentFolder === root.path
                            ? "bg-accent text-accent-foreground font-medium"
                            : "hover:bg-accent/50 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {root.path.includes("Recordings") ? (
                          <Film className="h-3 w-3 shrink-0" />
                        ) : root.path.includes("Screen") ? (
                          <Monitor className="h-3 w-3 shrink-0" />
                        ) : (
                          <Camera className="h-3 w-3 shrink-0" />
                        )}
                        {root.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => void agent.browseTrash()}
                      className={`w-full text-left rounded-md px-2.5 py-2 text-xs transition-colors flex items-center gap-1.5 ${
                        agent.browseSurface === "trash"
                          ? "bg-destructive/15 text-destructive font-medium"
                          : "hover:bg-accent/50 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Trash2 className="h-3 w-3 shrink-0" /> Trash (separate)
                    </button>
                  </div>
                </div>
                <Separator />
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    Cloud vault
                  </p>
                  <div className="flex gap-1 mb-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 flex-1 text-[10px] px-2"
                      onClick={() => setCloudPickerOpen(true)}
                    >
                      Choose folder
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 flex-1 text-[10px] px-2"
                      onClick={() => {
                        setCloudMkdirParent(agent.cloudUploadFolder || "/");
                        setCloudMkdirName("");
                        setCloudMkdirOpen(true);
                      }}
                    >
                      <FolderPlus className="h-3 w-3 mr-1" />
                      New
                    </Button>
                  </div>
                  <Select<{ label: string; value: string }, false>
                    instanceId="cloud-upload-folder"
                    value={
                      agent.cloudFolderOptions.find((f) => f.value === agent.cloudUploadFolder) ||
                      agent.cloudFolderOptions[0] ||
                      null
                    }
                    onChange={(opt) => {
                      if (opt) agent.setCloudUploadFolder(opt.value);
                    }}
                    options={agent.cloudFolderOptions}
                    className="text-xs mb-2"
                    classNamePrefix="react-select"
                    placeholder="Virtual folder…"
                  />
                  <div
                    className="rounded-lg border border-dashed border-border/80 bg-muted/20 p-3 min-h-[96px] transition-colors data-[active=true]:border-primary data-[active=true]:bg-primary/5"
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.currentTarget.dataset.active = "true";
                    }}
                    onDragLeave={(e) => {
                      e.currentTarget.dataset.active = "false";
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.currentTarget.dataset.active = "false";
                      const localPath = e.dataTransfer.getData("application/x-zenvora-file");
                      if (localPath) {
                        const entry = agent.items.find((i) => i.path === localPath);
                        if (entry) void agent.handleLocalDragToCloud(entry);
                        return;
                      }
                      void agent.uploadDropToCloud(e.dataTransfer.files);
                    }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Cloud className="h-4 w-4 text-sky-500" />
                      <p className="text-xs font-medium">Drop to backup</p>
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      Drag files here →{" "}
                      <span className="font-medium text-foreground">{agent.cloudUploadFolder || "/"}</span>
                    </p>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="w-full mt-3 h-8 text-xs"
                      onClick={() => {
                        const device = agent.selectedDevice;
                        if (!device) {
                          toast.error("Select agent device first");
                          return;
                        }
                        const folder = encodeURIComponent(agent.cloudUploadFolder || "/");
                        router.push(`/files/cloud?device=${encodeURIComponent(device)}&folder=${folder}`);
                      }}
                    >
                      <ExternalLink className="h-3 w-3 mr-1.5" />
                      Open Cloud Vault
                    </Button>
                  </div>
                </div>
              </div>
            </ScrollArea>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={52} minSize={35} className="min-h-0 p-3">
            <div
              className="h-full min-h-[320px] flex flex-col"
              onDragOver={(e) => agent.browseSurface === "local" && e.preventDefault()}
              onDrop={(e) => {
                if (agent.browseSurface !== "local") return;
                e.preventDefault();
                void agent.uploadFiles(e.dataTransfer.files);
              }}
            >
              {agent.browseSurface === "trash" && (
                <div className="mb-3 shrink-0 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
                  <p className="text-sm font-medium text-destructive">Trash — separate from local PC files</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Cloud vault items deleted for agent {agent.selectedDevice || "—"}. Restore or delete forever.
                  </p>
                </div>
              )}
              {agent.browseSurface === "cloud" && (
                <div className="mb-3 shrink-0 rounded-lg border border-sky-500/30 bg-sky-500/5 px-4 py-3">
                  <p className="text-sm font-medium text-sky-700 dark:text-sky-300">Cloud vault — device {agent.selectedDevice || "—"}</p>
                  <p className="text-xs text-muted-foreground mt-1">{agent.cloudCurrentFolder}</p>
                </div>
              )}
              <div className="flex-1 min-h-0">
              {agent.viewMode === "list" ? (
                <FileDataTable
                  rows={displayRows}
                  selectedPaths={agent.selectedPaths}
                  onSelect={handleSelectPaths}
                  onOpen={handleOpenEntry}
                  onContextAction={handleContextAction}
                />
              ) : (
                <ScrollArea className="h-full rounded-lg border border-border bg-card p-3">
                  {displayRows.length === 0 ? (
                    <p className="text-center text-muted-foreground py-16">
                      {agent.browseSurface === "trash" ? "Trash is empty" : "Empty folder"}
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
                      {displayRows.map((entry) => {
                        const Icon = getFileIcon(entry.name, entry.kind);
                        const selected = agent.selectedPaths.includes(entry.path);
                        return (
                          <ContextMenu key={entry.path}>
                            <ContextMenuTrigger asChild>
                              <button
                                type="button"
                                onClick={() => handleOpenEntry(entry)}
                                className={`rounded-xl border p-3 text-left transition-all hover:shadow-md w-full ${
                                  selected
                                    ? "border-foreground bg-accent/15 ring-1 ring-foreground/20"
                                    : "border-border hover:bg-accent/5"
                                }`}
                              >
                                <Icon className="h-8 w-8 mb-2 text-muted-foreground" />
                                <p className="text-sm font-medium truncate">{entry.name}</p>
                                <p className="text-[10px] text-muted-foreground mt-1">{entry.size_label}</p>
                              </button>
                            </ContextMenuTrigger>
                            <ContextMenuContent className="w-48">
                              {agent.browseSurface === "trash" ? (
                                <>
                                  <ContextMenuItem onClick={() => handleContextAction(entry, "open")}>Open</ContextMenuItem>
                                  <ContextMenuItem onClick={() => handleContextAction(entry, "restore")}>Restore</ContextMenuItem>
                                  <ContextMenuItem onClick={() => handleContextAction(entry, "purge")}>Delete forever</ContextMenuItem>
                                </>
                              ) : agent.browseSurface === "cloud" ? (
                                <>
                                  <ContextMenuItem onClick={() => handleContextAction(entry, "open")}>Open</ContextMenuItem>
                                  <ContextMenuItem onClick={() => handleContextAction(entry, "delete")}>Move to trash</ContextMenuItem>
                                </>
                              ) : (
                                <>
                                  <ContextMenuItem onClick={() => handleContextAction(entry, "open")}>Open</ContextMenuItem>
                                  <ContextMenuItem onClick={() => handleContextAction(entry, "download")}>Download</ContextMenuItem>
                                  <ContextMenuItem onClick={() => handleContextAction(entry, "rename")}>Rename</ContextMenuItem>
                                  <ContextMenuItem onClick={() => handleContextAction(entry, "delete")}>Delete</ContextMenuItem>
                                </>
                              )}
                            </ContextMenuContent>
                          </ContextMenu>
                        );
                      })}
                    </div>
                  )}
                </ScrollArea>
              )}
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={30} minSize={22} maxSize={40} className="min-h-0">
            <ScrollArea className="h-full border-l border-border bg-card/30 p-4">
              <h3 className="font-semibold text-sm mb-3">
                {agent.browseSurface === "trash"
                  ? "Trash details"
                  : agent.browseSurface === "cloud"
                    ? "Cloud details"
                    : "Details & preview"}
              </h3>
              {agent.selectedEntry ? (
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Name</p>
                    <p className="font-medium break-all">{agent.selectedEntry.name}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Size</p>
                      <p>{agent.selectedEntry.size_label}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Type</p>
                      <p className="capitalize">{agent.selectedEntry.kind}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-muted-foreground">Modified</p>
                      <p>{agent.selectedEntry.modified || "—"}</p>
                    </div>
                  </div>
                  {agent.browseSurface === "local" && (
                    <Button size="sm" variant="secondary" className="h-7 text-xs w-full" onClick={() => void openMetadataPopup()}>
                      <Info className="h-3 w-3 mr-1" /> Properties / full metadata
                    </Button>
                  )}
                  {agent.browseSurface !== "local" && selectedCloudItem && (
                    <>
                      <div className="text-xs">
                        <p className="text-muted-foreground">Device</p>
                        <p className="font-mono break-all">{agent.selectedDevice || "—"}</p>
                      </div>
                      {selectedCloudItem.virtualPath && (
                        <div className="text-xs">
                          <p className="text-muted-foreground">Folder</p>
                          <p className="font-mono break-all">{selectedCloudItem.virtualPath}</p>
                        </div>
                      )}
                      {selectedCloudItem.url && selectedCloudItem.kind === "file" && (
                        <img
                          src={selectedCloudItem.url}
                          alt={selectedCloudItem.name}
                          className="max-h-40 rounded-md border border-border w-full object-contain bg-black/5"
                        />
                      )}
                      <div className="flex flex-wrap gap-1">
                        {agent.browseSurface === "trash" ? (
                          <>
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void agent.restoreCloudSelected()}>
                              <ArchiveRestore className="h-3 w-3 mr-1" /> Restore
                            </Button>
                            <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => agent.selectedEntry && confirm(`Delete ${agent.selectedEntry.name} forever?`) && void agent.purgeCloudSelected()}>
                              <Trash2 className="h-3 w-3 mr-1" /> Delete forever
                            </Button>
                          </>
                        ) : (
                          <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => agent.selectedEntry && confirm(`Move ${agent.selectedEntry.name} to trash?`) && void agent.deleteCloudSelected()}>
                            <Trash2 className="h-3 w-3 mr-1" /> Move to trash
                          </Button>
                        )}
                      </div>
                    </>
                  )}
                  {agent.browseSurface === "local" && (
                  <>
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void openMetadataPopup()}>
                      <Info className="h-3 w-3 mr-1" /> Properties
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openDialog("copy", agent.currentPath)}>
                      <Copy className="h-3 w-3 mr-1" /> Copy
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openDialog("move", agent.currentPath)}>
                      <Move className="h-3 w-3 mr-1" /> Move
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void agent.compressSelected()}>
                      <Archive className="h-3 w-3 mr-1" /> Zip
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void agent.backupToCloud()}>
                      <CloudUpload className="h-3 w-3 mr-1" /> Cloud
                    </Button>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <Label className="text-xs">Tags (comma)</Label>
                    <Input value={agent.metaTags} onChange={(e) => agent.setMetaTags(e.target.value)} className="h-8 text-xs" />
                    <Label className="text-xs">Category</Label>
                    <Input value={agent.metaCategory} onChange={(e) => agent.setMetaCategory(e.target.value)} className="h-8 text-xs" />
                    <Button size="sm" onClick={() => void agent.saveMetadata()} className="w-full">
                      Save metadata
                    </Button>
                  </div>
                  </>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Select a file or folder</p>
              )}

              {agent.browseSurface === "local" && (agent.previewText || agent.previewBlobUrl || agent.previewPath) && (
                <Card className="mt-4 p-3 border-border">
                  <div className="flex items-center justify-between mb-2 gap-2">
                    <p className="text-xs font-medium truncate">{agent.previewPath.split("/").pop()}</p>
                    {agent.previewText && isTextFile(agent.previewPath) && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs shrink-0"
                        onClick={() => (agent.editMode ? void agent.saveEdit() : agent.setEditMode(true))}
                      >
                        {agent.editMode ? "Save" : "Edit"}
                      </Button>
                    )}
                  </div>
                  {agent.previewBlobUrl && isImageFile(agent.previewPath) ? (
                    <img src={agent.previewBlobUrl} alt="preview" className="max-h-48 rounded-md border border-border w-full object-contain bg-black/5" />
                  ) : agent.editMode ? (
                    <Textarea
                      value={agent.editContent}
                      onChange={(e) => agent.setEditContent(e.target.value)}
                      className="min-h-[180px] font-mono text-xs"
                    />
                  ) : (
                    <pre className="max-h-48 overflow-auto text-xs font-mono whitespace-pre-wrap bg-muted/40 rounded-md p-2">
                      {agent.previewText || "Binary preview unavailable — download instead"}
                    </pre>
                  )}
                </Card>
              )}
            </ScrollArea>
          </ResizablePanel>
        </ResizablePanelGroup>

        <div className="border-t border-border px-4 py-1.5 text-[11px] text-muted-foreground flex justify-between shrink-0 bg-card/30">
          <span>
            {displayRows.length} items •{" "}
            {agent.browseSurface === "trash"
              ? "Trash"
              : agent.browseSurface === "cloud"
                ? agent.cloudCurrentFolder
                : agent.currentPath || "—"}
            {agent.browseSurface !== "local" && agent.selectedDevice
              ? ` • ${agent.selectedDevice}`
              : ""}
          </span>
          <span>{agent.loading ? "Syncing with agent…" : "Ready"}</span>
        </div>
      </main>

      <Dialog open={dialogKind !== null} onOpenChange={(open) => !open && setDialogKind(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogKind === "rename" && "Rename"}
              {dialogKind === "move" && "Move to folder"}
              {dialogKind === "copy" && "Copy to folder"}
              {dialogKind === "mkdir" && "New folder"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              File manager action dialog
            </DialogDescription>
          </DialogHeader>
          <Input
            value={dialogValue}
            onChange={(e) => setDialogValue(e.target.value)}
            placeholder={
              dialogKind === "mkdir" ? "Folder name" : dialogKind === "rename" ? "New name" : "Destination path"
            }
            onKeyDown={(e) => e.key === "Enter" && void submitDialog()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogKind(null)}>
              Cancel
            </Button>
            <Button onClick={() => void submitDialog()}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CloudFolderPickerDialog
        open={cloudPickerOpen}
        onOpenChange={setCloudPickerOpen}
        options={agent.cloudFolderOptions}
        value={agent.cloudUploadFolder}
        onSelect={agent.setCloudUploadFolder}
        title="Select upload folder"
      />

      <CloudFolderCreateDialog
        open={cloudMkdirOpen}
        onOpenChange={setCloudMkdirOpen}
        options={agent.cloudFolderOptions}
        parentPath={cloudMkdirParent}
        onParentPathChange={setCloudMkdirParent}
        name={cloudMkdirName}
        onNameChange={setCloudMkdirName}
        loading={agent.loading}
        onSubmit={async () => {
          try {
            await agent.createCloudFolder(cloudMkdirName, cloudMkdirParent);
            setCloudMkdirOpen(false);
            setCloudMkdirName("");
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Create folder failed");
          }
        }}
      />

      <Dialog open={metaDialogOpen} onOpenChange={setMetaDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>File properties</DialogTitle>
            <DialogDescription>
              Complete metadata from the agent filesystem
            </DialogDescription>
          </DialogHeader>
          {agent.lastMetadata ? (
            <div className="space-y-2 text-sm">
              {[
                ["Name", agent.lastMetadata.name],
                ["Path", agent.lastMetadata.path],
                ["Size", agent.lastMetadata.sizeLabel || agent.lastMetadata.size],
                ["Extension", agent.lastMetadata.extension],
                ["Created", agent.lastMetadata.created],
                ["Modified", agent.lastMetadata.modified],
                ["Accessed", agent.lastMetadata.accessed],
                ["Owner", agent.lastMetadata.owner],
                ["Read-only", String(agent.lastMetadata.readonly)],
                ["Hidden", String(agent.lastMetadata.hidden)],
                ["System", String(agent.lastMetadata.system)],
                ["Category", agent.lastMetadata.category],
                [
                  "Tags",
                  Array.isArray(agent.lastMetadata.tags)
                    ? (agent.lastMetadata.tags as string[]).join(", ")
                    : agent.lastMetadata.tags,
                ],
              ].map(([label, value]) => (
                <div key={String(label)} className="grid grid-cols-[110px_1fr] gap-2 border-b border-border/60 py-1.5">
                  <span className="text-muted-foreground text-xs">{label}</span>
                  <span className="break-all font-mono text-xs">{value == null || value === "" ? "—" : String(value)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No metadata loaded yet.</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMetaDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

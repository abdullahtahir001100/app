"use client";

import { Suspense, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { alertMsg, Z } from "@/lib/messages";
import {
  ArrowLeft,
  ChevronRight,
  CloudDownload,
  Download,
  Edit2,
  ExternalLink,
  FolderPlus,
  Home,
  LayoutList,
  Move,
  RefreshCw,
  Share2,
  ArchiveRestore,
  Camera,
  Film,
  Monitor,
  Trash2,
  Upload,
} from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Toaster } from "@/components/ui/sonner";
import { FileDataTable } from "@/components/file-manager/file-data-table";
import { CloudFolderCreateDialog } from "@/components/file-manager/cloud-folder-picker-dialog";
import { useCloudVault } from "@/hooks/use-cloud-vault";
import { useGateway } from "@/hooks/use-gateway";
import type { FileEntry } from "@/lib/file-manager/types";

type DialogKind = "rename" | "move" | "mkdir" | null;

function CloudVaultManagerFallback() {
  return (
    <div className="flex h-screen bg-background">
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading cloud vault...
      </div>
    </div>
  );
}

export function CloudVaultManager() {
  return (
    <Suspense fallback={<CloudVaultManagerFallback />}>
      <CloudVaultManagerContent />
    </Suspense>
  );
}

function CloudVaultManagerContent() {
  const searchParams = useSearchParams();
  const { devices, resolveTarget } = useGateway();
  const paramDevice = searchParams.get("device");
  const deviceId =
    paramDevice && paramDevice !== "files"
      ? paramDevice
      : resolveTarget(devices[0]?.value) || paramDevice || "";
  const initialFolder = searchParams.get("folder") || "/";

  const vault = useCloudVault(deviceId, initialFolder);
  const [restoreAgentId, setRestoreAgentId] = useState(deviceId);
  const [restorePath, setRestorePath] = useState("");
  const [dialogKind, setDialogKind] = useState<DialogKind>(null);
  const [dialogValue, setDialogValue] = useState("");
  const [mkdirParent, setMkdirParent] = useState("/");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const execAgentUpload = async (path: string, fileName: string, content_b64: string) => {
    const target = restoreAgentId || deviceId;
    const response = await fetch("/api/files/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        action: "FILE_UPLOAD",
        targetDeviceId: target,
        payload: {
          path,
          file_name: fileName,
          content_b64,
          _requestId: crypto.randomUUID(),
        },
      }),
    });
    const data = await response.json();
    if (!data.success) throw new Error(data.message || "Agent upload failed");
  };

  const openDialog = (kind: DialogKind, initial = "") => {
    setDialogKind(kind);
    setDialogValue(initial);
    if (kind === "mkdir") {
      setMkdirParent(vault.currentFolder);
    }
  };

  const submitDialog = async () => {
    if (!dialogKind || !dialogValue.trim()) return;
    switch (dialogKind) {
      case "rename":
        await vault.renameSelected(dialogValue);
        break;
      case "move":
        await vault.moveSelected(dialogValue);
        break;
      case "mkdir":
        await vault.createFolder(dialogValue, mkdirParent);
        break;
    }
    setDialogKind(null);
    setDialogValue("");
  };

  const handleContextAction = (entry: FileEntry, action: string) => {
    vault.setSelectedIds([entry.path]);
    const item = vault.rawItems.find((i) => i.id === entry.path);
    if (!item) return;
    switch (action) {
      case "open":
        vault.openEntry(entry);
        break;
      case "download":
        void vault.downloadSelected();
        break;
      case "rename":
        if (item.kind !== "folder") openDialog("rename", item.name);
        break;
      case "move":
        if (item.kind !== "folder") openDialog("move", vault.currentFolder);
        break;
      case "delete":
        if (confirm(`Delete ${item.name}?`)) void vault.deleteSelected();
        break;
      case "share":
        void vault.shareSelected();
        break;
      case "restore":
        if (!restorePath.trim()) {
          alertMsg(Z.ENTER_DEST_PATH);
          return;
        }
        void vault.restoreToAgent(item, restoreAgentId, restorePath, execAgentUpload);
        break;
    }
  };

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />
      <Toaster richColors position="top-right" />

      <main className="flex flex-1 flex-col lg:ml-64 min-h-0">
        <div className="border-b border-border px-4 py-4 lg:px-6 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <Link href="/files" className="hover:text-foreground inline-flex items-center gap-1">
                  <ArrowLeft className="h-3 w-3" /> Local files
                </Link>
              </div>
              <h1 className="text-2xl lg:text-3xl font-display tracking-tight">Cloud Vault</h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Database-backed virtual vault (Cloudinary CDN) • {deviceId}
              </p>
            </div>
            <Badge variant="secondary" className="gap-1.5">
              <span className="h-2 w-2 rounded-full bg-sky-400" />
              Virtual drive
            </Badge>
          </div>
        </div>

        <div className="border-b border-border px-4 py-2 flex flex-wrap items-center gap-2 shrink-0 bg-card/40">
          <Button size="icon" variant="ghost" onClick={vault.goUp} title="Up">
            <ChevronRight className="h-4 w-4 -rotate-90" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => (vault.trashMode ? void vault.browse("/") : void vault.browse())}
            disabled={vault.loading}
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${vault.loading ? "animate-spin" : ""}`} />
          </Button>
          <Separator orientation="vertical" className="h-8 hidden sm:block" />
          {!vault.trashMode ? (
            <>
              <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4 mr-1.5" /> Upload
              </Button>
              <Button size="sm" variant="outline" onClick={() => openDialog("mkdir")}>
                <FolderPlus className="h-4 w-4 mr-1.5" /> New folder
              </Button>
              <Button size="sm" variant="outline" disabled={!vault.selectedItem || vault.selectedItem.kind === "folder"} onClick={() => void vault.downloadSelected()}>
                <Download className="h-4 w-4 mr-1.5" /> Download
              </Button>
              <Button size="sm" variant="outline" disabled={!vault.selectedItem || vault.selectedItem.kind === "folder"} onClick={() => void vault.shareSelected()}>
                <Share2 className="h-4 w-4 mr-1.5" /> Share
              </Button>
              <Button size="sm" variant="destructive" disabled={!vault.selectedItem} onClick={() => vault.selectedItem && confirm(`Move ${vault.selectedItem.name} to trash?`) && void vault.deleteSelected()}>
                <Trash2 className="h-4 w-4 mr-1.5" /> Delete
              </Button>
              <Button size="sm" variant="outline" onClick={() => void vault.browseTrash()}>
                <Trash2 className="h-4 w-4 mr-1.5" /> Trash
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="outline" disabled={!vault.selectedItem || vault.selectedItem.kind === "folder"} onClick={() => void vault.restoreSelected()}>
                <ArchiveRestore className="h-4 w-4 mr-1.5" /> Restore
              </Button>
              <Button size="sm" variant="destructive" disabled={!vault.selectedItem || vault.selectedItem.kind === "folder"} onClick={() => vault.selectedItem && confirm(`Permanently delete ${vault.selectedItem.name}?`) && void vault.purgeSelected()}>
                <Trash2 className="h-4 w-4 mr-1.5" /> Delete forever
              </Button>
              <Button size="sm" variant="outline" onClick={() => void vault.browse("/")}>
                Back to drive
              </Button>
            </>
          )}
          <div className="ml-auto flex items-center gap-1">
            <Button size="icon" variant={vault.viewMode === "list" ? "secondary" : "ghost"} onClick={() => vault.setViewMode("list")}>
              <LayoutList className="h-4 w-4" />
            </Button>
          </div>
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => void vault.uploadFiles(e.target.files)} />
        </div>

        <div className="px-4 py-2 flex flex-wrap items-center gap-1 text-sm border-b border-border shrink-0">
          {vault.breadcrumbs.map((crumb, idx) => (
            <span key={crumb.path} className="flex items-center gap-1">
              {idx > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
              <button
                type="button"
                onClick={() => vault.navigateToFolder(crumb.path)}
                className={`hover:underline ${idx === vault.breadcrumbs.length - 1 ? "font-medium" : "text-muted-foreground"}`}
              >
                {idx === 0 ? <Home className="h-3.5 w-3.5 inline mr-1" /> : null}
                {crumb.label}
              </button>
            </span>
          ))}
        </div>

        <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
          <ResizablePanel defaultSize={70} minSize={45} className="min-h-0 p-3">
            <div
              className="h-full min-h-[320px]"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void vault.uploadFiles(e.dataTransfer.files);
              }}
            >
              <FileDataTable
                rows={vault.displayRows}
                selectedPaths={vault.selectedIds}
                onSelect={vault.setSelectedIds}
                onOpen={vault.openEntry}
                onContextAction={handleContextAction}
              />
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={30} minSize={22} maxSize={40} className="min-h-0">
            <ScrollArea className="h-full border-l border-border bg-card/30 p-4">
              <h3 className="font-semibold text-sm mb-3">Details</h3>
              {vault.selectedItem ? (
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Name</p>
                    <p className="font-medium break-all">{vault.selectedItem.name}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Type</p>
                      <p className="capitalize">{vault.selectedItem.kind || "file"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Size</p>
                      <p>{vault.selectedItem.size_label || "--"}</p>
                    </div>
                  </div>
                  {vault.selectedItem.url && (
                    <Button size="sm" variant="outline" className="w-full h-8 text-xs" asChild>
                      <a href={vault.selectedItem.url} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-3 w-3 mr-1" /> Open in Cloudinary
                      </a>
                    </Button>
                  )}
                  {vault.selectedItem.kind !== "folder" && (
                    <>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        {vault.selectedItem.pageType && (
                          <div>
                            <p className="text-muted-foreground">Source</p>
                            <p className="capitalize">{vault.selectedItem.pageType}</p>
                          </div>
                        )}
                        {vault.selectedItem.fileType && (
                          <div>
                            <p className="text-muted-foreground">File type</p>
                            <p className="capitalize">{vault.selectedItem.fileType}</p>
                          </div>
                        )}
                      </div>
                      <Separator />
                      <p className="text-xs font-medium">Restore to agent PC</p>
                      <Input
                        value={restoreAgentId}
                        onChange={(e) => setRestoreAgentId(e.target.value)}
                        placeholder="Agent device ID"
                        className="h-8 text-xs"
                      />
                      <Input
                        value={restorePath}
                        onChange={(e) => setRestorePath(e.target.value)}
                        placeholder="Destination folder on PC e.g. C:/Users/You/Downloads"
                        className="h-8 text-xs"
                      />
                      <Button
                        size="sm"
                        className="w-full"
                        onClick={() =>
                          void vault.restoreToAgent(vault.selectedItem!, restoreAgentId, restorePath, execAgentUpload)
                        }
                      >
                        <CloudDownload className="h-3 w-3 mr-1" /> Restore to agent
                      </Button>
                    </>
                  )}
                  <div className="flex flex-wrap gap-1 pt-1">
                    {vault.selectedItem.kind !== "folder" && (
                      <>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openDialog("rename", vault.selectedItem?.name || "")}>
                          <Edit2 className="h-3 w-3 mr-1" /> Rename
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openDialog("move", vault.currentFolder)}>
                          <Move className="h-3 w-3 mr-1" /> Move
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Select a file or folder</p>
              )}

              <Separator className="my-4" />
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Media folders
              </p>
              <div className="space-y-1 mb-4">
                {vault.quickRoots.map((root) => (
                  <button
                    key={root.path}
                    type="button"
                    onClick={() => vault.navigateToFolder(root.path)}
                    className={`w-full text-left rounded-md px-2 py-1.5 text-xs transition-colors flex items-center gap-1.5 ${
                      vault.currentFolder === root.path
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent/50 text-muted-foreground"
                    }`}
                  >
                    {root.path.includes("Recordings") ? (
                      <Film className="h-3 w-3 shrink-0" />
                    ) : root.path.includes("Screen") ? (
                      <Monitor className="h-3 w-3 shrink-0" />
                    ) : root.path.includes("Camera") ? (
                      <Camera className="h-3 w-3 shrink-0" />
                    ) : null}
                    {root.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => void vault.browseTrash()}
                  className={`w-full text-left rounded-md px-2 py-1.5 text-xs transition-colors flex items-center gap-1.5 ${
                    vault.trashMode
                      ? "bg-destructive/15 text-destructive"
                      : "hover:bg-accent/50 text-muted-foreground"
                  }`}
                >
                  <Trash2 className="h-3 w-3 shrink-0" /> Trash
                </button>
              </div>

              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                All virtual folders
              </p>
              <div className="space-y-1">
                {vault.folderOptions.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => vault.navigateToFolder(f.value)}
                    className={`w-full text-left rounded-md px-2 py-1.5 text-xs transition-colors ${
                      vault.currentFolder === f.value
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent/50 text-muted-foreground"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </ScrollArea>
          </ResizablePanel>
        </ResizablePanelGroup>

        <div className="border-t border-border px-4 py-1.5 text-[11px] text-muted-foreground flex justify-between shrink-0 bg-card/30">
          <span>{vault.displayRows.length} items • {vault.currentFolder}</span>
          <span>{vault.loading ? "Syncing cloud vault…" : "Ready"}</span>
        </div>
      </main>

      <Dialog open={dialogKind !== null && dialogKind !== "mkdir"} onOpenChange={(open) => !open && setDialogKind(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogKind === "rename" && "Rename file"}
              {dialogKind === "move" && "Move to virtual folder"}
            </DialogTitle>
            <DialogDescription className="sr-only">Cloud vault action dialog</DialogDescription>
          </DialogHeader>
          <Input
            value={dialogValue}
            onChange={(e) => setDialogValue(e.target.value)}
            placeholder={
              dialogKind === "rename"
                ? "New name"
                : "Virtual folder path e.g. /Backups"
            }
            onKeyDown={(e) => e.key === "Enter" && void submitDialog()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogKind(null)}>Cancel</Button>
            <Button onClick={() => void submitDialog()}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CloudFolderCreateDialog
        open={dialogKind === "mkdir"}
        onOpenChange={(open) => {
          if (!open) setDialogKind(null);
        }}
        options={vault.folderOptions}
        parentPath={mkdirParent}
        onParentPathChange={setMkdirParent}
        name={dialogValue}
        onNameChange={setDialogValue}
        loading={vault.loading}
        onSubmit={async () => {
          await vault.createFolder(dialogValue, mkdirParent);
          setDialogKind(null);
          setDialogValue("");
        }}
      />
    </div>
  );
}

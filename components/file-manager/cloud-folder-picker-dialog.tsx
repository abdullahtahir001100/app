"use client";

import { Folder } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { VirtualFolderOption } from "@/lib/file-manager/types";

function folderDepth(path: string) {
  if (path === "/") return 0;
  return path.split("/").filter(Boolean).length;
}

function folderIndent(path: string) {
  const depth = folderDepth(path);
  return depth > 0 ? `${"  ".repeat(depth - 1)}└ ` : "";
}

type CloudFolderPickerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: VirtualFolderOption[];
  value: string;
  onSelect: (path: string) => void;
  title?: string;
};

export function CloudFolderPickerDialog({
  open,
  onOpenChange,
  options,
  value,
  onSelect,
  title = "Select cloud folder",
}: CloudFolderPickerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Choose where drag-and-drop uploads go. Nested folders are supported.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="h-[280px] rounded-md border border-border/60 p-2">
          <div className="space-y-1">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onSelect(option.value);
                  onOpenChange(false);
                }}
                className={`w-full text-left rounded-md px-2.5 py-2 text-sm transition-colors flex items-center gap-2 ${
                  value === option.value
                    ? "bg-primary/10 text-primary font-medium ring-1 ring-primary/30"
                    : "hover:bg-accent/50 text-muted-foreground hover:text-foreground"
                }`}
              >
                <Folder className="h-3.5 w-3.5 shrink-0 opacity-70" />
                <span className="truncate font-mono text-xs">
                  {folderIndent(option.value)}
                  {option.label}
                </span>
              </button>
            ))}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type CloudFolderCreateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: VirtualFolderOption[];
  parentPath: string;
  onParentPathChange: (path: string) => void;
  name: string;
  onNameChange: (name: string) => void;
  onSubmit: () => void | Promise<void>;
  loading?: boolean;
};

export function CloudFolderCreateDialog({
  open,
  onOpenChange,
  options,
  parentPath,
  onParentPathChange,
  name,
  onNameChange,
  onSubmit,
  loading,
}: CloudFolderCreateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New cloud folder</DialogTitle>
          <DialogDescription>Create a virtual folder for cloud backup. Pick a parent to nest folders.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cloud-parent-folder">Parent folder</Label>
            <ScrollArea className="h-[160px] rounded-md border border-border/60 p-2">
              <div className="space-y-1">
                {options.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => onParentPathChange(option.value)}
                    className={`w-full text-left rounded-md px-2.5 py-1.5 text-xs transition-colors flex items-center gap-2 ${
                      parentPath === option.value
                        ? "bg-primary/10 text-primary font-medium ring-1 ring-primary/30"
                        : "hover:bg-accent/50 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Folder className="h-3 w-3 shrink-0 opacity-70" />
                    <span className="truncate font-mono">
                      {folderIndent(option.value)}
                      {option.label}
                    </span>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cloud-folder-name">Folder name</Label>
            <Input
              id="cloud-folder-name"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="e.g. Backups"
              onKeyDown={(e) => e.key === "Enter" && void onSubmit()}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={() => void onSubmit()} disabled={loading || !name.trim()}>
            Create folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

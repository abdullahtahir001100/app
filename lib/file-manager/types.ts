export type FileEntryKind = "folder" | "file";

export type FileEntry = {
  name: string;
  path: string;
  kind: FileEntryKind;
  size: number;
  size_label: string;
  modified: string;
  extension?: string;
  tags?: string[];
  category?: string;
  readonly?: boolean;
};

export type QuickRoot = {
  label: string;
  path: string;
  kind?: "drive" | "folder";
};

export type FileViewMode = "list" | "grid";

export type FileSortKey = "name" | "size" | "modified" | "kind";

export type FileTelemetryPacket = {
  type: string;
  action?: string;
  status?: string;
  message?: string | null;
  file_result?: Record<string, unknown>;
};

export type CloudBackupEntry = {
  id: string;
  url: string;
  name: string;
  time: string;
  shareToken?: string | null;
  shareUrl?: string | null;
  mimeType?: string;
  size?: number;
  originalPath?: string;
  virtualPath?: string;
  kind?: "file" | "folder";
  size_label?: string;
  fileType?: string;
  pageType?: "camera" | "screen" | "file";
  isDeleted?: boolean;
  deletedAt?: string | null;
};

export type MediaQuickRoot = {
  label: string;
  path: string;
};

export type VirtualFolderOption = {
  label: string;
  value: string;
};

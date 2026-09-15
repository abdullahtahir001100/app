import { format } from "date-fns";
import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  type LucideIcon,
} from "lucide-react";
import type { FileEntry, QuickRoot } from "./types";

export const FRAME_FILE_BINARY = 0x06;

export function normalizePath(path: string) {
  if (!path) return "";
  let norm = path.replace(/\\/g, "/").trim();
  // Strip Windows UNC prefixes: //?/ or /?/
  if (norm.startsWith("//?/") || norm.startsWith("/?/")) {
    norm = norm.replace(/^(\/{1,2}\?\/)/, "");
  }
  // Windows drive root: e.g. C:, C:/, C:\ -> always C:/
  if (/^[A-Za-z]:\/?$/.test(norm)) {
    return `${norm.charAt(0).toUpperCase()}:/`;
  }
  // Clean up duplicate slashes and strip trailing slashes for subfolders
  return norm.replace(/\/+$/, "") || norm;
}

export function pathsEqual(a: string, b: string) {
  const left = normalizePath(a).toLowerCase();
  const right = normalizePath(b).toLowerCase();
  if (!left || !right) return left === right;
  return left === right;
}

export function parseBreadcrumbs(currentPath: string): Array<{ label: string; path: string }> {
  const norm = normalizePath(currentPath);
  if (!norm) return [];

  const parts = norm.split("/").filter(Boolean);
  const crumbs: Array<{ label: string; path: string }> = [];

  for (let i = 0; i < parts.length; i += 1) {
    let path: string;
    if (parts[0]?.endsWith(":")) {
      if (i === 0) path = `${parts[0]}/`;
      else path = `${parts[0]}/${parts.slice(1, i + 1).join("/")}`;
    } else {
      path = `/${parts.slice(0, i + 1).join("/")}`;
    }
    crumbs.push({ label: parts[i], path });
  }

  return crumbs;
}

export function parentPath(currentPath: string): string | null {
  const norm = normalizePath(currentPath).replace(/\/$/, "");
  const idx = norm.lastIndexOf("/");
  if (idx <= 0) return null;
  if (/^[A-Za-z]:$/.test(norm.slice(0, idx))) return `${norm.slice(0, idx)}/`;
  return norm.slice(0, idx) || null;
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (!+bytes || bytes <= 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i] || "B"}`;
}

export function formatModified(ts: string | number | undefined) {
  if (!ts) return "—";
  try {
    const n = Number(ts);
    if (Number.isFinite(n) && n > 0) {
      const ms = n < 10000000000 ? n * 1000 : n;
      return format(new Date(ms), "MMM d, yyyy HH:mm");
    }
    const d = new Date(String(ts));
    if (!isNaN(d.getTime())) {
      return format(d, "MMM d, yyyy HH:mm");
    }
    return String(ts);
  } catch {
    return "—";
  }
}

export function normalizeFileEntry(raw: Record<string, unknown> | FileEntry): FileEntry {
  const isFolder =
    raw.kind === "folder" ||
    raw.kind === "directory" ||
    (raw as any).isDir === true ||
    (raw as any).is_dir === true ||
    (raw as any).type === "dir" ||
    (raw as any).type === "directory" ||
    (raw as any).type === "folder";

  const size = typeof raw.size === "number" ? raw.size : Number(raw.size || 0);
  const sizeLabel =
    (raw as any).size_label ||
    (raw as any).sizeLabel ||
    (isFolder ? "--" : formatBytes(size));

  const rawPath = String(raw.path || "");
  const path = normalizePath(rawPath);
  const rawName = String(
    raw.name || (rawPath ? rawPath.split(/[\/\\]/).filter(Boolean).pop() : "")
  );

  return {
    name: rawName,
    path,
    kind: isFolder ? "folder" : "file",
    size,
    size_label: sizeLabel,
    modified: String(raw.modified || (raw as any).mtime || (raw as any).time || "—"),
    extension:
      typeof (raw as any).extension === "string"
        ? (raw as any).extension
        : (rawName.includes(".") ? rawName.split(".").pop()?.toLowerCase() : undefined),
    category: typeof (raw as any).category === "string" ? (raw as any).category : undefined,
    tags: Array.isArray((raw as any).tags) ? (raw as any).tags.map(String) : undefined,
    readonly: Boolean(raw.readonly),
  };
}

export function b64ToBlob(b64: string, mime = "application/octet-stream") {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || "");
      const comma = raw.indexOf(",");
      resolve(comma >= 0 ? raw.slice(comma + 1) : raw);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function getFileIcon(name: string, kind: FileEntry["kind"]): LucideIcon {
  if (kind === "folder") return Folder;
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(ext)) return FileImage;
  if (["mp4", "webm", "mov", "avi", "mkv"].includes(ext)) return FileVideo;
  if (["mp3", "wav", "ogg", "flac"].includes(ext)) return FileAudio;
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return FileArchive;
  if (["xls", "xlsx", "csv"].includes(ext)) return FileSpreadsheet;
  if (["js", "ts", "tsx", "jsx", "rs", "py", "go", "java", "c", "cpp"].includes(ext)) return FileCode;
  if (["txt", "md", "doc", "docx", "pdf"].includes(ext)) return FileText;
  return File;
}

export function isTextFile(name: string) {
  return /\.(txt|md|json|js|ts|tsx|jsx|css|html|xml|yaml|yml|log|csv|env|rs|py|toml|ini|cfg)$/i.test(name);
}

export function isImageFile(name: string) {
  return /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(name);
}

export function mimeForName(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    pdf: "application/pdf",
    txt: "text/plain",
    json: "application/json",
  };
  return map[ext] || "application/octet-stream";
}

export function filterEntries(items: FileEntry[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (item) =>
      item.name.toLowerCase().includes(q) ||
      item.category?.toLowerCase().includes(q) ||
      item.tags?.some((t) => t.toLowerCase().includes(q))
  );
}

export function sortEntries(items: FileEntry[], key: string, asc: boolean) {
  const list = [...items];
  list.sort((a, b) => {
    const aFolder = a.kind === "folder";
    const bFolder = b.kind === "folder";
    if (aFolder && !bFolder) return -1;
    if (!aFolder && bFolder) return 1;
    let cmp = 0;
    if (key === "size") cmp = (a.size || 0) - (b.size || 0);
    else if (key === "modified") cmp = String(a.modified || "").localeCompare(String(b.modified || ""));
    else if (key === "kind") cmp = String(a.kind || "").localeCompare(String(b.kind || ""));
    else cmp = String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" });
    return asc ? cmp : -cmp;
  });
  return list;
}

export function defaultRootFromList(roots: QuickRoot[]) {
  return roots.find((r) => r.label === "Home")?.path || roots[0]?.path || "";
}

/**
 * Universal UUID v4 generator safe for insecure contexts (HTTP LAN/IP)
 * where window.crypto.randomUUID is undefined.
 */
export function safeUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch {
      // fallback
    }
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    try {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    } catch {
      // fallback
    }
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}


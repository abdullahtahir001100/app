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
  if (/^[A-Za-z]:$/.test(norm)) {
    return `${norm.charAt(0).toUpperCase()}${norm.slice(1)}/`;
  }
  if (/^[A-Za-z]:\/$/.test(norm)) {
    return `${norm.charAt(0).toUpperCase()}${norm.slice(1)}`;
  }
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

export function formatModified(ts: string) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return "—";
  try {
    return format(new Date(n * 1000), "MMM d, yyyy HH:mm");
  } catch {
    return "—";
  }
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
    if (a.kind === "folder" && b.kind !== "folder") return -1;
    if (a.kind !== "folder" && b.kind === "folder") return 1;
    let cmp = 0;
    if (key === "size") cmp = a.size - b.size;
    else if (key === "modified") cmp = a.modified.localeCompare(b.modified);
    else if (key === "kind") cmp = a.kind.localeCompare(b.kind);
    else cmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    return asc ? cmp : -cmp;
  });
  return list;
}

export function defaultRootFromList(roots: QuickRoot[]) {
  return roots.find((r) => r.label === "Home")?.path || roots[0]?.path || "";
}

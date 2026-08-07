use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

use crate::commands::{CommandResponse, IncomingPacket};

pub const FRAME_FILE_BINARY: u8 = 0x06;

const MAX_TEXT_BYTES: usize = 512 * 1024;
const MAX_INLINE_DOWNLOAD: u64 = 4 * 1024 * 1024;
const MAX_UPLOAD_BYTES: usize = 16 * 1024 * 1024;
const SEARCH_MAX_RESULTS: usize = 200;
const SEARCH_MAX_DEPTH: usize = 8;

pub fn is_file_action(action: &str) -> bool {
    action.starts_with("FILE_")
}

pub struct FileState {
    guard: PathGuard,
    meta_store: Mutex<MetaStore>,
}

impl FileState {
    pub fn new() -> Self {
        Self {
            guard: PathGuard::new(),
            meta_store: Mutex::new(MetaStore::load()),
        }
    }
}

struct PathGuard {
    allowed_roots: Vec<PathBuf>,
    home: PathBuf,
}

impl PathGuard {
    fn new() -> Self {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("C:\\Users"));

        let mut allowed_roots = vec![home.clone()];
        for sub in ["Desktop", "Documents", "Downloads", "Pictures", "Videos", "Music"] {
            allowed_roots.push(home.join(sub));
        }

        for drive in enumerate_windows_drives() {
            if !allowed_roots.iter().any(|root| root == &drive) {
                allowed_roots.push(drive);
            }
        }

        Self {
            allowed_roots,
            home,
        }
    }

    fn home_path(&self) -> &Path {
        &self.home
    }

    fn quick_roots(&self) -> Vec<Value> {
        let mut roots = Vec::new();

        for drive in enumerate_windows_drives() {
            let label = drive
                .to_string_lossy()
                .trim_end_matches(['\\', '/'])
                .to_string();
            roots.push(json!({
                "label": label,
                "path": path_to_forward_slash(&drive),
                "kind": "drive"
            }));
        }

        let desktop = self.home.join("Desktop");
        let documents = self.home.join("Documents");
        let downloads = self.home.join("Downloads");
        let pictures = self.home.join("Pictures");

        let labels: [(&str, &Path); 5] = [
            ("Home", self.home.as_path()),
            ("Desktop", desktop.as_path()),
            ("Documents", documents.as_path()),
            ("Downloads", downloads.as_path()),
            ("Pictures", pictures.as_path()),
        ];

        for (label, path) in labels {
            if path.exists() {
                roots.push(json!({
                    "label": label,
                    "path": path_to_forward_slash(path),
                    "kind": "folder"
                }));
            }
        }

        roots
    }

    fn resolve(&self, input: &str) -> Result<PathBuf, String> {
        let trimmed = input.trim();
        if trimmed.is_empty() {
            return Ok(self.home.clone());
        }

        if let Some(drive) = parse_windows_drive_root(trimmed) {
            if drive.exists() {
                return Ok(drive);
            }
            return Err(format!("Drive not found: {}", trimmed));
        }

        let raw = PathBuf::from(trimmed.replace('/', "\\"));
        let candidate = if raw.is_absolute() {
            raw
        } else {
            self.home.join(raw)
        };

        let normalized = normalize_path(&candidate);

        if normalized
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            return Err("Path traversal is not allowed.".into());
        }

        let canonical = if normalized.exists() {
            fs::canonicalize(&normalized)
                .map_err(|e| format!("Invalid path: {}", e))?
        } else {
            let parent = normalized
                .parent()
                .ok_or_else(|| "Invalid path parent.".to_string())?;
            if !parent.exists() {
                return Err("Parent directory does not exist.".into());
            }
            let parent_canon = fs::canonicalize(parent)
                .map_err(|e| format!("Invalid parent path: {}", e))?;
            let file_name = normalized
                .file_name()
                .ok_or_else(|| "Missing file name.".to_string())?;
            parent_canon.join(file_name)
        };

        for root in &self.allowed_roots {
            if let Ok(root_canon) = root.canonicalize() {
                if canonical.starts_with(&root_canon) {
                    return Ok(canonical);
                }
            }
        }

        if path_is_allowed(&self.allowed_roots, &canonical) {
            return Ok(canonical);
        }

        Err("Access denied — path is outside allowed user folders.".into())
    }
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            std::path::Component::ParentDir => {
                out.pop();
            }
            std::path::Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

fn path_to_forward_slash(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn enumerate_windows_drives() -> Vec<PathBuf> {
    let mut drives = Vec::new();
    for letter in b'A'..=b'Z' {
        let drive = format!("{}:\\", letter as char);
        let path = PathBuf::from(&drive);
        if path.exists() {
            drives.push(path);
        }
    }
    drives
}

fn parse_windows_drive_root(input: &str) -> Option<PathBuf> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }

    // Only match bare drive roots: "C", "C:", "C:/", "C:\"
    let norm = trimmed.replace('/', "\\").trim_end_matches('\\').to_string();
    if norm.len() != 2 {
        return None;
    }

    let bytes = norm.as_bytes();
    if !bytes[0].is_ascii_alphabetic() || bytes[1] != b':' {
        return None;
    }

    let drive = format!("{}:\\", (bytes[0] as char).to_ascii_uppercase());
    Some(PathBuf::from(drive))
}

fn path_is_allowed(allowed_roots: &[PathBuf], path: &Path) -> bool {
    let canonical = path
        .canonicalize()
        .unwrap_or_else(|_| path.to_path_buf());
    let path_norm = path_to_forward_slash(&canonical).to_lowercase();

    for root in allowed_roots {
        if let Ok(root_canon) = root.canonicalize() {
            if canonical.starts_with(&root_canon) {
                return true;
            }
        }

        let root_norm = path_to_forward_slash(root).to_lowercase();
        let root_prefix = if root_norm.ends_with('/') {
            root_norm.clone()
        } else {
            format!("{}/", root_norm)
        };

        if path_norm == root_norm.trim_end_matches('/')
            || path_norm.starts_with(&root_prefix)
            || path_norm.starts_with(&root_norm)
        {
            return true;
        }
    }

    false
}

#[derive(Default, Clone, serde::Serialize, serde::Deserialize)]
struct FileMetaEntry {
    tags: Vec<String>,
    category: String,
    versions: Vec<VersionEntry>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct VersionEntry {
    id: String,
    label: String,
    cloud_url: Option<String>,
    created_at: String,
}

struct MetaStore {
    entries: HashMap<String, FileMetaEntry>,
    path: PathBuf,
}

impl MetaStore {
    fn load() -> Self {
        let path = meta_store_path();
        if let Ok(raw) = fs::read_to_string(&path) {
            if let Ok(entries) = serde_json::from_str(&raw) {
                return Self { entries, path };
            }
        }
        Self {
            entries: HashMap::new(),
            path,
        }
    }

    fn save(&self) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let raw = serde_json::to_string_pretty(&self.entries).map_err(|e| e.to_string())?;
        fs::write(&self.path, raw).map_err(|e| e.to_string())
    }

    fn get(&self, key: &str) -> FileMetaEntry {
        self.entries.get(key).cloned().unwrap_or_default()
    }

    fn set(&mut self, key: String, entry: FileMetaEntry) {
        self.entries.insert(key, entry);
    }
}

fn meta_store_path() -> PathBuf {
    std::env::var("LOCALAPPDATA")
        .map(|p| PathBuf::from(p).join("zenvora").join("file_meta.json"))
        .unwrap_or_else(|_| PathBuf::from(".zenvora_file_meta.json"))
}

fn meta_key(path: &Path) -> String {
    path_to_forward_slash(path).to_lowercase()
}

fn entry_to_json(path: &Path, meta: &FileMetaEntry) -> Value {
    let meta_fs = fs::metadata(path).ok();
    let readonly = meta_fs
        .as_ref()
        .map(|m| m.permissions().readonly())
        .unwrap_or(false);
    let is_dir = meta_fs.as_ref().map(|m| m.is_dir()).unwrap_or(false);
    let is_file = meta_fs.as_ref().map(|m| m.is_file()).unwrap_or(false);
    let size = meta_fs.as_ref().map(|m| m.len()).unwrap_or(0);
    let modified = meta_fs
        .as_ref()
        .and_then(|m| m.modified().ok())
        .map(format_system_time_iso)
        .unwrap_or_else(|| "unknown".into());
    let created = meta_fs
        .as_ref()
        .and_then(|m| m.created().ok())
        .map(format_system_time_iso)
        .unwrap_or_else(|| "unknown".into());
    let accessed = meta_fs
        .as_ref()
        .and_then(|m| m.accessed().ok())
        .map(format_system_time_iso)
        .unwrap_or_else(|| "unknown".into());

    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let extension = path
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_default();

    #[cfg(windows)]
    let (hidden, system) = windows_file_attrs(path);
    #[cfg(not(windows))]
    let (hidden, system) = (false, false);

    json!({
        "path": path_to_forward_slash(path),
        "name": name,
        "extension": extension,
        "size": size,
        "sizeLabel": format_size(size),
        "isDir": is_dir,
        "isFile": is_file,
        "tags": meta.tags,
        "category": meta.category,
        "versions": meta.versions,
        "readonly": readonly,
        "hidden": hidden,
        "system": system,
        "modified": modified,
        "created": created,
        "accessed": accessed,
        "owner": whoami::username(),
    })
}

fn format_system_time_iso(time: SystemTime) -> String {
    use std::time::UNIX_EPOCH;
    let Ok(duration) = time.duration_since(UNIX_EPOCH) else {
        return "unknown".into();
    };
    // Unix seconds as ISO-ish string (Win7-safe, no chrono dependency needed here)
    let secs = duration.as_secs() as i64;
    format!("{secs}")
}

#[cfg(windows)]
fn windows_file_attrs(path: &Path) -> (bool, bool) {
    use std::os::windows::fs::MetadataExt;
    if let Ok(meta) = fs::metadata(path) {
        let attrs = meta.file_attributes();
        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
        const FILE_ATTRIBUTE_SYSTEM: u32 = 0x4;
        return (
            (attrs & FILE_ATTRIBUTE_HIDDEN) != 0,
            (attrs & FILE_ATTRIBUTE_SYSTEM) != 0,
        );
    }
    (false, false)
}

fn format_system_time(time: SystemTime) -> String {
    format_system_time_iso(time)
}

fn format_size(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;
    if bytes >= GB {
        format!("{:.1} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.1} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}

fn list_directory(path: &Path, meta_store: &MetaStore) -> Result<Vec<Value>, String> {
    let mut items = Vec::new();
    let read_dir = fs::read_dir(path).map_err(|e| format!("Cannot read directory: {}", e))?;

    for entry in read_dir.flatten() {
        let entry_path = entry.path();
        let name = entry_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        if name.starts_with('.') && name != ".zenvora_versions" {
            continue;
        }

        let meta = fs::metadata(&entry_path).ok();
        let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        let modified = meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .map(format_system_time)
            .unwrap_or_else(|| "unknown".into());

        let file_meta = meta_store.get(&meta_key(&entry_path));
        let ext = entry_path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();

        items.push(json!({
            "name": name,
            "path": path_to_forward_slash(&entry_path),
            "kind": if is_dir { "folder" } else { "file" },
            "size": size,
            "size_label": if is_dir { "--".into() } else { format_size(size) },
            "modified": modified,
            "extension": ext,
            "tags": file_meta.tags,
            "category": file_meta.category,
            "readonly": meta.as_ref().map(|m| m.permissions().readonly()).unwrap_or(false),
        }));
    }

    items.sort_by(|a, b| {
        let a_dir = a["kind"] == "folder";
        let b_dir = b["kind"] == "folder";
        match (a_dir, b_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a["name"]
                .as_str()
                .unwrap_or("")
                .to_lowercase()
                .cmp(&b["name"].as_str().unwrap_or("").to_lowercase()),
        }
    });

    Ok(items)
}

pub fn handle_file_command(packet: IncomingPacket, state: &mut FileState) -> Option<CommandResponse> {
    println!("[RUST AGENT] File action: {}", packet.action);

    let payload = &packet.payload;
    let request_id = payload
        .get("_requestId")
        .and_then(|v| v.as_str())
        .map(String::from);
    let path_raw = payload
        .get("path")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let mut message: Option<String> = None;
    let mut response_data: Value = json!({});
    let mut binary: Option<Vec<u8>> = None;

    let result: Result<(), String> = (|| -> Result<(), String> {
        match packet.action.as_str() {
        "FILE_GET_ROOTS" => {
            let drives = enumerate_windows_drives()
                .into_iter()
                .map(|drive| {
                    json!({
                        "label": drive.to_string_lossy().trim_end_matches(['\\', '/']).to_string(),
                        "path": path_to_forward_slash(&drive),
                        "kind": "drive"
                    })
                })
                .collect::<Vec<_>>();

            let default_home = path_to_forward_slash(state.guard.home_path());

            response_data = json!({
                "home": default_home,
                "roots": state.guard.quick_roots(),
                "drives": drives,
            });
            Ok(())
        }
        "FILE_LIST_DIR" => {
            let resolved = state.guard.resolve(path_raw)?;
            if !resolved.is_dir() {
                response_data = json!({ "error": "Not a directory." });
                message = Some("Path is not a directory.".into());
                return Ok(());
            }
            let store = state
                .meta_store
                .lock()
                .map_err(|_| "Metadata store lock failed.".to_string())?;
            let items = list_directory(&resolved, &store)?;
            response_data = json!({
                "path": path_to_forward_slash(&resolved),
                "items": items,
            });
            Ok(())
        }
        "FILE_READ_TEXT" => {
            let resolved = state.guard.resolve(path_raw)?;
            if resolved.is_dir() {
                return Err("Cannot preview a folder.".into());
            }
            let size = fs::metadata(&resolved).map_err(|e| e.to_string())?.len();
            if size > MAX_TEXT_BYTES as u64 {
                return Err(format!(
                    "File too large for text preview (max {} KB). Use download.",
                    MAX_TEXT_BYTES / 1024
                ));
            }
            let mut buf = String::new();
            File::open(&resolved)
                .and_then(|mut f| f.read_to_string(&mut buf))
                .map_err(|e| format!("Read failed: {}", e))?;
            response_data = json!({
                "path": path_to_forward_slash(&resolved),
                "content": buf,
                "size": size,
            });
            Ok(())
        }
        "FILE_WRITE_TEXT" => {
            let resolved = state.guard.resolve(path_raw)?;
            let content = payload
                .get("content")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "Missing content.".to_string())?;
            if content.len() > MAX_TEXT_BYTES {
                return Err("Content exceeds max edit size.".into());
            }
            if let Some(parent) = resolved.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::write(&resolved, content).map_err(|e| format!("Write failed: {}", e))?;
            message = Some("File saved.".into());
            response_data = json!({ "path": path_to_forward_slash(&resolved) });
            Ok(())
        }
        "FILE_DOWNLOAD" => {
            let resolved = state.guard.resolve(path_raw)?;
            if resolved.is_dir() {
                return Err("Download a file, not a folder. Use compress for folders.".into());
            }
            let size = fs::metadata(&resolved).map_err(|e| e.to_string())?.len();
            let mut data = Vec::new();
            File::open(&resolved)
                .and_then(|mut f| f.read_to_end(&mut data))
                .map_err(|e| format!("Read failed: {}", e))?;

            if size <= MAX_INLINE_DOWNLOAD {
                response_data = json!({
                    "path": path_to_forward_slash(&resolved),
                    "name": resolved.file_name().map(|n| n.to_string_lossy().to_string()),
                    "size": size,
                    "content_b64": STANDARD.encode(&data),
                    "inline": true,
                });
            } else {
                response_data = json!({
                    "path": path_to_forward_slash(&resolved),
                    "name": resolved.file_name().map(|n| n.to_string_lossy().to_string()),
                    "size": size,
                    "inline": false,
                });
                binary = Some(data);
            }
            Ok(())
        }
        "FILE_UPLOAD" => {
            let dir = state.guard.resolve(path_raw)?;
            if !dir.is_dir() {
                return Err("Upload target must be a directory.".into());
            }
            let file_name = payload
                .get("file_name")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "Missing file_name.".to_string())?;
            if file_name.contains(['\\', '/', ':', '*', '?', '"', '<', '>', '|']) {
                return Err("Invalid file name.".into());
            }
            let content_b64 = payload
                .get("content_b64")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "Missing content_b64.".to_string())?;
            let bytes = STANDARD
                .decode(content_b64)
                .map_err(|e| format!("Invalid base64: {}", e))?;
            if bytes.len() > MAX_UPLOAD_BYTES {
                return Err(format!(
                    "Upload exceeds max size ({} MB).",
                    MAX_UPLOAD_BYTES / 1024 / 1024
                ));
            }
            let target = dir.join(file_name);
            let resolved_target = state.guard.resolve(&path_to_forward_slash(&target))?;
            fs::write(&resolved_target, &bytes).map_err(|e| format!("Upload failed: {}", e))?;
            message = Some(format!("Uploaded {} ({}).", file_name, format_size(bytes.len() as u64)));
            response_data = json!({
                "path": path_to_forward_slash(&resolved_target),
                "size": bytes.len(),
            });
            Ok(())
        }
        "FILE_DELETE" => {
            let resolved = state.guard.resolve(path_raw)?;
            if resolved.is_dir() {
                fs::remove_dir_all(&resolved).map_err(|e| format!("Delete folder failed: {}", e))?;
            } else {
                fs::remove_file(&resolved).map_err(|e| format!("Delete failed: {}", e))?;
            }
            message = Some("Deleted.".into());
            Ok(())
        }
        "FILE_RENAME" => {
            let resolved = state.guard.resolve(path_raw)?;
            let new_name = payload
                .get("new_name")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "Missing new_name.".to_string())?;
            if new_name.contains(['\\', '/', ':', '*', '?', '"', '<', '>', '|']) {
                return Err("Invalid new name.".into());
            }
            let target = resolved
                .parent()
                .ok_or_else(|| "Invalid parent.".to_string())?
                .join(new_name);
            let target = state.guard.resolve(&path_to_forward_slash(&target))?;
            fs::rename(&resolved, &target).map_err(|e| format!("Rename failed: {}", e))?;
            message = Some("Renamed.".into());
            response_data = json!({ "path": path_to_forward_slash(&target) });
            Ok(())
        }
        "FILE_MOVE" | "FILE_COPY" => {
            let resolved = state.guard.resolve(path_raw)?;
            let dest_dir = payload
                .get("dest_path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "Missing dest_path.".to_string())?;
            let dest = state.guard.resolve(dest_dir)?;
            if !dest.is_dir() {
                return Err("Destination must be a directory.".into());
            }
            let file_name = resolved
                .file_name()
                .ok_or_else(|| "Missing file name.".to_string())?;
            let target = dest.join(file_name);
            let target = state.guard.resolve(&path_to_forward_slash(&target))?;
            if packet.action == "FILE_MOVE" {
                fs::rename(&resolved, &target).map_err(|e| format!("Move failed: {}", e))?;
                message = Some("Moved.".into());
            } else {
                if resolved.is_dir() {
                    copy_dir_recursive(&resolved, &target)?;
                } else {
                    fs::copy(&resolved, &target).map_err(|e| format!("Copy failed: {}", e))?;
                }
                message = Some("Copied.".into());
            }
            response_data = json!({ "path": path_to_forward_slash(&target) });
            Ok(())
        }
        "FILE_MKDIR" => {
            let resolved = state.guard.resolve(path_raw)?;
            let name = payload
                .get("name")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "Missing folder name.".to_string())?;
            let target = resolved.join(name);
            let target = state.guard.resolve(&path_to_forward_slash(&target))?;
            fs::create_dir_all(&target).map_err(|e| format!("Create folder failed: {}", e))?;
            message = Some("Folder created.".into());
            response_data = json!({ "path": path_to_forward_slash(&target) });
            Ok(())
        }
        "FILE_SEARCH" => {
            let root = state.guard.resolve(path_raw)?;
            let query = payload
                .get("query")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_lowercase();
            if query.len() < 2 {
                return Err("Search query must be at least 2 characters.".into());
            }
            let mut results = Vec::new();
            for entry in WalkDir::new(&root)
                .max_depth(SEARCH_MAX_DEPTH)
                .into_iter()
                .filter_map(|e| e.ok())
            {
                let name = entry.file_name().to_string_lossy().to_lowercase();
                if name.contains(&query) {
                    let path = entry.path();
                    let is_dir = entry.file_type().is_dir();
                    let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                    results.push(json!({
                        "name": entry.file_name().to_string_lossy(),
                        "path": path_to_forward_slash(path),
                        "kind": if is_dir { "folder" } else { "file" },
                        "size": size,
                        "size_label": if is_dir { "--".into() } else { format_size(size) },
                    }));
                    if results.len() >= SEARCH_MAX_RESULTS {
                        break;
                    }
                }
            }
            response_data = json!({ "query": query, "results": results, "count": results.len() });
            Ok(())
        }
        "FILE_COMPRESS" => {
            let resolved = state.guard.resolve(path_raw)?;
            let zip_name = payload
                .get("zip_name")
                .and_then(|v| v.as_str())
                .unwrap_or("archive.zip");
            let parent = resolved.parent().ok_or_else(|| "Invalid path.".to_string())?;
            let zip_path = parent.join(zip_name);
            let zip_path = state.guard.resolve(&path_to_forward_slash(&zip_path))?;
            compress_to_zip(&resolved, &zip_path)?;
            message = Some(format!("Compressed to {}.", zip_name));
            response_data = json!({ "path": path_to_forward_slash(&zip_path) });
            Ok(())
        }
        "FILE_DECOMPRESS" => {
            let resolved = state.guard.resolve(path_raw)?;
            if !resolved.is_file() {
                return Err("Select a .zip file to decompress.".into());
            }
            let dest = resolved
                .parent()
                .ok_or_else(|| "Invalid parent.".to_string())?
                .join(
                    resolved
                        .file_stem()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_else(|| "extracted".into()),
                );
            let dest = state.guard.resolve(&path_to_forward_slash(&dest))?;
            fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
            decompress_zip(&resolved, &dest)?;
            message = Some("Archive extracted.".into());
            response_data = json!({ "path": path_to_forward_slash(&dest) });
            Ok(())
        }
        "FILE_GET_METADATA" => {
            let resolved = state.guard.resolve(path_raw)?;
            let store = state.meta_store.lock().map_err(|_| "Metadata lock failed.".to_string())?;
            let entry = store.get(&meta_key(&resolved));
            response_data = entry_to_json(&resolved, &entry);
            Ok(())
        }
        "FILE_SET_METADATA" => {
            let resolved = state.guard.resolve(path_raw)?;
            let mut store = state.meta_store.lock().map_err(|_| "Metadata lock failed.".to_string())?;
            let mut entry = store.get(&meta_key(&resolved));
            if let Some(tags) = payload.get("tags").and_then(|v| v.as_array()) {
                entry.tags = tags
                    .iter()
                    .filter_map(|t| t.as_str().map(String::from))
                    .collect();
            }
            if let Some(cat) = payload.get("category").and_then(|v| v.as_str()) {
                entry.category = cat.to_string();
            }
            if let Some(version) = payload.get("add_version") {
                entry.versions.push(VersionEntry {
                    id: version
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    label: version
                        .get("label")
                        .and_then(|v| v.as_str())
                        .unwrap_or("backup")
                        .to_string(),
                    cloud_url: version.get("cloud_url").and_then(|v| v.as_str()).map(String::from),
                    created_at: version
                        .get("created_at")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                });
            }
            store.set(meta_key(&resolved), entry.clone());
            store.save()?;
            message = Some("Metadata updated.".into());
            response_data = entry_to_json(&resolved, &entry);
            Ok(())
        }
        "FILE_SET_PERMISSIONS" => {
            let resolved = state.guard.resolve(path_raw)?;
            let readonly = payload
                .get("readonly")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let mut perms = fs::metadata(&resolved)
                .map_err(|e| e.to_string())?
                .permissions();
            perms.set_readonly(readonly);
            fs::set_permissions(&resolved, perms).map_err(|e| format!("Permission update failed: {}", e))?;
            message = Some(if readonly {
                "Marked read-only.".into()
            } else {
                "Read-only removed.".into()
            });
            Ok(())
        }
        "FILE_GET_PERMISSIONS" => {
            let resolved = state.guard.resolve(path_raw)?;
            let readonly = fs::metadata(&resolved)
                .map(|m| m.permissions().readonly())
                .unwrap_or(false);
            response_data = json!({
                "path": path_to_forward_slash(&resolved),
                "readonly": readonly,
            });
            Ok(())
        }
        _ => return Err(format!("Unknown file action: {}", packet.action)),
        }
    })();

    match result {
        Ok(()) => {
            attach_request_id(&mut response_data, &request_id);
            Some(file_response(
                &packet.action,
                response_data,
                message,
                binary.map(|b| (b, FRAME_FILE_BINARY)),
            ))
        }
        Err(err) => {
            let msg = err.clone();
            let mut err_data = json!({ "error": msg });
            attach_request_id(&mut err_data, &request_id);
            Some(file_response(
                &packet.action,
                err_data,
                Some(err),
                None,
            ))
        }
    }
}

fn attach_request_id(data: &mut Value, request_id: &Option<String>) {
    if let Some(id) = request_id {
        if let Some(obj) = data.as_object_mut() {
            obj.insert("request_id".to_string(), json!(id));
        }
    }
}

fn file_response(
    action: &str,
    data: Value,
    message: Option<String>,
    binary: Option<(Vec<u8>, u8)>,
) -> CommandResponse {
    let (frame, frame_kind) = if let Some((bytes, kind)) = binary {
        (Some(bytes), kind)
    } else {
        (None, FRAME_FILE_BINARY)
    };

    CommandResponse {
        json: json!({
            "type": "sys_ack",
            "channel": "files",
            "status": if data.get("error").is_some() { "ERROR" } else { "OK" },
            "message": message.or_else(|| data.get("error").and_then(|v| v.as_str()).map(String::from)),
            "last_action": action,
            "file_result": data,
        }),
        frame,
        frame_kind,
    }
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let ty = entry.file_type().map_err(|e| e.to_string())?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            fs::copy(&from, &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn compress_to_zip(source: &Path, zip_path: &Path) -> Result<(), String> {
    let file = File::create(zip_path).map_err(|e| e.to_string())?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    if source.is_file() {
        let name = source
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "file".into());
        zip.start_file(name, options)
            .map_err(|e| e.to_string())?;
        let mut f = File::open(source).map_err(|e| e.to_string())?;
        let mut buf = Vec::new();
        f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        zip.write_all(&buf).map_err(|e| e.to_string())?;
    } else {
        let base = source
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "folder".into());
        for entry in WalkDir::new(source).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            if path == source {
                continue;
            }
            let rel = path
                .strip_prefix(source)
                .map_err(|e| e.to_string())?;
            let name = format!("{}/{}", base, path_to_forward_slash(rel));
            if entry.file_type().is_dir() {
                zip.add_directory(name, options).map_err(|e| e.to_string())?;
            } else {
                zip.start_file(name, options).map_err(|e| e.to_string())?;
                let mut f = File::open(path).map_err(|e| e.to_string())?;
                let mut buf = Vec::new();
                f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
                zip.write_all(&buf).map_err(|e| e.to_string())?;
            }
        }
    }

    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

fn decompress_zip(zip_path: &Path, dest: &Path) -> Result<(), String> {
    let file = File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let outpath = dest.join(file.name());
        if file.name().ends_with('/') {
            fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
        } else {
            if let Some(p) = outpath.parent() {
                fs::create_dir_all(p).map_err(|e| e.to_string())?;
            }
            let mut outfile = File::create(&outpath).map_err(|e| e.to_string())?;
            std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

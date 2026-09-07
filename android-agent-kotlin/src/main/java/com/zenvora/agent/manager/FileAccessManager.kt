package com.zenvora.agent.manager

import android.content.Context
import android.os.Environment
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * File explorer commands matching the Windows agent FILE_* protocol.
 */
class FileAccessManager(private val context: Context) {

    private val TAG = "FileSync"
    private val dateFmt = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US)

    fun handle(action: String, payload: JSONObject): JSONObject {
        val requestId = payload.optString("_requestId").ifBlank { payload.optString("request_id") }
        val pathRaw = payload.optString("path")
        return try {
            val data = when (action) {
                "FILE_GET_ROOTS" -> getRoots()
                "FILE_LIST_DIR" -> listDir(pathRaw)
                "FILE_READ_TEXT" -> readText(pathRaw)
                "FILE_WRITE_TEXT" -> writeText(pathRaw, payload.optString("content"))
                "FILE_DOWNLOAD" -> download(pathRaw)
                "FILE_UPLOAD" -> upload(pathRaw, payload)
                "FILE_DELETE" -> delete(pathRaw)
                "FILE_RENAME" -> rename(pathRaw, payload.optString("name").ifBlank { payload.optString("new_name") })
                "FILE_MOVE" -> copyOrMove(pathRaw, payload.optString("dest_path"), move = true)
                "FILE_COPY" -> copyOrMove(pathRaw, payload.optString("dest_path"), move = false)
                "FILE_MKDIR" -> mkdir(pathRaw, payload.optString("name"))
                "FILE_SEARCH" -> search(pathRaw, payload.optString("query"))
                "FILE_GET_METADATA", "FILE_GET_PERMISSIONS" -> metadata(pathRaw)
                "FILE_SET_METADATA", "FILE_SET_PERMISSIONS" ->
                    JSONObject().put("path", resolve(pathRaw).absolutePath)
                "FILE_COMPRESS" -> compress(pathRaw)
                else -> JSONObject().put("error", "Unsupported file action")
            }
            if (requestId.isNotBlank()) data.put("request_id", requestId)
            ack(action, data, data.optString("error").takeIf { it.isNotBlank() })
        } catch (e: Exception) {
            val data = JSONObject().put("error", e.message ?: "File operation failed")
            if (requestId.isNotBlank()) data.put("request_id", requestId)
            ack(action, data, e.message)
        }
    }

    private fun ack(action: String, data: JSONObject, error: String?): JSONObject {
        return JSONObject().apply {
            put("type", "sys_ack")
            put("channel", "files")
            put("platform", "android")
            put("status", if (error.isNullOrBlank() && !data.has("error")) "OK" else "ERROR")
            put("last_action", action)
            put("action", action)
            if (!error.isNullOrBlank()) put("message", error)
            put("file_result", data)
        }
    }

    private fun getRoots(): JSONObject {
        val roots = JSONArray()
        val drives = JSONArray()
        fun add(label: String, file: File?, kind: String) {
            if (file == null || !file.exists()) return
            val obj = JSONObject()
                .put("label", label)
                .put("path", slash(file.absolutePath))
                .put("kind", kind)
            roots.put(obj)
            if (kind == "drive") drives.put(obj)
        }
        val ext = Environment.getExternalStorageDirectory()
        add("Internal storage", ext, "drive")
        add("Downloads", Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "folder")
        add("Pictures", Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "folder")
        add("DCIM", Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DCIM), "folder")
        add("Documents", Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS), "folder")
        add("Movies", Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES), "folder")
        add("Music", Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC), "folder")
        add("App files", context.filesDir, "folder")
        context.getExternalFilesDir(null)?.let { add("App shared", it, "folder") }
        val home = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            ?: ext
            ?: context.filesDir
        return JSONObject()
            .put("home", slash(home.absolutePath))
            .put("roots", roots)
            .put("drives", drives)
    }

    private fun listDir(pathRaw: String): JSONObject {
        val dir = resolve(pathRaw)
        if (!dir.isDirectory) {
            return JSONObject().put("error", "Not a directory.")
        }
        val items = JSONArray()
        dir.listFiles()?.sortedWith(compareBy({ !it.isDirectory }, { it.name.lowercase(Locale.US) }))
            ?.forEach { file ->
                if (file.name.startsWith('.') && file.name != ".zenvora_versions") return@forEach
                items.put(entryJson(file))
            }
        return JSONObject()
            .put("path", slash(dir.absolutePath))
            .put("items", items)
    }

    private fun readText(pathRaw: String): JSONObject {
        val file = resolve(pathRaw)
        if (file.isDirectory) return JSONObject().put("error", "Cannot preview a folder.")
        if (file.length() > MAX_TEXT_BYTES) {
            return JSONObject().put("error", "File too large for text preview. Use download.")
        }
        val content = file.readText(Charsets.UTF_8)
        return JSONObject()
            .put("path", slash(file.absolutePath))
            .put("content", content)
            .put("size", file.length())
    }

    private fun writeText(pathRaw: String, content: String): JSONObject {
        val file = resolve(pathRaw)
        file.parentFile?.mkdirs()
        file.writeText(content, Charsets.UTF_8)
        return JSONObject().put("path", slash(file.absolutePath))
    }

    private fun download(pathRaw: String): JSONObject {
        val file = resolve(pathRaw)
        if (file.isDirectory) return JSONObject().put("error", "Download a file, not a folder.")
        val bytes = FileInputStream(file).use { it.readBytes() }
        val result = JSONObject()
            .put("path", slash(file.absolutePath))
            .put("name", file.name)
            .put("size", bytes.size)
        if (bytes.size <= MAX_INLINE_DOWNLOAD) {
            result.put("inline", true)
            result.put("content_b64", Base64.encodeToString(bytes, Base64.NO_WRAP))
        } else {
            result.put("inline", false)
            result.put("error", "File too large to inline. Open it on the device.")
        }
        return result
    }

    private fun upload(dirRaw: String, payload: JSONObject): JSONObject {
        val dir = resolve(dirRaw)
        if (!dir.isDirectory) return JSONObject().put("error", "Upload target must be a directory.")
        val name = payload.optString("file_name")
        if (name.isBlank() || name.contains('/') || name.contains('\\')) {
            return JSONObject().put("error", "Invalid file name.")
        }
        val b64 = payload.optString("content_b64")
        val bytes = Base64.decode(b64, Base64.DEFAULT)
        val target = File(dir, name)
        target.writeBytes(bytes)
        return JSONObject()
            .put("path", slash(target.absolutePath))
            .put("size", bytes.size)
    }

    private fun delete(pathRaw: String): JSONObject {
        val file = resolve(pathRaw)
        val ok = if (file.isDirectory) file.deleteRecursively() else file.delete()
        if (!ok) return JSONObject().put("error", "Delete failed.")
        return JSONObject().put("path", slash(file.absolutePath))
    }

    private fun rename(pathRaw: String, newName: String): JSONObject {
        val file = resolve(pathRaw)
        if (newName.isBlank()) return JSONObject().put("error", "Missing name.")
        val dest = File(file.parentFile, newName)
        if (!file.renameTo(dest)) return JSONObject().put("error", "Rename failed.")
        return JSONObject().put("path", slash(dest.absolutePath))
    }

    private fun copyOrMove(pathRaw: String, destRaw: String, move: Boolean): JSONObject {
        val src = resolve(pathRaw)
        val destDir = resolve(destRaw)
        if (!destDir.isDirectory) return JSONObject().put("error", "Destination must be a directory.")
        val dest = File(destDir, src.name)
        if (src.isDirectory) {
            src.copyRecursively(dest, overwrite = true)
            if (move) src.deleteRecursively()
        } else {
            src.copyTo(dest, overwrite = true)
            if (move) src.delete()
        }
        return JSONObject().put("path", slash(dest.absolutePath))
    }

    private fun mkdir(pathRaw: String, name: String): JSONObject {
        val parent = resolve(pathRaw)
        val dir = if (name.isBlank()) parent else File(parent, name)
        if (!dir.mkdirs() && !dir.isDirectory) return JSONObject().put("error", "Could not create folder.")
        return JSONObject().put("path", slash(dir.absolutePath))
    }

    private fun search(pathRaw: String, query: String): JSONObject {
        val root = resolve(pathRaw)
        val q = query.lowercase(Locale.US)
        val results = JSONArray()
        walk(root, 0, 4) { file ->
            if (q.isNotBlank() && !file.name.lowercase(Locale.US).contains(q)) return@walk
            results.put(entryJson(file))
        }
        return JSONObject()
            .put("results", results)
            .put("count", results.length())
    }

    private fun metadata(pathRaw: String): JSONObject {
        val file = resolve(pathRaw)
        return entryJson(file)
            .put("canRead", file.canRead())
            .put("canWrite", file.canWrite())
    }

    private fun compress(pathRaw: String): JSONObject {
        val src = resolve(pathRaw)
        val zip = File(src.parentFile, src.nameWithoutExtension + ".zip")
        ZipOutputStream(zip.outputStream()).use { zos ->
            if (src.isDirectory) {
                src.walkTopDown().filter { it.isFile }.forEach { file ->
                    val entryName = src.toURI().relativize(file.toURI()).path
                    zos.putNextEntry(ZipEntry(entryName))
                    file.inputStream().use { it.copyTo(zos) }
                    zos.closeEntry()
                }
            } else {
                zos.putNextEntry(ZipEntry(src.name))
                src.inputStream().use { it.copyTo(zos) }
                zos.closeEntry()
            }
        }
        return JSONObject().put("path", slash(zip.absolutePath))
    }

    private fun entryJson(file: File): JSONObject {
        val isDir = file.isDirectory
        val size = if (isDir) 0L else file.length()
        return JSONObject()
            .put("name", file.name)
            .put("path", slash(file.absolutePath))
            .put("kind", if (isDir) "folder" else "file")
            .put("isDir", isDir)
            .put("isFile", !isDir)
            .put("size", size)
            .put("size_label", if (isDir) "--" else formatSize(size))
            .put("sizeLabel", if (isDir) "--" else formatSize(size))
            .put("modified", dateFmt.format(Date(file.lastModified())))
            .put("extension", file.extension.lowercase(Locale.US))
            .put("readonly", !file.canWrite())
    }

    private fun resolve(input: String): File {
        val trimmed = input.trim().ifBlank { homePath() }
        val normalized = trimmed.replace('\\', '/')
        val file = File(normalized)
        return if (file.isAbsolute) file else File(homePath(), normalized)
    }

    private fun homePath(): String {
        val downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        return when {
            downloads != null && downloads.exists() -> downloads.absolutePath
            Environment.getExternalStorageDirectory() != null ->
                Environment.getExternalStorageDirectory().absolutePath
            else -> context.filesDir.absolutePath
        }
    }

    private fun walk(dir: File, depth: Int, maxDepth: Int, visit: (File) -> Unit) {
        if (depth > maxDepth) return
        val children = dir.listFiles() ?: return
        children.forEach { file ->
            visit(file)
            if (file.isDirectory) walk(file, depth + 1, maxDepth, visit)
        }
    }

    private fun slash(path: String) = path.replace('\\', '/')

    private fun formatSize(size: Long): String {
        if (size < 1024) return "$size B"
        val kb = size / 1024.0
        if (kb < 1024) return String.format(Locale.US, "%.1f KB", kb)
        val mb = kb / 1024.0
        if (mb < 1024) return String.format(Locale.US, "%.1f MB", mb)
        return String.format(Locale.US, "%.1f GB", mb / 1024.0)
    }

    companion object {
        private const val MAX_TEXT_BYTES = 512 * 1024
        private const val MAX_INLINE_DOWNLOAD = 2 * 1024 * 1024
    }
}

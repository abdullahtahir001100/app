import { existsSync } from "fs";
import { readFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function windowsCandidates(): string[] {
  const cwd = process.cwd();
  return [
    process.env.AGENT_BINARY_PATH,
    path.join(cwd, "public", "downloads", "ZenvoraAgent.exe"),
    path.join(cwd, "public", "downloads", "win_32.exe"),
    path.join(cwd, "zenvora_agent", "target", "release", "ZenvoraAgent.exe"),
    path.join(cwd, "zenvora_agent", "target", "release", "deps", "ZenvoraAgent.exe"),
    path.join(cwd, "zenvora_agent", "target", "release", "win_32.exe"),
    path.join(cwd, "zenvora_agent", "target", "release", "deps", "win_32.exe"),
  ].filter(Boolean) as string[];
}

function androidCandidates(): string[] {
  const cwd = process.cwd();
  return [
    process.env.ANDROID_APK_PATH,
    path.join(cwd, "public", "downloads", "Zenvora.apk"),
    path.join(cwd, "public", "downloads", "ZenvoraAgent.apk"),
    path.join(cwd, "android-agent-kotlin", "build", "outputs", "apk", "release", "android-agent-kotlin-release.apk"),
    path.join(cwd, "android-agent-kotlin", "build", "outputs", "apk", "release", "app-release.apk"),
    path.join(cwd, "android-agent-kotlin", "build", "outputs", "apk", "debug", "android-agent-kotlin-debug.apk"),
    path.join(cwd, "android-agent-kotlin", "build", "outputs", "apk", "debug", "app-debug.apk"),
  ].filter(Boolean) as string[];
}

export async function GET(req: NextRequest) {
  const platform = (req.nextUrl.searchParams.get("platform") || "windows").toLowerCase();
  const isAndroid = platform === "android" || platform === "apk";
  const filePath = (isAndroid ? androidCandidates() : windowsCandidates()).find((p) => existsSync(p));

  if (!filePath) {
    return NextResponse.json(
      {
        success: false,
        message: isAndroid
          ? "Android APK not found. Build release APK and place it at public/downloads/Zenvora.apk (or set ANDROID_APK_PATH)."
          : "Agent binary not found. Place ZenvoraAgent.exe in public/downloads/ or set AGENT_BINARY_PATH.",
      },
      { status: 404 }
    );
  }

  const data = await readFile(filePath);
  const filename = isAndroid ? "Zenvora.apk" : "ZenvoraAgent.exe";
  return new NextResponse(data, {
    status: 200,
    headers: {
      "Content-Type": isAndroid
        ? "application/vnd.android.package-archive"
        : "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "Content-Length": String(data.byteLength),
    },
  });
}

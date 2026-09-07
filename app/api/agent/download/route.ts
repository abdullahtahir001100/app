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

function androidCandidates(flavor: string): string[] {
  const cwd = process.cwd();
  if (flavor === "lite") {
    return [
      process.env.ANDROID_LITE_APK_PATH,
      path.join(cwd, "public", "downloads", "Zenvora-lite.apk"),
      path.join(cwd, "public", "downloads", "ZenvoraLite.apk"),
      path.join(cwd, "android-agent-kotlin", "build", "outputs", "apk", "lite", "release", "android-agent-kotlin-lite-release.apk"),
      path.join(cwd, "android-agent-kotlin", "build", "outputs", "apk", "lite", "release", "app-lite-release.apk"),
      path.join(cwd, "android-agent-kotlin", "build", "outputs", "apk", "lite", "debug", "android-agent-kotlin-lite-debug.apk"),
      path.join(cwd, "android-agent-kotlin", "build", "outputs", "apk", "lite", "debug", "app-lite-debug.apk"),
    ].filter(Boolean) as string[];
  }
  return [
    process.env.ANDROID_FULL_APK_PATH,
    process.env.ANDROID_APK_PATH,
    path.join(cwd, "public", "downloads", "Zenvora-full.apk"),
    path.join(cwd, "public", "downloads", "Zenvora.apk"),
    path.join(cwd, "public", "downloads", "ZenvoraAgent.apk"),
    path.join(cwd, "android-agent-kotlin", "build", "outputs", "apk", "full", "release", "android-agent-kotlin-full-release.apk"),
    path.join(cwd, "android-agent-kotlin", "build", "outputs", "apk", "full", "release", "app-full-release.apk"),
    path.join(cwd, "android-agent-kotlin", "build", "outputs", "apk", "enterprise", "release", "android-agent-kotlin-enterprise-release.apk"),
    path.join(cwd, "android-agent-kotlin", "build", "outputs", "apk", "play", "release", "android-agent-kotlin-play-release.apk"),
    path.join(cwd, "android-agent-kotlin", "build", "outputs", "apk", "full", "debug", "android-agent-kotlin-full-debug.apk"),
    path.join(cwd, "android-agent-kotlin", "build", "outputs", "apk", "full", "debug", "app-full-debug.apk"),
  ].filter(Boolean) as string[];
}

function macCandidates(preferZip = false): string[] {
  const cwd = process.cwd();
  if (preferZip) {
    return [
      path.join(cwd, "public", "downloads", "ZenvoraAgent-mac.zip"),
      process.env.AGENT_MACOS_BINARY_PATH,
      path.join(cwd, "public", "downloads", "ZenvoraAgent-mac"),
      path.join(cwd, "public", "downloads", "ZenvoraAgent"),
      path.join(cwd, "zenvora_agent", "target", "release", "ZenvoraAgent"),
      path.join(cwd, "zenvora_agent", "target", "debug", "ZenvoraAgent"),
      path.join(cwd, "zenvora_agent", "target.nosync", "release", "ZenvoraAgent"),
      path.join(cwd, "zenvora_agent", "target.nosync", "debug", "ZenvoraAgent"),
    ].filter(Boolean) as string[];
  }
  return [
    process.env.AGENT_MACOS_BINARY_PATH,
    path.join(cwd, "public", "downloads", "ZenvoraAgent-mac"),
    path.join(cwd, "public", "downloads", "ZenvoraAgent"),
    path.join(cwd, "public", "downloads", "ZenvoraAgent-mac.zip"),
    path.join(cwd, "zenvora_agent", "target", "release", "ZenvoraAgent"),
    path.join(cwd, "zenvora_agent", "target", "debug", "ZenvoraAgent"),
    path.join(cwd, "zenvora_agent", "target.nosync", "release", "ZenvoraAgent"),
    path.join(cwd, "zenvora_agent", "target.nosync", "debug", "ZenvoraAgent"),
  ].filter(Boolean) as string[];
}

function linuxCandidates(): string[] {
  const cwd = process.cwd();
  return [
    process.env.AGENT_LINUX_BINARY_PATH,
    path.join(cwd, "public", "downloads", "ZenvoraAgent-linux"),
    path.join(cwd, "public", "downloads", "ZenvoraAgent"),
    path.join(cwd, "zenvora_agent", "target", "release", "ZenvoraAgent"),
    path.join(cwd, "zenvora_agent", "target", "x86_64-unknown-linux-gnu", "release", "ZenvoraAgent"),
  ].filter(Boolean) as string[];
}

export async function GET(req: NextRequest) {
  const platform = (req.nextUrl.searchParams.get("platform") || "windows").toLowerCase();
  const flavorRaw = (req.nextUrl.searchParams.get("flavor") || "lite").toLowerCase();
  const format = (req.nextUrl.searchParams.get("format") || "").toLowerCase();
  const isAndroid = platform === "android" || platform === "apk";
  const isMac = platform === "mac" || platform === "macos" || platform === "darwin";
  const isLinux = platform === "linux";

  const flavor =
    flavorRaw === "full" || flavorRaw === "play" || flavorRaw === "enterprise"
      ? "full"
      : "lite";

  const preferZip = isMac && format !== "binary";
  let candidates: string[] = [];
  if (isAndroid) {
    candidates = androidCandidates(flavor);
  } else if (isMac) {
    candidates = macCandidates(preferZip);
  } else if (isLinux) {
    candidates = linuxCandidates();
  } else {
    candidates = windowsCandidates();
  }

  const filePath = candidates.find((p) => existsSync(p));

  if (!filePath) {
    return NextResponse.json(
      {
        success: false,
        message: isAndroid
          ? flavor === "lite"
            ? "Lite APK missing. Run: gradlew assembleLiteRelease — copy to public/downloads/Zenvora-lite.apk"
            : "Full APK missing. Run: gradlew assembleFullRelease — copy to public/downloads/Zenvora-full.apk"
          : isMac
          ? "macOS binary not found. Place ZenvoraAgent-mac in public/downloads/ or build in zenvora_agent."
          : isLinux
          ? "Linux binary not found. Place ZenvoraAgent-linux in public/downloads/ or build in zenvora_agent."
          : "Agent binary not found. Place ZenvoraAgent.exe in public/downloads/ or set AGENT_BINARY_PATH.",
      },
      { status: 404 }
    );
  }

  const data = await readFile(filePath);
  const isZip = filePath.endsWith(".zip");
  const filename = isAndroid
    ? flavor === "lite"
      ? "Zenvora-lite.apk"
      : "Zenvora-full.apk"
    : isZip
    ? path.basename(filePath)
    : isMac || isLinux
    ? "ZenvoraAgent"
    : "ZenvoraAgent.exe";

  const contentType = isAndroid
    ? "application/vnd.android.package-archive"
    : isZip
    ? "application/zip"
    : "application/octet-stream";

  return new NextResponse(data, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "Content-Length": String(data.byteLength),
    },
  });
}

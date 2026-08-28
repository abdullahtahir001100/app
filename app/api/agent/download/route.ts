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

export async function GET(req: NextRequest) {
  const platform = (req.nextUrl.searchParams.get("platform") || "windows").toLowerCase();
  const flavorRaw = (req.nextUrl.searchParams.get("flavor") || "lite").toLowerCase();
  const isAndroid = platform === "android" || platform === "apk";
  const flavor =
    flavorRaw === "full" || flavorRaw === "play" || flavorRaw === "enterprise"
      ? "full"
      : "lite";
  const filePath = (isAndroid ? androidCandidates(flavor) : windowsCandidates()).find((p) =>
    existsSync(p)
  );

  if (!filePath) {
    return NextResponse.json(
      {
        success: false,
        message: isAndroid
          ? flavor === "lite"
            ? "Lite APK missing. Run: gradlew assembleLiteRelease — copy to public/downloads/Zenvora-lite.apk"
            : "Full APK missing. Run: gradlew assembleFullRelease — copy to public/downloads/Zenvora-full.apk"
          : "Agent binary not found. Place ZenvoraAgent.exe in public/downloads/ or set AGENT_BINARY_PATH.",
      },
      { status: 404 }
    );
  }

  const data = await readFile(filePath);
  const filename = isAndroid
    ? flavor === "lite"
      ? "Zenvora-lite.apk"
      : "Zenvora-full.apk"
    : "ZenvoraAgent.exe";
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

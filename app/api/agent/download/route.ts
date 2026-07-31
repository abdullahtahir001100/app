import { existsSync } from "fs";
import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function candidatePaths(): string[] {
  const cwd = process.cwd();
  return [
    process.env.AGENT_BINARY_PATH,
    path.join(cwd, "public", "downloads", "win_32.exe"),
    path.join(cwd, "zenvora_agent", "target", "release", "win_32.exe"),
    path.join(cwd, "zenvora_agent", "target", "release", "deps", "win_32.exe"),
    path.join(cwd, "zenvora_agent", "target", "release", "win_32", "win_32.exe"),
  ].filter(Boolean) as string[];
}

export async function GET() {
  const filePath = candidatePaths().find((p) => existsSync(p));

  if (!filePath) {
    return NextResponse.json(
      {
        success: false,
        message:
          "Agent binary not found. Place win_32.exe in public/downloads/ or set AGENT_BINARY_PATH.",
      },
      { status: 404 }
    );
  }

  const data = await readFile(filePath);
  return new NextResponse(data, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": 'attachment; filename="win_32.exe"',
      "Cache-Control": "no-store",
      "Content-Length": String(data.byteLength),
    },
  });
}

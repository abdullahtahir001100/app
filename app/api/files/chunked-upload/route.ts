import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

export const runtime = "nodejs";

const { verifyRequestAuth } = require("../../../../server/middleware/auth");

const TEMP_UPLOAD_DIR = path.join(os.tmpdir(), "zenvora_uploads");

export async function POST(request: NextRequest) {
  const user = await verifyRequestAuth(request);
  if (!user) {
    return NextResponse.json({ success: false, message: "Authentication required." }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("chunk") as Blob | null;
    const uploadId = String(formData.get("uploadId") || "").replace(/[^a-zA-Z0-9_-]/g, "");
    const chunkIndex = parseInt(String(formData.get("chunkIndex") || "0"), 10);
    const totalChunks = parseInt(String(formData.get("totalChunks") || "1"), 10);
    const fileName = String(formData.get("fileName") || "upload.bin").replace(/[^a-zA-Z0-9_.-]/g, "_");

    if (!uploadId || !file) {
      return NextResponse.json({ success: false, message: "Missing upload parameters." }, { status: 400 });
    }

    await fs.mkdir(TEMP_UPLOAD_DIR, { recursive: true });
    const targetFile = path.join(TEMP_UPLOAD_DIR, `${uploadId}_${fileName}`);

    const buffer = Buffer.from(await file.arrayBuffer());

    if (chunkIndex === 0) {
      await fs.writeFile(targetFile, buffer);
    } else {
      await fs.appendFile(targetFile, buffer);
    }

    const isComplete = chunkIndex + 1 >= totalChunks;
    let finalSize = 0;
    if (isComplete) {
      const stat = await fs.stat(targetFile);
      finalSize = stat.size;
    }

    return NextResponse.json({
      success: true,
      chunkIndex,
      totalChunks,
      isComplete,
      filePath: isComplete ? targetFile : undefined,
      size: isComplete ? finalSize : undefined,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, message: err instanceof Error ? err.message : "Chunk upload failed." },
      { status: 500 }
    );
  }
}

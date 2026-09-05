import { NextRequest, NextResponse } from "next/server";

type GuardResult =
  | { ok: true; user: { id: string; email?: string; role?: string; name?: string } }
  | { ok: false; response: NextResponse };

export async function guardRequest(
  request: NextRequest,
  deviceId?: string | null
): Promise<GuardResult> {
  const { verifyRequestDeviceAccess } = require("../server/middleware/auth");
  const result = await verifyRequestDeviceAccess(request, deviceId || undefined);
  if (!result.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, message: result.message },
        { status: result.status || 401 }
      ),
    };
  }
  return { ok: true, user: result.user! };
}

export async function guardVirtualFileById(
  request: NextRequest,
  fileId: string
): Promise<GuardResult> {
  const VirtualFile = require("../server/models/VirtualFile");
  const doc = await VirtualFile.findById(fileId).lean();
  if (!doc) {
    return {
      ok: false,
      response: NextResponse.json({ success: false, message: "File not found." }, { status: 404 }),
    };
  }
  return guardRequest(request, doc.deviceId);
}

export async function guardVirtualFolderById(
  request: NextRequest,
  folderId: string
): Promise<GuardResult> {
  const VirtualFolder = require("../server/models/VirtualFolder");
  const doc = await VirtualFolder.findById(folderId).lean();
  if (!doc) {
    return {
      ok: false,
      response: NextResponse.json({ success: false, message: "Folder not found." }, { status: 404 }),
    };
  }
  return guardRequest(request, doc.deviceId);
}

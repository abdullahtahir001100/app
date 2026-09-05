import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const { execFileCommand, FILE_ACTION_TOKENS } = require("../../../../server/sockets/fileHandler");
const { getConnectionRegistry } = require("../../../../server/sockets/registry");
const { verifyRequestDeviceAccess } = require("../../../../server/middleware/auth");

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const targetDeviceId = String(body?.targetDeviceId || "");
    const action = String(body?.action || "");
    const payload = body?.payload && typeof body.payload === "object" ? body.payload : {};

    if (!FILE_ACTION_TOKENS.includes(action)) {
      return NextResponse.json({ success: false, message: `Unsupported file action: ${action}` }, { status: 400 });
    }
    if (!targetDeviceId) {
      return NextResponse.json({ success: false, message: "targetDeviceId is required." }, { status: 400 });
    }

    const access = await verifyRequestDeviceAccess(request, targetDeviceId);
    if (!access?.ok) {
      return NextResponse.json(
        { success: false, message: access?.message || "Unauthorized." },
        { status: access?.status || 401 }
      );
    }

    getConnectionRegistry();
    const packet = await execFileCommand(action, targetDeviceId, payload);
    const fileResult = packet.file_result || {};
    if (fileResult.error) {
      return NextResponse.json(
        {
          success: false,
          message: String(fileResult.error),
          action: packet.last_action || action,
          file_result: fileResult,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      action: packet.last_action || action,
      status: packet.status || "OK",
      message: packet.message || null,
      file_result: fileResult,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "File operation failed.";
    return NextResponse.json(
      { success: false, message },
      { status: message.includes("offline") ? 503 : 504 }
    );
  }
}

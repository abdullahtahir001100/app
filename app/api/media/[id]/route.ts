import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const virtualFileService = require("../../../../server/services/virtualFileService");
const { verifyRequestAuth } = require("../../../../server/middleware/auth");

type RouteContext = { params: Promise<{ id: string }> };

function jsonError(error: unknown, fallback: string) {
  const err = error as { message?: string; status?: number };
  const payload = virtualFileService.serviceErrorResponse(err, fallback);
  return NextResponse.json(payload, { status: payload.status || 500 });
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const auth = await verifyRequestAuth(_request);
    if (!auth?.id) {
      return NextResponse.json({ success: false, message: "Authentication required." }, { status: 401 });
    }
    const payload = await virtualFileService.deleteVirtualFile({ user: auth }, id);
    return NextResponse.json(payload);
  } catch (error: unknown) {
    return jsonError(error, "Failed to move media to trash.");
  }
}

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const service = require("../../../../server/services/virtualFileService");
const { verifyRequestAuth, verifyRequestDeviceAccess } = require("../../../../server/middleware/auth");

type RouteContext = { params: Promise<{ path?: string[] }> };

function jsonError(error: unknown, fallback: string, extras: Record<string, unknown> = {}) {
  const err = error as { message?: string; status?: number };
  const payload = service.serviceErrorResponse(err, fallback);
  return NextResponse.json({ ...payload, ...extras }, { status: payload.status || 500 });
}

async function requireDeviceAccess(request: NextRequest, deviceId?: string) {
  const access = await verifyRequestDeviceAccess(request, deviceId);
  if (!access.ok) {
    return NextResponse.json(
      { success: false, message: access.message },
      { status: access.status }
    );
  }
  return access;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const segments = (await context.params).path || [];

  try {
    if (segments.length === 1 && segments[0] === "browse") {
      const access = await requireDeviceAccess(request, request.nextUrl.searchParams.get("deviceId") || undefined);
      if (access instanceof NextResponse) return access;
      return NextResponse.json(await service.browseVirtualFolder(request));
    }
    if (segments.length === 1 && segments[0] === "list") {
      const access = await requireDeviceAccess(request, request.nextUrl.searchParams.get("deviceId") || undefined);
      if (access instanceof NextResponse) return access;
      return NextResponse.json(await service.browseVirtualFolder(request));
    }
    if (segments.length === 1 && segments[0] === "folders") {
      const access = await requireDeviceAccess(request, request.nextUrl.searchParams.get("deviceId") || undefined);
      if (access instanceof NextResponse) return access;
      return NextResponse.json(await service.listVirtualFolders(request));
    }
    if (segments.length === 1 && segments[0] === "trash") {
      const access = await requireDeviceAccess(request, request.nextUrl.searchParams.get("deviceId") || undefined);
      if (access instanceof NextResponse) return access;
      return NextResponse.json(await service.listTrashItems(request));
    }
    if (segments.length === 2 && segments[0] === "share") {
      return NextResponse.json(await service.lookupShareToken(request, segments[1]));
    }
    return NextResponse.json({ success: false, message: "Not found." }, { status: 404 });
  } catch (error) {
    if (segments[0] === "folders") {
      return jsonError(error, "Failed to list folders.", {
        folders: [{ label: "Cloud Drive (root)", value: "/" }],
      });
    }
    return jsonError(error, "Request failed.", { items: [] });
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const segments = (await context.params).path || [];

  try {
    if (segments.length === 1 && segments[0] === "folders") {
      const body = await request.json();
      const access = await requireDeviceAccess(request, String(body?.deviceId || request.nextUrl.searchParams.get("deviceId") || ""));
      if (access instanceof NextResponse) return access;
      return NextResponse.json(await service.createVirtualFolder({ ...body, user: access.user }));
    }

    if (segments.length === 1 && segments[0] === "upload") {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ success: false, message: "No file received." }, { status: 400 });
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const body = {
        deviceId: String(formData.get("deviceId") || "unknown-device"),
        virtualFolder: String(formData.get("virtualFolder") || "/"),
        originalPath: String(formData.get("originalPath") || ""),
      };

      const access = await requireDeviceAccess(request, body.deviceId);
      if (access instanceof NextResponse) return access;

      return NextResponse.json(
        await service.uploadVirtualFile(
          { body, user: access.user },
          {
            buffer,
            originalname: file.name,
            mimetype: file.type || "application/octet-stream",
            size: file.size,
          }
        )
      );
    }

    if (segments.length === 2 && segments[1] === "share") {
      const auth = await verifyRequestAuth(request);
      if (!auth?.id) {
        return NextResponse.json({ success: false, message: "Authentication required." }, { status: 401 });
      }
      return NextResponse.json(await service.shareVirtualFile(request, segments[0]));
    }
    if (segments.length === 2 && segments[1] === "restore") {
      const auth = await verifyRequestAuth(request);
      if (!auth?.id) {
        return NextResponse.json({ success: false, message: "Authentication required." }, { status: 401 });
      }
      return NextResponse.json(await service.restoreVirtualFile({ user: auth }, segments[0]));
    }

    if (segments.length === 2 && segments[1] === "rename") {
      const auth = await verifyRequestAuth(request);
      if (!auth?.id) {
        return NextResponse.json({ success: false, message: "Authentication required." }, { status: 401 });
      }
      const body = await request.json();
      return NextResponse.json(await service.renameVirtualFile({ user: auth }, segments[0], body));
    }
    if (segments.length === 2 && segments[1] === "move") {
      const auth = await verifyRequestAuth(request);
      if (!auth?.id) {
        return NextResponse.json({ success: false, message: "Authentication required." }, { status: 401 });
      }
      const body = await request.json();
      return NextResponse.json(await service.moveVirtualFile({ user: auth }, segments[0], body));
    }

    return NextResponse.json({ success: false, message: "Not found." }, { status: 404 });
  } catch (error) {
    return jsonError(error, "Request failed.");
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const segments = (await context.params).path || [];

  try {
    const auth = await verifyRequestAuth(request);
    if (!auth?.id) {
      return NextResponse.json({ success: false, message: "Authentication required." }, { status: 401 });
    }
    const body = await request.json();

    if (segments.length === 2 && segments[1] === "rename") {
      return NextResponse.json(await service.renameVirtualFile({ user: auth }, segments[0], body));
    }
    if (segments.length === 2 && segments[1] === "move") {
      return NextResponse.json(await service.moveVirtualFile({ user: auth }, segments[0], body));
    }

    return NextResponse.json({ success: false, message: "Not found." }, { status: 404 });
  } catch (error) {
    return jsonError(error, "Request failed.");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const segments = (await context.params).path || [];

  try {
    const auth = await verifyRequestAuth(request);
    if (!auth?.id) {
      return NextResponse.json({ success: false, message: "Authentication required." }, { status: 401 });
    }

    if (segments.length === 2 && segments[0] === "folders") {
      return NextResponse.json(await service.deleteVirtualFolder({ user: auth }, segments[1]));
    }
    if (segments.length === 2 && segments[1] === "permanent") {
      return NextResponse.json(await service.purgeVirtualFile({ user: auth }, segments[0]));
    }
    if (segments.length === 1) {
      return NextResponse.json(await service.deleteVirtualFile({ user: auth }, segments[0]));
    }

    return NextResponse.json({ success: false, message: "Not found." }, { status: 404 });
  } catch (error) {
    return jsonError(error, "Request failed.");
  }
}

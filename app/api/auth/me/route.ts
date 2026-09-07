import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const { listUserDevices } = require("../../../../server/services/authService");
const { verifyRequestAuth } = require("../../../../server/middleware/auth");

export async function GET(request: NextRequest) {
  const user = await verifyRequestAuth(request);
  if (!user) {
    return NextResponse.json({ success: false, message: "Authentication required." }, { status: 401 });
  }

  const devices = await listUserDevices(user.id);
  return NextResponse.json({
    success: true,
    user,
    devices: devices.map((d: { deviceId: string; label: string; lastConnectedAt?: Date }) => ({
      deviceId: d.deviceId,
      label: d.label,
      lastConnectedAt: d.lastConnectedAt
    }))
  });
}

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const { createAgentCredential } = require("../../../../server/services/authService");
const { verifyRequestAuth } = require("../../../../server/middleware/auth");

export async function POST(request: NextRequest) {
  const user = await verifyRequestAuth(request);
  if (!user) {
    return NextResponse.json({ success: false, message: "Authentication required." }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { credential, agentToken } = await createAgentCredential(
      user.id,
      body.deviceId,
      body.label
    );
    return NextResponse.json({
      success: true,
      device: {
        deviceId: credential.deviceId,
        label: credential.label
      },
      agentToken
    });
  } catch (error: unknown) {
    const err = error as { message?: string; status?: number };
    return NextResponse.json(
      { success: false, message: err.message || "Could not register agent." },
      { status: err.status || 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const user = await verifyRequestAuth(request);
  if (!user) {
    return NextResponse.json({ success: false, message: "Authentication required." }, { status: 401 });
  }

  const { listUserDevices } = require("../../../../server/services/authService");
  const devices = await listUserDevices(user.id);
  return NextResponse.json({
    success: true,
    devices: devices.map((d: { deviceId: string; label: string; lastConnectedAt?: Date }) => ({
      deviceId: d.deviceId,
      label: d.label,
      lastConnectedAt: d.lastConnectedAt
    }))
  });
}

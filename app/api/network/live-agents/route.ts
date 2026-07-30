import { NextResponse } from "next/server";

export const runtime = "nodejs";

type DeviceOption = {
  value: string;
  label?: string;
  role?: string;
};

type DeviceRecord = {
  deviceId: string;
  hostname?: string;
  localIp?: string;
  publicIp?: string;
  platform?: string;
  status?: string;
  lastSeen?: Date;
  battery?: number | null;
  storage?: number | null;
};

export async function GET(request: Request) {
  try {
    const { getConnectionRegistry } = require("../../../../server/sockets/registry");
    const { getLiveDeviceOptions } = require("../../../../server/sockets/handler");
    const { verifyRequestAuth } = require("../../../../server/middleware/auth");
    const Device = require("../../../../server/models/Device");

    const user = await verifyRequestAuth(request);
    if (!user?.id) {
      return NextResponse.json({ success: false, devices: [], message: 'Authentication required.' }, { status: 401 });
    }

    getConnectionRegistry();

    const liveDevices = getLiveDeviceOptions(user.id) as DeviceOption[];
    const liveDeviceIds = new Set(liveDevices.map((device) => String(device.value)));
    const deviceRecords = (await Device.find({ userId: user.id }).sort({ lastSeen: -1 }).lean()) as DeviceRecord[];

    const devices = deviceRecords.map((record) => {
      const deviceId = String(record.deviceId || "");
      const isLive = liveDeviceIds.has(deviceId);
      return {
        value: deviceId,
        label: record.hostname || deviceId,
        role: "AGENT",
        platform: record.platform || null,
        localIp: record.localIp || null,
        publicIp: record.publicIp || null,
        status: isLive ? "online" : "offline",
        battery: typeof record.battery === "number" ? record.battery : null,
        storage: typeof record.storage === "number" ? record.storage : null,
        lastSeen: record.lastSeen ? record.lastSeen.toISOString() : null,
      };
    });

    return NextResponse.json({ success: true, devices });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list live agents.";
    return NextResponse.json({ success: false, devices: [], message }, { status: 500 });
  }
}

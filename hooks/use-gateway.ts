"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { gatewayClient, type DeviceOption } from "@/lib/gateway-client";

export function useGateway() {
  const [isConnected, setIsConnected] = useState(false);
  const [devices, setDevices] = useState<DeviceOption[]>(() => gatewayClient.getDevices());
  const [devicesLoading, setDevicesLoading] = useState(
    () => !gatewayClient.hasDeviceCache() && gatewayClient.isDevicesFetchInFlight()
  );
  const [socket, setSocket] = useState<WebSocket | null>(gatewayClient.getSocket());
  const devicesRef = useRef(devices);
  devicesRef.current = devices;

  useEffect(() => {
    setIsConnected(gatewayClient.isOpen());
    setDevices(gatewayClient.getDevices());
    setSocket(gatewayClient.getSocket());

    void gatewayClient.refreshDevices().finally(() => setDevicesLoading(false));

    return gatewayClient.subscribe((event) => {
      if (event.type === "connected") {
        setIsConnected(true);
        setSocket(gatewayClient.getSocket());
      }
      if (event.type === "disconnected") {
        setIsConnected(false);
        setSocket(null);
      }
      if (event.type === "devices") {
        setDevices(event.devices);
        setDevicesLoading(false);
      }
    });
  }, []);

  const resolveTarget = useCallback(
    (override?: string) => {
      if (override) return override;
      const online = devicesRef.current.find((d) => d.status === "online");
      return online?.value || devicesRef.current[0]?.value || "";
    },
    []
  );

  const isDeviceOnline = useCallback((deviceId?: string) => {
    const id = deviceId || devicesRef.current[0]?.value;
    if (!id) return false;
    return devicesRef.current.some((d) => d.value === id && d.status === "online");
  }, []);

  const dispatch = useCallback(
    (action: string, payload: Record<string, unknown> = {}, targetOverride?: string) => {
      // Prefer explicit target; never coerce to devices[0] when override is empty string.
      const target =
        (targetOverride && String(targetOverride).trim()) || resolveTarget();
      if (!target) return { ok: false as const, reason: "no-agent" as const };
      if (!gatewayClient.isOpen()) {
        gatewayClient.ensureConnected();
        return { ok: false as const, reason: "offline" as const };
      }
      const deviceOnline = devicesRef.current.some(
        (d) => d.value === target && d.status === "online"
      );
      if (!deviceOnline) {
        // Soft-fail: still try dispatch if WS is up (HTTP status can lag).
        // Security ownership is enforced server-side.
      }
      if (!gatewayClient.dispatch(action, target, payload)) {
        return { ok: false as const, reason: "offline" as const };
      }
      return { ok: true as const, target };
    },
    [resolveTarget]
  );

  const getSocket = useCallback(() => gatewayClient.getSocket(), []);

  const sendCommand = useCallback(
    (deviceId: string, command: string) => {
      return dispatch(command, { command }, deviceId);
    },
    [dispatch]
  );

  const refreshDevices = useCallback(
    (force = false) => gatewayClient.refreshDevices({ force }),
    []
  );

  return {
    isConnected,
    devices,
    devicesLoading,
    dispatch,
    sendCommand,
    refreshDevices,
    resolveTarget,
    isDeviceOnline,
    getSocket,
    socket,
    subscribe: gatewayClient.subscribe.bind(gatewayClient),
    getFullDevices: gatewayClient.getFullDevices.bind(gatewayClient),
    ensureConnected: gatewayClient.ensureConnected.bind(gatewayClient),
  };
}

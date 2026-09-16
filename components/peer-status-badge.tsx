"use client";

import { useEffect, useState } from "react";
import { PeerDirectTransport, TransportStatus } from "@/lib/peer-direct-transport";
import { Wifi, Zap, Globe, ShieldCheck } from "lucide-react";

export function PeerStatusBadge({
  deviceId,
  localIp,
  webrtcState,
}: {
  deviceId: string;
  localIp?: string;
  webrtcState?: string;
}) {
  const [status, setStatus] = useState<TransportStatus>({
    mode: "gateway",
    connected: true,
    latencyMs: 0,
    localIp: localIp || "",
    isLanReachable: false,
  });

  useEffect(() => {
    if (!deviceId) return;
    const transport = PeerDirectTransport.get(deviceId);
    if (localIp) {
      transport.setLocalIp(localIp);
    }
    const unsub = transport.onStatusChange(setStatus);
    return () => unsub();
  }, [deviceId, localIp]);

  const isUdpConnected = webrtcState === "connected";
  const isPrivateIp = localIp && /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|127\.0\.0\.1|localhost)/.test(localIp);
  const isLan = status.mode === "lan_p2p" || (isUdpConnected && isPrivateIp);
  const isWanP2P = isUdpConnected && !isPrivateIp;
  const isConnectingP2P = webrtcState === "connecting";

  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-medium border shadow-xs transition-all">
      {isLan ? (
        <>
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <Wifi className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
          <span className="text-emerald-700 dark:text-emerald-300 font-semibold">
            DIRECT LAN P2P (UDP &lt;1ms)
          </span>
          {localIp && (
            <span className="text-emerald-600/70 dark:text-emerald-400/70 border-l border-emerald-500/20 pl-1.5">
              {localIp}
            </span>
          )}
        </>
      ) : isWanP2P ? (
        <>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
          <Zap className="w-3 h-3 text-amber-600 dark:text-amber-400" />
          <span className="text-amber-700 dark:text-amber-300 font-semibold">
            DIRECT P2P TUNNEL (UDP)
          </span>
        </>
      ) : isConnectingP2P ? (
        <>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400 animate-pulse" />
          <Zap className="w-3 h-3 text-amber-500 animate-bounce" />
          <span className="text-amber-600 dark:text-amber-300">
            CONNECTING P2P TUNNEL…
          </span>
        </>
      ) : (
        <>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
          <Globe className="w-3 h-3 text-blue-600 dark:text-blue-400" />
          <span className="text-blue-700 dark:text-blue-300">
            FAST RELAY TUNNEL
          </span>
          {status.localIp && (
            <span className="text-muted-foreground border-l border-border pl-1.5 text-[10px]">
              LAN: {status.localIp}
            </span>
          )}
        </>
      )}
    </div>
  );
}

export default PeerStatusBadge;

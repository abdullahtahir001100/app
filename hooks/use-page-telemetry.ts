"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

export function usePageTelemetry() {
  const pathname = usePathname();
  const startTimeRef = useRef<number>(Date.now());
  const activePageRef = useRef<string>(pathname || "/");

  useEffect(() => {
    activePageRef.current = pathname || "/";
    startTimeRef.current = Date.now();

    const sendHeartbeat = async (dwellSeconds: number) => {
      try {
        if (typeof window === "undefined") return;
        await fetch("/api/auth/telemetry/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            page: activePageRef.current,
            pageTitle: typeof document !== "undefined" ? document.title : "",
            dwellSeconds,
          }),
        });
      } catch (_) {
        // Telemetry is silent and non-blocking
      }
    };

    // Initial ping on page enter
    void sendHeartbeat(0);

    // Periodic heartbeat every 30 seconds
    const interval = setInterval(() => {
      const elapsed = Math.round((Date.now() - startTimeRef.current) / 1000);
      startTimeRef.current = Date.now();
      void sendHeartbeat(elapsed);
    }, 30000);

    return () => {
      clearInterval(interval);
      const elapsed = Math.round((Date.now() - startTimeRef.current) / 1000);
      if (elapsed > 0) {
        void sendHeartbeat(elapsed);
      }
    };
  }, [pathname]);
}

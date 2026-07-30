"use client";

import { Smartphone, Shield, LogOut, Menu, X, Home, FileText, Eye, Camera, Bell, History, Mic, MicOff, TerminalSquare, ScrollText } from "lucide-react";
import { Suspense, useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ZenvoraLogo } from "@/components/zenvora-logo";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useSearchParams } from "next/navigation";
import { useGateway } from "@/hooks/use-gateway";

import Link from "next/link";

function AppSidebarFallback() {
  return (
    <aside className="fixed left-0 top-0 h-screen w-64 bg-sidebar border-r border-sidebar-border z-40 overflow-y-auto">
      <div className="p-8">
        <div className="mb-12">
          <div className="flex items-center gap-3">
            <div className="text-foreground">
              <ZenvoraLogo />
            </div>
            <span className="font-display text-xl font-semibold">Zenvora</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

function AppSidebarContent() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [userProfile, setUserProfile] = useState<{name: string; email: string; avatarUrl?: string | null} | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const { isConnected, devices, dispatch, subscribe } = useGateway();
  const searchParams = useSearchParams();
  const deviceId = searchParams ? (searchParams.get("deviceId") || devices[0]?.value || "") : (devices[0]?.value || "");

  const [isAudioStreaming, setIsAudioStreaming] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeDeviceIdRef = useRef<string>("");

  useEffect(() => {
    activeDeviceIdRef.current = deviceId;
  }, [deviceId]);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/session", { credentials: "include" })
      .then(async (response) => {
        if (!active) return;
        const payload = await response.json().catch(() => ({}));
        if (response.ok && payload?.authenticated && payload?.user) {
          setUserProfile({
            name: payload.user.name || "User",
            email: payload.user.email || "",
            avatarUrl: payload.user.avatarUrl || null
          });
        }
      })
      .catch(() => {
        if (!active) return;
      });

    return () => {
      active = false;
    };
  }, []);

  // Handle gateway binary streaming events for audio packets (0x0A)
  useEffect(() => {
    if (!isAudioStreaming) {
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      return;
    }

    // Initialize audio context
    const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
    const audioCtx = new AudioContextClass();
    audioContextRef.current = audioCtx;
    nextStartTimeRef.current = 0;

    const unsubscribe = subscribe((event) => {
      if (event.type === "binary") {
        const payload = event.data;
        const bufferPromise = payload instanceof Blob ? payload.arrayBuffer() : Promise.resolve(payload);
        bufferPromise.then((buffer) => {
          const bytes = new Uint8Array(buffer);
          if (bytes.length < 5 || bytes[0] !== 0x0A) return;

          // Read sample rate (bytes 1-4)
          const sampleRate = (bytes[1] << 24) | (bytes[2] << 16) | (bytes[3] << 8) | bytes[4];

          // Read mono PCM i16 samples starting at byte 5
          const samplesByteOffset = 5;
          const samplesLength = (bytes.length - samplesByteOffset) / 2;
          
          const int16Array = new Int16Array(samplesLength);
          const dataView = new DataView(buffer);
          for (let i = 0; i < samplesLength; i++) {
            int16Array[i] = dataView.getInt16(samplesByteOffset + i * 2, true); 
          }

          // Convert to Float32
          const float32Array = new Float32Array(samplesLength);
          for (let i = 0; i < samplesLength; i++) {
            float32Array[i] = int16Array[i] / 32768.0;
          }

          // Queue and play PCM chunk
          if (audioCtx.state === "suspended") {
            audioCtx.resume().catch(() => {});
          }

          const audioBuffer = audioCtx.createBuffer(1, float32Array.length, sampleRate);
          audioBuffer.copyToChannel(float32Array, 0);

          const source = audioCtx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(audioCtx.destination);

          const now = audioCtx.currentTime;
          if (nextStartTimeRef.current < now) {
            nextStartTimeRef.current = now + 0.06; 
          }
          source.start(nextStartTimeRef.current);
          nextStartTimeRef.current += audioBuffer.duration;
        }).catch((err) => {
          console.error("[AUDIO SIDEBAR] Failed to parse binary audio packet:", err);
        });
      }
    });

    return () => {
      unsubscribe();
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
    };
  }, [isAudioStreaming, subscribe]);

  const toggleAudioStream = () => {
    const target = activeDeviceIdRef.current;
    if (!target) return;

    if (isAudioStreaming) {
      dispatch("STOP_AUDIO_STREAM", {}, target);
      setIsAudioStreaming(false);
    } else {
      dispatch("START_AUDIO_STREAM", {}, target);
      setIsAudioStreaming(true);
    }
  };

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);

    if (isAudioStreaming) {
      const target = activeDeviceIdRef.current;
      if (target) {
        dispatch("STOP_AUDIO_STREAM", {}, target);
      }
      setIsAudioStreaming(false);
    }

    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Still clear local state and redirect even if the request fails.
    }

    try {
      sessionStorage.removeItem("zenvora_device_registry");
      sessionStorage.removeItem("zenvora_camera_streaming");
      sessionStorage.removeItem("zenvora_screen_streaming");
    } catch {
      // ignore storage errors
    }

    router.replace("/login");
    router.refresh();
  };

  const userMenuItems = [
    { icon: Home, label: "Dashboard", href: "/dashboard" },
    { icon: Smartphone, label: "Devices", href: "/devices" },
    { icon: Eye, label: "Screen Monitor", href: "/screen" },
    { icon: Camera, label: "Camera Access", href: "/camera" },
    { icon: FileText, label: "File Manager", href: "/files" },
    { icon: TerminalSquare, label: "Shell Control", href: "/shell" },
    { icon: Bell, label: "Notifications", href: "/notifications" },
    { icon: History, label: "Activity Logs", href: "/logs" },
    { icon: ScrollText, label: "Live Console", href: "/console" },
  ];

  // const adminMenuItems = [
  //   { icon: Shield, label: "Admin Dashboard", href: "/admin" },
  //   { icon: Smartphone, label: "Devices", href: "/admin/devices" },
  //   { icon: FileText, label: "Users", href: "/admin/users" },
  //   { icon: History, label: "System Logs", href: "/admin/logs" },
  //   { icon: Eye, label: "Security", href: "/admin/security" },
  // ];

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-4 left-4 z-50 lg:hidden p-2 hover:bg-secondary rounded-lg transition-colors"
      >
       {isOpen ? 
        (<><div className="left"><X className="w-6 h-6" /></div></>) : 
        <Menu className="w-6 h-6" />}
      </button>

      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 h-screen w-64 bg-sidebar border-r border-sidebar-border transform transition-transform duration-300 ease-in-out z-40 overflow-y-auto custom-scrollbar ${
          isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="p-8">
          <div className="mb-12">
            <div className="flex items-center gap-3 mb-2">
              {/* <div className="w-10 h-10 bg-sidebar-primary rounded-lg flex items-center justify-center">
                <Smartphone className="w-5 h-5 text-sidebar-primary-foreground" />
              </div> */}
            
          <div className="flex items-center gap-3">
            <div className="text-foreground hover-lift transition-transform">
              <ZenvoraLogo />
            </div>
            <span className="font-display text-xl font-semibold">Zenvora</span>
          </div>
         
            </div>
            <p className="text-xs text-sidebar-foreground/60 text-center">Remote Device Control</p>
          </div>

          <div className="mb-6 rounded-lg border border-sidebar-border/60 bg-sidebar-accent/30 p-3">
            <div className="flex items-center gap-3">
              <Avatar className="h-10 w-10">
                <AvatarImage src={userProfile?.avatarUrl || undefined} alt={userProfile?.name || "User"} />
                <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-sm">
                  {userProfile?.name ? userProfile.name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase() : "U"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-sidebar-foreground">{userProfile?.name || "Signed in"}</p>
                <p className="truncate text-xs text-sidebar-foreground/60">{userProfile?.email || "View your account"}</p>
              </div>
            </div>
          </div>

          {/* User Mode */}
          <div className="mb-10">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs font-mono text-sidebar-foreground/50 uppercase tracking-wide">User Mode</p>
              {deviceId && (
                <button
                  onClick={toggleAudioStream}
                  className="p-1 hover:text-foreground text-sidebar-foreground/60 transition-colors focus:outline-none focus:ring-0 cursor-pointer"
                  title={isAudioStreaming ? "Stop Live Device Audio Listening" : "Listen Live Device Microphone/Audio"}
                >
                  {isAudioStreaming ? (
                    <Mic className="w-4.5 h-4.5 text-rose-500 animate-pulse" />
                  ) : (
                    <MicOff className="w-4.5 h-4.5 text-sidebar-foreground/30 hover:text-sidebar-foreground/75" />
                  )}
                </button>
              )}
            </div>
            <nav className="space-y-2">
              {userMenuItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setIsOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 text-sm rounded-lg text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors group"
                >
                  <item.icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </Link>
              ))}
            </nav>
          </div>

          {/* Admin Mode */}
          {/* <div className="border-t border-sidebar-border pt-8">
            <p className="text-xs font-mono text-sidebar-foreground/50 uppercase tracking-wide mb-4">Admin Mode</p>
            <nav className="space-y-2">
              {adminMenuItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setIsOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 text-sm rounded-lg text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors group"
                >
                  <item.icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </Link>
              ))}
            </nav>
          </div> */}
        </div>

        {/* Footer */}
        <div className="bottom-0 left-0 right-0 p-6 border-t border-sidebar-border">
          <button
            type="button"
            onClick={() => void handleLogout()}
            disabled={loggingOut}
            className="flex items-center gap-3 text-sm text-sidebar-foreground hover:text-sidebar-foreground/70 transition-colors w-full disabled:opacity-60"
          >
            <LogOut className="w-4 h-4" />
            <span>{loggingOut ? "Logging out..." : "Logout"}</span>
          </button>
        </div>
      </aside>

      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-30 lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}
    </>
  );
}

export function AppSidebar() {
  return (
    <Suspense fallback={<AppSidebarFallback />}>
      <AppSidebarContent />
    </Suspense>
  );
}

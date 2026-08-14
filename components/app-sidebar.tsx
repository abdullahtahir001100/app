"use client";

import {
  Smartphone,
  Shield,
  LogOut,
  Menu,
  X,
  Home,
  FileText,
  Eye,
  Camera,
  Bell,
  History,
  Mic,
  MicOff,
  TerminalSquare,
  ScrollText,
  ChevronDown,
  ChevronUp,
  Settings,
} from "lucide-react";
import { Suspense, useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ZenvoraLogo } from "@/components/zenvora-logo";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useSearchParams } from "next/navigation";
import { useGateway } from "@/hooks/use-gateway";
import { unwrapDeviceBinaryFrame } from "@/lib/binary-frame";

import Link from "next/link";
import { clearDeviceRegistryCache, gatewayClient } from "@/lib/gateway-client";

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
  const [userProfile, setUserProfile] = useState<{
    name: string;
    email: string;
    avatarUrl?: string | null;
    role?: string;
    pages?: string[];
  } | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  const { devices, dispatch, subscribe } = useGateway();
  const searchParams = useSearchParams();
  const urlDeviceId = searchParams ? searchParams.get("deviceId") || "" : "";

  const [isAudioStreaming, setIsAudioStreaming] = useState(false);
  const [micDropdownOpen, setMicDropdownOpen] = useState(false);
  const [audioDevices, setAudioDevices] = useState<Array<{ id: string; label: string }>>([]);
  const [listeningDeviceId, setListeningDeviceId] = useState("");
  const [micsLoading, setMicsLoading] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const listeningDeviceIdRef = useRef<string>("");
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const micMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    listeningDeviceIdRef.current = listeningDeviceId;
  }, [listeningDeviceId]);

  useEffect(() => {
    if (listeningDeviceId) return;
    const fromUrl = urlDeviceId && devices.some((d) => d.value === urlDeviceId) ? urlDeviceId : "";
    const online = devices.find((d) => d.status === "online")?.value || "";
    const fallback = fromUrl || online || devices[0]?.value || "";
    if (fallback) setListeningDeviceId(fallback);
  }, [urlDeviceId, devices, listeningDeviceId]);

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
            avatarUrl: payload.user.avatarUrl || null,
            role: payload.user.role || "user",
            pages: Array.isArray(payload.user.pages) ? payload.user.pages : [],
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

  useEffect(() => {
    const unsubscribe = subscribe((event) => {
      if (event.type !== "json") return;
      const packet = event.packet;
      if (packet?.action !== "LIST_AUDIO_DEVICES") return;
      const metrics = packet.metrics as { audio_devices?: Array<{ id?: string; label?: string }> } | undefined;
      const list = Array.isArray(metrics?.audio_devices) ? metrics.audio_devices : [];
      const sender = String(packet.senderAgentId || packet.deviceId || "");
      if (sender && listeningDeviceIdRef.current && sender !== listeningDeviceIdRef.current) {
        return;
      }
      setAudioDevices(
        list
          .map((dev) => ({
            id: String(dev.id || dev.label || ""),
            label: String(dev.label || dev.id || "Microphone"),
          }))
          .filter((dev) => dev.id)
      );
      setMicsLoading(false);
    });
    return () => unsubscribe();
  }, [subscribe]);

  useEffect(() => {
    if (!isAudioStreaming) {
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      return;
    }

    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audioCtx = new AudioContextClass();
    audioContextRef.current = audioCtx;
    nextStartTimeRef.current = 0;

    const unsubscribe = subscribe((event) => {
      if (event.type !== "binary") return;
      const payload = event.data;
      const bufferPromise = payload instanceof Blob ? payload.arrayBuffer() : Promise.resolve(payload);
      bufferPromise
        .then((buffer) => {
          const { deviceId, frame } = unwrapDeviceBinaryFrame(buffer);
          if (deviceId && listeningDeviceIdRef.current && deviceId !== listeningDeviceIdRef.current) {
            return;
          }
          if (frame.length < 5 || frame[0] !== 0x0a) return;

          const sampleRate = (frame[1] << 24) | (frame[2] << 16) | (frame[3] << 8) | frame[4];
          const samplesByteOffset = 5;
          const samplesLength = Math.floor((frame.length - samplesByteOffset) / 2);
          if (samplesLength <= 0 || !sampleRate) return;

          const float32Array = new Float32Array(samplesLength);
          const dataView = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
          for (let i = 0; i < samplesLength; i++) {
            float32Array[i] = dataView.getInt16(samplesByteOffset + i * 2, true) / 32768.0;
          }

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
        })
        .catch((err) => {
          console.error("[AUDIO SIDEBAR] Failed to parse binary audio packet:", err);
        });
    });

    return () => {
      unsubscribe();
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
    };
  }, [isAudioStreaming, subscribe]);

  useEffect(() => {
    if (!accountMenuOpen && !micDropdownOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (accountMenuOpen && accountMenuRef.current && !accountMenuRef.current.contains(target)) {
        setAccountMenuOpen(false);
      }
      if (micDropdownOpen && micMenuRef.current && !micMenuRef.current.contains(target)) {
        setMicDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [accountMenuOpen, micDropdownOpen]);

  const requestMicList = (targetDeviceId: string) => {
    if (!targetDeviceId) return;
    setMicsLoading(true);
    setAudioDevices([]);
    dispatch("LIST_AUDIO_DEVICES", {}, targetDeviceId);
  };

  const toggleAudioStream = (selectedMicrophoneId?: string) => {
    const target = listeningDeviceIdRef.current;
    if (!target) return;

    if (isAudioStreaming) {
      dispatch("STOP_AUDIO_STREAM", {}, target);
      setIsAudioStreaming(false);
      return;
    }

    dispatch("START_AUDIO_STREAM", { device_id: selectedMicrophoneId || undefined }, target);
    setIsAudioStreaming(true);
    setMicDropdownOpen(false);
  };

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setAccountMenuOpen(false);

    if (isAudioStreaming) {
      const target = listeningDeviceIdRef.current;
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
      clearDeviceRegistryCache();
      gatewayClient.clearCachedDevices();
      sessionStorage.removeItem("zenvora_camera_streaming");
      sessionStorage.removeItem("zenvora_screen_streaming");
    } catch {
      // ignore storage errors
    }

    router.replace("/login");
    router.refresh();
  };

  const can = (page: string) => {
    if (!userProfile) return page !== "console" && page !== "admin";
    if (userProfile.role === "admin") return true;
    return Array.isArray(userProfile.pages) && userProfile.pages.includes(page);
  };

  const userMenuItems = [
    { icon: Home, label: "Dashboard", href: "/dashboard", page: "dashboard" },
    { icon: Smartphone, label: "Devices", href: "/devices", page: "dashboard" },
    { icon: Eye, label: "Screen Monitor", href: "/screen", page: "screen" },
    { icon: Camera, label: "Camera Access", href: "/camera", page: "camera" },
    { icon: FileText, label: "File Manager", href: "/files", page: "files" },
    { icon: TerminalSquare, label: "Shell Control", href: "/shell", page: "shell" },
    { icon: Bell, label: "Notifications", href: "/notifications", page: "notifications" },
    { icon: History, label: "Activity Logs", href: "/logs", page: "logs" },
    { icon: ScrollText, label: "Live Console", href: "/console", page: "console" },
  ].filter((item) => can(item.page));

  const adminMenuItems = can("admin")
    ? [
        { icon: Shield, label: "Admin Dashboard", href: "/admin" },
        { icon: Smartphone, label: "All Devices", href: "/admin/devices" },
        { icon: FileText, label: "Users", href: "/admin/users" },
        { icon: History, label: "Permissions", href: "/admin/permissions" },
        { icon: Eye, label: "Security", href: "/admin/security" },
      ]
    : [];

  const initials = userProfile?.name
    ? userProfile.name
        .split(" ")
        .map((part) => part[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "U";

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-4 left-4 z-50 lg:hidden p-2 hover:bg-secondary rounded-lg transition-colors"
      >
        {isOpen ? (
          <>
            <div className="left">
              <X className="w-6 h-6" />
            </div>
          </>
        ) : (
          <Menu className="w-6 h-6" />
        )}
      </button>

      <aside
        className={`fixed left-0 top-0 h-screen w-64 bg-sidebar border-r border-sidebar-border transform transition-transform duration-300 ease-in-out z-40 overflow-y-auto custom-scrollbar ${
          isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="p-8 pb-6">
          <div className="mb-12">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex items-center gap-3">
                <div className="text-foreground hover-lift transition-transform">
                  <ZenvoraLogo />
                </div>
                <span className="font-display text-xl font-semibold">Zenvora</span>
              </div>
            </div>
            <p className="text-xs text-sidebar-foreground/60 text-center">Remote Device Control</p>
          </div>

          <div className="mb-10">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs font-mono text-sidebar-foreground/50 uppercase tracking-wide">User Mode</p>
              {devices.length > 0 && (
                <div className="relative" ref={micMenuRef}>
                  <button
                    type="button"
                    onClick={() => {
                      if (isAudioStreaming) {
                        toggleAudioStream();
                        return;
                      }
                      const nextOpen = !micDropdownOpen;
                      setMicDropdownOpen(nextOpen);
                      if (nextOpen && listeningDeviceId) {
                        requestMicList(listeningDeviceId);
                      }
                    }}
                    className="p-1 hover:text-foreground text-sidebar-foreground/60 transition-colors focus:outline-none focus:ring-0 cursor-pointer"
                    title={
                      isAudioStreaming
                        ? "Stop Live Device Audio Listening"
                        : "Select device & microphone"
                    }
                  >
                    {isAudioStreaming ? (
                      <Mic className="w-4.5 h-4.5 text-rose-500 animate-pulse" />
                    ) : (
                      <div className="flex items-center gap-0.5">
                        <MicOff className="w-4.5 h-4.5 text-sidebar-foreground/30 hover:text-sidebar-foreground/75" />
                        <ChevronDown className="w-3 h-3 text-sidebar-foreground/30" />
                      </div>
                    )}
                  </button>

                  {micDropdownOpen && !isAudioStreaming && (
                    <div className="absolute top-6 right-[-19px] z-50 w-52 bg-sidebar py-1.5 text-[11px] outline-none">
                      <p className="px-2.5 pb-1 text-[10px] uppercase tracking-wide text-sidebar-foreground/40">
                        Device
                      </p>
                      <ul className="max-h-28 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        {devices.length === 0 ? (
                          <li className="px-2.5 py-1 text-sidebar-foreground/45">No devices</li>
                        ) : (
                          devices.map((dev) => (
                            <li key={dev.value}>
                              <button
                                type="button"
                                className={`w-full truncate px-2.5 py-1 text-left outline-none focus:outline-none ${
                                  listeningDeviceId === dev.value
                                    ? "text-sidebar-foreground"
                                    : "text-sidebar-foreground/65 hover:text-sidebar-foreground"
                                }`}
                                onClick={() => {
                                  setListeningDeviceId(dev.value);
                                  requestMicList(dev.value);
                                }}
                              >
                                {dev.label || dev.value}
                                {dev.status === "online" ? "" : " · offline"}
                              </button>
                            </li>
                          ))
                        )}
                      </ul>

                      <p className="mt-1.5 px-2.5 pb-1 pt-1.5 text-[10px] uppercase tracking-wide text-sidebar-foreground/40">
                        Microphone
                      </p>
                      {!listeningDeviceId ? (
                        <p className="px-2.5 py-1 text-sidebar-foreground/45">Pick a device first</p>
                      ) : micsLoading && audioDevices.length === 0 ? (
                        <p className="px-2.5 py-1 text-sidebar-foreground/45">Loading mics…</p>
                      ) : (
                        <ul className="max-h-28 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                          <li>
                            <button
                              type="button"
                              className="w-full truncate px-2.5 py-1 text-left text-sidebar-foreground/65 outline-none hover:text-sidebar-foreground focus:outline-none"
                              onClick={() => toggleAudioStream()}
                            >
                              Default microphone
                            </button>
                          </li>
                          {audioDevices.map((dev) => (
                            <li key={dev.id}>
                              <button
                                type="button"
                                className="w-full truncate px-2.5 py-1 text-left text-sidebar-foreground/65 outline-none hover:text-sidebar-foreground focus:outline-none"
                                onClick={() => toggleAudioStream(dev.id)}
                              >
                                {dev.label}
                              </button>
                            </li>
                          ))}
                          {!micsLoading && audioDevices.length === 0 ? (
                            <li className="px-2.5 py-1 text-sidebar-foreground/40">No mics reported</li>
                          ) : null}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
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

          {adminMenuItems.length > 0 && (
            <div className="border-t border-sidebar-border pt-8">
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
            </div>
          )}

          <div className="relative mt-8" ref={accountMenuRef}>
            {accountMenuOpen && (
              <div className="absolute bottom-full left-0 mb-1 w-36 py-1 text-xs bg-[#fafaf9] shadow-[1px_1px_0px_#00000021]">
                <Link
                  href="/settings"
                  onClick={() => {
                    setAccountMenuOpen(false);
                    setIsOpen(false);
                  }}
                  className="flex items-center gap-2 px-2.5 py-1.5 text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors"
                >
                  <Settings className="w-3.5 h-3.5" />
                  <span>Settings</span>
                </Link>
                <button
                  type="button"
                  onClick={() => void handleLogout()}
                  disabled={loggingOut}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors disabled:opacity-60"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>{loggingOut ? "Logging out..." : "Logout"}</span>
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => setAccountMenuOpen((open) => !open)}
              className="flex w-full items-center gap-2.5 px-4 text-left text-sidebar-foreground outline-none focus:outline-none"
            >
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarImage src={userProfile?.avatarUrl || undefined} alt={userProfile?.name || "User"} />
                <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-xs">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium leading-tight">{userProfile?.name || "Signed in"}</p>
                <p className="truncate text-[11px] leading-tight text-sidebar-foreground/55">
                  {userProfile?.email || "Account"}
                </p>
              </div>
              {accountMenuOpen ? (
                <ChevronUp className="w-3.5 h-3.5 shrink-0 text-sidebar-foreground/40" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 shrink-0 text-sidebar-foreground/40" />
              )}
            </button>
          </div>
        </div>
      </aside>

      {isOpen && (
        <div className="fixed inset-0 bg-black/20 z-30 lg:hidden" onClick={() => setIsOpen(false)} />
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

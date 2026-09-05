"use client";

import { FormEvent, useEffect, useState, useMemo } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { alertFromApi, alertMsg, Z } from "@/lib/messages";
import {
  Copy,
  KeyRound,
  RefreshCw,
  Save,
  Shield,
  Database,
  Cloud,
  Cpu,
  Network,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Bot,
  Activity,
  Radio,
  Server,
  Zap,
  ArrowRightLeft,
  Check,
  XCircle,
  ShieldAlert,
  Wifi,
} from "lucide-react";
import {
  useApiConfig,
  PROVIDER_OPTIONS,
  type ProviderKey,
} from "@/hooks/use-api-config";
import { gatewayClient } from "@/lib/gateway-client";
import {
  getPreferredMediaTransport,
  setPreferredMediaTransport,
  type MediaTransport,
} from "@/lib/media-transport";

type PairingState = {
  pairingToken: string;
  pairingUserId: string;
};

type IntegrationVariables = {
  mongodbUri: string;
  cloudinaryCloudName: string;
  cloudinaryApiKey: string;
  cloudinaryApiSecret: string;
  gatewayUrl: string;
  directLanPreferred: boolean;
};

const DEFAULT_INTEGRATION_VARS: IntegrationVariables = {
  mongodbUri: "",
  cloudinaryCloudName: "",
  cloudinaryApiKey: "",
  cloudinaryApiSecret: "",
  gatewayUrl: "",
  directLanPreferred: true,
};

type TabKey = "pairing" | "network" | "integrations" | "ai";

function isWeakCode(code: string): boolean {
  if (!/^\d{6}$/.test(code)) return true;
  if (/^(\d)\1{5}$/.test(code)) return true;
  const asc = "0123456789012345";
  const desc = "9876543210987654";
  if (asc.includes(code) || desc.includes(code)) return true;
  if (/^(\d)\1\1(\d)\2\2$/.test(code)) return true;
  if (/^(\d{3})\1$/.test(code)) return true;
  if (/^(\d{2})\1\1$/.test(code)) return true;
  const uniqueDigits = new Set(code.split("")).size;
  return uniqueDigits < 4;
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("pairing");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [bindingAi, setBindingAi] = useState(false);
  const [aiBindingStatus, setAiBindingStatus] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const [pairing, setPairing] = useState<PairingState>({
    pairingToken: "",
    pairingUserId: "",
  });
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

  // Media Transport mode (WSS vs TCP)
  const [mediaTransport, setMediaTransportState] = useState<MediaTransport>(() => {
    if (typeof window !== "undefined") {
      return getPreferredMediaTransport();
    }
    return "wss";
  });

  // Integrated Variables (MongoDB, Cloudinary, Network)
  const [vars, setVars] = useState<IntegrationVariables>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("zenvora-workspace-variables");
        if (saved) return { ...DEFAULT_INTEGRATION_VARS, ...JSON.parse(saved) };
      } catch (_) {}
    }
    return DEFAULT_INTEGRATION_VARS;
  });

  // Inline Test States (AI, MongoDB, Cloudinary)
  const [testingAiKey, setTestingAiKey] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<{
    success: boolean;
    provider?: string;
    message?: string;
    error?: string;
    latencyMs?: number;
    model?: string;
  } | null>(null);

  const [testingMongo, setTestingMongo] = useState(false);
  const [mongoTestResult, setMongoTestResult] = useState<{
    success: boolean;
    message?: string;
    error?: string;
    latencyMs?: number;
    dbName?: string;
  } | null>(null);

  const [testingCloudinary, setTestingCloudinary] = useState(false);
  const [cloudinaryTestResult, setCloudinaryTestResult] = useState<{
    success: boolean;
    message?: string;
    error?: string;
    latencyMs?: number;
  } | null>(null);

  // Gateway Probe & Shift state
  const [testingGateway, setTestingGateway] = useState(false);
  const [gatewayProbeResult, setGatewayProbeResult] = useState<{
    browserLive?: boolean;
    browserRtt?: number;
    agentLive?: boolean;
    agentRtt?: number;
    agentMsg?: string;
    endpoint?: string;
    error?: string;
  } | null>(null);
  const [shiftingGateway, setShiftingGateway] = useState(false);
  const [shiftResultMsg, setShiftResultMsg] = useState("");

  // Centralized AI Multi-Provider Config
  const {
    config: apiConfig,
    activeProvider,
    setActiveProvider,
    setProviderApiKey,
    setProviderModel,
  } = useApiConfig("ops");

  const [selectedAiProvider, setSelectedAiProvider] = useState<ProviderKey>(
    apiConfig.activeProvider || "gemini"
  );

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/session", { credentials: "include", cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.authenticated) {
        setError(data?.message || "Could not load settings.");
        return;
      }
      setName(String(data.user?.name || ""));
      setEmail(String(data.user?.email || ""));
      setPairing({
        pairingToken: String(data.user?.pairingToken || ""),
        pairingUserId: String(data.user?.pairingUserId || ""),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load settings.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const copyValue = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      alertMsg(Z.COMMAND_COPIED, `${label} copied`);
    } catch {
      alertMsg(Z.COPY_FAILED);
    }
  };

  const isTokenWeak = useMemo(() => {
    return pairing.pairingToken ? isWeakCode(pairing.pairingToken) : false;
  }, [pairing.pairingToken]);

  const savePairing = async (event: FormEvent) => {
    event.preventDefault();
    if (isTokenWeak) {
      setError("Pairing token is too weak. Please use a high-entropy code or click Rotate.");
      return;
    }
    setSaving(true);
    setError("");
    setSuccessMsg("");
    try {
      const res = await fetch("/api/auth/pairing", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pairing),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data.message || "Could not update pairing credentials.");
        alertFromApi(data, Z.UPDATE_FAILED);
        return;
      }
      setPairing({
        pairingToken: String(data.user?.pairingToken || pairing.pairingToken),
        pairingUserId: String(data.user?.pairingUserId || pairing.pairingUserId),
      });
      setSuccessMsg("Pairing credentials saved successfully.");
      alertMsg(Z.PAIRING_UPDATED);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update pairing credentials.");
    } finally {
      setSaving(false);
    }
  };

  const rotatePairing = async () => {
    setRotating(true);
    setError("");
    setSuccessMsg("");
    try {
      const res = await fetch("/api/auth/pairing/rotate", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data.message || "Could not rotate pairing credentials.");
        alertFromApi(data, Z.UPDATE_FAILED);
        return;
      }
      setPairing({
        pairingToken: String(data.user?.pairingToken || ""),
        pairingUserId: String(data.user?.pairingUserId || ""),
      });
      setSuccessMsg("High-entropy pairing token generated successfully.");
      alertMsg(Z.PAIRING_ROTATED);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rotate pairing credentials.");
    } finally {
      setRotating(false);
    }
  };

  const saveVariables = (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      localStorage.setItem("zenvora-workspace-variables", JSON.stringify(vars));
      setSuccessMsg("Integration variables and network settings saved.");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err) {
      setError("Failed to save variables locally.");
    } finally {
      setSaving(false);
    }
  };

  const switchTransport = (next: MediaTransport) => {
    setMediaTransportState(next);
    setPreferredMediaTransport(next);
    gatewayClient.broadcast({
      action: "SET_PREFERRED_MEDIA_TRANSPORT",
      transport: next,
      preferredMediaTransport: next,
    });
    alertMsg("Transport Mode Updated", `Preferred media transport set to ${next.toUpperCase()}`);
  };

  const runAiTest = async () => {
    if (!activeProviderConfig?.apiKey?.trim()) {
      setError("Please enter an API key for " + activeProviderConfig?.label + " before testing.");
      return;
    }
    setTestingAiKey(true);
    setAiTestResult(null);
    setError("");
    try {
      const res = await fetch("/api/integrations/test-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: selectedAiProvider,
          apiKey: activeProviderConfig.apiKey.trim(),
          model: activeProviderConfig.model,
        }),
      });
      const data = await res.json();
      setAiTestResult(data);
      if (data.success) {
        setSuccessMsg(data.message || "AI API Key verified successfully!");
      } else {
        setError(data.error || "AI API Key verification failed.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setAiTestResult({ success: false, error: msg });
      setError("Network error testing AI API key: " + msg);
    } finally {
      setTestingAiKey(false);
    }
  };

  const runMongoTest = async () => {
    if (!vars.mongodbUri?.trim()) {
      setError("Please enter a MongoDB Connection URI before testing.");
      return;
    }
    setTestingMongo(true);
    setMongoTestResult(null);
    setError("");
    try {
      const res = await fetch("/api/integrations/test-mongo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mongodbUri: vars.mongodbUri.trim() }),
      });
      const data = await res.json();
      setMongoTestResult(data);
      if (data.success) {
        setSuccessMsg(data.message || "MongoDB connection succeeded!");
      } else {
        setError(data.error || "MongoDB connection test failed.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setMongoTestResult({ success: false, error: msg });
      setError("Network error testing MongoDB connection: " + msg);
    } finally {
      setTestingMongo(false);
    }
  };

  const runCloudinaryTest = async () => {
    if (!vars.cloudinaryCloudName?.trim() || !vars.cloudinaryApiKey?.trim() || !vars.cloudinaryApiSecret?.trim()) {
      setError("Please enter Cloud Name, API Key, and API Secret before testing.");
      return;
    }
    setTestingCloudinary(true);
    setCloudinaryTestResult(null);
    setError("");
    try {
      const res = await fetch("/api/integrations/test-cloudinary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cloudName: vars.cloudinaryCloudName.trim(),
          apiKey: vars.cloudinaryApiKey.trim(),
          apiSecret: vars.cloudinaryApiSecret.trim(),
        }),
      });
      const data = await res.json();
      setCloudinaryTestResult(data);
      if (data.success) {
        setSuccessMsg(data.message || "Cloudinary credentials verified!");
      } else {
        setError(data.error || "Cloudinary verification failed.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setCloudinaryTestResult({ success: false, error: msg });
      setError("Network error testing Cloudinary credentials: " + msg);
    } finally {
      setTestingCloudinary(false);
    }
  };

  const testGateway = async () => {
    const target = vars.gatewayUrl.trim();
    if (!target) {
      setError("Please enter a Gateway URL or Static IP to test.");
      return;
    }
    setTestingGateway(true);
    setError("");
    setGatewayProbeResult(null);

    // 1. Browser Probe
    let browserLive = false;
    let browserRtt = 0;
    const start = performance.now();
    try {
      const httpTarget = target.replace(/^wss:\/\//i, "https://").replace(/^ws:\/\//i, "http://");
      const res = await fetch(`${httpTarget.replace(/\/ws.*$/, "")}/api/health`, {
        method: "GET",
        signal: AbortSignal.timeout(3000),
      });
      browserLive = res.ok || res.status < 500;
      browserRtt = Math.round(performance.now() - start);
    } catch (_) {
      try {
        const ws = new WebSocket(target);
        await new Promise<void>((resolve, reject) => {
          ws.onopen = () => {
            browserLive = true;
            browserRtt = Math.round(performance.now() - start);
            ws.close();
            resolve();
          };
          ws.onerror = () => reject();
          setTimeout(reject, 2500);
        });
      } catch (_) {
        browserLive = false;
      }
    }

    // 2. Dispatch Probe to Agent
    let agentReported = false;
    const unsubscribe = gatewayClient.subscribe((event) => {
      if (event.type === "json" && event.packet) {
        const p = event.packet as Record<string, unknown>;
        if (p.action === "PROBE_GATEWAY_URL") {
          agentReported = true;
          setGatewayProbeResult({
            browserLive,
            browserRtt,
            agentLive: Boolean(p.live),
            agentRtt: Number(p.rttMs || 0),
            endpoint: String(p.endpoint || target),
            agentMsg: String(p.message || ""),
          });
        }
      }
    });

    gatewayClient.broadcast({
      action: "PROBE_GATEWAY_URL",
      targetUrl: target,
    });

    setTimeout(() => {
      unsubscribe();
      if (!agentReported) {
        setGatewayProbeResult((prev) => ({
          browserLive,
          browserRtt,
          agentLive: false,
          agentMsg: "No active agents reported connectivity. Ensure at least one agent is running.",
          ...prev,
        }));
      }
      setTestingGateway(false);
    }, 4500);
  };

  const shiftGatewayConnection = () => {
    const target = vars.gatewayUrl.trim();
    if (!target) {
      setError("Enter a target Gateway URL / Static IP first.");
      return;
    }
    setShiftingGateway(true);
    gatewayClient.broadcast({
      action: "SWITCH_GATEWAY_URL",
      targetUrl: target,
    });
    setShiftResultMsg(
      `Shift command dispatched! The agent is persisting ${target} and reconnecting with automated 30s cloud fallback protection.`
    );
    setTimeout(() => setShiftingGateway(false), 3500);
  };

  const bindAiToAgents = async () => {
    setBindingAi(true);
    setAiBindingStatus("Transmitting AI API credentials to connected agents...");
    try {
      const activeP = apiConfig.providers.find((p) => p.provider === selectedAiProvider);
      const apiKey = activeP?.apiKey || "";
      const model = activeP?.model || activeP?.label;

      if (!apiKey.trim()) {
        setAiBindingStatus("Warning: Selected provider has no API Key configured. Please enter API key first.");
        setBindingAi(false);
        return;
      }

      gatewayClient.broadcast({
        action: "SET_AGENT_AI_CONFIG",
        provider: selectedAiProvider,
        api_key: apiKey,
        model: model,
        enabled: true,
      });

      setAiBindingStatus(`Bound ${selectedAiProvider.toUpperCase()} successfully to active agents. Agents will now audit local data delivery.`);
    } catch (err) {
      setAiBindingStatus("Failed to broadcast AI configuration: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBindingAi(false);
    }
  };

  const activeProviderConfig = apiConfig.providers.find(
    (p) => p.provider === selectedAiProvider
  );

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />
      <main className="flex-1 sidebar-aware-main overflow-auto">
        <div className="relative min-h-full">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.35]"
            style={{
              backgroundImage:
                "radial-gradient(circle at 12% 18%, oklch(0.92 0.01 90), transparent 42%), radial-gradient(circle at 88% 8%, oklch(0.94 0.01 60), transparent 36%)",
            }}
          />
          <div className="relative p-6 lg:p-12 max-w-4xl">
            <div className="mb-8">
              <p className="text-xs font-mono uppercase tracking-[0.22em] text-muted-foreground mb-3">
                Workspace Central
              </p>
              <h1 className="font-display text-4xl lg:text-5xl tracking-tight mb-3">Settings</h1>
              <p className="text-muted-foreground max-w-2xl">
                Unified configuration center. Manage agent pairing tokens, media transport modes (WSS vs TCP),
                custom gateway static IPs, API connectivity diagnostics, and AI provider engines.
              </p>
            </div>

            {error && (
              <div className="mb-6 rounded-lg border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            {successMsg && (
              <div className="mb-6 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                {successMsg}
              </div>
            )}

            {/* Navigation Tabs */}
            <div className="flex flex-wrap gap-2 mb-8 border-b border-border pb-3">
              <button
                onClick={() => setActiveTab("pairing")}
                className={`flex items-center gap-2 px-4 py-2 text-xs font-mono tracking-wider uppercase transition-colors rounded-md ${
                  activeTab === "pairing"
                    ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                <KeyRound className="w-4 h-4" />
                Pairing & Access
              </button>

              <button
                onClick={() => setActiveTab("network")}
                className={`flex items-center gap-2 px-4 py-2 text-xs font-mono tracking-wider uppercase transition-colors rounded-md ${
                  activeTab === "network"
                    ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                <Network className="w-4 h-4" />
                Network & Transports
              </button>

              <button
                onClick={() => setActiveTab("integrations")}
                className={`flex items-center gap-2 px-4 py-2 text-xs font-mono tracking-wider uppercase transition-colors rounded-md ${
                  activeTab === "integrations"
                    ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                <Database className="w-4 h-4" />
                Variables & Storage
              </button>

              <button
                onClick={() => setActiveTab("ai")}
                className={`flex items-center gap-2 px-4 py-2 text-xs font-mono tracking-wider uppercase transition-colors rounded-md ${
                  activeTab === "ai"
                    ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                <Cpu className="w-4 h-4" />
                AI Engine & Binding
              </button>
            </div>

            {/* Tab 1: Pairing & Access */}
            {activeTab === "pairing" && (
              <div className="space-y-8">
                <section className="border-b border-border pb-8">
                  <div className="flex items-center gap-2 mb-4">
                    <Shield className="w-4 h-4 text-muted-foreground" />
                    <h2 className="text-sm font-mono uppercase tracking-wide text-muted-foreground">
                      Signed in as
                    </h2>
                  </div>
                  {loading ? (
                    <p className="text-sm text-muted-foreground animate-pulse">Loading profile…</p>
                  ) : (
                    <div className="grid gap-1">
                      <p className="text-lg font-medium">{name || "Operator"}</p>
                      <p className="text-sm text-muted-foreground font-mono">{email || "—"}</p>
                    </div>
                  )}
                </section>

                <section>
                  <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <KeyRound className="w-4 h-4 text-muted-foreground" />
                        <h2 className="text-xl font-display tracking-tight">Agent pairing</h2>
                      </div>
                      <p className="text-sm text-muted-foreground max-w-xl">
                        High-entropy, cryptographically unique pairing codes. Weak patterns (e.g. 000000, 111999, 123456) are strictly prohibited.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void rotatePairing()}
                      disabled={loading || rotating}
                      className="gap-2"
                    >
                      <RefreshCw className={`w-4 h-4 ${rotating ? "animate-spin" : ""}`} />
                      {rotating ? "Generating Strong…" : "Generate New Codes"}
                    </Button>
                  </div>

                  <form onSubmit={savePairing} className="space-y-6">
                    <div className="grid gap-6 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="pairingUserId" className="text-xs font-mono uppercase tracking-wider">
                          Pairing user id
                        </Label>
                        <div className="flex gap-2">
                          <Input
                            id="pairingUserId"
                            inputMode="numeric"
                            maxLength={6}
                            value={pairing.pairingUserId}
                            onChange={(e) =>
                              setPairing((prev) => ({
                                ...prev,
                                pairingUserId: e.target.value.replace(/\D/g, "").slice(0, 6),
                              }))
                            }
                            className="h-12 font-mono text-lg tracking-[0.2em]"
                            disabled={loading}
                            required
                          />
                          <Button
                            type="button"
                            variant="outline"
                            className="h-12 px-3"
                            onClick={() => void copyValue(pairing.pairingUserId, "Pairing user id")}
                            disabled={!pairing.pairingUserId}
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="pairingToken" className="text-xs font-mono uppercase tracking-wider">
                            Pairing token
                          </Label>
                          {pairing.pairingToken && (
                            <span
                              className={`text-[11px] font-mono flex items-center gap-1 ${
                                isTokenWeak ? "text-amber-500" : "text-emerald-500"
                              }`}
                            >
                              {isTokenWeak ? (
                                <>
                                  <ShieldAlert className="w-3 h-3" /> Weak / Low Entropy
                                </>
                              ) : (
                                <>
                                  <Check className="w-3 h-3" /> Cryptographically Strong
                                </>
                              )}
                            </span>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <Input
                            id="pairingToken"
                            inputMode="numeric"
                            maxLength={6}
                            value={pairing.pairingToken}
                            onChange={(e) =>
                              setPairing((prev) => ({
                                ...prev,
                                pairingToken: e.target.value.replace(/\D/g, "").slice(0, 6),
                              }))
                            }
                            className={`h-12 font-mono text-lg tracking-[0.2em] ${
                              isTokenWeak ? "border-amber-500 focus-visible:ring-amber-500" : ""
                            }`}
                            disabled={loading}
                            required
                          />
                          <Button
                            type="button"
                            variant="outline"
                            className="h-12 px-3"
                            onClick={() => void copyValue(pairing.pairingToken, "Pairing token")}
                            disabled={!pairing.pairingToken}
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                        </div>
                        {isTokenWeak && (
                          <p className="text-[11px] text-amber-500 font-mono mt-1">
                            Warning: Avoid sequential or repeated digits. Click &quot;Generate New Codes&quot; to obtain a high-entropy token.
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 pt-2">
                      <Button type="submit" disabled={loading || saving || isTokenWeak} className="gap-2 h-11 px-6">
                        <Save className="w-4 h-4" />
                        {saving ? "Saving…" : "Save pairing codes"}
                      </Button>
                    </div>
                  </form>
                </section>
              </div>
            )}

            {/* Tab 2: Network & Transports (Relocated TCP/WSS shifter + Gateway IP Shift & Test) */}
            {activeTab === "network" && (
              <div className="space-y-8">
                {/* 1. Preferred Media Transport Section */}
                <section className="space-y-5 p-6 border border-border/80 rounded-2xl bg-gradient-to-b from-card via-card to-card/60 shadow-sm backdrop-blur-sm">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-start sm:items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-500 border border-indigo-500/20">
                        <ArrowRightLeft className="w-5 h-5" />
                      </div>
                      <div>
                        <h2 className="text-base font-bold text-foreground tracking-tight">Preferred Media Transport Mode</h2>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Controls whether remote screen and camera streams flow over Secure WebSocket or raw Binary TCP.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Active:</span>
                      <span className="text-xs font-mono font-bold uppercase bg-indigo-500/10 text-indigo-500 border border-indigo-500/30 px-3 py-1 rounded-full shadow-sm">
                        {mediaTransport.toUpperCase()}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                    <button
                      type="button"
                      onClick={() => switchTransport("wss")}
                      className={`group relative p-5 rounded-xl border text-left transition-all duration-200 ${
                        mediaTransport === "wss"
                          ? "border-indigo-500/80 bg-indigo-500/[0.07] ring-1 ring-indigo-500/50 shadow-md shadow-indigo-500/5"
                          : "border-border bg-card/40 hover:bg-muted/40 hover:border-border/80"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm tracking-wide text-foreground">WSS (Secure WebSocket)</span>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                            Universal
                          </span>
                        </div>
                        {mediaTransport === "wss" ? (
                          <div className="h-5 w-5 rounded-full bg-indigo-500 text-white flex items-center justify-center">
                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                          </div>
                        ) : (
                          <div className="h-5 w-5 rounded-full border border-border group-hover:border-muted-foreground/50" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Universal proxy and firewall friendly. Operates smoothly over cloud deployments, Railway, Nginx, Cloudflare, and corporate firewalls.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => switchTransport("tcp")}
                      className={`group relative p-5 rounded-xl border text-left transition-all duration-200 ${
                        mediaTransport === "tcp"
                          ? "border-indigo-500/80 bg-indigo-500/[0.07] ring-1 ring-indigo-500/50 shadow-md shadow-indigo-500/5"
                          : "border-border bg-card/40 hover:bg-muted/40 hover:border-border/80"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm tracking-wide text-foreground">TCP (Raw Binary Stream)</span>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20">
                            60 FPS Direct
                          </span>
                        </div>
                        {mediaTransport === "tcp" ? (
                          <div className="h-5 w-5 rounded-full bg-indigo-500 text-white flex items-center justify-center">
                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                          </div>
                        ) : (
                          <div className="h-5 w-5 rounded-full border border-border group-hover:border-muted-foreground/50" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Zero WebSocket framing overhead, direct socket pipeline. Delivers lowest latency and maximum 60 FPS remote desktop responsiveness.
                      </p>
                    </button>
                  </div>
                </section>

                {/* 2. Custom Gateway Static IP / Server Endpoint & Shift */}
                <section className="space-y-5 p-6 border border-border/80 rounded-2xl bg-gradient-to-b from-card via-card to-card/60 shadow-sm backdrop-blur-sm">
                  <div className="flex items-start sm:items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-sky-500/10 text-sky-500 border border-sky-500/20">
                      <Server className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-foreground tracking-tight">Custom Gateway Static IP / Server Endpoint</h2>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Test and shift your agent&apos;s active communication channel to a dedicated Static IP or on-premise gateway URL.
                      </p>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl border border-sky-500/25 bg-sky-500/5 text-xs text-muted-foreground space-y-2">
                    <div className="flex items-center gap-2 text-sky-600 dark:text-sky-400 font-semibold">
                      <Zap className="w-4 h-4" />
                      <span>Architecture Note: How Static IP Shift Works Across Remote Clouds</span>
                    </div>
                    <p className="leading-relaxed">
                      • <strong>Cloud Deployment (Railway/VPS):</strong> When the server is hosted remotely in the cloud and you enter a static IP (e.g. an on-premise relay or dedicated gateway), the agent executes an isolated ping/probe test directly from its host.
                    </p>
                    <p className="leading-relaxed">
                      • <strong>Safe Auto-Rollback:</strong> When shifted, the agent maintains an active heartbeat. If unreachable after 30 seconds, it automatically rolls back to the primary cloud gateway.
                    </p>
                  </div>

                  <div className="space-y-2 pt-1">
                    <Label htmlFor="gatewayUrl" className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                      Gateway URL / Static IP
                    </Label>
                    <Input
                      id="gatewayUrl"
                      placeholder="wss://203.0.113.10:9443/ws/gateway or ws://192.168.1.50:9443"
                      value={vars.gatewayUrl}
                      onChange={(e) => setVars({ ...vars, gatewayUrl: e.target.value })}
                      className="font-mono text-sm h-11 bg-background/50 border-border focus-visible:ring-sky-500"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void testGateway()}
                      disabled={testingGateway || !vars.gatewayUrl.trim()}
                      className="gap-2 text-xs h-10 px-4 border-border hover:bg-muted font-medium"
                    >
                      <Wifi className={`w-3.5 h-3.5 text-sky-500 ${testingGateway ? "animate-pulse" : ""}`} />
                      {testingGateway ? "Testing Endpoint…" : "Test IP & Endpoint (Browser + Agent Ping)"}
                    </Button>

                    <Button
                      type="button"
                      variant="default"
                      onClick={shiftGatewayConnection}
                      disabled={shiftingGateway || !vars.gatewayUrl.trim()}
                      className="gap-2 text-xs h-10 px-4 bg-sky-600 hover:bg-sky-700 text-white shadow-sm font-medium"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      {shiftingGateway ? "Shifting Agent…" : "Shift Connection to this IP"}
                    </Button>
                  </div>

                  {/* Probe Result Display */}
                  {gatewayProbeResult && (
                    <div className="p-4 rounded-xl border border-border bg-background/80 space-y-3 shadow-sm">
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="text-muted-foreground flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-sky-500" />
                          Browser Reachability:
                        </span>
                        <span
                          className={`flex items-center gap-1 font-semibold ${
                            gatewayProbeResult.browserLive ? "text-emerald-500" : "text-amber-500"
                          }`}
                        >
                          {gatewayProbeResult.browserLive ? (
                            <>
                              <Check className="w-3.5 h-3.5" /> Reachable ({gatewayProbeResult.browserRtt}ms RTT)
                            </>
                          ) : (
                            <>
                              <XCircle className="w-3.5 h-3.5" /> Direct Browser Blocked / Cross-Origin
                            </>
                          )}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-xs font-mono border-t border-border/50 pt-2">
                        <span className="text-muted-foreground flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-emerald-500" />
                          Agent Probe (Direct TCP / WS):
                        </span>
                        <span
                          className={`flex items-center gap-1 font-semibold ${
                            gatewayProbeResult.agentLive ? "text-emerald-500" : "text-destructive"
                          }`}
                        >
                          {gatewayProbeResult.agentLive ? (
                            <>
                              <Check className="w-3.5 h-3.5" /> Agent Connected ({gatewayProbeResult.agentRtt}ms RTT)
                            </>
                          ) : (
                            <>
                              <XCircle className="w-3.5 h-3.5" /> Agent Probe Failed
                            </>
                          )}
                        </span>
                      </div>

                      {gatewayProbeResult.agentMsg && (
                        <p className="text-[11px] font-mono text-muted-foreground border-t border-border/50 pt-2">
                          Status: {gatewayProbeResult.agentMsg}
                        </p>
                      )}
                    </div>
                  )}

                  {shiftResultMsg && (
                    <div className="p-3.5 rounded-xl border border-emerald-500/25 bg-emerald-500/10 text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      {shiftResultMsg}
                    </div>
                  )}
                </section>

                {/* 3. Direct LAN Peer Connection */}
                <section className="space-y-4 p-6 border border-border/80 rounded-2xl bg-gradient-to-b from-card via-card to-card/60 shadow-sm backdrop-blur-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-bold text-foreground tracking-tight">Automatic Direct LAN Connection</h2>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Detect matching public IPs by default and stream screen/camera directly over local WiFi / subnet without cloud relay.
                      </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={vars.directLanPreferred}
                        onChange={(e) => setVars({ ...vars, directLanPreferred: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                    </label>
                  </div>
                </section>

                <Button onClick={saveVariables} disabled={saving} className="gap-2 h-11 px-6 shadow-sm">
                  <Save className="w-4 h-4" />
                  {saving ? "Saving…" : "Save Network Preferences"}
                </Button>
              </div>
            )}

            {/* Tab 3: Variables & Storage */}
            {activeTab === "integrations" && (
              <form onSubmit={saveVariables} className="space-y-8">
                {/* MongoDB Section */}
                <section className="space-y-4 p-5 border border-border rounded-xl bg-card shadow-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Database className="w-5 h-5 text-emerald-500" />
                      <div>
                        <h2 className="text-base font-semibold">Database Connection (MongoDB)</h2>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Connect your MongoDB cluster for fleet telemetry, app history, device logs, and configuration.
                        </p>
                      </div>
                    </div>
                    {mongoTestResult && (
                      <span
                        className={`text-xs px-2.5 py-1 rounded-md font-mono font-medium ${
                          mongoTestResult.success
                            ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                            : "bg-destructive/10 text-destructive border border-destructive/20"
                        }`}
                      >
                        {mongoTestResult.success ? `Connected (${mongoTestResult.latencyMs}ms)` : "Failed"}
                      </span>
                    )}
                  </div>

                  <div className="space-y-2 pt-1">
                    <Label htmlFor="mongodbUri" className="text-xs font-mono uppercase tracking-wider">
                      MongoDB Connection URI
                    </Label>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Input
                        id="mongodbUri"
                        type="password"
                        placeholder="mongodb+srv://username:password@cluster.mongodb.net/zenvora?retryWrites=true&w=majority"
                        value={vars.mongodbUri}
                        onChange={(e) => setVars({ ...vars, mongodbUri: e.target.value })}
                        className="font-mono text-sm flex-1"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void runMongoTest()}
                        disabled={testingMongo || !vars.mongodbUri?.trim()}
                        className="gap-2 shrink-0 border-emerald-500/30 hover:bg-emerald-500/10 hover:text-emerald-500 text-xs"
                      >
                        <Activity className={`w-3.5 h-3.5 text-emerald-500 ${testingMongo ? "animate-spin" : ""}`} />
                        {testingMongo ? "Testing…" : "Test Connection"}
                      </Button>
                    </div>
                  </div>

                  {mongoTestResult && (
                    <div
                      className={`p-3 rounded-lg border text-xs font-mono flex items-center justify-between ${
                        mongoTestResult.success
                          ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400"
                          : "border-destructive/30 bg-destructive/5 text-destructive"
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        {mongoTestResult.success ? (
                          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
                        ) : (
                          <AlertCircle className="w-4 h-4 shrink-0 text-destructive" />
                        )}
                        <span className="truncate">{mongoTestResult.message || mongoTestResult.error}</span>
                      </div>
                      {mongoTestResult.latencyMs !== undefined && (
                        <span className="text-[10px] opacity-75 shrink-0 ml-2">{mongoTestResult.latencyMs}ms ping</span>
                      )}
                    </div>
                  )}
                </section>

                {/* Cloudinary Section */}
                <section className="space-y-4 p-5 border border-border rounded-xl bg-card shadow-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Cloud className="w-5 h-5 text-blue-500" />
                      <div>
                        <h2 className="text-base font-semibold">Media Storage (Cloudinary)</h2>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          High-resolution remote screen captures, camera recordings, and media telemetry storage.
                        </p>
                      </div>
                    </div>
                    {cloudinaryTestResult && (
                      <span
                        className={`text-xs px-2.5 py-1 rounded-md font-mono font-medium ${
                          cloudinaryTestResult.success
                            ? "bg-blue-500/10 text-blue-500 border border-blue-500/20"
                            : "bg-destructive/10 text-destructive border border-destructive/20"
                        }`}
                      >
                        {cloudinaryTestResult.success ? `Verified (${cloudinaryTestResult.latencyMs}ms)` : "Failed"}
                      </span>
                    )}
                  </div>

                  <div className="grid gap-4 sm:grid-cols-3 pt-1">
                    <div className="space-y-2">
                      <Label htmlFor="cloudName" className="text-xs font-mono uppercase tracking-wider">
                        Cloud Name
                      </Label>
                      <Input
                        id="cloudName"
                        placeholder="my-cloud"
                        value={vars.cloudinaryCloudName}
                        onChange={(e) => setVars({ ...vars, cloudinaryCloudName: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="cloudKey" className="text-xs font-mono uppercase tracking-wider">
                        API Key
                      </Label>
                      <Input
                        id="cloudKey"
                        placeholder="1234567890"
                        value={vars.cloudinaryApiKey}
                        onChange={(e) => setVars({ ...vars, cloudinaryApiKey: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="cloudSecret" className="text-xs font-mono uppercase tracking-wider">
                        API Secret
                      </Label>
                      <Input
                        id="cloudSecret"
                        type="password"
                        placeholder="••••••••••••"
                        value={vars.cloudinaryApiSecret}
                        onChange={(e) => setVars({ ...vars, cloudinaryApiSecret: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void runCloudinaryTest()}
                      disabled={testingCloudinary || !vars.cloudinaryCloudName?.trim() || !vars.cloudinaryApiKey?.trim()}
                      className="gap-2 border-blue-500/30 hover:bg-blue-500/10 hover:text-blue-500 text-xs"
                    >
                      <Activity className={`w-3.5 h-3.5 text-blue-500 ${testingCloudinary ? "animate-spin" : ""}`} />
                      {testingCloudinary ? "Testing Cloudinary…" : "Test Cloudinary Credentials"}
                    </Button>

                    <Button type="submit" disabled={saving} className="gap-2 h-9 px-5">
                      <Save className="w-4 h-4" />
                      {saving ? "Saving…" : "Save Variables"}
                    </Button>
                  </div>

                  {cloudinaryTestResult && (
                    <div
                      className={`p-3 rounded-lg border text-xs font-mono flex items-center justify-between ${
                        cloudinaryTestResult.success
                          ? "border-blue-500/30 bg-blue-500/5 text-blue-600 dark:text-blue-400"
                          : "border-destructive/30 bg-destructive/5 text-destructive"
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        {cloudinaryTestResult.success ? (
                          <CheckCircle2 className="w-4 h-4 shrink-0 text-blue-500" />
                        ) : (
                          <AlertCircle className="w-4 h-4 shrink-0 text-destructive" />
                        )}
                        <span className="truncate">{cloudinaryTestResult.message || cloudinaryTestResult.error}</span>
                      </div>
                      {cloudinaryTestResult.latencyMs !== undefined && (
                        <span className="text-[10px] opacity-75 shrink-0 ml-2">{cloudinaryTestResult.latencyMs}ms</span>
                      )}
                    </div>
                  )}
                </section>
              </form>
            )}

            {/* Tab 4: AI Providers & Agent AI Binding */}
            {activeTab === "ai" && (
              <div className="space-y-8">
                <section className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Cpu className="w-5 h-5 text-purple-500" />
                    <div>
                      <h2 className="text-lg font-display tracking-tight">AI Engines & Telemetry Auditor</h2>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Configure your AI keys in one central location. All chatbot, AI Ops, and agent automated
                        self-healing use the keys configured here.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2">
                    {PROVIDER_OPTIONS.map((p) => {
                      const isSelected = selectedAiProvider === p.key;
                      const hasKey = Boolean(apiConfig.providers.find((item) => item.provider === p.key)?.apiKey?.trim());
                      return (
                        <button
                          key={p.key}
                          type="button"
                          onClick={() => {
                            setSelectedAiProvider(p.key);
                            setActiveProvider(p.key);
                            setAiTestResult(null);
                          }}
                          className={`flex flex-col items-center justify-center p-3 border rounded-xl transition-all ${
                            isSelected
                              ? "border-purple-500 bg-purple-500/10 text-purple-600 dark:text-purple-400 font-semibold ring-1 ring-purple-500/50 shadow-sm"
                              : "border-border bg-card text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          <span className="text-xs">{p.label}</span>
                          <span className={`text-[10px] mt-1 font-mono ${hasKey ? "text-emerald-500 font-medium" : "text-muted-foreground"}`}>
                            {hasKey ? "Key Configured" : "No Key"}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {activeProviderConfig && (
                    <div className="space-y-4 p-5 border border-border rounded-xl bg-card shadow-sm">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold flex items-center gap-2">
                          <span>{activeProviderConfig.label} Configuration</span>
                          {selectedAiProvider === "gemini" && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono">
                              Recommended
                            </span>
                          )}
                        </h3>
                        <span className="text-xs font-mono uppercase text-muted-foreground bg-muted px-2 py-0.5 rounded">
                          Active Provider
                        </span>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs font-mono uppercase tracking-wider">
                          API Key
                        </Label>
                        <Input
                          type="password"
                          placeholder={`Enter ${activeProviderConfig.label} API Key`}
                          value={activeProviderConfig.apiKey}
                          onChange={(e) => {
                            setProviderApiKey(selectedAiProvider, e.target.value);
                            setAiTestResult(null);
                          }}
                          className="font-mono text-sm"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs font-mono uppercase tracking-wider">
                          Model
                        </Label>
                        <select
                          value={activeProviderConfig.model}
                          onChange={(e) => setProviderModel(selectedAiProvider, e.target.value)}
                          className="w-full h-10 px-3 border border-border rounded-md bg-background text-sm font-mono"
                        >
                          {PROVIDER_OPTIONS.find((p) => p.key === selectedAiProvider)?.models.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Test API Key Button */}
                      <div className="pt-2 flex flex-wrap items-center gap-3">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void runAiTest()}
                          disabled={testingAiKey || !activeProviderConfig.apiKey?.trim()}
                          className="gap-2 border-purple-500/30 hover:bg-purple-500/10 hover:text-purple-400 text-xs h-9 px-4"
                        >
                          <Activity className={`w-3.5 h-3.5 text-purple-500 ${testingAiKey ? "animate-spin" : ""}`} />
                          {testingAiKey ? `Verifying ${activeProviderConfig.label} Key…` : `Test ${activeProviderConfig.label} API Key`}
                        </Button>
                      </div>

                      {/* Test API Key Result Banner */}
                      {aiTestResult && (
                        <div
                          className={`p-3.5 rounded-lg border text-xs font-mono flex items-center justify-between ${
                            aiTestResult.success
                              ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400"
                              : "border-destructive/30 bg-destructive/5 text-destructive"
                          }`}
                        >
                          <div className="flex items-center gap-2 truncate">
                            {aiTestResult.success ? (
                              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
                            ) : (
                              <AlertCircle className="w-4 h-4 shrink-0 text-destructive" />
                            )}
                            <span className="truncate">{aiTestResult.message || aiTestResult.error}</span>
                          </div>
                          {aiTestResult.latencyMs !== undefined && (
                            <span className="text-[10px] opacity-75 shrink-0 ml-2 font-mono">
                              {aiTestResult.latencyMs}ms RTT
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Bind AI to Agents button */}
                  <div className="p-5 border border-purple-500/30 rounded-xl bg-purple-500/5 space-y-3 shadow-sm">
                    <div className="flex items-center gap-2">
                      <Bot className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                      <h3 className="text-sm font-semibold">Bind AI Key Directly to Agents</h3>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Pushes your selected AI configuration ({selectedAiProvider.toUpperCase()}) directly to all active agents.
                      The agent uses this key locally to verify data delivery integrity (notifications, app history, browser history)
                      and apply autonomous self-healing.
                    </p>

                    <Button
                      type="button"
                      onClick={() => void bindAiToAgents()}
                      disabled={bindingAi || !activeProviderConfig?.apiKey.trim()}
                      className="gap-2 bg-purple-600 hover:bg-purple-700 text-white text-xs h-9 px-4"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${bindingAi ? "animate-spin" : ""}`} />
                      {bindingAi ? "Binding to agents…" : "Bind AI to Connected Agents"}
                    </Button>

                    {aiBindingStatus && (
                      <p className="text-xs font-mono text-purple-600 dark:text-purple-300 mt-2">
                        {aiBindingStatus}
                      </p>
                    )}
                  </div>
                </section>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

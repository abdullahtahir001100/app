"use client";

import { FormEvent, useEffect, useState } from "react";
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
} from "lucide-react";
import {
  useApiConfig,
  PROVIDER_OPTIONS,
  type ProviderKey,
} from "@/hooks/use-api-config";
import { gatewayClient } from "@/lib/gateway-client";

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

type TabKey = "pairing" | "integrations" | "ai" | "network";

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

  const savePairing = async (event: FormEvent) => {
    event.preventDefault();
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
      setSuccessMsg("Pairing credentials rotated.");
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
                Unified configuration center. All environment variables, MongoDB URI, Cloudinary,
                direct connection modes, and AI API keys are managed here.
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
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                <KeyRound className="w-4 h-4" />
                Pairing & Access
              </button>

              <button
                onClick={() => setActiveTab("integrations")}
                className={`flex items-center gap-2 px-4 py-2 text-xs font-mono tracking-wider uppercase transition-colors rounded-md ${
                  activeTab === "integrations"
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                <Database className="w-4 h-4" />
                Variables & Storage
              </button>

              <button
                onClick={() => setActiveTab("network")}
                className={`flex items-center gap-2 px-4 py-2 text-xs font-mono tracking-wider uppercase transition-colors rounded-md ${
                  activeTab === "network"
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                <Network className="w-4 h-4" />
                Network & Direct Peer
              </button>

              <button
                onClick={() => setActiveTab("ai")}
                className={`flex items-center gap-2 px-4 py-2 text-xs font-mono tracking-wider uppercase transition-colors rounded-md ${
                  activeTab === "ai"
                    ? "bg-primary text-primary-foreground font-semibold"
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
                        These 6-digit codes bind new agents to your account across Windows, macOS, and Linux.
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
                      {rotating ? "Rotating…" : "Rotate codes"}
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
                        <Label htmlFor="pairingToken" className="text-xs font-mono uppercase tracking-wider">
                          Pairing token
                        </Label>
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
                            className="h-12 font-mono text-lg tracking-[0.2em]"
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
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 pt-2">
                      <Button type="submit" disabled={loading || saving} className="gap-2 h-11 px-6">
                        <Save className="w-4 h-4" />
                        {saving ? "Saving…" : "Save pairing codes"}
                      </Button>
                    </div>
                  </form>
                </section>
              </div>
            )}

            {/* Tab 2: Variables & Storage */}
            {activeTab === "integrations" && (
              <form onSubmit={saveVariables} className="space-y-8">
                <section className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Database className="w-5 h-5 text-emerald-500" />
                    <h2 className="text-lg font-display tracking-tight">Database Connection (MongoDB)</h2>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Connect your own MongoDB instance for fleet telemetry, app history, and logs.
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="mongodbUri" className="text-xs font-mono uppercase tracking-wider">
                      MongoDB Connection URI
                    </Label>
                    <Input
                      id="mongodbUri"
                      type="password"
                      placeholder="mongodb+srv://username:password@cluster.mongodb.net/zenvora?retryWrites=true&w=majority"
                      value={vars.mongodbUri}
                      onChange={(e) => setVars({ ...vars, mongodbUri: e.target.value })}
                      className="font-mono text-sm"
                    />
                  </div>
                </section>

                <section className="space-y-4 border-t border-border pt-6">
                  <div className="flex items-center gap-2">
                    <Cloud className="w-5 h-5 text-blue-500" />
                    <h2 className="text-lg font-display tracking-tight">Media Storage (Cloudinary)</h2>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Optional cloud storage for high-resolution device screenshot archives and camera captures.
                  </p>
                  <div className="grid gap-4 sm:grid-cols-3">
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
                </section>

                <Button type="submit" disabled={saving} className="gap-2 h-11 px-6">
                  <Save className="w-4 h-4" />
                  {saving ? "Saving…" : "Save Variables"}
                </Button>
              </form>
            )}

            {/* Tab 3: Network & Direct Peer */}
            {activeTab === "network" && (
              <form onSubmit={saveVariables} className="space-y-8">
                <section className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Network className="w-5 h-5 text-indigo-500" />
                    <h2 className="text-lg font-display tracking-tight">Direct Peer Connection (Same Public IP)</h2>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    When this dashboard and an agent share the same public IP (same local router / Wi-Fi network),
                    ZenVora can connect peer-to-peer over your LAN. This eliminates cloud bandwidth consumption and delivers ultra-low latency remote control.
                  </p>

                  <div className="flex items-center justify-between p-4 border border-border rounded-lg bg-card">
                    <div>
                      <h3 className="text-sm font-medium">Automatic Direct LAN Connection</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Detect matching public IPs by default and stream screen/camera directly over LAN.
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={vars.directLanPreferred}
                      onChange={(e) => setVars({ ...vars, directLanPreferred: e.target.checked })}
                      className="w-5 h-5 rounded border-slate-300 text-primary focus:ring-primary"
                    />
                  </div>
                </section>

                <section className="space-y-4 border-t border-border pt-6">
                  <div className="flex items-center gap-2">
                    <Cloud className="w-5 h-5 text-slate-500" />
                    <h2 className="text-lg font-display tracking-tight">Custom Gateway Static IP / Server Endpoint</h2>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Leave blank to use the default web origin gateway, or configure your dedicated static server IP.
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="gatewayUrl" className="text-xs font-mono uppercase tracking-wider">
                      Gateway URL (e.g. wss://gateway.example.com/ws/gateway)
                    </Label>
                    <Input
                      id="gatewayUrl"
                      placeholder="wss://<your-server-static-ip>/ws/gateway"
                      value={vars.gatewayUrl}
                      onChange={(e) => setVars({ ...vars, gatewayUrl: e.target.value })}
                      className="font-mono text-sm"
                    />
                  </div>
                </section>

                <Button type="submit" disabled={saving} className="gap-2 h-11 px-6">
                  <Save className="w-4 h-4" />
                  {saving ? "Saving…" : "Save Network Preferences"}
                </Button>
              </form>
            )}

            {/* Tab 4: AI Providers & Agent AI Binding */}
            {activeTab === "ai" && (
              <div className="space-y-8">
                <section className="space-y-4">
                  <div className="flex items-center gap-2">
                    <Cpu className="w-5 h-5 text-purple-500" />
                    <h2 className="text-lg font-display tracking-tight">AI Engines & Telemetry Auditor</h2>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Configure your AI keys in one central location. All chatbot, AI Ops, and agent automated
                    self-healing use the keys configured here.
                  </p>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
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
                          }}
                          className={`flex flex-col items-center justify-center p-3 border rounded-lg transition-all ${
                            isSelected
                              ? "border-purple-500 bg-purple-500/10 text-purple-600 dark:text-purple-400 font-semibold"
                              : "border-border bg-card text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          <span className="text-xs">{p.label}</span>
                          <span className={`text-[10px] mt-1 font-mono ${hasKey ? "text-emerald-500" : "text-muted-foreground"}`}>
                            {hasKey ? "Key Set" : "No Key"}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {activeProviderConfig && (
                    <div className="space-y-4 p-5 border border-border rounded-lg bg-card">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold">{activeProviderConfig.label} Configuration</h3>
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
                          onChange={(e) => setProviderApiKey(selectedAiProvider, e.target.value)}
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
                    </div>
                  )}

                  {/* Bind AI to Agents button */}
                  <div className="p-5 border border-purple-500/30 rounded-lg bg-purple-500/5 space-y-3">
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

"use client";

import { FormEvent, useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { alertFromApi, alertMsg, Z } from "@/lib/messages";
import { Copy, KeyRound, RefreshCw, Save, Shield } from "lucide-react";

type PairingState = {
  pairingToken: string;
  pairingUserId: string;
};

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState("");
  const [pairing, setPairing] = useState<PairingState>({
    pairingToken: "",
    pairingUserId: "",
  });
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

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
      alertMsg(Z.PAIRING_ROTATED);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rotate pairing credentials.");
    } finally {
      setRotating(false);
    }
  };

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
            <div className="mb-10">
              <p className="text-xs font-mono uppercase tracking-[0.22em] text-muted-foreground mb-3">
                Workspace
              </p>
              <h1 className="font-display text-4xl lg:text-5xl tracking-tight mb-3">Settings</h1>
              <p className="text-muted-foreground max-w-2xl">
                Manage agent pairing credentials used to install and reconnect devices. Account email
                and password are not changed here.
              </p>
            </div>

            {error && (
              <div className="mb-6 rounded-lg border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <section className="mb-8 border-b border-border pb-8">
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
                    These 6-digit codes bind new agents to your account. Changing them does not alter
                    your login — but existing agents must be re-paired with the new values.
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
                  <p className="text-xs text-muted-foreground">
                    Codes must be unique 6-digit numbers.
                  </p>
                </div>
              </form>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

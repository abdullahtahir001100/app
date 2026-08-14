"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout } from "@/components/auth-layout";
import { ShieldCheck } from "lucide-react";
import { alertFromApi, alertMsg, msgText, Z } from "@/lib/messages";

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  "google-auth-failed": "Google sign-in failed. Please try again.",
  "google-not-configured": "Google OAuth is not configured on this server.",
  "google-state-mismatch": "Google sign-in session expired. Please try again.",
  "google-token-exchange-failed": "Google token exchange failed. Check OAuth redirect URI settings.",
  "database-unavailable":
    "Database is not connected. Check MONGODB_URI in .env and ensure MongoDB Atlas allows your IP.",
  "auth-not-configured": "Server auth is not configured. Set JWT_SECRET in .env.",
  "session-replaced": msgText(Z.SESSION_REPLACED),
};

function extractErrorMessage(data: { code?: number; message?: string } | null | undefined): string {
  if (data?.message && String(data.message).trim()) return String(data.message).trim();
  if (data?.code != null) return msgText(data.code);
  return msgText(Z.AUTH_FAILED);
}

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/dashboard";
  const authError = searchParams.get("error");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (!authError) return;
    const detail =
      AUTH_ERROR_MESSAGES[authError] ||
      `Sign-in failed (${authError}). Please try again.`;
    setFormError(detail);
    alertMsg(Z.AUTH_FAILED, detail);
  }, [authError]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        const message = extractErrorMessage(data);
        setFormError(message);
        alertFromApi(data, Z.AUTH_FAILED);
        return;
      }
      alertMsg(Z.SIGNED_IN);
      router.replace(nextPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : msgText(Z.AUTH_FAILED);
      setFormError(message);
      alertMsg(Z.AUTH_FAILED, message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    alertMsg(Z.GOOGLE_REDIRECT);
    window.location.href = "/api/auth/google";
  };

  return (
    <AuthLayout
      title="Secure Terminal Access"
      subtitle="Identify yourself to enter the Zenvora central control console."
    >
      <div className="space-y-6">
        {(authError || formError) && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-200">
            {formError ||
              AUTH_ERROR_MESSAGES[authError || ""] ||
              `Sign-in failed (${authError}). Please try again.`}
          </div>
        )}
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-xs uppercase font-mono tracking-wider text-muted-foreground">
              Security Email
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="operator@zenvora.local"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (formError) setFormError("");
              }}
              className="h-11 rounded-xl bg-card border-border/80 focus-visible:ring-emerald-500/20"
              required
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password" className="text-xs uppercase font-mono tracking-wider text-muted-foreground">
                Access Token / Password
              </Label>
              <Link href="/forgot-password" className="text-xs font-mono transition-colors">
                Forgot?
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (formError) setFormError("");
              }}
              className="h-11 rounded-xl bg-card border-border/80 focus-visible:ring-emerald-500/20"
              required
            />
          </div>

          <Button
            type="submit"
            className="w-full h-11 bg-foreground text-background hover:bg-foreground/90 rounded-xl font-medium transition-all duration-300 hover-lift shadow-lg relative group"
            disabled={loading}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-4 w-4 border-2 border-background border-t-transparent rounded-full animate-spin" />
                Authorizing Node...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <ShieldCheck className="w-4 h-4 " />
                Login
              </span>
            )}
          </Button>
        </form>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border/60" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-3 text-muted-foreground font-mono text-[10px]">
              Or secure sign-in via
            </span>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={handleGoogleLogin}
          className="w-full h-11 border-border/80 bg-card hover:bg-muted text-foreground rounded-xl flex items-center justify-center gap-3 transition-all hover-lift"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              fill="#EA4335"
            />
          </svg>
          <span className="font-medium text-sm font-sans">Continue with Google Account</span>
        </Button>

        <div className="flex items-center justify-between text-xs font-mono pt-4 border-t border-border/40">
          <Link href="/register" className=" hover:underline">
            Register Agent
          </Link>
          <Link href="/" className="text-muted-foreground hover:underline">
            Optimus Home
          </Link>
        </div>
      </div>
    </AuthLayout>
  );
}

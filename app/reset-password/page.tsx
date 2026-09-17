"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout } from "@/components/auth-layout";
import { Lock, Eye, EyeOff, CheckCircle2, AlertCircle, KeyRound, ArrowRight } from "lucide-react";
import { toast } from "sonner";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-sm font-mono">Loading security recovery…</div>}>
      <ResetPasswordContent />
    </Suspense>
  );
}

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlEmail = searchParams.get("email") || "";
  const urlOtp = searchParams.get("otp") || "";

  const [email, setEmail] = useState(urlEmail);
  const [otp, setOtp] = useState(urlOtp);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const passwordValid = password.length >= 6;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email.trim()) {
      setError("Email address is required.");
      return;
    }
    if (!otp.trim()) {
      setError("Verification code (OTP) is required.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          otp: otp.trim(),
          newPassword: password,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to reset password. Please check your OTP code.");
      }

      setSuccess(true);
      toast.success("Password reset successfully! You can now log in with your new credentials.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error resetting password";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <AuthLayout
        title="Password Reset Complete"
        subtitle="Your credentials have been securely updated across all Zenvora nodes."
      >
        <div className="space-y-6 text-center py-4">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-xl shadow-emerald-500/5">
            <CheckCircle2 className="w-8 h-8" />
          </div>

          <div className="space-y-2">
            <h3 className="text-xl font-bold text-foreground">Access Restored</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              Your new password is now active. You can sign in immediately to resume full management of your agent fleet.
            </p>
          </div>

          <Button
            onClick={() => router.push("/login")}
            className="w-full h-11 bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl font-medium shadow-lg flex items-center justify-center gap-2"
          >
            Sign In with New Password
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create New Password"
      subtitle="Enter your recovery verification code and set a strong new password for your account."
    >
      <div className="space-y-6">
        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Email field (readonly if supplied in url) */}
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-xs uppercase font-mono tracking-wider text-muted-foreground">
              Account Email
            </Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operator@zenvora.local"
              required
              className="h-10 rounded-xl bg-card border-border/80 text-sm font-mono"
            />
          </div>

          {/* OTP field */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="otp" className="text-xs uppercase font-mono tracking-wider text-muted-foreground">
                6-Digit Recovery OTP
              </Label>
              <Link
                href={`/verify-otp?email=${encodeURIComponent(email)}`}
                className="text-[11px] text-primary hover:underline"
              >
                Need to re-enter OTP?
              </Link>
            </div>
            <Input
              id="otp"
              type="text"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              placeholder="123456"
              required
              className="h-10 rounded-xl bg-card border-border/80 text-sm font-mono tracking-widest text-center font-bold"
            />
          </div>

          {/* New Password field */}
          <div className="space-y-1.5">
            <Label htmlFor="new-password" className="text-xs uppercase font-mono tracking-wider text-muted-foreground">
              New Password
            </Label>
            <div className="relative">
              <Input
                id="new-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                className="h-10 rounded-xl bg-card border-border/80 pr-10 text-sm"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {password.length > 0 && (
              <p className={`text-[11px] ${passwordValid ? "text-emerald-400" : "text-amber-400"}`}>
                {passwordValid ? "✓ Minimum 6 characters met" : "Must be at least 6 characters"}
              </p>
            )}
          </div>

          {/* Confirm Password field */}
          <div className="space-y-1.5">
            <Label htmlFor="confirm-password" className="text-xs uppercase font-mono tracking-wider text-muted-foreground">
              Confirm New Password
            </Label>
            <div className="relative">
              <Input
                id="confirm-password"
                type={showConfirm ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="h-10 rounded-xl bg-card border-border/80 pr-10 text-sm"
              />
              <button
                type="button"
                onClick={() => setShowConfirm(!showConfirm)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {confirmPassword.length > 0 && (
              <p className={`text-[11px] ${passwordsMatch ? "text-emerald-400" : "text-rose-400"}`}>
                {passwordsMatch ? "✓ Passwords match" : "✕ Passwords do not match"}
              </p>
            )}
          </div>

          <Button
            type="submit"
            disabled={loading || !passwordValid || !passwordsMatch || !otp}
            className="w-full h-11 bg-foreground text-background hover:bg-foreground/90 rounded-xl font-medium shadow-lg transition-all duration-300 mt-2"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 border-2 border-background border-t-transparent rounded-full animate-spin" />
                Updating Password...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Lock className="w-4 h-4" />
                Confirm & Set New Password
              </span>
            )}
          </Button>
        </form>

        <div className="flex items-center justify-between text-xs font-mono pt-4 border-t border-border/40">
          <Link href="/login" className="text-muted-foreground hover:text-foreground">
            ← Return to Sign In
          </Link>
          <Link href="/forgot-password" className="text-primary hover:underline">
            Request fresh OTP
          </Link>
        </div>
      </div>
    </AuthLayout>
  );
}

"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AuthLayout } from "@/components/auth-layout";
import { ShieldCheck } from "lucide-react";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

function safeNextPath(raw: string | null) {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/admin-pin")) {
    return "/dashboard";
  }
  return raw;
}

export default function AdminPinPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading…</div>}>
      <AdminPinPageContent />
    </Suspense>
  );
}

function AdminPinPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get("next"));
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submitPin = async (value: string) => {
    if (value.length !== 6 || loading) return;
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/admin-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ pin: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data.message || "Invalid PIN.");
        setPin("");
        return;
      }
      router.replace(nextPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid PIN.");
      setPin("");
    } finally {
      setLoading(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await submitPin(pin);
  };

  return (
    <AuthLayout
      title="Admin unlock"
      subtitle="Enter your 6-digit PIN to open the control console. This is required after every admin sign-in."
    >
      <form onSubmit={submit} className="space-y-6">
        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-200">
            {error}
          </div>
        )}
        <div className="flex justify-center">
          <InputOTP
            maxLength={6}
            value={pin}
            onChange={(value) => {
              const digits = value.replace(/\D/g, "").slice(0, 6);
              setPin(digits);
              if (digits.length === 6) void submitPin(digits);
            }}
            disabled={loading}
            autoFocus
          >
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
              <InputOTPSlot index={3} />
              <InputOTPSlot index={4} />
              <InputOTPSlot index={5} />
            </InputOTPGroup>
          </InputOTP>
        </div>
        <Button
          type="submit"
          disabled={loading || pin.length !== 6}
          className="w-full h-11 rounded-xl"
        >
          <ShieldCheck className="mr-2 h-4 w-4" />
          {loading ? "Verifying…" : "Unlock console"}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          <button
            type="button"
            className="underline underline-offset-4 hover:text-foreground"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
              router.replace("/login");
            }}
          >
            Sign out and use another account
          </button>
        </p>
      </form>
    </AuthLayout>
  );
}

"use client";

import { FormEvent, Suspense, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { AuthLayout } from "@/components/auth-layout";
import { ShieldCheck } from "lucide-react";
import { alertFromApi, alertMsg, Z } from "@/lib/messages";

export default function VerifyOTPPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading…</div>}>
      <VerifyOTPPageContent />
    </Suspense>
  );
}

function VerifyOTPPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") || "operator@zenvora.local";

  const [otp, setOtp] = useState<string[]>(new Array(6).fill(""));
  const [loading, setLoading] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleChange = (element: HTMLInputElement, index: number) => {
    const value = element.value.replace(/[^0-9]/g, "");
    if (!value) return;

    const newOtp = [...otp];
    newOtp[index] = value.substring(value.length - 1);
    setOtp(newOtp);

    // Focus next input
    if (index < 5 && inputRefs.current[index + 1]) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === "Backspace") {
      const newOtp = [...otp];
      if (otp[index] === "") {
        // Backspace on empty field, focus previous
        if (index > 0 && inputRefs.current[index - 1]) {
          inputRefs.current[index - 1]?.focus();
          newOtp[index - 1] = "";
        }
      } else {
        newOtp[index] = "";
      }
      setOtp(newOtp);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const code = otp.join("");
    if (code.length < 6) {
      alertMsg(Z.INVALID_OTP);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp: code, newPassword: "changeme123" })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alertFromApi(data, Z.VERIFY_FAILED);
        return;
      }
      alertMsg(Z.VERIFIED);
      router.push("/login");
    } catch (err) {
      alertMsg(Z.VERIFY_FAILED, err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alertFromApi(data, Z.OTP_RESEND_FAILED);
        return;
      }
      alertMsg(Z.OTP_RESENT);
    } catch (err) {
      alertMsg(Z.OTP_RESEND_FAILED, err instanceof Error ? err.message : undefined);
    }
  };

  return (
    <AuthLayout
      title="Secure MFA Verification"
      subtitle={`We have dispatched a 6-digit access code to ${email}. Enter it to unlock.`}
    >
      <div className="space-y-6">
        <form onSubmit={submit} className="space-y-6">
          <div className="space-y-3">
            <Label className="text-xs uppercase font-mono tracking-wider text-muted-foreground block text-center">
              Verification Code (MFA OTP)
            </Label>

            <div className="flex justify-center items-center gap-2">
              {otp.map((data, index) => (
                <input
                  key={index}
                  type="text"
                  name="otp"
                  maxLength={1}
                  value={data}
                  ref={(el) => {
                    inputRefs.current[index] = el;
                  }}
                  onChange={(e) => handleChange(e.target, index)}
                  onKeyDown={(e) => handleKeyDown(e, index)}
                  className="w-12 h-14 text-center text-xl font-bold rounded-xl bg-card border border-border/80 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/80 transition-all font-mono"
                  required
                />
              ))}
            </div>
          </div>

          <Button
            type="submit"
            className="w-full h-11 bg-foreground text-background hover:bg-foreground/90 rounded-xl font-medium transition-all duration-300 hover-lift shadow-lg relative group"
            disabled={loading}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-4 w-4 border-2 border-background border-t-transparent rounded-full animate-spin" />
                Validating Token...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <ShieldCheck className="w-4 h-4 " />
                Verify Access Code
              </span>
            )}
          </Button>
        </form>

        {/* Resend and back links */}
        <div className="space-y-4 pt-4 border-t border-border/40">
          <div className="text-center">
            <button
              type="button"
              onClick={handleResend}
              className="text-xs  font-mono transition-colors"
            >
              Didn&apos;t receive the code? Resend OTP
            </button>
          </div>
          <div className="flex items-center justify-between text-xs font-mono">
            <Link href="/login" className="text-muted-foreground hover:underline">
              Back to Login
            </Link>
            <Link href="/" className="text-muted-foreground hover:underline">
              Optimus Home
            </Link>
          </div>
        </div>
      </div>
    </AuthLayout>
  );
}

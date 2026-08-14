"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { AuthLayout } from "@/components/auth-layout";
import { KeyRound } from "lucide-react";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const raw = await res.text();
      let data: { success?: boolean; message?: string } = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        throw new Error("Password reset service is unavailable. Try again.");
      }
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Request failed");
      }
      toast.success(data.message || "Recovery code sent to your registered email.");
      router.push(`/verify-otp?email=${encodeURIComponent(email)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Request failed";
      setFormError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Reset Account Access"
      subtitle="Enter your verified security email to recover your credentials and unlock agent nodes."
    >
      <div className="space-y-6">
        {formError && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-200">
            {formError}
          </div>
        )}
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-xs uppercase font-mono tracking-wider text-muted-foreground">
              Security Email Address
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="operator@zenvora.local"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
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
                Requesting Recovery...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <KeyRound className="w-4 h-4 " />
                Generate Recovery OTP
              </span>
            )}
          </Button>
        </form>

        {/* Back Link */}
        <div className="flex items-center justify-between text-xs font-mono pt-4 border-t border-border/40">
          <Link href="/login" className=" hover:underline">
            Back to Login
          </Link>
          <Link href="/" className="text-muted-foreground hover:underline">
            Optimus Home
          </Link>
        </div>
      </div>
    </AuthLayout>
  );
}

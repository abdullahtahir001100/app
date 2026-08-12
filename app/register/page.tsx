"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout } from "@/components/auth-layout";
import { UserPlus } from "lucide-react";
import { alertFromApi, alertMsg, Z } from "@/lib/messages";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    if (password !== confirmPassword) {
      alertMsg(Z.PASSWORD_MISMATCH);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password, name }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alertFromApi(data, Z.REGISTER_FAILED);
        return;
      }
      alertMsg(Z.ACCOUNT_CREATED);
      router.replace("/dashboard");
    } catch (err) {
      alertMsg(Z.REGISTER_FAILED, err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Create Workspace Account"
      subtitle="Register to Zenvora to manage your devices, vaults, and agent nodes."
    >
      <div className="space-y-6">
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name" className="text-xs uppercase font-mono tracking-wider text-muted-foreground">
              Operator Full Name
            </Label>
            <Input
              id="name"
              type="text"
              placeholder="Alex Mercer"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-11 rounded-xl bg-card border-border/80 focus-visible:ring-emerald-500/20"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email" className="text-xs uppercase font-mono tracking-wider text-muted-foreground">
              Security Email Address
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="alex@zenvora.local"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 rounded-xl bg-card border-border/80 focus-visible:ring-emerald-500/20"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="text-xs uppercase font-mono tracking-wider text-muted-foreground">
              Password (min 6 characters)
            </Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 rounded-xl bg-card border-border/80 focus-visible:ring-emerald-500/20"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword" className="text-xs uppercase font-mono tracking-wider text-muted-foreground">
              Confirm Password
            </Label>
            <Input
              id="confirmPassword"
              type="password"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
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
                Registering Account...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <UserPlus className="w-4 h-4 " />
                Create Account
              </span>
            )}
          </Button>
        </form>

        {/* Footnote links */}
        <div className="flex items-center justify-between text-xs font-mono pt-4 border-t border-border/40">
          <span className="text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="hover:underline">
              Sign In
            </Link>
          </span>
          <Link href="/" className="text-muted-foreground hover:underline">
            Optimus Home
          </Link>
        </div>
      </div>
    </AuthLayout>
  );
}

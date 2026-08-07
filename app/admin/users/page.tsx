"use client";

import { useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useRouter } from "next/navigation";
import Link from "next/link";

type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  pages?: string[];
  lastLoginAt?: string | null;
};

export default function AdminUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState("");

  const load = async () => {
    const res = await fetch("/api/admin/users", { credentials: "include" });
    const data = await res.json();
    if (!res.ok) {
      setError(data.message || "Failed to load users");
      return;
    }
    setUsers(data.users || []);
  };

  useEffect(() => {
    (async () => {
      const session = await fetch("/api/auth/session", { credentials: "include" });
      const sessionData = await session.json().catch(() => ({}));
      if (!session.ok || sessionData?.user?.role !== "admin") {
        router.replace("/dashboard");
        return;
      }
      await load();
    })();
  }, [router]);

  const setRole = async (id: string, role: string) => {
    const res = await fetch(`/api/admin/users/${id}/role`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.message || "Failed to update role");
      return;
    }
    await load();
  };

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />
      <main className="flex-1 overflow-y-auto lg:ml-64 p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-display tracking-tight">Users</h1>
            <p className="text-sm text-muted-foreground">Roles and permission shortcuts</p>
          </div>
          <Button asChild variant="outline">
            <Link href="/admin/permissions">Open permissions</Link>
          </Button>
        </div>
        {error && <p className="text-sm text-destructive mb-4">{error}</p>}
        <div className="space-y-2">
          {users.map((user) => (
            <Card key={user.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">{user.name}</p>
                <p className="text-xs text-muted-foreground">{user.email}</p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Pages: {(user.pages || []).join(", ") || "—"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs rounded-full bg-muted px-2 py-1">{user.role}</span>
                <Button size="sm" variant="outline" onClick={() => void setRole(user.id, "user")}>
                  Make user
                </Button>
                <Button size="sm" onClick={() => void setRole(user.id, "admin")}>
                  Make admin
                </Button>
                <Button size="sm" variant="secondary" asChild>
                  <Link href={`/admin/permissions?userId=${user.id}`}>Permissions</Link>
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}

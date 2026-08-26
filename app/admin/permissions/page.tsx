"use client";

import { useEffect, useMemo, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useRouter, useSearchParams } from "next/navigation";

type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  pages?: string[];
};

export default function AdminPermissionsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [pageKeys, setPageKeys] = useState<string[]>([]);
  const [pageLabels, setPageLabels] = useState<Record<string, string>>({});
  const [selectedUserId, setSelectedUserId] = useState(searchParams.get("userId") || "");
  const [pages, setPages] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const selected = useMemo(
    () => users.find((u) => u.id === selectedUserId) || null,
    [users, selectedUserId]
  );

  useEffect(() => {
    (async () => {
      try {
        const session = await fetch("/api/auth/session", { credentials: "include" });
        const sessionData = await session.json().catch(() => ({}));
        const canAdmin =
          sessionData?.user?.role === "admin" ||
          (Array.isArray(sessionData?.user?.pages) && sessionData.user.pages.includes("admin"));

        if (!session.ok || !canAdmin) {
          router.replace("/dashboard");
          return;
        }

        const res = await fetch("/api/admin/users", { credentials: "include" });
        const data = await res.json();
        if (!res.ok) return;

        setUsers(data.users || []);
        setPageKeys(data.pageKeys || []);
        setPageLabels(data.pageLabels || {});
        const initial = searchParams.get("userId") || data.users?.[0]?.id || "";
        setSelectedUserId(initial);
        const u = (data.users || []).find((x: AdminUser) => x.id === initial);
        setPages(u?.pages || []);
      } catch (error) {
        console.error("Failed to load permissions", error);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [router, searchParams]);

  useEffect(() => {
    const u = users.find((x) => x.id === selectedUserId);
    setPages(u?.pages || []);
  }, [selectedUserId, users]);

  const toggle = (key: string) => {
    setPages((prev) => (prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]));
  };

  const save = async () => {
    if (!selectedUserId) return;
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch(`/api/admin/permissions/${selectedUserId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pages }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.message || "Save failed");
        return;
      }
      setMessage("Permissions saved");
      setUsers((prev) =>
        prev.map((u) => (u.id === selectedUserId ? { ...u, pages: data.pages } : u))
      );
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-screen bg-background">
        <AppSidebar />
        <main className="flex-1 overflow-y-auto lg:ml-64 p-6">
          <Skeleton className="h-8 w-40 mb-2" />
          <Skeleton className="h-4 w-96 mb-6" />

          <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
            <Card className="p-3 space-y-2 max-h-[70vh] overflow-y-auto">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="rounded-md px-3 py-2">
                  <Skeleton className="h-4 w-24 mb-2" />
                  <Skeleton className="h-3 w-36" />
                </div>
              ))}
            </Card>

            <Card className="p-5">
              <Skeleton className="h-5 w-32 mb-2" />
              <Skeleton className="h-3 w-56 mb-4" />
              <div className="grid gap-3 sm:grid-cols-2">
                {Array.from({ length: 6 }).map((_, index) => (
                  <Skeleton key={index} className="h-11 w-full rounded-md" />
                ))}
              </div>
              <Skeleton className="h-10 w-36 mt-6 rounded-lg" />
            </Card>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />
      <main className="flex-1 overflow-y-auto lg:ml-64 p-6">
        <h1 className="text-3xl font-display tracking-tight mb-2">Permissions</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Grant page access per user. <code>devices.any</code> lets a user control every device.
        </p>

        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <Card className="p-3 space-y-1 max-h-[70vh] overflow-y-auto">
            {users.map((user) => (
              <button
                key={user.id}
                onClick={() => setSelectedUserId(user.id)}
                className={`w-full text-left rounded-md px-3 py-2 text-sm ${
                  selectedUserId === user.id ? "bg-muted" : "hover:bg-muted/50"
                }`}
              >
                <div className="font-medium">{user.name}</div>
                <div className="text-[11px] text-muted-foreground">{user.email}</div>
              </button>
            ))}
          </Card>

          <Card className="p-5">
            {selected ? (
              <>
                <div className="mb-4">
                  <p className="font-medium">{selected.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {selected.email} · role: {selected.role}
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {pageKeys.map((key) => (
                    <label key={key} className="flex items-center gap-2 text-sm border border-border rounded-md px-3 py-2">
                      <Checkbox checked={pages.includes(key)} onCheckedChange={() => toggle(key)} />
                      <span className="flex flex-col min-w-0">
                        <span className="text-sm">{pageLabels[key] || key}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">{key}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <Button onClick={() => void save()} disabled={saving}>
                    {saving ? "Saving…" : "Save permissions"}
                  </Button>
                  {message && <span className="text-sm text-muted-foreground">{message}</span>}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Select a user</p>
            )}
          </Card>
        </div>
      </main>
    </div>
  );
}

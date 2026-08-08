"use client";

import { useEffect, useState, type ReactNode } from "react";
import { notFound, usePathname, useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { bindDeviceCacheUser, clearDeviceRegistryCache, gatewayClient } from "@/lib/gateway-client";

const PUBLIC_PATHS = ["/", "/login", "/register", "/forgot-password", "/verify-otp"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/** Map URL path → Permission page key. null = no page ACL (auth only). */
export function pathToPageKey(pathname: string): string | null {
  if (!pathname || pathname === "/") return null;
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/console")) return "console";
  if (pathname.startsWith("/screen")) return "screen";
  if (pathname.startsWith("/camera")) return "camera";
  if (pathname.startsWith("/files")) return "files";
  if (pathname.startsWith("/shell")) return "shell";
  if (pathname.startsWith("/logs")) return "logs";
  if (pathname.startsWith("/notifications")) return "notifications";
  if (pathname.startsWith("/dashboard") || pathname.startsWith("/devices")) return "dashboard";
  return null;
}

function userCanAccessPage(
  role: string | undefined,
  pages: string[] | undefined,
  pageKey: string
): boolean {
  if (role === "admin") return true;
  return Array.isArray(pages) && pages.includes(pageKey);
}

export function AuthGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    if (isPublicPath(pathname)) {
      setAuthorized(true);
      setForbidden(false);
      setReady(true);
      return;
    }

    let active = true;
    setReady(false);
    setForbidden(false);

    fetch("/api/auth/session", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (!active) return;
        const data = await response.json().catch(() => ({}));
        if (response.ok && data?.authenticated) {
          const userId = data?.user?.id ? String(data.user.id) : null;
          bindDeviceCacheUser(userId);
          gatewayClient.bindUser(userId);
          void gatewayClient.refreshDevices({ force: true });

          const pageKey = pathToPageKey(pathname);
          const role = data?.user?.role as string | undefined;
          const pages = (data?.user?.pages || []) as string[];
          if (pageKey && !userCanAccessPage(role, pages, pageKey)) {
            setAuthorized(false);
            setForbidden(true);
            return;
          }
          setAuthorized(true);
          return;
        }
        clearDeviceRegistryCache();
        gatewayClient.clearCachedDevices();
        const next = encodeURIComponent(pathname);
        router.replace(`/login?next=${next}`);
      })
      .catch(() => {
        if (!active) return;
        const next = encodeURIComponent(pathname);
        router.replace(`/login?next=${next}`);
      })
      .finally(() => {
        if (active) setReady(true);
      });

    return () => {
      active = false;
    };
  }, [pathname, router]);

  if (forbidden) {
    notFound();
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex bg-background text-foreground">
        <aside className="hidden xl:flex w-72 flex-col gap-4 border-r border-border bg-muted p-8">
          <Skeleton className="h-12 w-40" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-48" />
          <div className="space-y-3 pt-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </aside>
        <main className="flex-1 p-8">
          <div className="space-y-6">
            <Skeleton className="h-12 w-1/3" />
            <div className="grid gap-4 lg:grid-cols-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
            <div className="space-y-4">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!authorized) {
    return null;
  }

  return <>{children}</>;
}

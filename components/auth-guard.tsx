"use client";

import { useEffect, useState, type ReactNode } from "react";
import { notFound, usePathname, useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { bindDeviceCacheUser, clearDeviceRegistryCache, gatewayClient } from "@/lib/gateway-client";

const PUBLIC_PATHS = ["/", "/login", "/register", "/forgot-password", "/verify-otp"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function isAdminPinPath(pathname: string) {
  return pathname === "/admin-pin" || pathname.startsWith("/admin-pin/");
}

function safeNextPath(pathname: string) {
  if (!pathname.startsWith("/") || pathname.startsWith("//") || isAdminPinPath(pathname)) {
    return "/dashboard";
  }
  return pathname;
}

/** Map URL path → Permission page key. null = no page ACL (auth only). */
export function pathToPageKey(pathname: string): string | null {
  if (!pathname || pathname === "/") return null;
  if (pathname.startsWith("/admin-pin")) return null;
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/console")) return "console";
  if (pathname.startsWith("/cockpit")) return "cockpit";
  if (pathname.startsWith("/fleet")) return "fleet";
  if (pathname.startsWith("/screen")) return "screen";
  if (pathname.startsWith("/camera")) return "camera";
  if (pathname.startsWith("/files")) return "files";
  if (pathname.startsWith("/ops")) return "ops";
  if (pathname.startsWith("/apps")) return "apps";
  if (pathname.startsWith("/shell")) return "shell";
  if (pathname.startsWith("/usage")) return "usage";
  if (pathname.startsWith("/phone")) return "phone";
  if (pathname.startsWith("/logs")) return "logs";
  if (pathname.startsWith("/notifications")) return "notifications";
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith("/architecture")) return "architecture";
  if (pathname.startsWith("/devices")) return "devices";
  if (pathname.startsWith("/dashboard")) return "dashboard";
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

function redirectToLogin(router: ReturnType<typeof useRouter>, pathname: string, reason?: string) {
  const next = encodeURIComponent(pathname);
  const q = reason ? `?next=${next}&error=${encodeURIComponent(reason)}` : `?next=${next}`;
  router.replace(`/login${q}`);
}

export function AuthGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    if (isPublicPath(pathname)) {
      gatewayClient.setAuthEnabled(false);
      setAuthorized(true);
      setForbidden(false);
      setReady(true);
      return;
    }

    let active = true;
    setReady(false);
    setForbidden(false);

    const checkSession = async (isPoll = false) => {
      try {
        const response = await fetch("/api/auth/session", {
          credentials: "include",
          cache: "no-store",
        });
        if (!active) return;
        const data = await response.json().catch(() => ({}));

        if (response.ok && data?.authenticated) {
          const userId = data?.user?.id ? String(data.user.id) : null;
          const role = data?.user?.role as string | undefined;
          const pages = (data?.user?.pages || []) as string[];
          const adminUnlocked =
            role !== "admin" || data?.user?.adminUnlocked === true || data?.adminUnlocked === true;

          if (role === "admin" && !adminUnlocked) {
            gatewayClient.setAuthEnabled(false);
            if (isAdminPinPath(pathname)) {
              bindDeviceCacheUser(userId);
              setAuthorized(true);
              return;
            }
            router.replace(`/admin-pin?next=${encodeURIComponent(safeNextPath(pathname))}`);
            return;
          }

          if (isAdminPinPath(pathname)) {
            const next = safeNextPath(
              typeof window !== "undefined"
                ? new URLSearchParams(window.location.search).get("next") || "/dashboard"
                : "/dashboard"
            );
            router.replace(next);
            return;
          }

          bindDeviceCacheUser(userId);
          gatewayClient.setAuthEnabled(true);
          gatewayClient.bindUser(userId);
          gatewayClient.ensureConnected();
          if (!isPoll) {
            void gatewayClient.refreshDevices({ force: true });
          }

          const pageKey = pathToPageKey(pathname);
          if (pageKey && !userCanAccessPage(role, pages, pageKey)) {
            setAuthorized(false);
            setForbidden(true);
            return;
          }
          setAuthorized(true);
          return;
        }

        gatewayClient.setAuthEnabled(false);
        clearDeviceRegistryCache();
        gatewayClient.clearCachedDevices();
        const reason =
          data?.reason === "session_invalid" || data?.code === 310
            ? "session-replaced"
            : undefined;
        redirectToLogin(router, pathname, reason);
      } catch {
        if (!active) return;
        if (!isPoll) redirectToLogin(router, pathname);
      } finally {
        if (active && !isPoll) setReady(true);
      }
    };

    void checkSession(false);
    const pollId = window.setInterval(() => {
      void checkSession(true);
    }, 20_000);

    return () => {
      active = false;
      window.clearInterval(pollId);
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

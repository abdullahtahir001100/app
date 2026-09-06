"use client";

import { useEffect, useState } from "react";

export interface FeatureAccessState {
  allowed: boolean;
  loading: boolean;
  role: string;
  pages: string[];
}

const SESSION_CACHE_KEY = "zenvora_session_cache";

function computeAllowed(pageKey: string, role: string, pages: string[]): boolean {
  if (role === "admin") return true;
  if (pageKey === "dashboard" || pageKey === "devices" || pageKey === "settings") return true;
  if (pages.includes(pageKey)) return true;
  if (pageKey.startsWith("logs.") && pages.includes("logs")) return true;
  if (pageKey.startsWith("phone.") && pages.includes("phone")) return true;
  if (pageKey.startsWith("settings.") && (pages.includes("settings.all") || pages.includes("admin"))) return true;
  if (pageKey.startsWith("usage.") && pages.includes("usage")) return true;
  if (pageKey.startsWith("apps.") && pages.includes("apps")) return true;
  if (pageKey === "logs") return pages.some((p) => p === "logs" || p.startsWith("logs."));
  if (pageKey === "phone") return pages.some((p) => p === "phone" || p.startsWith("phone."));
  if (pageKey === "usage") return pages.includes("usage") || pages.some((p) => p.startsWith("usage."));
  if (pageKey === "apps") return pages.includes("apps") || pages.some((p) => p.startsWith("apps."));
  return false;
}

function getInitialState(pageKey: string): FeatureAccessState {
  if (typeof window !== "undefined") {
    try {
      const raw = sessionStorage.getItem(SESSION_CACHE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (data?.authenticated && data?.user) {
          const role = data.user.role || "user";
          const pages: string[] = Array.isArray(data.user.pages) ? data.user.pages : [];
          return {
            allowed: computeAllowed(pageKey, role, pages),
            loading: false,
            role,
            pages,
          };
        }
      }
    } catch (_) {}
  }

  return {
    allowed: pageKey === "dashboard" || pageKey === "devices" || pageKey === "settings",
    loading: true,
    role: "user",
    pages: [],
  };
}

export function useFeatureAccess(pageKey: string): FeatureAccessState {
  const [state, setState] = useState<FeatureAccessState>(() => getInitialState(pageKey));

  useEffect(() => {
    let active = true;
    fetch("/api/auth/session", { credentials: "include", cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (!active) return;
        if (data?.authenticated && data?.user) {
          try {
            sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(data));
          } catch (_) {}

          const role = data.user.role || "user";
          const pages: string[] = Array.isArray(data.user.pages) ? data.user.pages : [];
          const allowed = computeAllowed(pageKey, role, pages);

          setState({
            allowed,
            loading: false,
            role,
            pages,
          });
        } else {
          setState((prev) => ({ ...prev, loading: false }));
        }
      })
      .catch(() => {
        if (active) {
          setState((prev) => ({ ...prev, loading: false }));
        }
      });

    return () => {
      active = false;
    };
  }, [pageKey]);

  return state;
}

export default useFeatureAccess;

"use client";

import { useEffect, useState } from "react";

export interface FeatureAccessState {
  allowed: boolean;
  loading: boolean;
  role: string;
  pages: string[];
}

export function useFeatureAccess(pageKey: string): FeatureAccessState {
  const [state, setState] = useState<FeatureAccessState>({
    allowed: pageKey === "dashboard" || pageKey === "devices" || pageKey === "settings",
    loading: true,
    role: "user",
    pages: [],
  });

  useEffect(() => {
    let active = true;
    fetch("/api/auth/session", { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        if (!active) return;
        if (data?.authenticated && data?.user) {
          const role = data.user.role || "user";
          const pages: string[] = Array.isArray(data.user.pages) ? data.user.pages : [];

          let allowed = false;
          if (role === "admin") {
            allowed = true;
          } else if (pageKey === "dashboard" || pageKey === "devices") {
            allowed = true;
          } else if (pageKey === "settings") {
            allowed = true;
          } else if (pages.includes(pageKey)) {
            allowed = true;
          } else if (pageKey.startsWith("logs.") && pages.includes("logs")) {
            allowed = true;
          } else if (pageKey.startsWith("phone.") && pages.includes("phone")) {
            allowed = true;
          } else if (pageKey.startsWith("settings.") && (pages.includes("settings.all") || pages.includes("admin"))) {
            allowed = true;
          } else if (pageKey.startsWith("usage.") && pages.includes("usage")) {
            allowed = true;
          } else if (pageKey.startsWith("apps.") && pages.includes("apps")) {
            allowed = true;
          } else if (pageKey === "logs") {
            allowed = pages.some((p) => p === "logs" || p.startsWith("logs."));
          } else if (pageKey === "phone") {
            allowed = pages.some((p) => p === "phone" || p.startsWith("phone."));
          } else if (pageKey === "usage") {
            allowed = pages.includes("usage") || pages.some((p) => p.startsWith("usage."));
          } else if (pageKey === "apps") {
            allowed = pages.includes("apps") || pages.some((p) => p.startsWith("apps."));
          }

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

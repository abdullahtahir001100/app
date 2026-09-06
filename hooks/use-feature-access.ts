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
          } else if (pageKey === "dashboard" || pageKey === "devices" || pageKey === "settings") {
            allowed = true;
          } else if (pages.includes(pageKey)) {
            allowed = true;
          } else if (pageKey === "logs") {
            allowed = pages.some((p) => p === "logs" || p.startsWith("logs."));
          } else if (pageKey === "phone") {
            allowed = pages.some((p) => p === "phone" || p.startsWith("phone."));
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

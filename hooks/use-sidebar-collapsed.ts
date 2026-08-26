"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Shared collapse state for the desktop sidebar.
 *
 * The sidebar (`app-sidebar.tsx`) and the page shell (`dashboard-layout.tsx`)
 * are separate client components, so they can't share React state directly.
 * We persist the flag in localStorage and broadcast changes with a custom
 * window event so every mounted instance (sidebar + main-content margin) stays
 * in sync within the same tab, and the `storage` event keeps other tabs synced.
 */
const STORAGE_KEY = "zenvora_sidebar_collapsed";
const EVENT = "zenvora:sidebar-collapsed";

function read(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function useSidebarCollapsed() {
  // SSR-safe default (expanded); hydrate the real value on mount to avoid
  // hydration mismatches.
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(read());

    const onEvent = (e: Event) => {
      const detail = (e as CustomEvent<boolean>).detail;
      setCollapsed(typeof detail === "boolean" ? detail : read());
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setCollapsed(read());
    };

    window.addEventListener(EVENT, onEvent as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, onEvent as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setCollapsedPersist = useCallback((value: boolean) => {
    setCollapsed(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
    } catch {
      // ignore storage errors (private mode etc.)
    }
    try {
      window.dispatchEvent(new CustomEvent(EVENT, { detail: value }));
    } catch {
      // ignore
    }
  }, []);

  const toggle = useCallback(() => {
    setCollapsedPersist(!read());
  }, [setCollapsedPersist]);

  return { collapsed, setCollapsed: setCollapsedPersist, toggle };
}

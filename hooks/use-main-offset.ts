"use client";

import { useSidebarCollapsed } from "@/hooks/use-sidebar-collapsed";

/** Drop-in replacement for hardcoded `lg:ml-64` so collapsed sidebar leaves no empty gap. */
export function useMainOffsetClass(extra = "") {
  const { mainOffsetClass } = useSidebarCollapsed();
  return `${extra} ${mainOffsetClass}`.replace(/\s+/g, " ").trim();
}

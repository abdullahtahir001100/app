"use client";

import { AppSidebar } from "@/components/app-sidebar";
import { useSidebarCollapsed } from "@/hooks/use-sidebar-collapsed";
import { ReactNode } from "react";

export function DashboardLayout({ children }: { children: ReactNode }) {
  const { collapsed } = useSidebarCollapsed();
  return (
    <div className="flex h-screen">
      <AppSidebar />
      <main
        className={`flex-1 overflow-auto ml-0 transition-all duration-300 ${
          collapsed ? "lg:ml-0" : "sidebar-aware-main"
        }`}
      >
        {children}
      </main>
    </div>
  );
}

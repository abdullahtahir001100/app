"use client";

import { AppSidebar } from "@/components/app-sidebar";

export function FullPageLoader({ message = "Verifying license permissions…" }: { message?: string }) {
  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />
      <main className="flex-1 sidebar-aware-main overflow-auto p-6 flex flex-col items-center justify-center gap-4">
        <div className="relative flex items-center justify-center">
          <div className="w-12 h-12 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
          <div className="absolute w-5 h-5 rounded-full bg-primary/15 animate-ping" />
        </div>
        <div className="text-center space-y-1">
          <p className="text-sm font-semibold text-foreground tracking-tight">{message}</p>
          <p className="text-xs font-mono text-muted-foreground/70">Connecting to secure ACL engine…</p>
        </div>
      </main>
    </div>
  );
}

export default FullPageLoader;

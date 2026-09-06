"use client";

import dynamic from "next/dynamic";
import { AppSidebar } from "@/components/app-sidebar";
import { PremiumGate } from "@/components/premium-card";
import { useFeatureAccess } from "@/hooks/use-feature-access";

const FileManager = dynamic(
  () => import("@/components/file-manager/file-manager").then((mod) => mod.FileManager),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        Loading file manager…
      </div>
    ),
  }
);

export default function FilesPage() {
  const { allowed, loading } = useFeatureAccess("files");

  if (!loading && !allowed) {
    return (
      <div className="flex h-screen bg-background">
        <AppSidebar />
        <main className="flex-1 sidebar-aware-main overflow-auto p-6 flex items-center justify-center">
          <PremiumGate featureKey="files" onUnlocked={() => window.location.reload()} />
        </main>
      </div>
    );
  }

  return <FileManager />;
}

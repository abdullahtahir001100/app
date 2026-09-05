"use client";

import dynamic from "next/dynamic";

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
  return <FileManager />;
}

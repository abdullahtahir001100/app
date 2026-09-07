"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";

const CloudVaultManager = dynamic(
  () => import("@/components/file-manager/cloud-vault-manager").then((mod) => mod.CloudVaultManager),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        Loading cloud vault…
      </div>
    ),
  }
);

export default function CloudVaultPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
          Loading cloud vault…
        </div>
      }
    >
      <CloudVaultManager />
    </Suspense>
  );
}

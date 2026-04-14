"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Header } from "@/components/layout/Header";
import { TokenUsageTab } from "@/components/settings/TokenUsageTab";

export default function TokenUsagePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const role = (session as any)?.user?.role as string | undefined;

  useEffect(() => {
    if (status === "loading") return;
    if (role !== "admin" && role !== "super_admin") {
      router.replace("/dashboard");
    }
  }, [status, role, router]);

  if (status === "loading" || (role !== "admin" && role !== "super_admin")) {
    return null;
  }

  return (
    <div className="flex flex-col min-h-screen" style={{ backgroundColor: "#0a0a0a" }}>
      <Header title="Token Usage" />
      <div className="flex-1 p-6 md:p-8 max-w-7xl mx-auto w-full">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Token Usage</h1>
          <p className="text-sm mt-1" style={{ color: "#6b7280" }}>
            Monitor Claude API token consumption and costs across users and projects.
          </p>
        </div>
        <TokenUsageTab />
      </div>
    </div>
  );
}

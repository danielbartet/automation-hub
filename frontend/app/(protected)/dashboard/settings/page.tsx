"use client";

import { Suspense } from "react";
import { Header } from "@/components/layout/Header";
import { MetaTokenSection } from "@/components/settings/MetaTokenSection";
import { TokenUsageTab } from "@/components/settings/TokenUsageTab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSession } from "next-auth/react";
import { useT } from "@/lib/i18n";

export default function SettingsPage() {
  const t = useT();
  const { data: session, status } = useSession();
  const role = (session as any)?.user?.role as string | undefined;
  const showTokenUsage = status !== "loading" && (role === "admin" || role === "super_admin");

  return (
    <div>
      <Header title={t.settings_page_title} />
      <div className="p-6 max-w-4xl">
        <Tabs defaultValue="meta">
          <TabsList className="mb-2" style={{ backgroundColor: "#0a0a0a", border: "1px solid #222222" }}>
            <TabsTrigger value="meta">Meta Connection</TabsTrigger>
            {showTokenUsage && (
              <TabsTrigger value="token-usage">Token Usage</TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="meta">
            <div className="max-w-2xl">
              <Suspense>
                <MetaTokenSection />
              </Suspense>
            </div>
          </TabsContent>

          {showTokenUsage && (
            <TabsContent value="token-usage">
              <TokenUsageTab />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  );
}

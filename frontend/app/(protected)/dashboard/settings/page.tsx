"use client";

import { Suspense } from "react";
import { Header } from "@/components/layout/Header";
import { MetaTokenSection } from "@/components/settings/MetaTokenSection";
import { useT } from "@/lib/i18n";

export default function SettingsPage() {
  const t = useT();

  return (
    <div>
      <Header title={t.settings_page_title} />
      <div className="p-6 space-y-6 max-w-2xl">
        <Suspense>
          <MetaTokenSection />
        </Suspense>
      </div>
    </div>
  );
}

export const dynamic = "force-dynamic";

import { Sidebar } from "@/components/layout/Sidebar";
import { LanguageProvider } from "@/lib/i18n";
import { ProjectProvider } from "@/lib/project-context";
import { MetaRateLimitProvider } from "@/components/dashboard/MetaRateLimitProvider";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <LanguageProvider>
      <ProjectProvider>
        <MetaRateLimitProvider>
          <div className="flex h-screen" style={{ backgroundColor: "#0a0a0a" }}>
            <Sidebar />
            <main className="flex-1 overflow-y-auto">{children}</main>
          </div>
        </MetaRateLimitProvider>
      </ProjectProvider>
    </LanguageProvider>
  );
}

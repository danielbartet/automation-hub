"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Header } from "@/components/layout/Header";
import { fetchProjects } from "@/lib/api";
import { AuditScoreCard } from "../AuditScoreCard";
import { AuditCheckList } from "../AuditCheckList";

interface Project {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
}

export default function AuditPage() {
  const { data: session } = useSession();
  const token = session?.accessToken as string | undefined;

  const [projects, setProjects] = useState<Project[]>([]);
  const [auditSlug, setAuditSlug] = useState<string>("");
  const [selectedAuditId, setSelectedAuditId] = useState<number | null>(null);

  useEffect(() => {
    if (!token) return;
    fetchProjects(token)
      .then((list: Project[]) => {
        const arr = Array.isArray(list) ? list : [];
        setProjects(arr);
        if (arr.length > 0) setAuditSlug(arr[0].slug);
      })
      .catch(() => {});
  }, [token]);

  // Reset auditId when project changes
  useEffect(() => {
    setSelectedAuditId(null);
  }, [auditSlug]);

  return (
    <div className="flex flex-col min-h-screen" style={{ backgroundColor: "#0a0a0a" }}>
      <Header title="Meta Ads Audit" />
      <div className="flex-1 p-6 md:p-8 max-w-7xl mx-auto w-full">
        {/* Page header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Meta Ads Audit</h1>
          <p className="text-sm mt-1" style={{ color: "#6b7280" }}>
            Review your Meta Ads account health and compliance checks.
          </p>
        </div>

        {projects.length === 0 ? (
          <div className="text-center py-20" style={{ color: "#4b5563" }}>
            <p className="text-lg">No projects found.</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="ml-auto flex items-center gap-2">
                <label className="text-sm font-medium" style={{ color: "#9ca3af" }}>Project:</label>
                <select
                  value={auditSlug}
                  onChange={(e) => setAuditSlug(e.target.value)}
                  className="text-sm rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                  style={{ backgroundColor: "#1a1a1a", border: "1px solid #333333", color: "#ffffff" }}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.slug}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {auditSlug && (
              <>
                <AuditScoreCard
                  projectSlug={auditSlug}
                  onAuditCompleted={(auditId) => setSelectedAuditId(auditId)}
                />
                {selectedAuditId && (
                  <AuditCheckList auditId={selectedAuditId} />
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

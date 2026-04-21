"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { KPICard } from "@/components/dashboard/KPICard";
import { WhatToPostTodayCard } from "@/components/dashboard/WhatToPostTodayCard";
import { fetchDashboard } from "@/lib/api";
import { Loader2, FileText, Activity } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useProject } from "@/lib/project-context";

interface ContentPost {
  id: string;
  caption: string;
  status: string;
  image_url?: string;
  created_at: string;
  published_at?: string;
}

interface Campaign {
  name: string;
  status: string;
  spend_today?: number;
  spend_this_month?: number;
}

interface DashboardData {
  project?: { name: string; slug: string };
  content?: {
    total_posts?: number;
    posts_this_week?: number;
    posts_this_month?: number;
    pending_approvals?: number;
    recent_posts?: ContentPost[];
  };
  meta_ads?: {
    spend_today?: number;
    spend_this_month?: number;
    active_campaigns?: number;
    campaigns?: Campaign[];
    totals?: {
      spend_today?: number;
      spend_this_month?: number;
      active_campaigns?: number;
      leads?: number;
      cpl?: number;
      ctr?: number;
    };
  };
}

interface AuditLogEntry {
  id: number;
  timestamp: string;
  operation: string;
  entity_type: string;
  entity_id: string | null;
  success: boolean;
  response_status: number | null;
  error_message: string | null;
  user_id: number | null;
}

const STATUS_CLASSES: Record<string, string> = {
  pending_approval: "bg-yellow-900/50 text-yellow-400",
  published: "bg-green-900/50 text-green-400",
  draft: "bg-gray-800 text-gray-400",
};

// STATUS_LABELS is now built from translations inside the component

const CAMPAIGN_STATUS_CLASSES: Record<string, string> = {
  ACTIVE: "bg-green-900/50 text-green-400",
  PAUSED: "bg-gray-800 text-gray-400",
};

function formatDate(dateStr: string) {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

export default function DashboardPage() {
  const t = useT();
  const { data: session } = useSession();
  const router = useRouter();
  const { selectedSlug, selectedProject } = useProject();

  const isAdmin = session?.user?.role === "admin" || session?.user?.role === "super_admin";
  const token = (session as { accessToken?: string } | null)?.accessToken ?? "";

  const [data, setData] = useState<DashboardData | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "actividad">("overview");
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const loadData = useCallback(() => {
    if (!selectedSlug) return;
    setLoadingData(true);
    setError(null);
    fetchDashboard(selectedSlug, token)
      .then((d) => setData(d))
      .catch((err) => setError(err.message))
      .finally(() => setLoadingData(false));
  }, [selectedSlug, token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Fetch audit log when Actividad tab is active (admin only)
  useEffect(() => {
    if (activeTab !== "actividad" || !selectedSlug || !token || !isAdmin) return;
    setAuditLoading(true);
    const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
    fetch(`${api}/api/v1/ads/audit-log/${selectedSlug}?limit=50`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : { entries: [] }))
      .then((d) => setAuditLog(d.entries ?? []))
      .catch(() => setAuditLog([]))
      .finally(() => setAuditLoading(false));
  }, [activeTab, selectedSlug, token, isAdmin]);

  const recentPosts = data?.content?.recent_posts ?? [];
  const campaigns = data?.meta_ads?.campaigns ?? [];

  const projectName =
    data?.project?.name ??
    selectedProject?.name ??
    selectedSlug;

  return (
    <div>
      <Header title={`Dashboard${projectName ? ` — ${projectName}` : ""}`} />
      <div className="p-6 space-y-6">
        {loadingData && (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" style={{ color: "#9ca3af" }} />
          </div>
        )}

        {error && (
          <div className="rounded-md p-4 text-sm" style={{ backgroundColor: "#450a0a", border: "1px solid #7f1d1d", color: "#fca5a5" }}>
            Error: {error}
          </div>
        )}

        {/* Tab bar — admin only */}
        {isAdmin && (
          <div className="flex gap-1" style={{ borderBottom: "1px solid #222222" }}>
            {(["overview", "actividad"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className="px-4 py-2 text-sm font-medium transition-colors"
                style={
                  activeTab === tab
                    ? { color: "#ffffff", borderBottom: "2px solid #7c3aed" }
                    : { color: "#9ca3af", borderBottom: "2px solid transparent" }
                }
              >
                {tab === "overview" ? "Overview" : "Actividad"}
              </button>
            ))}
          </div>
        )}

        {/* ── Actividad tab ── */}
        {activeTab === "actividad" && isAdmin && (
          <div className="rounded-lg overflow-hidden" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
            <div className="px-6 py-4" style={{ borderBottom: "1px solid #222222" }}>
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <Activity className="h-4 w-4" style={{ color: "#9ca3af" }} />
                Actividad Meta API
              </h3>
            </div>
            {auditLoading ? (
              <div className="flex items-center justify-center h-40 text-sm" style={{ color: "#9ca3af" }}>
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Cargando actividad…
              </div>
            ) : auditLog.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-sm" style={{ color: "#9ca3af" }}>
                No hay actividad registrada aún.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead style={{ backgroundColor: "#111111", borderBottom: "1px solid #222222" }}>
                    <tr>
                      <th className="text-left px-4 py-3 font-medium" style={{ color: "#9ca3af" }}>Timestamp</th>
                      <th className="text-left px-4 py-3 font-medium" style={{ color: "#9ca3af" }}>Operación</th>
                      <th className="text-left px-4 py-3 font-medium" style={{ color: "#9ca3af" }}>Entidad</th>
                      <th className="text-left px-4 py-3 font-medium" style={{ color: "#9ca3af" }}>Estado</th>
                      <th className="text-left px-4 py-3 font-medium" style={{ color: "#9ca3af" }}>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLog.map((entry, i) => (
                      <tr
                        key={entry.id}
                        style={{ borderTop: i > 0 ? "1px solid #1a1a1a" : undefined }}
                        className="hover:bg-[#161616] transition-colors"
                      >
                        <td className="px-4 py-3 whitespace-nowrap" style={{ color: "#9ca3af" }}>
                          {new Date(entry.timestamp).toLocaleString("es-AR", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                            style={{ backgroundColor: "#1e1b4b", color: "#a5b4fc" }}
                          >
                            {entry.operation}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-white">
                          {entry.entity_type}
                          {entry.entity_id && (
                            <span style={{ color: "#6b7280" }}>
                              {" "}·{" "}{entry.entity_id.slice(0, 12)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {entry.success ? (
                            <span className="text-green-400 font-medium">✓</span>
                          ) : (
                            <span className="text-red-400 font-medium">✗</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs max-w-[200px] truncate" style={{ color: "#9ca3af" }}>
                          {entry.error_message ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Overview tab content ── */}
        {(activeTab === "overview" || !isAdmin) && (
          <>
        {/* What to post today wizard */}
        {selectedSlug && (
          <WhatToPostTodayCard
            projectSlug={selectedSlug}
            onGenerateContent={(hint, format, category) => {
              const params = new URLSearchParams({ hint, format });
              if (category) params.set("category", category);
              router.push(`/dashboard/content?${params.toString()}`);
            }}
            onPlanWeek={() => {
              router.push("/dashboard/calendar");
            }}
          />
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
          <KPICard
            title={t.overview_kpi_total_posts}
            value={data?.content?.total_posts ?? 0}
            subtitle={t.overview_kpi_total_posts_sub}
          />
          <KPICard
            title={t.overview_kpi_week_posts}
            value={data?.content?.posts_this_week ?? 0}
            subtitle={t.overview_kpi_week_posts_sub}
          />
          <KPICard
            title={t.overview_kpi_month_posts}
            value={data?.content?.posts_this_month ?? 0}
            subtitle={t.overview_kpi_month_posts_sub}
          />
          <KPICard
            title={t.overview_kpi_pending}
            value={data?.content?.pending_approvals ?? 0}
            subtitle={t.overview_kpi_pending_sub}
          />
          <KPICard
            title={t.overview_kpi_ad_spend}
            value={`$${(data?.meta_ads?.totals?.spend_this_month ?? data?.meta_ads?.spend_this_month ?? 0).toFixed(2)}`}
            subtitle={t.overview_kpi_ad_spend_sub}
          />
          <KPICard
            title={t.overview_kpi_active_campaigns}
            value={data?.meta_ads?.totals?.active_campaigns ?? data?.meta_ads?.active_campaigns ?? 0}
            subtitle={t.overview_kpi_active_campaigns_sub}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Posts */}
          <div className="rounded-lg overflow-hidden" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
            <div className="px-6 py-4" style={{ borderBottom: "1px solid #222222" }}>
              <h3 className="text-base font-semibold text-white">{t.overview_recent_posts}</h3>
            </div>
            {loadingData ? (
              <div className="flex items-center justify-center h-40 text-sm" style={{ color: "#9ca3af" }}>
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                {t.overview_loading}
              </div>
            ) : recentPosts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2">
                <FileText className="h-8 w-8" style={{ color: "#374151" }} />
                <p className="text-sm" style={{ color: "#9ca3af" }}>{t.overview_no_recent_posts}</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead style={{ backgroundColor: "#111111", borderBottom: "1px solid #222222" }}>
                  <tr>
                    <th className="text-left px-4 py-3 font-medium" style={{ color: "#9ca3af" }}>{t.overview_col_caption}</th>
                    <th className="text-left px-4 py-3 font-medium" style={{ color: "#9ca3af" }}>{t.overview_col_status}</th>
                    <th className="text-left px-4 py-3 font-medium" style={{ color: "#9ca3af" }}>{t.overview_col_date}</th>
                  </tr>
                </thead>
                <tbody>
                  {recentPosts.map((post) => {
                    const statusLabel =
                      post.status === "pending_approval" ? t.overview_status_pending :
                      post.status === "published" ? t.overview_status_published :
                      post.status === "draft" ? t.overview_status_draft :
                      post.status;
                    return (
                      <tr key={post.id} style={{ borderTop: "1px solid #1a1a1a" }} className="hover:bg-[#161616] transition-colors">
                        <td className="px-4 py-3 max-w-[180px] truncate text-white">
                          {post.caption}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                              STATUS_CLASSES[post.status] ?? "bg-gray-800 text-gray-400"
                            }`}
                          >
                            {statusLabel}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap" style={{ color: "#9ca3af" }}>
                          {formatDate(post.created_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Campaigns */}
          <div className="rounded-lg overflow-hidden" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
            <div className="px-6 py-4" style={{ borderBottom: "1px solid #222222" }}>
              <h3 className="text-base font-semibold text-white">{t.overview_campaigns}</h3>
            </div>
            {loadingData ? (
              <div className="flex items-center justify-center h-40 text-sm" style={{ color: "#9ca3af" }}>
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                {t.overview_loading}
              </div>
            ) : campaigns.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-sm" style={{ color: "#9ca3af" }}>
                {t.overview_no_campaigns}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead style={{ backgroundColor: "#111111", borderBottom: "1px solid #222222" }}>
                  <tr>
                    <th className="text-left px-4 py-3 font-medium" style={{ color: "#9ca3af" }}>{t.overview_col_campaign}</th>
                    <th className="text-left px-4 py-3 font-medium" style={{ color: "#9ca3af" }}>{t.overview_col_status}</th>
                    <th className="text-left px-4 py-3 font-medium" style={{ color: "#9ca3af" }}>{t.overview_col_today}</th>
                    <th className="text-left px-4 py-3 font-medium" style={{ color: "#9ca3af" }}>{t.overview_col_this_month}</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c, i) => (
                    <tr key={i} style={{ borderTop: "1px solid #1a1a1a" }} className="hover:bg-[#161616] transition-colors">
                      <td className="px-4 py-3 max-w-[160px] truncate font-medium text-white">
                        {c.name}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            CAMPAIGN_STATUS_CLASSES[c.status] ?? "bg-gray-800 text-gray-400"
                          }`}
                        >
                          {c.status}
                        </span>
                      </td>
                      <td className="px-4 py-3" style={{ color: "#d1d5db" }}>
                        {c.spend_today != null ? `$${c.spend_today.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-4 py-3" style={{ color: "#d1d5db" }}>
                        {c.spend_this_month != null ? `$${c.spend_this_month.toFixed(2)}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
          </>
        )}
      </div>
    </div>
  );
}

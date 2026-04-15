"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useSearchParams, useRouter } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { KPICard } from "@/components/dashboard/KPICard";
import { WhatToPostTodayCard } from "@/components/dashboard/WhatToPostTodayCard";
import { fetchDashboard, fetchProjects } from "@/lib/api";
import { Loader2, FileText } from "lucide-react";
import { useT } from "@/lib/i18n";

interface Project {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
}

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
  const searchParams = useSearchParams();
  const router = useRouter();
  const projectParam = searchParams.get("project");

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string>(projectParam ?? "");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = (session as any)?.accessToken as string | undefined;
    fetchProjects(token)
      .then((list: Project[]) => {
        const arr = Array.isArray(list) ? list : [];
        setProjects(arr);
        if (!selectedSlug && arr.length > 0) {
          setSelectedSlug(arr[0].slug);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoadingProjects(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const loadData = useCallback(() => {
    if (!selectedSlug) return;
    const token = (session as any)?.accessToken as string | undefined;
    setLoadingData(true);
    setError(null);
    fetchDashboard(selectedSlug, token)
      .then((d) => setData(d))
      .catch((err) => setError(err.message))
      .finally(() => setLoadingData(false));
  }, [selectedSlug, session]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const recentPosts = data?.content?.recent_posts ?? [];
  const campaigns = data?.meta_ads?.campaigns ?? [];

  const projectName =
    data?.project?.name ??
    projects.find((p) => p.slug === selectedSlug)?.name ??
    selectedSlug;

  return (
    <div>
      <Header title={`Dashboard${projectName ? ` — ${projectName}` : ""}`} />
      <div className="p-6 space-y-6">
        {/* Project selector */}
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium" style={{ color: "#9ca3af" }}>{t.overview_project_label}</label>
          {loadingProjects ? (
            <span className="text-sm" style={{ color: "#9ca3af" }}>{t.overview_loading}</span>
          ) : (
            <select
              value={selectedSlug}
              onChange={(e) => setSelectedSlug(e.target.value)}
              className="text-sm rounded-md px-3 py-2 focus:outline-none focus:ring-2"
              style={{
                border: "1px solid #333333",
                backgroundColor: "#1a1a1a",
                color: "#ffffff",
              }}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.slug}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          {loadingData && <Loader2 className="h-4 w-4 animate-spin" style={{ color: "#9ca3af" }} />}
        </div>

        {error && (
          <div className="rounded-md p-4 text-sm" style={{ backgroundColor: "#450a0a", border: "1px solid #7f1d1d", color: "#fca5a5" }}>
            Error: {error}
          </div>
        )}

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
      </div>
    </div>
  );
}

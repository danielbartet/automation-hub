"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Header } from "@/components/layout/Header";
import { KPICard } from "@/components/dashboard/KPICard";
import { CreateCampaignModal } from "@/components/dashboard/CreateCampaignModal";
import { CampaignOptimizationPanel } from "@/components/dashboard/CampaignOptimizationPanel";
import InspirationTab from "@/components/dashboard/InspirationTab";
import {
  fetchDashboard,
  importCampaigns,
  fetchCampaignRecommendations,
  fetchProjectBySlug,
  approveOptimizerAction,
  rejectOptimizerAction,
  type CampaignRecommendations,
  type CampaignRecommendation,
  type InspirationPrefill,
} from "@/lib/api";
import { useProject } from "@/lib/project-context";
import { Loader2, Plus, Download } from "lucide-react";
import Link from "next/link";
import { useT } from "@/lib/i18n";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface CampaignKPIs {
  leads?: number;
  cpl?: number;
  purchases?: number;
  cpa?: number;
  roas?: number;
  clicks?: number;
  cpc?: number;
}

interface Campaign {
  id: number;
  name: string;
  objective?: string;
  status: string;
  daily_budget?: number;
  spend_today?: number;
  spend_this_month?: number;
  andromeda_status?: string;
  kpis?: CampaignKPIs;
  meta_campaign_id?: string;
}

interface MetaAdsTotals {
  spend_today?: number;
  spend_this_month?: number;
  active_campaigns?: number;
  leads?: number;
  cpl?: number;
  ctr?: number;
}

interface MetaAds {
  spend_today?: number;
  spend_this_month?: number;
  active_campaigns?: number;
  campaigns?: Campaign[];
  daily_spend?: { date: string; spend: number }[];
  totals?: MetaAdsTotals;
}

interface DashboardData {
  meta_ads?: MetaAds;
}

const CAMPAIGN_STATUS_CLASSES: Record<string, string> = {
  ACTIVE: "bg-green-900/50 text-green-400",
  active: "bg-green-900/50 text-green-400",
  PAUSED: "bg-gray-800 text-gray-400",
  paused: "bg-gray-800 text-gray-400",
  DELETED: "bg-red-900/50 text-red-400",
};

const ANDROMEDA_STATUS_CLASSES: Record<string, string> = {
  running: "bg-blue-900/50 text-blue-400",
  paused: "bg-yellow-900/50 text-yellow-400",
  stopped: "bg-gray-800 text-gray-500",
  error: "bg-red-900/50 text-red-400",
};

interface CompetitiveBrief {
  hook_patterns: { pattern: string; frequency: number }[];
  angle_distribution: Record<string, number>;
  opportunity_gap: string;
  weekly_recommendation: string;
  [key: string]: unknown;
}

interface CompetitiveInsightsData {
  brief: CompetitiveBrief;
  generated_at: string;
  analyzed_ads_count: number;
}

export default function AdsPage() {
  const t = useT();
  const { data: session } = useSession();
  const isClient = session?.user?.role === "client";
  const isAdmin = session?.user?.role === "admin" || session?.user?.role === "super_admin";
  const isOperator = session?.user?.role === "operator";
  const token = (session as { accessToken?: string } | null)?.accessToken ?? "";
  const { selectedSlug, selectedProject: ctxSelectedProject, loading: loadingProjects } = useProject();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; updated: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [allRecommendations, setAllRecommendations] = useState<CampaignRecommendations[]>([]);
  const [recsToast, setRecsToast] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"campaigns" | "inspiration">("campaigns");
  const [inspirationPrefill, setInspirationPrefill] = useState<InspirationPrefill | undefined>(undefined);
  const [projectContentConfig, setProjectContentConfig] = useState<Record<string, unknown> | undefined>(undefined);
  const [competitiveInsights, setCompetitiveInsights] = useState<CompetitiveInsightsData | null | "empty">(null);
  const [insightsPrefillRec, setInsightsPrefillRec] = useState<string | undefined>(undefined);
  const loadData = useCallback(() => {
    if (!selectedSlug) return;
    setLoadingData(true);
    setError(null);
    fetchDashboard(selectedSlug, token)
      .then((d) => {
        setData(d);
        // Fetch recommendations in parallel for all active campaigns
        if (token) {
          const activeCampaigns: Campaign[] = (d?.meta_ads?.campaigns ?? []).filter(
            (c: Campaign) => c.id != null
          );
          Promise.allSettled(
            activeCampaigns.map((c: Campaign) =>
              fetchCampaignRecommendations(token, c.id).catch(() => null)
            )
          ).then((results) => {
            const recs = results
              .filter(
                (r): r is PromiseFulfilledResult<CampaignRecommendations> =>
                  r.status === "fulfilled" && r.value !== null && r.value.has_pending
              )
              .map((r) => r.value);
            setAllRecommendations(recs);
          });
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoadingData(false));
  }, [selectedSlug, token]);

  const showRecsToast = (msg: string) => {
    setRecsToast(msg);
    setTimeout(() => setRecsToast(null), 4000);
  };

  const handleRecApprove = async (rec: CampaignRecommendation, campaignId: number) => {
    if (!rec.approval_token) return;
    // Optimistic remove
    setAllRecommendations((prev) =>
      prev
        .map((r) =>
          r.campaign_id === campaignId
            ? { ...r, recommendations: r.recommendations.filter((x) => x.id !== rec.id) }
            : r
        )
        .filter((r) => r.recommendations.length > 0)
        .map((r) => ({ ...r, has_pending: r.recommendations.length > 0 }))
    );
    try {
      await approveOptimizerAction(token, rec.approval_token);
      showRecsToast(t.ads_action_approved);
      loadData();
    } catch {
      showRecsToast(t.ads_approve_error);
      loadData();
    }
  };

  const handleRecReject = async (rec: CampaignRecommendation, campaignId: number) => {
    if (!rec.approval_token) return;
    // Optimistic remove
    setAllRecommendations((prev) =>
      prev
        .map((r) =>
          r.campaign_id === campaignId
            ? { ...r, recommendations: r.recommendations.filter((x) => x.id !== rec.id) }
            : r
        )
        .filter((r) => r.recommendations.length > 0)
        .map((r) => ({ ...r, has_pending: r.recommendations.length > 0 }))
    );
    try {
      await rejectOptimizerAction(token, rec.approval_token);
      showRecsToast(t.ads_action_rejected);
      loadData();
    } catch {
      showRecsToast(t.ads_reject_error);
      loadData();
    }
  };

  const handleImport = useCallback(async () => {
    if (!selectedSlug) return;
    setImporting(true);
    setImportResult(null);
    setImportError(null);
    try {
      const result = await importCampaigns(selectedSlug, token);
      setImportResult({ imported: result.imported, updated: result.updated });
      loadData();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : t.ads_import_error_default);
    } finally {
      setImporting(false);
    }
  }, [selectedSlug, loadData]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!selectedSlug || !token) return;
    fetchProjectBySlug(selectedSlug, token)
      .then((proj) => setProjectContentConfig(proj?.content_config ?? undefined))
      .catch(() => setProjectContentConfig(undefined));
  }, [selectedSlug, token]);

  // Fetch competitive insights (admin + operator only)
  useEffect(() => {
    if (!selectedSlug || !token || isClient) return;
    const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
    fetch(`${api}/api/v1/competitor-intelligence/${selectedSlug}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (r.status === 404) { setCompetitiveInsights("empty"); return null; }
        if (!r.ok) { setCompetitiveInsights("empty"); return null; }
        return r.json();
      })
      .then((d) => { if (d) setCompetitiveInsights(d as CompetitiveInsightsData); })
      .catch(() => setCompetitiveInsights("empty"));
  }, [selectedSlug, token, isClient]);

  const handleAdapted = (prefill: InspirationPrefill) => {
    setInspirationPrefill(prefill);
    setShowCreateModal(true);
  };

  const selectedProject = ctxSelectedProject;
  const metaAds = data?.meta_ads;
  const metaTotals = metaAds?.totals ?? metaAds;
  const campaigns = metaAds?.campaigns ?? [];
  const spendData = metaAds?.daily_spend ?? [];

  return (
    <div>
      <Header title="Ads" />
      <div className="p-6 space-y-6">
        {/* Actions bar */}
        <div className="flex items-center gap-3 flex-wrap">
          {loadingData && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
          {!isClient && (
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={handleImport}
                disabled={!selectedProject || importing}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                style={{ border: "1px solid #333333", color: "#9ca3af" }}
                onMouseEnter={e => { if (!(e.currentTarget as HTMLButtonElement).disabled) { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1a1a1a"; (e.currentTarget as HTMLButtonElement).style.color = "#ffffff"; } }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; }}
              >
                {importing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t.ads_importing}
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    {t.ads_import_from_meta}
                  </>
                )}
              </button>
              <button
                onClick={() => setShowCreateModal(true)}
                disabled={!selectedProject}
                className="flex items-center gap-2 px-4 py-2 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                style={{ backgroundColor: "#7c3aed" }}
                onMouseEnter={e => { if (!(e.currentTarget as HTMLButtonElement).disabled) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#6d28d9"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#7c3aed"; }}
              >
                <Plus className="h-4 w-4" />{t.ads_create_campaign}
              </button>
            </div>
          )}
        </div>

        {/* Tab bar — admin/operator only */}
        {!isClient && (
          <div className="flex gap-1" style={{ borderBottom: "1px solid #222222" }}>
            {/* TEMP: commented for Meta App Review video — uncomment after */}
            {/* {(["campaigns", "inspiration"] as const).map((tab) => ( */}
            {(["campaigns"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => { setActiveTab(tab); setInspirationPrefill(undefined); }}
                className="px-4 py-2 text-sm font-medium transition-colors"
                style={
                  activeTab === tab
                    ? { color: "#ffffff", borderBottom: "2px solid #7c3aed" }
                    : { color: "#9ca3af", borderBottom: "2px solid transparent" }
                }
              >
                {tab === "campaigns" ? t.ads_campaigns_tab : t.ads_inspiration_tab}
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-md p-4 text-sm text-red-400" style={{ backgroundColor: "#450a0a", border: "1px solid #7f1d1d" }}>
            Error: {error}
          </div>
        )}

        {/* ── Inspiration tab ── */}
        {activeTab === "inspiration" && !isClient && selectedProject && (
          <InspirationTab
            projectSlug={selectedProject.slug}
            token={token}
            onAdapted={handleAdapted}
          />
        )}

        {activeTab === "campaigns" && importResult && (
          <div className="rounded-md p-4 text-sm text-green-400 flex items-center justify-between" style={{ backgroundColor: "#052e16", border: "1px solid #166534" }}>
            <span>
              {importResult.imported > 0 && (
                <span><strong>{importResult.imported}</strong> {importResult.imported === 1 ? t.ads_imported_one : t.ads_imported_many}</span>
              )}
              {importResult.imported > 0 && importResult.updated > 0 && <span>, </span>}
              {importResult.updated > 0 && (
                <span><strong>{importResult.updated}</strong> {importResult.updated === 1 ? t.ads_updated_one : t.ads_updated_many}</span>
              )}
              {importResult.imported === 0 && importResult.updated === 0 && (
                <span>{t.ads_no_new_campaigns}</span>
              )}
            </span>
            <button
              onClick={() => setImportResult(null)}
              className="ml-4 text-green-400 hover:text-green-300 font-medium"
            >
              &times;
            </button>
          </div>
        )}

        {activeTab === "campaigns" && importError && (
          <div className="rounded-md p-4 text-sm text-red-400 flex items-center justify-between" style={{ backgroundColor: "#450a0a", border: "1px solid #7f1d1d" }}>
            <span>{t.ads_import_error_prefix} {importError}</span>
            <button
              onClick={() => setImportError(null)}
              className="ml-4 text-red-400 hover:text-red-300 font-medium"
            >
              &times;
            </button>
          </div>
        )}

        {/* Recommendations toast */}
        {activeTab === "campaigns" && recsToast && (
          <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg text-sm font-medium text-white shadow-lg"
            style={{ backgroundColor: "#1a1a1a", border: "1px solid #333333" }}>
            {recsToast}
          </div>
        )}

        {/* ── RECOMENDACIONES PENDIENTES ───────────────────────────────────── */}
        {activeTab === "campaigns" && allRecommendations.length > 0 && (
          <div className="rounded-lg overflow-hidden" style={{ backgroundColor: "#111111", border: "1px solid #2d2d00" }}>
            <div className="px-6 py-4 flex items-center gap-2" style={{ borderBottom: "1px solid #2d2d00" }}>
              <span className="text-yellow-400 font-semibold text-sm">
                {t.ads_pending_recommendations}
              </span>
              <span className="px-2 py-0.5 rounded-full text-xs font-bold text-yellow-400" style={{ backgroundColor: "#2d2d00" }}>
                {allRecommendations.reduce((sum, r) => sum + r.recommendations.length, 0)}
              </span>
            </div>
            <div className="divide-y" style={{ borderColor: "#1a1a1a" }}>
              {allRecommendations.map((campRec) =>
                campRec.recommendations.map((rec) => {
                  const isScale = rec.type === "optimizer_scale";
                  const isPause = rec.type === "optimizer_pause";
                  const isFatigued = rec.type === "campaign_fatigued";

                  const emoji = isScale ? "🟢" : isPause ? "🔴" : "🟡";
                  const decisionLabel = isScale ? "SCALE" : isPause ? "PAUSE" : t.ads_fatigued_label;

                  let summary = rec.rationale.slice(0, 100);
                  if (rec.rationale.length > 100) summary += "…";

                  // For scale/pause, add budget info if available
                  if (isScale && rec.budget_current != null && rec.budget_proposed != null) {
                    summary = t.ads_budget_change(rec.budget_current, rec.budget_proposed) + summary;
                  }

                  return (
                    <div key={rec.id} className="px-6 py-4">
                      <div className="flex items-start justify-between flex-wrap gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm font-medium mb-0.5">{campRec.campaign_name}</p>
                          <p className="text-gray-400 text-xs leading-relaxed">
                            <span className="mr-1">{emoji}</span>
                            <span className="font-medium text-gray-300">{decisionLabel}</span>
                            {" — "}
                            {summary}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {(isScale || isPause) && rec.approval_token && (
                            <>
                              <button
                                onClick={() => handleRecApprove(rec, campRec.campaign_id)}
                                className="px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-colors"
                                style={{ backgroundColor: isScale ? "#166534" : "#7f1d1d" }}
                                onMouseEnter={e => (e.currentTarget.style.opacity = "0.85")}
                                onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
                              >
                                {t.ads_confirm}
                              </button>
                              <button
                                onClick={() => handleRecReject(rec, campRec.campaign_id)}
                                className="px-3 py-1.5 text-xs font-medium text-gray-300 rounded-lg transition-colors"
                                style={{ backgroundColor: "#1a1a1a" }}
                                onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#333333")}
                                onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#1a1a1a")}
                              >
                                {t.ads_reject}
                              </button>
                            </>
                          )}
                          <Link
                            href={`/dashboard/ads/${campRec.campaign_id}?project_slug=${selectedSlug}`}
                            className="px-3 py-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors"
                          >
                            {isFatigued ? t.ads_view_brief : t.ads_view_campaign}
                          </Link>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* TEMP: commented for Meta App Review video — uncomment after */}
        {/* ── Competitive Insights card (admin + operator, campaigns tab) ── */}
        {/* {activeTab === "campaigns" && !isClient && (
          competitiveInsights === "empty" || competitiveInsights === null ? (
            <div className="rounded-lg p-5" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
              <p className="text-sm font-semibold text-gray-400 mb-1">{t.ads_competitive_title}</p>
              <p className="text-xs" style={{ color: "#6b7280" }}>
                {t.ads_competitive_empty_desc}
              </p>
            </div>
          ) : competitiveInsights !== null && (
            <div className="rounded-lg overflow-hidden" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
              <div className="px-6 py-4 flex items-start justify-between flex-wrap gap-2" style={{ borderBottom: "1px solid #222222" }}>
                <div>
                  <h3 className="text-base font-semibold text-white">{t.ads_competitive_title}</h3>
                  <p className="text-xs mt-0.5" style={{ color: "#9ca3af" }}>
                    {t.ads_competitive_updated} {new Date(competitiveInsights.generated_at).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" })}
                    {" · "}
                    {t.ads_competitive_ads_analyzed(competitiveInsights.analyzed_ads_count)}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setInsightsPrefillRec(competitiveInsights.brief.weekly_recommendation);
                    setShowCreateModal(true);
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-colors"
                  style={{ backgroundColor: "#7c3aed" }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#6d28d9")}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#7c3aed")}
                >
                  {t.ads_competitive_use_insight}
                </button>
              </div>
              <div className="px-6 py-4 space-y-4">
                {competitiveInsights.brief.hook_patterns?.slice(0, 2).map((hp, i) => (
                  <div key={i}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-white">{hp.pattern}</span>
                      <span className="text-xs" style={{ color: "#9ca3af" }}>{Math.round(hp.frequency * 100)}%</span>
                    </div>
                    <div className="h-1.5 rounded-full" style={{ backgroundColor: "#222222" }}>
                      <div
                        className="h-1.5 rounded-full"
                        style={{ width: `${hp.frequency * 100}%`, backgroundColor: "#7c3aed" }}
                      />
                    </div>
                  </div>
                ))}
                {competitiveInsights.brief.opportunity_gap && (
                  <div className="flex items-start gap-2 px-3 py-2 rounded-md" style={{ backgroundColor: "#2d2300", border: "1px solid #4d3800" }}>
                    <span className="text-amber-400 text-sm">⚡</span>
                    <p className="text-xs text-amber-300">{competitiveInsights.brief.opportunity_gap}</p>
                  </div>
                )}
                {competitiveInsights.brief.weekly_recommendation && (
                  <div className="px-3 py-2 rounded-md" style={{ backgroundColor: "#0d1b2e", border: "1px solid #1e3a5f" }}>
                    <p className="text-xs font-semibold text-blue-400 mb-1">{t.ads_competitive_weekly_rec}</p>
                    <p className="text-xs text-blue-200">{competitiveInsights.brief.weekly_recommendation}</p>
                  </div>
                )}
              </div>
            </div>
          )
        )} */}

        {/* KPI Cards — campaigns tab only */}
        {activeTab === "campaigns" && <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KPICard
            title={t.ads_kpi_spend_month}
            value={`$${((metaTotals as any)?.spend_this_month ?? 0).toFixed(2)}`}
            subtitle="Meta Ads"
          />
          <KPICard
            title={t.ads_kpi_spend_today}
            value={`$${((metaTotals as any)?.spend_today ?? 0).toFixed(2)}`}
            subtitle="Meta Ads"
          />
          <KPICard
            title={t.ads_kpi_active_campaigns}
            value={(metaTotals as any)?.active_campaigns ?? 0}
            subtitle="Meta Ads"
          />
        </div>}

        {/* Spend chart */}
        {activeTab === "campaigns" && spendData.length > 0 && (
          <div className="rounded-lg p-6" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
            <h3 className="text-base font-semibold text-white mb-4">{t.ads_spend_chart_title}</h3>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={spendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#222222" />
                <XAxis dataKey="date" tick={{ fontSize: 12, fill: "#9ca3af" }} />
                <YAxis tick={{ fontSize: 12, fill: "#9ca3af" }} tickFormatter={(v) => `$${v}`} />
                <Tooltip
                  formatter={(v: number) => [`$${v.toFixed(2)}`, "Spend"]}
                  contentStyle={{ backgroundColor: "#1a1a1a", border: "1px solid #333333", borderRadius: "8px", color: "#ffffff" }}
                  labelStyle={{ color: "#9ca3af" }}
                />
                <Line
                  type="monotone"
                  dataKey="spend"
                  stroke="#7c3aed"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Campaigns table */}
        {activeTab === "campaigns" && <div className="rounded-lg overflow-hidden" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
          <div className="px-6 py-4" style={{ borderBottom: "1px solid #222222" }}>
            <h3 className="text-base font-semibold text-white">{t.ads_col_campaigns}</h3>
          </div>
          {loadingData ? (
            <div className="flex items-center justify-center h-40 text-sm" style={{ color: "#9ca3af" }}>
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              {t.ads_loading_campaigns}
            </div>
          ) : campaigns.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-sm" style={{ color: "#9ca3af" }}>
              {t.ads_no_campaigns}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead style={{ backgroundColor: "#111111", borderBottom: "1px solid #222222" }}>
                  <tr>
                    <th className="text-left px-4 py-3 font-medium" style={{ color: "#9ca3af" }}>{t.ads_col_name}</th>
                    <th className="text-left px-4 py-3 font-medium" style={{ color: "#9ca3af" }}>{t.ads_col_objective}</th>
                    <th className="text-left px-4 py-3 font-medium" style={{ color: "#9ca3af" }}>{t.ads_col_status}</th>
                    <th className="text-left px-4 py-3 font-medium" style={{ color: "#9ca3af" }}>{t.ads_col_daily_budget}</th>
                    <th className="text-left px-4 py-3 font-medium" style={{ color: "#9ca3af" }}>{t.ads_col_spend_today}</th>
                    <th className="text-left px-4 py-3 font-medium" style={{ color: "#9ca3af" }}>{t.ads_col_spend_month}</th>
                    <th className="text-left px-4 py-3 font-medium" style={{ color: "#9ca3af" }}>{t.ads_col_kpis}</th>
                    <th className="text-left px-4 py-3 font-medium" style={{ color: "#9ca3af" }}>{t.ads_col_andromeda}</th>
                    <th className="text-left px-4 py-3 font-medium" style={{ color: "#9ca3af" }}>{t.ads_col_detail}</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c, i) => (
                    <tr
                      key={c.id ?? i}
                      onClick={() => { if (!isClient) setSelectedCampaign(c); }}
                      className={`transition-colors ${!isClient ? "cursor-pointer" : ""}`}
                      style={{ borderTop: i > 0 ? "1px solid #1a1a1a" : undefined }}
                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#161616")}
                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                      <td className="px-4 py-3 font-medium text-white max-w-[200px] truncate">
                        {c.name}
                      </td>
                      <td className="px-4 py-3" style={{ color: "#9ca3af" }}>{c.objective ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            CAMPAIGN_STATUS_CLASSES[c.status] ?? "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {c.status}
                        </span>
                      </td>
                      <td className="px-4 py-3" style={{ color: "#9ca3af" }}>
                        {c.daily_budget != null ? `$${c.daily_budget.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-4 py-3" style={{ color: "#9ca3af" }}>
                        {c.spend_today != null ? `$${c.spend_today.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-4 py-3" style={{ color: "#9ca3af" }}>
                        {c.spend_this_month != null ? `$${c.spend_this_month.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: "#9ca3af" }}>
                        {c.objective === "LEADS" || c.objective === "OUTCOME_LEADS" ? (
                          <span>
                            {c.kpis?.leads != null ? `${c.kpis.leads} leads` : "—"}
                            {c.kpis?.cpl != null ? ` · $${c.kpis.cpl.toFixed(2)} CPL` : ""}
                          </span>
                        ) : c.objective === "SALES" || c.objective === "OUTCOME_SALES" ? (
                          <span>
                            {c.kpis?.purchases != null ? `${c.kpis.purchases} sales` : "—"}
                            {c.kpis?.roas != null ? ` · ${c.kpis.roas.toFixed(2)}x ROAS` : ""}
                          </span>
                        ) : c.objective === "TRAFFIC" || c.objective === "OUTCOME_TRAFFIC" ? (
                          <span>
                            {c.kpis?.clicks != null ? `${c.kpis.clicks} clicks` : "—"}
                            {c.kpis?.cpc != null ? ` · $${c.kpis.cpc.toFixed(2)} CPC` : ""}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {c.andromeda_status ? (
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                              ANDROMEDA_STATUS_CLASSES[c.andromeda_status] ?? "bg-gray-800 text-gray-400"
                            }`}
                          >
                            {c.andromeda_status}
                          </span>
                        ) : (
                          <span style={{ color: "#9ca3af" }}>—</span>
                        )}
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <Link
                          href={`/dashboard/ads/${c.id}?project_slug=${selectedSlug}`}
                          className="text-blue-400 hover:text-blue-300 text-xs font-medium"
                        >
                          {t.ads_view_detail}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>}
      </div>

      {/* Modals */}
      {showCreateModal && selectedProject && (
        <CreateCampaignModal
          projectSlug={selectedProject.slug}
          projectId={selectedProject.id}
          prefill={inspirationPrefill}
          contentConfig={projectContentConfig}
          initialContext={insightsPrefillRec}
          onClose={() => { setShowCreateModal(false); setInspirationPrefill(undefined); setInsightsPrefillRec(undefined); }}
          onSuccess={() => {
            setShowCreateModal(false);
            setInspirationPrefill(undefined);
            setInsightsPrefillRec(undefined);
            loadData();
          }}
        />
      )}
      {selectedCampaign && (
        <CampaignOptimizationPanel
          campaign={selectedCampaign}
          onClose={() => setSelectedCampaign(null)}
          onStatusChanged={() => {
            setSelectedCampaign(null);
            loadData();
          }}
        />
      )}
    </div>
  );
}

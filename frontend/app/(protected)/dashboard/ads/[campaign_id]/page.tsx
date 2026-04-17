"use client"
import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import Link from "next/link"
import { Header } from "@/components/layout/Header"
import { useT } from "@/lib/i18n"
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"
import {
  fetchCampaignDetail,
  fetchCampaignRecommendations,
  updateCampaignStatus,
  updateCampaignBudget,
  optimizeCampaign,
  approveOptimizerAction,
  rejectOptimizerAction,
  fetchCampaignAds,
  updateAdCopy,
  updateAdImage,
  type CampaignRecommendation,
  type CampaignRecommendations,
  type CampaignAd,
} from "@/lib/api"
import { Loader2, Copy, Check, X, Upload } from "lucide-react"
import { AuditScoreCard } from "../AuditScoreCard"
import { AuditCheckList } from "../AuditCheckList"
import { CampaignChatPanel } from "@/components/dashboard/CampaignChatPanel"

// ─── Types ───────────────────────────────────────────────────────────────────

interface OptimizationLog {
  id: number
  created_at: string
  decision: string
  rationale: string
  budget_before: number | null
  budget_after: number | null
  approval_status: string
  approval_token?: string
}

interface CampaignDetail {
  campaign: {
    id: number
    meta_campaign_id: string
    name: string
    objective: string
    status: string
    created_at: string
    daily_budget: number
  }
  insights_summary: {
    period: string
    total_spend: number
    total_impressions: number
    total_reach: number
    total_clicks: number
    avg_ctr: number
    avg_cpc: number
    avg_cpm: number
    avg_frequency: number
    total_results: number
    result_label: string
    cost_per_result: number
    roas: number | null
    // Funnel metrics
    leads?: number | null
    landing_page_views?: number | null
    link_clicks?: number | null
    post_reactions?: number | null
    post_saves?: number | null
    comments?: number | null
    video_views?: number | null
    page_engagement?: number | null
    cpl?: number | null
    cost_per_landing_page_view?: number | null
    click_to_lead_rate?: number | null
    landing_page_conversion_rate?: number | null
    cpc_derived?: number | null
    hook_rate?: number | null
    // Sales-specific
    purchases?: number | null
    revenue?: number | null
    cost_per_purchase?: number | null
  }
  daily_insights: Array<{
    date: string
    spend: number
    impressions: number
    clicks: number
    ctr: number
    results: number
    cost_per_result: number
    frequency?: number
    cpc?: number
  }>
  adsets: Array<{
    id: string
    name: string
    status: string
    daily_budget: number
    budget_display?: string
    targeting_summary: string
  }>
  ads: Array<{
    id: string
    name: string
    status: string
    creative_thumbnail: string | null
  }>
  optimization_logs: OptimizationLog[]
  andromeda_status: string
  andromeda_reason: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DATE_PRESET_LABELS: Record<string, string> = {
  last_7d: "Últimos 7 días",
  last_30d: "Últimos 30 días",
  this_month: "Este mes",
}

function fmtPeriod(preset: string): string {
  return DATE_PRESET_LABELS[preset] ?? preset
}

function fmt(n: number | null | undefined, prefix = "$", decimals = 2): string {
  if (n == null) return "—"
  return `${prefix}${n.toFixed(decimals)}`
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso)
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`
  } catch {
    return iso
  }
}

// relativeTime is now built inside the component using t

function filterByDateRange(
  data: CampaignDetail["daily_insights"],
  range: string
): CampaignDetail["daily_insights"] {
  const now = new Date()
  let cutoff: Date
  if (range === "last_7d") {
    cutoff = new Date(now.getTime() - 7 * 86400000)
  } else if (range === "this_month") {
    cutoff = new Date(now.getFullYear(), now.getMonth(), 1)
  } else {
    // last_30d default
    cutoff = new Date(now.getTime() - 30 * 86400000)
  }
  return data.filter((d) => {
    try {
      return new Date(d.date) >= cutoff
    } catch {
      return true
    }
  })
}

// ─── KPI Card ────────────────────────────────────────────────────────────────

function KPICard({ label, value, sub, tooltip }: { label: string; value: string; sub?: string; tooltip?: string }) {
  return (
    <div className="rounded-lg p-4" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
      <div className="flex items-center gap-1 mb-1">
        <p className="text-gray-400 text-xs">{label}</p>
        {tooltip && (
          <span className="relative group cursor-default inline-flex items-center">
            <svg className="w-3 h-3 text-gray-600 hover:text-gray-400 transition-colors" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 px-2 py-1.5 rounded text-xs text-gray-300 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-50 leading-relaxed" style={{ backgroundColor: "#1f2937", border: "1px solid #374151" }}>
              {tooltip}
            </span>
          </span>
        )}
      </div>
      <p className="text-white text-2xl font-bold">{value}</p>
      {sub && <p className="text-gray-500 text-xs mt-1">{sub}</p>}
    </div>
  )
}

// ─── Decision badge ───────────────────────────────────────────────────────────

const DECISION_CLASSES: Record<string, string> = {
  SCALE: "bg-blue-900 text-blue-300",
  PAUSE: "bg-orange-900 text-orange-300",
  KEEP: "bg-[#1a1a1a] text-gray-300",
  MODIFY: "bg-yellow-900 text-yellow-300",
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CampaignDetailPage() {
  const t = useT()
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: session } = useSession()
  const token = (session as { accessToken?: string } | null)?.accessToken ?? ""
  const campaignId = params?.campaign_id as string
  const projectSlug = searchParams?.get("project_slug") ?? ""

  const relativeTime = (iso: string): string => {
    try {
      const diffMs = Date.now() - new Date(iso).getTime()
      const diffDays = Math.floor(diffMs / 86400000)
      if (diffDays === 0) return "today"
      if (diffDays === 1) return "1 day ago"
      return `${diffDays} days ago`
    } catch {
      return iso
    }
  }

  const [detail, setDetail] = useState<CampaignDetail | null>(null)
  // Use local DB id for mutations — campaignId from URL may be a Meta ID (large int
  // that loses JS precision). Once detail loads, localId is always the safe integer.
  const localId = detail?.campaign?.id ?? Number(campaignId)
  const [recommendations, setRecommendations] = useState<CampaignRecommendations | null>(null)
  const [loading, setLoading] = useState(true)
  const [optimizing, setOptimizing] = useState(false)
  const [optimizeModalOpen, setOptimizeModalOpen] = useState(false)
  const [budgetModalOpen, setBudgetModalOpen] = useState(false)
  const [newBudget, setNewBudget] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const [statusChanging, setStatusChanging] = useState(false)
  const [chartMetric, setChartMetric] = useState<"ctr" | "cpc" | "frequency">("ctr")
  const [dateRange, setDateRange] = useState("last_30d")
  const [expandedRationale, setExpandedRationale] = useState<Record<number, boolean>>({})

  // ── Tab state ──────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"overview" | "ads" | "audit" | "chat">("overview")
  const [campaignAds, setCampaignAds] = useState<CampaignAd[]>([])
  const [auditLoaded, setAuditLoaded] = useState(false)
  const [auditId, setAuditId] = useState<number | null>(null)
  const [adsLoading, setAdsLoading] = useState(false)
  const [adsError, setAdsError] = useState<string | null>(null)
  // Per-ad edit state: adId -> { headline, primary_text }
  const [editingAd, setEditingAd] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<{ headline: string; primary_text: string }>({ headline: "", primary_text: "" })
  const [savingAd, setSavingAd] = useState<string | null>(null)
  const [uploadingImageAdId, setUploadingImageAdId] = useState<string | null>(null)

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }

  const loadDetail = useCallback(async () => {
    if (!token || !campaignId) return
    try {
      const [data, recs] = await Promise.all([
        fetchCampaignDetail(token, campaignId, projectSlug, dateRange),
        fetchCampaignRecommendations(token, detail?.campaign?.id ?? Number(campaignId)).catch(() => null),
      ])
      setDetail(data)
      setRecommendations(recs)
      setNewBudget(data?.campaign?.daily_budget ?? 0)
    } catch (e) {
      showToast(t.campaign_detail_toast_load_error)
    } finally {
      setLoading(false)
    }
  }, [token, campaignId, projectSlug, dateRange])

  useEffect(() => {
    loadDetail()
  }, [loadDetail])

  const loadCampaignAds = useCallback(async () => {
    if (!token || !localId) return
    setAdsLoading(true)
    setAdsError(null)
    try {
      const data = await fetchCampaignAds(token, localId)
      setCampaignAds(data)
    } catch {
      setAdsError(t.ads_tab_ads_error)
    } finally {
      setAdsLoading(false)
    }
  }, [token, localId])

  const handleTabChange = (tab: "overview" | "ads" | "audit" | "chat") => {
    setActiveTab(tab)
    if (tab === "ads" && campaignAds.length === 0 && !adsLoading) {
      loadCampaignAds()
    }
    if (tab === "audit") {
      setAuditLoaded(true)
    }
  }

  const handleStartEdit = (ad: CampaignAd) => {
    setEditingAd(ad.id)
    setEditDraft({ headline: ad.headline ?? "", primary_text: ad.primary_text ?? "" })
  }

  const handleCancelEdit = () => {
    setEditingAd(null)
    setEditDraft({ headline: "", primary_text: "" })
  }

  const handleSaveAd = async (ad: CampaignAd) => {
    if (!token) return
    setSavingAd(ad.id)
    try {
      await updateAdCopy(token, localId, ad.id, {
        headline: editDraft.headline || undefined,
        primary_text: editDraft.primary_text || undefined,
      })
      setCampaignAds((prev) =>
        prev.map((a) =>
          a.id === ad.id
            ? { ...a, headline: editDraft.headline || null, primary_text: editDraft.primary_text || null }
            : a
        )
      )
      setEditingAd(null)
      showToast(t.ads_tab_toast_updated)
    } catch {
      showToast(t.ads_tab_toast_error)
    } finally {
      setSavingAd(null)
    }
  }

  const handleImageChange = async (ad: CampaignAd, file: File) => {
    if (!token) return
    setUploadingImageAdId(ad.id)
    try {
      const result = await updateAdImage(token, localId, ad.id, file)
      setCampaignAds(prev => prev.map(a => a.id === ad.id ? { ...a, image_url: result.image_url } : a))
      showToast(t.ads_tab_toast_image_updated)
    } catch {
      showToast(t.ads_tab_toast_image_error)
    } finally {
      setUploadingImageAdId(null)
    }
  }

  const handleOptimizeConfirm = async () => {
    setOptimizeModalOpen(false)
    if (!token) return
    setOptimizing(true)
    try {
      const result = await optimizeCampaign(localId, token)
      showToast(t.campaign_detail_toast_analysis(result.decision || ""))
      const fresh = await fetchCampaignDetail(token, campaignId)
      setDetail(fresh)
    } catch {
      showToast(t.campaign_detail_toast_optimize_error)
    } finally {
      setOptimizing(false)
    }
  }

  const handleStatusChange = async (status: string) => {
    setStatusChanging(true)
    try {
      await updateCampaignStatus(localId, status as "active" | "paused", token)
      const fresh = await fetchCampaignDetail(token, campaignId)
      setDetail(fresh)
      showToast(status === "paused" ? t.campaign_detail_toast_paused : t.campaign_detail_toast_activated)
    } catch {
      showToast(t.campaign_detail_toast_status_error)
    } finally {
      setStatusChanging(false)
    }
  }

  const handleBudgetUpdate = async () => {
    try {
      await updateCampaignBudget(token, localId, newBudget)
      setBudgetModalOpen(false)
      const fresh = await fetchCampaignDetail(token, campaignId)
      setDetail(fresh)
      showToast(t.campaign_detail_toast_budget_updated(newBudget))
    } catch {
      showToast(t.campaign_detail_toast_budget_error)
    }
  }

  const handleApprove = async (log: OptimizationLog) => {
    if (!log.approval_token) return
    try {
      await approveOptimizerAction(token, log.approval_token)
      const fresh = await fetchCampaignDetail(token, campaignId)
      setDetail(fresh)
      showToast(t.campaign_detail_toast_approved)
    } catch {
      showToast(t.campaign_detail_toast_approve_error)
    }
  }

  const handleReject = async (log: OptimizationLog) => {
    if (!log.approval_token) return
    try {
      await rejectOptimizerAction(token, log.approval_token)
      const fresh = await fetchCampaignDetail(token, campaignId)
      setDetail(fresh)
      showToast(t.campaign_detail_toast_rejected)
    } catch {
      showToast(t.campaign_detail_toast_reject_error)
    }
  }

  const handleRecommendationApprove = async (rec: CampaignRecommendation) => {
    if (!rec.approval_token) return
    // Optimistic: remove card immediately
    setRecommendations((prev) =>
      prev
        ? { ...prev, recommendations: prev.recommendations.filter((r) => r.id !== rec.id), has_pending: prev.recommendations.length > 1 }
        : prev
    )
    try {
      await approveOptimizerAction(token, rec.approval_token)
      showToast(t.campaign_detail_toast_approved)
      loadDetail()
    } catch {
      showToast(t.campaign_detail_toast_approve_error)
      loadDetail()
    }
  }

  const handleRecommendationReject = async (rec: CampaignRecommendation) => {
    if (!rec.approval_token) return
    // Optimistic: remove card immediately
    setRecommendations((prev) =>
      prev
        ? { ...prev, recommendations: prev.recommendations.filter((r) => r.id !== rec.id), has_pending: prev.recommendations.length > 1 }
        : prev
    )
    try {
      await rejectOptimizerAction(token, rec.approval_token)
      showToast(t.campaign_detail_toast_rejected)
      loadDetail()
    } catch {
      showToast(t.campaign_detail_toast_reject_error)
      loadDetail()
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => showToast(t.campaign_detail_toast_copied))
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen text-white">
        <Header title={t.campaign_detail_title} />
        <div className="flex items-center justify-center py-32">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="min-h-screen text-white">
        <Header title={t.campaign_detail_title} />
        <div className="flex items-center justify-center py-32">
          <p className="text-gray-400">{t.campaign_detail_not_found}</p>
        </div>
      </div>
    )
  }

  const ins = detail.insights_summary
  const objective = detail.campaign.objective

  // ── KPI grid based on objective ────────────────────────────────────────────
  const hasEngagement = (ins.post_reactions ?? 0) > 0 || (ins.comments ?? 0) > 0 || (ins.post_saves ?? 0) > 0 || (ins.video_views ?? 0) > 0 || (ins.page_engagement ?? 0) > 0

  // ── Attribution tooltips ───────────────────────────────────────────────────
  const TT_SPEND = "Dato de Meta Ads API · Actualización ~1h · Período seleccionado en el toggle superior"
  const TT_CONVERSIONS = "Dato de Meta Ads API · Ventana: 7 días clic + 1 día vista · Puede diferir del Ads Manager si tu cuenta usa una ventana de atribución personalizada"
  const TT_ROAS = "Dato de Meta Ads API · Ventana: 7 días clic + 1 día vista · Puede diferir del Ads Manager si tu cuenta usa una ventana de atribución personalizada"
  const TT_REACH = "Dato de Meta Ads API · Actualización ~1h"

  let kpiRows: React.ReactNode
  if (objective === "OUTCOME_LEADS") {
    kpiRows = (
      <div className="space-y-4">
        {/* Row 1 — main metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <KPICard label={t.campaign_detail_kpi_total_spent} value={fmt(ins.total_spend)} sub={fmtPeriod(ins.period)} tooltip={TT_SPEND} />
          <KPICard label={t.campaign_detail_kpi_leads} value={ins.leads != null ? String(ins.leads) : String(ins.total_results ?? "—")} sub={ins.result_label} tooltip={TT_CONVERSIONS} />
          <KPICard label={t.campaign_detail_kpi_cost_lead} value={ins.cpl != null ? fmt(ins.cpl) : fmt(ins.cost_per_result)} tooltip={TT_CONVERSIONS} />
          <KPICard label={t.campaign_detail_kpi_ctr} value={ins.avg_ctr != null ? `${ins.avg_ctr.toFixed(2)}%` : "—"} />
          <KPICard label={t.campaign_detail_kpi_frequency} value={ins.avg_frequency != null ? ins.avg_frequency.toFixed(2) : "—"} />
          <KPICard label={t.campaign_detail_kpi_reach} value={ins.total_reach != null ? ins.total_reach.toLocaleString() : "—"} tooltip={TT_REACH} />
        </div>
        {/* Row 2 — funnel (only if data exists) */}
        {(ins.landing_page_views != null || ins.click_to_lead_rate != null || ins.landing_page_conversion_rate != null || ins.cpc_derived != null) && (
          <div>
            <p className="text-gray-500 text-xs mb-2 uppercase tracking-wider">{t.campaign_detail_section_funnel}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {ins.landing_page_views != null && (
                <KPICard label={t.campaign_detail_kpi_landing_views} value={ins.landing_page_views.toLocaleString()} />
              )}
              {ins.click_to_lead_rate != null && (
                <KPICard label={t.campaign_detail_kpi_click_to_lead} value={`${ins.click_to_lead_rate.toFixed(1)}%`} sub={t.campaign_detail_kpi_click_to_lead_sub} />
              )}
              {ins.landing_page_conversion_rate != null && (
                <KPICard label={t.campaign_detail_kpi_conv_landing} value={`${ins.landing_page_conversion_rate.toFixed(1)}%`} sub={t.campaign_detail_kpi_conv_landing_sub} />
              )}
              {ins.cpc_derived != null && (
                <KPICard label={t.campaign_detail_kpi_cpc_link} value={fmt(ins.cpc_derived)} />
              )}
              {ins.hook_rate != null && (
                <KPICard label={t.campaign_detail_kpi_hook_rate} value={`${ins.hook_rate.toFixed(1)}%`} sub={t.campaign_detail_kpi_hook_rate_sub} />
              )}
              {ins.cost_per_landing_page_view != null && (
                <KPICard label={t.campaign_detail_kpi_cost_landing} value={fmt(ins.cost_per_landing_page_view)} />
              )}
            </div>
          </div>
        )}
        {/* Row 3 — engagement (only if any > 0) */}
        {hasEngagement && (
          <div>
            <p className="text-gray-500 text-xs mb-2 uppercase tracking-wider">{t.campaign_detail_section_engagement}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              {ins.post_reactions != null && <KPICard label={t.campaign_detail_kpi_reactions} value={ins.post_reactions.toLocaleString()} />}
              {ins.comments != null && <KPICard label={t.campaign_detail_kpi_comments} value={ins.comments.toLocaleString()} />}
              {ins.post_saves != null && <KPICard label={t.campaign_detail_kpi_saves} value={ins.post_saves.toLocaleString()} />}
              {ins.video_views != null && <KPICard label={t.campaign_detail_kpi_video_views} value={ins.video_views.toLocaleString()} />}
              {ins.page_engagement != null && <KPICard label={t.campaign_detail_kpi_page_engagement} value={ins.page_engagement.toLocaleString()} />}
            </div>
          </div>
        )}
      </div>
    )
  } else if (objective === "OUTCOME_SALES") {
    kpiRows = (
      <div className="space-y-4">
        {/* Row 1 */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <KPICard label={t.campaign_detail_kpi_total_spent} value={fmt(ins.total_spend)} sub={fmtPeriod(ins.period)} tooltip={TT_SPEND} />
          <KPICard label={t.campaign_detail_kpi_roas} value={ins.roas != null ? `${ins.roas.toFixed(2)}x` : "—"} sub={t.campaign_detail_kpi_roas_sub} tooltip={TT_ROAS} />
          <KPICard label={t.campaign_detail_kpi_purchases} value={ins.purchases != null ? String(ins.purchases) : String(ins.total_results ?? "—")} sub={ins.result_label} tooltip={TT_CONVERSIONS} />
          <KPICard label={t.campaign_detail_kpi_cpa} value={ins.cost_per_purchase != null ? fmt(ins.cost_per_purchase) : fmt(ins.cost_per_result)} tooltip={TT_CONVERSIONS} />
          <KPICard label={t.campaign_detail_kpi_ctr} value={ins.avg_ctr != null ? `${ins.avg_ctr.toFixed(2)}%` : "—"} />
          <KPICard label={t.campaign_detail_kpi_frequency} value={ins.avg_frequency != null ? ins.avg_frequency.toFixed(2) : "—"} />
        </div>
        {/* Row 2 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {ins.revenue != null && <KPICard label={t.campaign_detail_kpi_revenue} value={fmt(ins.revenue)} tooltip={TT_CONVERSIONS} />}
          {ins.cpl != null && <KPICard label={t.campaign_detail_kpi_cpl} value={fmt(ins.cpl)} />}
          {ins.landing_page_views != null && <KPICard label={t.campaign_detail_kpi_landing_views} value={ins.landing_page_views.toLocaleString()} />}
          {ins.click_to_lead_rate != null && (
            <KPICard label={t.campaign_detail_kpi_click_to_purchase} value={`${ins.click_to_lead_rate.toFixed(1)}%`} sub={t.campaign_detail_kpi_click_to_purchase_sub} />
          )}
        </div>
        {/* Row 3 — engagement */}
        {hasEngagement && (
          <div>
            <p className="text-gray-500 text-xs mb-2 uppercase tracking-wider">{t.campaign_detail_section_engagement}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              {ins.post_reactions != null && <KPICard label={t.campaign_detail_kpi_reactions} value={ins.post_reactions.toLocaleString()} />}
              {ins.comments != null && <KPICard label={t.campaign_detail_kpi_comments} value={ins.comments.toLocaleString()} />}
              {ins.post_saves != null && <KPICard label={t.campaign_detail_kpi_saves} value={ins.post_saves.toLocaleString()} />}
              {ins.video_views != null && <KPICard label={t.campaign_detail_kpi_video_views} value={ins.video_views.toLocaleString()} />}
              {ins.page_engagement != null && <KPICard label={t.campaign_detail_kpi_page_engagement} value={ins.page_engagement.toLocaleString()} />}
            </div>
          </div>
        )}
      </div>
    )
  } else {
    // OUTCOME_TRAFFIC or other
    kpiRows = (
      <div className="space-y-4">
        {/* Row 1 */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <KPICard label={t.campaign_detail_kpi_total_spent} value={fmt(ins.total_spend)} sub={fmtPeriod(ins.period)} tooltip={TT_SPEND} />
          <KPICard label={t.campaign_detail_kpi_clicks} value={ins.link_clicks != null ? ins.link_clicks.toLocaleString() : ins.total_clicks != null ? ins.total_clicks.toLocaleString() : "—"} />
          <KPICard label={t.campaign_detail_kpi_cpc} value={ins.cpc_derived != null ? fmt(ins.cpc_derived) : fmt(ins.avg_cpc)} />
          <KPICard label={t.campaign_detail_kpi_ctr} value={ins.avg_ctr != null ? `${ins.avg_ctr.toFixed(2)}%` : "—"} />
          <KPICard label={t.campaign_detail_kpi_reach} value={ins.total_reach != null ? ins.total_reach.toLocaleString() : "—"} tooltip={TT_REACH} />
          <KPICard label={t.campaign_detail_kpi_cpm} value={fmt(ins.avg_cpm)} />
        </div>
        {/* Row 2 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {ins.landing_page_views != null && <KPICard label={t.campaign_detail_kpi_landing_views} value={ins.landing_page_views.toLocaleString()} />}
          {ins.hook_rate != null && <KPICard label={t.campaign_detail_kpi_hook_rate} value={`${ins.hook_rate.toFixed(1)}%`} sub={t.campaign_detail_kpi_hook_rate_sub} />}
          {ins.post_reactions != null && <KPICard label={t.campaign_detail_kpi_reactions} value={ins.post_reactions.toLocaleString()} />}
          {ins.post_saves != null && <KPICard label={t.campaign_detail_kpi_saves} value={ins.post_saves.toLocaleString()} />}
          {ins.video_views != null && <KPICard label={t.campaign_detail_kpi_video_views} value={ins.video_views.toLocaleString()} />}
        </div>
      </div>
    )
  }

  const filteredInsights = filterByDateRange(detail.daily_insights ?? [], dateRange)

  const chartData = filteredInsights.map((d) => ({
    ...d,
    dateLabel: fmtDate(d.date),
    ctrPct: d.ctr != null ? Number((d.ctr * 100).toFixed(2)) : null,
  }))

  const metricKey =
    chartMetric === "ctr" ? "ctrPct" : chartMetric === "cpc" ? "cpc" : "frequency"
  const metricLabel =
    chartMetric === "ctr" ? "CTR %" : chartMetric === "cpc" ? "CPC $" : t.campaign_detail_chart_frequency

  return (
    <div className="min-h-screen text-white">
      <Header title={t.campaign_detail_title} />
      <div className="p-6 space-y-6 max-w-[1400px] mx-auto">

        {/* ── ACTIVE RECOMMENDATIONS ──────────────────────────────────────── */}
        {recommendations?.has_pending && recommendations.recommendations.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-white font-semibold text-base">{t.campaign_detail_active_recs}</h2>
            {recommendations.recommendations.map((rec) => {
              const isScale = rec.type === "optimizer_scale"
              const isPause = rec.type === "optimizer_pause"
              const isFatigued = rec.type === "campaign_fatigued"

              const headerColor = isScale
                ? "text-green-400"
                : isPause
                ? "text-red-400"
                : "text-yellow-400"

              const headerLabel = isScale
                ? t.campaign_detail_rec_scale
                : isPause
                ? t.campaign_detail_rec_pause
                : t.campaign_detail_rec_fatigued

              const borderColor = isScale
                ? "#166534"
                : isPause
                ? "#7f1d1d"
                : "#713f12"

              const bgColor = isScale
                ? "#052e16"
                : isPause
                ? "#450a0a"
                : "#1c1200"

              const brief = rec.creative_brief
              const m = rec.metrics

              return (
                <div
                  key={rec.id}
                  className="rounded-xl p-4 space-y-3"
                  style={{ backgroundColor: bgColor, border: `1px solid ${borderColor}` }}
                >
                  {/* Header row */}
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className={`font-semibold text-sm ${headerColor}`}>{headerLabel}</span>
                    <span className="text-gray-500 text-xs">{relativeTime(rec.created_at)}</span>
                  </div>

                  {/* Rationale */}
                  <p className="text-gray-200 text-sm leading-relaxed">{rec.rationale}</p>

                  {/* Budget info (SCALE) */}
                  {isScale && rec.budget_current != null && rec.budget_proposed != null && (
                    <div className="text-sm">
                      <span className="text-gray-400">{t.campaign_detail_rec_current_budget} </span>
                      <span className="text-white font-medium">{t.campaign_detail_per_day(rec.budget_current)}</span>
                      <span className="text-gray-400"> {t.campaign_detail_rec_proposed_budget} </span>
                      <span className="text-green-400 font-medium">{t.campaign_detail_per_day(rec.budget_proposed)}</span>
                      {rec.budget_current > 0 && (
                        <span className="text-green-500 text-xs ml-1">
                          (+{(((rec.budget_proposed - rec.budget_current) / rec.budget_current) * 100).toFixed(0)}%)
                        </span>
                      )}
                    </div>
                  )}

                  {/* Warning (PAUSE) */}
                  {isPause && (
                    <p className="text-orange-300 text-xs">{t.campaign_detail_rec_pause_warning}</p>
                  )}

                  {/* Metrics */}
                  {m && Object.keys(m).length > 0 && (
                    <div className="rounded-lg p-3 space-y-1" style={{ backgroundColor: "#0a0a0a" }}>
                      <p className="text-gray-400 text-xs font-medium mb-2">
                        {isFatigued ? t.campaign_detail_rec_fatigue_metrics : t.campaign_detail_rec_metrics_7d}
                      </p>
                      {isFatigued ? (
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-300">
                          {m.ctr_current != null && (
                            <span>
                              {t.campaign_detail_rec_ctr_label} <span className="text-white">{m.ctr_current.toFixed(2)}%</span>
                              {m.ctr_7d_ago != null && (
                                <span className="text-gray-500"> ({t.campaign_detail_rec_ctr_was(m.ctr_7d_ago)}</span>
                              )}
                              {m.ctr_drop_pct != null && (
                                <span className="text-red-400">{t.campaign_detail_rec_dropped(m.ctr_drop_pct)}</span>
                              )}
                            </span>
                          )}
                          {m.frequency != null && (
                            <span>{t.campaign_detail_rec_freq_label} <span className="text-white">{m.frequency.toFixed(1)}</span></span>
                          )}
                          {m.cost_per_result != null && (
                            <span>{t.campaign_detail_rec_cost_result} <span className="text-white">${m.cost_per_result.toFixed(2)}</span></span>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-300">
                          {m.ctr != null && <span>{t.campaign_detail_rec_ctr_label} <span className="text-white">{m.ctr.toFixed(2)}%</span></span>}
                          {m.cpl != null && <span>{t.campaign_detail_rec_cpl_label} <span className="text-white">${m.cpl.toFixed(2)}</span></span>}
                          {m.frequency != null && <span>{t.campaign_detail_rec_freq_label} <span className="text-white">{m.frequency.toFixed(1)}</span></span>}
                          {m.spend != null && <span>{t.campaign_detail_rec_spend_label} <span className="text-white">${m.spend.toFixed(2)}</span></span>}
                          {m.days_running != null && <span>{t.campaign_detail_rec_days_running} <span className="text-white">{m.days_running}</span></span>}
                          {m.impressions != null && <span>{t.campaign_detail_rec_impressions} <span className="text-white">{m.impressions.toLocaleString()}</span></span>}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Creative brief (FATIGUED) */}
                  {isFatigued && brief && (
                    <div className="rounded-lg p-3 space-y-2" style={{ backgroundColor: "#0a0a0a", border: "1px solid #1a1a1a" }}>
                      <p className="text-yellow-400 text-xs font-medium">{t.campaign_detail_rec_brief_title}</p>
                      {brief.angle && (
                        <p className="text-xs text-gray-300">
                          <span className="text-gray-500">{t.campaign_detail_rec_angle} </span>{brief.angle}
                        </p>
                      )}
                      {brief.replacement_persona && (
                        <p className="text-xs text-gray-300">
                          <span className="text-gray-500">{t.campaign_detail_rec_persona} </span>{brief.replacement_persona}
                        </p>
                      )}
                      {brief.suggested_hook && (
                        <div className="flex items-start gap-2">
                          <p className="text-xs text-gray-300 flex-1">
                            <span className="text-gray-500">{t.campaign_detail_rec_hook} </span>
                            <span className="italic">"{brief.suggested_hook}"</span>
                          </p>
                          <button
                            onClick={() => copyToClipboard(brief.suggested_hook!)}
                            className="flex-shrink-0 p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-white"
                            title={t.campaign_detail_rec_hook}
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                      {brief.suggested_body && (
                        <div className="flex items-start gap-2">
                          <p className="text-xs text-gray-300 flex-1">
                            <span className="text-gray-500">{t.campaign_detail_rec_copy} </span>
                            <span className="italic">"{brief.suggested_body}"</span>
                          </p>
                          <button
                            onClick={() => copyToClipboard(brief.suggested_body!)}
                            className="flex-shrink-0 p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-white"
                            title={t.campaign_detail_rec_copy}
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                      {brief.visual_direction && (
                        <p className="text-xs text-gray-300">
                          <span className="text-gray-500">{t.campaign_detail_rec_visual} </span>{brief.visual_direction}
                        </p>
                      )}
                      {brief.what_to_avoid && (
                        <p className="text-xs text-gray-300">
                          <span className="text-gray-500">{t.campaign_detail_rec_avoid} </span>{brief.what_to_avoid}
                        </p>
                      )}
                      {(brief.urgency_level || brief.urgency_reason) && (
                        <p className="text-xs text-yellow-300">
                          {t.campaign_detail_rec_urgency} <span className="font-semibold">{brief.urgency_level ?? ""}</span>
                          {brief.urgency_reason && <span className="text-gray-400"> — {brief.urgency_reason}</span>}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Action buttons (SCALE / PAUSE only) */}
                  {(isScale || isPause) && rec.approval_token && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleRecommendationApprove(rec)}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors text-white"
                        style={{ backgroundColor: isScale ? "#166534" : "#7f1d1d" }}
                        onMouseEnter={e => (e.currentTarget.style.opacity = "0.85")}
                        onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
                      >
                        {isScale ? t.campaign_detail_confirm_scale : t.campaign_detail_confirm_pause}
                      </button>
                      <button
                        onClick={() => handleRecommendationReject(rec)}
                        className="px-3 py-1.5 text-xs font-medium text-gray-300 rounded-lg transition-colors"
                        style={{ backgroundColor: "#1a1a1a" }}
                        onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#333333")}
                        onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#1a1a1a")}
                      >
                        {t.campaign_detail_reject}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* ── HEADER ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <Link
              href="/dashboard/ads"
              className="text-gray-400 hover:text-white flex items-center gap-1 text-sm"
            >
              {t.campaign_detail_back}
            </Link>
            <h1 className="text-2xl font-bold text-white">{detail.campaign.name}</h1>
            <span
              className={`px-2 py-1 rounded text-xs font-semibold ${
                detail.campaign.status === "ACTIVE"
                  ? "bg-green-900 text-green-300"
                  : "bg-[#1a1a1a] text-gray-300"
              }`}
            >
              {detail.campaign.status}
            </span>
            <span className="px-2 py-1 rounded text-xs font-semibold bg-blue-900 text-blue-300">
              {detail.campaign.objective.replace("OUTCOME_", "")}
            </span>
            {detail.campaign.daily_budget > 0 && (
              <span className="px-2 py-1 rounded text-xs font-semibold bg-[#1a1a1a] text-gray-300">
                {t.campaign_detail_per_day(detail.campaign.daily_budget)}
              </span>
            )}
            <span
              title={detail.andromeda_reason}
              className={`px-2 py-1 rounded text-xs font-semibold cursor-help ${
                detail.andromeda_status === "healthy"
                  ? "bg-emerald-900 text-emerald-300"
                  : "bg-orange-900 text-orange-300"
              }`}
            >
              {t.campaign_detail_andromeda} {detail.andromeda_status}
            </span>
          </div>

          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setOptimizeModalOpen(true)}
              disabled={optimizing}
              className="px-3 py-1.5 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white text-sm rounded"
            >
              {optimizing ? t.campaign_detail_optimizing : t.campaign_detail_optimize_btn}
            </button>
            {detail.campaign.status === "ACTIVE" ? (
              <button
                onClick={() => handleStatusChange("paused")}
                disabled={statusChanging}
                className="px-3 py-1.5 text-yellow-400 text-sm rounded border border-yellow-800 disabled:opacity-50 flex items-center gap-1.5"
                style={{ backgroundColor: "rgba(113,63,18,0.3)" }}
              >
                {statusChanging ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                {t.campaign_detail_pause_btn}
              </button>
            ) : (
              <button
                onClick={() => handleStatusChange("active")}
                disabled={statusChanging}
                className="px-3 py-1.5 text-green-400 text-sm rounded border border-green-800 disabled:opacity-50 flex items-center gap-1.5"
                style={{ backgroundColor: "rgba(5,46,22,0.5)" }}
              >
                {statusChanging ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                {t.campaign_detail_activate_btn}
              </button>
            )}
            <button
              onClick={() => setBudgetModalOpen(true)}
              className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white text-sm rounded"
            >
              {t.campaign_detail_budget_btn}
            </button>
          </div>
        </div>

        {/* ── TAB BAR ─────────────────────────────────────────────────────── */}
        <div className="flex gap-1 border-b" style={{ borderColor: "#222222" }}>
          {(["overview", "ads", "audit"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => handleTabChange(tab)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "text-white border-b-2 border-indigo-500"
                  : "text-gray-400 hover:text-white"
              }`}
              style={{ marginBottom: "-1px" }}
            >
              {tab === "overview" ? "Overview" : tab === "ads" ? t.ads_tab_ads : t.ads_tab_audit}
            </button>
          ))}
          {session?.user?.role === "super_admin" && (
            <button
              onClick={() => handleTabChange("chat")}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === "chat"
                  ? "text-white border-b-2 border-indigo-500"
                  : "text-gray-400 hover:text-white"
              }`}
              style={{ marginBottom: "-1px" }}
            >
              Chat
            </button>
          )}
        </div>

        {/* ── ADS TAB ─────────────────────────────────────────────────────── */}
        {activeTab === "ads" && (
          <div className="space-y-4">
            {adsLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                <span className="ml-2 text-gray-400 text-sm">{t.ads_tab_ads_loading}</span>
              </div>
            ) : adsError ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <p className="text-red-400 text-sm">{adsError}</p>
                <button
                  onClick={loadCampaignAds}
                  className="px-3 py-1.5 text-xs bg-indigo-700 hover:bg-indigo-600 text-white rounded"
                >
                  Retry
                </button>
              </div>
            ) : campaignAds.length === 0 ? (
              <p className="text-gray-500 text-sm py-12 text-center">{t.ads_tab_ads_empty}</p>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {campaignAds.map((ad) => {
                  const isEditing = editingAd === ad.id
                  const isSaving = savingAd === ad.id
                  return (
                    <div
                      key={ad.id}
                      className="rounded-lg p-4 space-y-4"
                      style={{ backgroundColor: "#111111", border: "1px solid #222222" }}
                    >
                      {/* Image area */}
                      <div className="relative w-full h-32 rounded-md overflow-hidden bg-gray-900 group/img">
                        {ad.image_url ? (
                          <img src={ad.image_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs">No image</div>
                        )}
                        {/* Overlay on hover */}
                        <label
                          className={`absolute inset-0 flex flex-col items-center justify-center gap-1 cursor-pointer transition-opacity
                            ${uploadingImageAdId === ad.id ? 'opacity-100 bg-black/60' : 'opacity-0 group-hover/img:opacity-100 bg-black/50'}`}
                        >
                          {uploadingImageAdId === ad.id ? (
                            <Loader2 className="h-5 w-5 animate-spin text-white" />
                          ) : (
                            <>
                              <Upload className="h-5 w-5 text-white" />
                              <span className="text-white text-xs">{t.ads_tab_change_image}</span>
                            </>
                          )}
                          <input
                            type="file"
                            accept="image/jpeg,image/png"
                            className="hidden"
                            disabled={uploadingImageAdId !== null}
                            onChange={(e) => {
                              const file = e.target.files?.[0]
                              if (file) handleImageChange(ad, file)
                              e.target.value = ""
                            }}
                          />
                        </label>
                      </div>

                      {/* Ad name */}
                      <p className="text-white font-semibold text-sm truncate" title={ad.name}>{ad.name}</p>

                      {/* Headline field */}
                      <div className="space-y-1">
                        <p className="text-gray-500 text-xs uppercase tracking-wider">{t.ads_tab_headline_label}</p>
                        {isEditing ? (
                          <input
                            type="text"
                            value={editDraft.headline}
                            onChange={(e) => setEditDraft((prev) => ({ ...prev, headline: e.target.value }))}
                            disabled={isSaving}
                            className="w-full text-white text-sm px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-indigo-600 disabled:opacity-50"
                            style={{ backgroundColor: "#1a1a1a", border: "1px solid #333333" }}
                            placeholder={t.ads_tab_headline_label}
                          />
                        ) : (
                          <p className="text-gray-200 text-sm leading-relaxed">
                            {ad.headline ?? <span className="text-gray-500 italic">{t.ads_tab_no_value}</span>}
                          </p>
                        )}
                      </div>

                      {/* Primary text field */}
                      <div className="space-y-1">
                        <p className="text-gray-500 text-xs uppercase tracking-wider">{t.ads_tab_primary_text_label}</p>
                        {isEditing ? (
                          <textarea
                            value={editDraft.primary_text}
                            onChange={(e) => setEditDraft((prev) => ({ ...prev, primary_text: e.target.value }))}
                            disabled={isSaving}
                            rows={4}
                            className="w-full text-white text-sm px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-indigo-600 disabled:opacity-50 resize-none"
                            style={{ backgroundColor: "#1a1a1a", border: "1px solid #333333" }}
                            placeholder={t.ads_tab_primary_text_label}
                          />
                        ) : (
                          <p className="text-gray-200 text-sm leading-relaxed whitespace-pre-wrap">
                            {ad.primary_text ?? <span className="text-gray-500 italic">{t.ads_tab_no_value}</span>}
                          </p>
                        )}
                      </div>

                      {/* Edit link / action buttons */}
                      {!isEditing ? (
                        <button
                          onClick={() => handleStartEdit(ad)}
                          className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                        >
                          {t.ads_tab_edit}
                        </button>
                      ) : (
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={() => handleSaveAd(ad)}
                            disabled={isSaving}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white rounded disabled:opacity-50 transition-colors"
                            style={{ backgroundColor: "#166534" }}
                          >
                            {isSaving ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Check className="h-3.5 w-3.5" />
                            )}
                            {t.ads_tab_save}
                          </button>
                          <button
                            onClick={handleCancelEdit}
                            disabled={isSaving}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-300 rounded disabled:opacity-50 transition-colors"
                            style={{ backgroundColor: "#1a1a1a" }}
                          >
                            <X className="h-3.5 w-3.5" />
                            {t.ads_tab_cancel}
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── AUDIT TAB ───────────────────────────────────────────────────── */}
        {activeTab === "audit" && auditLoaded && projectSlug && (
          <div className="space-y-6 pt-4">
            <AuditScoreCard
              projectSlug={projectSlug}
              campaignId={localId}
              onAuditCompleted={(id) => setAuditId(id)}
            />
            {auditId && <AuditCheckList auditId={auditId} />}
          </div>
        )}
        {activeTab === "audit" && auditLoaded && !projectSlug && (
          <div className="py-16 text-center text-sm" style={{ color: "#9ca3af" }}>
            Project context is required to run an audit. Navigate to this campaign from the campaigns list.
          </div>
        )}

        {/* ── CHAT TAB ────────────────────────────────────────────────────── */}
        {activeTab === "chat" && projectSlug && (
          <div className="pt-4">
            <CampaignChatPanel
              projectSlug={projectSlug}
              preselectedCampaignId={localId}
            />
          </div>
        )}
        {activeTab === "chat" && !projectSlug && (
          <div className="py-16 text-center text-sm" style={{ color: "#9ca3af" }}>
            Project context is required to use Campaign Chat. Navigate to this campaign from the campaigns list.
          </div>
        )}

        {/* ── DATE RANGE TOGGLE ───────────────────────────────────────────── */}
        {activeTab === "overview" && (
          <div className="flex items-center gap-2 mb-6">
            <span className="text-gray-400 text-sm">{t.campaign_detail_period}</span>
            {(["last_7d", "last_30d", "this_month"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setDateRange(r)}
                className={`px-3 py-1 text-xs rounded ${
                  dateRange === r
                    ? "text-white"
                    : "text-gray-400 hover:text-white"
                }`}
                style={{ backgroundColor: dateRange === r ? "#333333" : "#111111" }}
              >
                {r === "last_7d" ? t.campaign_detail_range_7d : r === "last_30d" ? t.campaign_detail_range_30d : t.campaign_detail_range_month}
              </button>
            ))}
          </div>
        )}

        {/* ── ATTRIBUTION NOTE ────────────────────────────────────────────── */}
        {activeTab === "overview" && (
          <p className="text-xs mb-4" style={{ color: "#6b7280" }}>
            Los datos provienen de Meta Ads API · Ventana de atribución: 7 días clic + 1 día vista · Pequeñas diferencias con el Ads Manager son normales (zona horaria de reporte, ventana configurada a nivel cuenta, actualización ~1h).
          </p>
        )}

        {/* ── KPI CARDS ───────────────────────────────────────────────────── */}
        {activeTab === "overview" && kpiRows}

        {/* ── CHARTS ──────────────────────────────────────────────────────── */}
        {activeTab === "overview" && <div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Left — Daily Spend */}
            <div className="rounded-lg p-4" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
              <h3 className="text-white font-semibold mb-4 text-sm">{t.campaign_detail_chart_daily_spend}</h3>
              {chartData.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-10">{t.campaign_detail_no_data}</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="dateLabel" tick={{ fontSize: 11, fill: "#9ca3af" }} />
                    <YAxis
                      tick={{ fontSize: 11, fill: "#9ca3af" }}
                      tickFormatter={(v) => `$${v}`}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", color: "#fff" }}
                      formatter={(v: number) => [`$${v.toFixed(2)}`, t.campaign_detail_chart_spend_label]}
                    />
                    <Line
                      type="monotone"
                      dataKey="spend"
                      stroke="#818cf8"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Right — Daily Performance */}
            <div className="rounded-lg p-4" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-semibold text-sm">{t.campaign_detail_chart_daily_perf}</h3>
                <div className="flex gap-1">
                  {(["ctr", "cpc", "frequency"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setChartMetric(m)}
                      className={`px-2 py-0.5 text-xs rounded ${
                        chartMetric === m
                          ? "bg-indigo-700 text-white"
                          : "text-gray-400 hover:text-white"
                      }`}
                      style={chartMetric !== m ? { backgroundColor: "#1a1a1a" } : undefined}
                    >
                      {m === "ctr" ? "CTR" : m === "cpc" ? "CPC" : t.campaign_detail_chart_frequency}
                    </button>
                  ))}
                </div>
              </div>
              {chartData.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-10">{t.campaign_detail_no_data}</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="dateLabel" tick={{ fontSize: 11, fill: "#9ca3af" }} />
                    <YAxis
                      yAxisId="left"
                      tick={{ fontSize: 11, fill: "#9ca3af" }}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tick={{ fontSize: 11, fill: "#9ca3af" }}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", color: "#fff" }}
                    />
                    <Legend wrapperStyle={{ fontSize: "11px", color: "#9ca3af" }} />
                    <Bar yAxisId="left" dataKey={metricKey} name={metricLabel} fill="#6366f1" radius={[2, 2, 0, 0]} />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="results"
                      name={t.campaign_detail_chart_results}
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>}

        {/* ── BOTTOM THREE PANELS ─────────────────────────────────────────── */}
        {activeTab === "overview" && <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Ad Sets */}
          <div className="rounded-lg p-4" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
            <h3 className="text-white font-semibold mb-4 text-sm">{t.campaign_detail_adsets_title}</h3>
            {detail.adsets.length === 0 ? (
              <p className="text-gray-500 text-sm">{t.campaign_detail_no_data}</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 text-xs" style={{ borderBottom: "1px solid #222222" }}>
                    <th className="pb-2 text-left font-normal">{t.campaign_detail_adsets_col_name}</th>
                    <th className="pb-2 text-left font-normal">{t.campaign_detail_adsets_col_status}</th>
                    <th className="pb-2 text-right font-normal">{t.campaign_detail_adsets_col_budget}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.adsets.map((adset) => (
                    <tr key={adset.id} style={{ borderBottom: "1px solid #1a1a1a" }}>
                      <td
                        className="py-2 text-white text-xs max-w-[120px] truncate"
                        title={adset.name}
                      >
                        {adset.name}
                      </td>
                      <td className="py-2">
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded ${
                            adset.status === "ACTIVE"
                              ? "bg-green-900 text-green-300"
                              : "bg-[#1a1a1a] text-gray-300"
                          }`}
                        >
                          {adset.status}
                        </span>
                      </td>
                      <td className="py-2 text-right text-xs">
                        {adset.budget_display === "CBO" ? (
                          <span className="px-1.5 py-0.5 rounded text-gray-300 text-xs font-medium" style={{ backgroundColor: "#333333" }}>CBO</span>
                        ) : adset.daily_budget > 0 ? (
                          <span className="text-gray-300">{t.campaign_detail_per_day(adset.daily_budget)}</span>
                        ) : (
                          <span className="text-gray-500">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Ads — Active Creatives */}
          <div className="rounded-lg p-4" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
            <h3 className="text-white font-semibold mb-4 text-sm">{t.campaign_detail_creatives_title}</h3>
            {detail.ads.length === 0 ? (
              <p className="text-gray-500 text-sm">{t.campaign_detail_no_data}</p>
            ) : (
              <div className="space-y-3">
                {detail.ads.map((ad) => {
                  // Determine Andromeda health badge per ad using campaign-level metrics
                  const daysRunning = (Date.now() - new Date(detail.campaign.created_at).getTime()) / 86400000
                  const adHealth =
                    daysRunning < 7
                      ? { label: t.campaign_detail_creative_new, cls: "bg-blue-900 text-blue-300" }
                      : detail.andromeda_status === "fatigued"
                      ? { label: t.campaign_detail_creative_fatigued, cls: "bg-orange-900 text-orange-300" }
                      : { label: t.campaign_detail_creative_healthy, cls: "bg-emerald-900 text-emerald-300" }

                  // Check if there's a creative_brief in the latest MODIFY/fatigue log
                  const hasBrief = detail.andromeda_status === "fatigued"

                  return (
                    <div
                      key={ad.id}
                      className="flex items-start gap-3 pb-3 last:border-0"
                      style={{ borderBottom: "1px solid #1a1a1a" }}
                    >
                      {ad.creative_thumbnail ? (
                        <img
                          src={ad.creative_thumbnail}
                          alt={ad.name}
                          className="w-12 h-12 rounded object-cover flex-shrink-0" style={{ backgroundColor: "#1a1a1a" }}
                        />
                      ) : (
                        <div className="w-12 h-12 rounded flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "#1a1a1a" }}>
                          <span className="text-gray-500 text-xs">{t.campaign_detail_creative_no_img}</span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-xs truncate font-medium" title={ad.name}>
                          {ad.name}
                        </p>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          <span
                            className={`text-xs px-1.5 py-0.5 rounded ${
                              ad.status === "ACTIVE"
                                ? "bg-green-900 text-green-300"
                                : "bg-[#1a1a1a] text-gray-300"
                            }`}
                          >
                            {ad.status}
                          </span>
                          <span
                            className={`text-xs px-1.5 py-0.5 rounded font-medium ${adHealth.cls}`}
                            title={detail.andromeda_reason}
                          >
                            {adHealth.label}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-x-3 mt-1.5 text-[10px] text-gray-500">
                          <span>CTR: {ins.avg_ctr?.toFixed(2) ?? "—"}%</span>
                          <span>Freq: {ins.avg_frequency?.toFixed(1) ?? "—"}</span>
                          <span>{t.campaign_detail_creative_running(Math.floor(daysRunning))}</span>
                        </div>
                        {hasBrief && (
                          <button
                            onClick={() => showToast(t.campaign_detail_brief_notification_hint)}
                            className="mt-1.5 text-[10px] text-orange-400 hover:text-orange-300 transition-colors"
                          >
                            {t.campaign_detail_creative_view_brief}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Optimization Logs */}
          <div className="rounded-lg p-4" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
            <h3 className="text-white font-semibold mb-4 text-sm">{t.campaign_detail_logs_title}</h3>
            {detail.optimization_logs.length === 0 ? (
              <p className="text-gray-500 text-sm">{t.campaign_detail_logs_no_records}</p>
            ) : (
              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
                {detail.optimization_logs.map((log) => (
                  <div key={log.id} className="pb-3 last:border-0" style={{ borderBottom: "1px solid #1a1a1a" }}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-gray-500 text-xs">{relativeTime(log.created_at)}</span>
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded font-semibold ${
                          DECISION_CLASSES[log.decision] ?? "bg-[#1a1a1a] text-gray-300"
                        }`}
                      >
                        {log.decision}
                      </span>
                      {/* Approval status dot */}
                      <span
                        className={`text-xs ${
                          log.approval_status === "approved"
                            ? "text-green-400"
                            : log.approval_status === "rejected"
                            ? "text-red-400"
                            : log.approval_status === "auto_executed"
                            ? "text-blue-400"
                            : "text-yellow-400"
                        }`}
                      >
                        {log.approval_status === "pending"
                          ? t.campaign_detail_logs_pending
                          : log.approval_status === "approved"
                          ? t.campaign_detail_logs_approved
                          : log.approval_status === "rejected"
                          ? t.campaign_detail_logs_rejected
                          : t.campaign_detail_logs_auto}
                      </span>
                    </div>

                    <p className="text-gray-300 text-xs leading-relaxed">
                      {log.rationale.length > 200 && !expandedRationale[log.id]
                        ? log.rationale.slice(0, 200) + "…"
                        : log.rationale}
                    </p>
                    {log.rationale.length > 200 && (
                      <button
                        onClick={() =>
                          setExpandedRationale((prev) => ({
                            ...prev,
                            [log.id]: !prev[log.id],
                          }))
                        }
                        className="mt-1 text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors"
                      >
                        {expandedRationale[log.id] ? t.campaign_detail_logs_see_less : t.campaign_detail_logs_see_more}
                      </button>
                    )}

                    {log.budget_before != null && log.budget_after != null && (
                      <p className="text-gray-500 text-xs mt-1">
                        {t.campaign_detail_per_day(log.budget_before)} → {t.campaign_detail_per_day(log.budget_after)}
                      </p>
                    )}

                    {log.approval_status === "pending" && log.approval_token && (
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={() => handleApprove(log)}
                          className="px-2 py-0.5 text-xs bg-green-800 hover:bg-green-700 text-green-200 rounded"
                        >
                          {t.campaign_detail_logs_approve}
                        </button>
                        <button
                          onClick={() => handleReject(log)}
                          className="px-2 py-0.5 text-xs bg-red-900 hover:bg-red-800 text-red-300 rounded"
                        >
                          {t.campaign_detail_logs_reject}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>}
      </div>

      {/* ── OPTIMIZE CONFIRM MODAL ──────────────────────────────────────────── */}
      {optimizeModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="rounded-xl p-6 w-96" style={{ backgroundColor: "#0a0a0a", border: "1px solid #222222" }}>
            <h3 className="text-white font-semibold mb-3">{t.campaign_detail_optimize_modal_title}</h3>
            <p className="text-gray-400 text-sm mb-6">
              {t.campaign_detail_optimize_modal_body}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setOptimizeModalOpen(false)}
                className="flex-1 px-3 py-2 text-white rounded" style={{ backgroundColor: "#1a1a1a" }}
              >
                {t.campaign_detail_optimize_modal_cancel}
              </button>
              <button
                onClick={handleOptimizeConfirm}
                className="flex-1 px-3 py-2 bg-purple-600 text-white rounded hover:bg-purple-500"
              >
                {t.campaign_detail_optimize_modal_confirm}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── BUDGET MODAL ────────────────────────────────────────────────────── */}
      {budgetModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="rounded-xl p-6 w-96" style={{ backgroundColor: "#0a0a0a", border: "1px solid #222222" }}>
            <h3 className="text-white font-semibold mb-4">{t.campaign_detail_budget_modal_title}</h3>
            <p className="text-gray-400 text-sm mb-4">
              {t.campaign_detail_budget_modal_current(detail.campaign.daily_budget)}
            </p>
            <input
              type="number"
              value={newBudget}
              onChange={(e) => setNewBudget(Number(e.target.value))}
              className="w-full text-white px-3 py-2 rounded mb-2 focus:outline-none focus:ring-2 focus:ring-blue-600" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}
              placeholder={t.campaign_detail_budget_modal_placeholder}
              min={1}
            />
            {newBudget < 10 && newBudget > 0 && (
              <p className="text-yellow-400 text-xs mb-2">
                {t.campaign_detail_budget_modal_min_warning}
              </p>
            )}
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setBudgetModalOpen(false)}
                className="flex-1 px-3 py-2 text-white rounded" style={{ backgroundColor: "#1a1a1a" }}
              >
                {t.campaign_detail_budget_modal_cancel}
              </button>
              <button
                onClick={handleBudgetUpdate}
                className="flex-1 px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-500"
              >
                {t.campaign_detail_budget_modal_update}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TOAST ───────────────────────────────────────────────────────────── */}
      {toast && (
        <div className="fixed bottom-4 right-4 text-white px-4 py-3 rounded-lg shadow-xl z-50 max-w-sm text-sm" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
          {toast}
        </div>
      )}
    </div>
  )
}

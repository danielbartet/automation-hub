"use client"
import { useEffect, useState, useCallback } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import Link from "next/link"
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
  updateCampaignStatus,
  updateCampaignBudget,
  optimizeCampaign,
  approveOptimizerAction,
  rejectOptimizerAction,
} from "@/lib/api"
import { Loader2 } from "lucide-react"

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

function relativeTime(iso: string): string {
  try {
    const diffMs = Date.now() - new Date(iso).getTime()
    const diffDays = Math.floor(diffMs / 86400000)
    if (diffDays === 0) return "hoy"
    if (diffDays === 1) return "hace 1 día"
    return `hace ${diffDays} días`
  } catch {
    return iso
  }
}

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

function KPICard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <p className="text-gray-400 text-xs mb-1">{label}</p>
      <p className="text-white text-2xl font-bold">{value}</p>
      {sub && <p className="text-gray-500 text-xs mt-1">{sub}</p>}
    </div>
  )
}

// ─── Decision badge ───────────────────────────────────────────────────────────

const DECISION_CLASSES: Record<string, string> = {
  SCALE: "bg-blue-900 text-blue-300",
  PAUSE: "bg-orange-900 text-orange-300",
  KEEP: "bg-gray-700 text-gray-300",
  MODIFY: "bg-yellow-900 text-yellow-300",
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CampaignDetailPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: session } = useSession()
  const token = (session as { accessToken?: string } | null)?.accessToken ?? ""
  const campaignId = params?.campaign_id as string
  const projectSlug = searchParams?.get("project_slug") ?? ""

  const [detail, setDetail] = useState<CampaignDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [optimizing, setOptimizing] = useState(false)
  const [optimizeModalOpen, setOptimizeModalOpen] = useState(false)
  const [budgetModalOpen, setBudgetModalOpen] = useState(false)
  const [newBudget, setNewBudget] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const [chartMetric, setChartMetric] = useState<"ctr" | "cpc" | "frequency">("ctr")
  const [dateRange, setDateRange] = useState("last_30d")

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 4000)
  }

  const loadDetail = useCallback(async () => {
    if (!token || !campaignId) return
    try {
      const data = await fetchCampaignDetail(token, campaignId, projectSlug)
      setDetail(data)
      setNewBudget(data?.campaign?.daily_budget ?? 0)
    } catch (e) {
      showToast("Error al cargar campaña")
    } finally {
      setLoading(false)
    }
  }, [token, campaignId, projectSlug])

  useEffect(() => {
    loadDetail()
  }, [loadDetail])

  const handleOptimizeConfirm = async () => {
    setOptimizeModalOpen(false)
    if (!token) return
    setOptimizing(true)
    try {
      const result = await optimizeCampaign(Number(campaignId))
      showToast(`Análisis: ${result.decision || "Completado"}`)
      const fresh = await fetchCampaignDetail(token, campaignId)
      setDetail(fresh)
    } catch {
      showToast("Error al optimizar")
    } finally {
      setOptimizing(false)
    }
  }

  const handleStatusChange = async (status: string) => {
    const label = status === "paused" ? "Pausar" : "Activar"
    if (!confirm(`¿${label} la campaña?`)) return
    try {
      await updateCampaignStatus(Number(campaignId), status as "active" | "paused")
      const fresh = await fetchCampaignDetail(token, campaignId)
      setDetail(fresh)
      showToast(`Campaña ${status === "paused" ? "pausada" : "activada"}`)
    } catch {
      showToast("Error al cambiar estado")
    }
  }

  const handleBudgetUpdate = async () => {
    try {
      await updateCampaignBudget(token, Number(campaignId), newBudget)
      setBudgetModalOpen(false)
      const fresh = await fetchCampaignDetail(token, campaignId)
      setDetail(fresh)
      showToast(`Presupuesto actualizado a $${newBudget}/día`)
    } catch {
      showToast("Error al actualizar presupuesto")
    }
  }

  const handleApprove = async (log: OptimizationLog) => {
    if (!log.approval_token) return
    try {
      await approveOptimizerAction(token, log.approval_token)
      const fresh = await fetchCampaignDetail(token, campaignId)
      setDetail(fresh)
      showToast("Acción aprobada")
    } catch {
      showToast("Error al aprobar")
    }
  }

  const handleReject = async (log: OptimizationLog) => {
    if (!log.approval_token) return
    try {
      await rejectOptimizerAction(token, log.approval_token)
      const fresh = await fetchCampaignDetail(token, campaignId)
      setDetail(fresh)
      showToast("Acción rechazada")
    } catch {
      showToast("Error al rechazar")
    }
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <p className="text-gray-400">No se pudo cargar la campaña.</p>
      </div>
    )
  }

  const ins = detail.insights_summary
  const objective = detail.campaign.objective

  // ── KPI grid based on objective ────────────────────────────────────────────
  let kpiCards: React.ReactNode
  if (objective === "OUTCOME_LEADS") {
    kpiCards = (
      <>
        <KPICard label="Total Gastado" value={fmt(ins.total_spend)} sub={ins.period} />
        <KPICard label="Leads" value={String(ins.total_results ?? "—")} sub={ins.result_label} />
        <KPICard label="Costo / Lead" value={fmt(ins.cost_per_result)} />
        <KPICard label="CTR" value={ins.avg_ctr != null ? `${ins.avg_ctr.toFixed(2)}%` : "—"} />
        <KPICard label="Frecuencia" value={ins.avg_frequency != null ? ins.avg_frequency.toFixed(2) : "—"} />
        <KPICard label="Alcance" value={ins.total_reach != null ? ins.total_reach.toLocaleString() : "—"} />
      </>
    )
  } else if (objective === "OUTCOME_SALES") {
    kpiCards = (
      <>
        <KPICard label="Total Gastado" value={fmt(ins.total_spend)} sub={ins.period} />
        <KPICard label="ROAS" value={ins.roas != null ? `${ins.roas.toFixed(2)}x` : "—"} />
        <KPICard label="Compras" value={String(ins.total_results ?? "—")} sub={ins.result_label} />
        <KPICard label="CPA" value={fmt(ins.cost_per_result)} />
        <KPICard label="CTR" value={ins.avg_ctr != null ? `${ins.avg_ctr.toFixed(2)}%` : "—"} />
        <KPICard label="Frecuencia" value={ins.avg_frequency != null ? ins.avg_frequency.toFixed(2) : "—"} />
      </>
    )
  } else {
    // OUTCOME_TRAFFIC or other
    kpiCards = (
      <>
        <KPICard label="Total Gastado" value={fmt(ins.total_spend)} sub={ins.period} />
        <KPICard label="Clicks" value={ins.total_clicks != null ? ins.total_clicks.toLocaleString() : "—"} />
        <KPICard label="CPC" value={fmt(ins.avg_cpc)} />
        <KPICard label="CTR" value={ins.avg_ctr != null ? `${ins.avg_ctr.toFixed(2)}%` : "—"} />
        <KPICard label="Alcance" value={ins.total_reach != null ? ins.total_reach.toLocaleString() : "—"} />
        <KPICard label="CPM" value={fmt(ins.avg_cpm)} />
      </>
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
    chartMetric === "ctr" ? "CTR %" : chartMetric === "cpc" ? "CPC $" : "Frecuencia"

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="p-6 space-y-6 max-w-[1400px] mx-auto">

        {/* ── HEADER ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <Link
              href="/dashboard/ads"
              className="text-gray-400 hover:text-white flex items-center gap-1 text-sm"
            >
              ← Campañas
            </Link>
            <h1 className="text-2xl font-bold text-white">{detail.campaign.name}</h1>
            <span
              className={`px-2 py-1 rounded text-xs font-semibold ${
                detail.campaign.status === "ACTIVE"
                  ? "bg-green-900 text-green-300"
                  : "bg-gray-700 text-gray-300"
              }`}
            >
              {detail.campaign.status}
            </span>
            <span className="px-2 py-1 rounded text-xs font-semibold bg-blue-900 text-blue-300">
              {detail.campaign.objective.replace("OUTCOME_", "")}
            </span>
            <span
              title={detail.andromeda_reason}
              className={`px-2 py-1 rounded text-xs font-semibold cursor-help ${
                detail.andromeda_status === "healthy"
                  ? "bg-emerald-900 text-emerald-300"
                  : "bg-orange-900 text-orange-300"
              }`}
            >
              Andromeda: {detail.andromeda_status}
            </span>
          </div>

          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setOptimizeModalOpen(true)}
              disabled={optimizing}
              className="px-3 py-1.5 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white text-sm rounded"
            >
              {optimizing ? "Analizando..." : "Optimizar ahora"}
            </button>
            {detail.campaign.status === "ACTIVE" ? (
              <button
                onClick={() => handleStatusChange("paused")}
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded"
              >
                Pausar
              </button>
            ) : (
              <button
                onClick={() => handleStatusChange("active")}
                className="px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white text-sm rounded"
              >
                Activar
              </button>
            )}
            <button
              onClick={() => setBudgetModalOpen(true)}
              className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white text-sm rounded"
            >
              Presupuesto
            </button>
          </div>
        </div>

        {/* ── KPI CARDS ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {kpiCards}
        </div>

        {/* ── DATE RANGE + CHARTS ─────────────────────────────────────────── */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <span className="text-gray-400 text-sm">Período:</span>
            {(["last_7d", "last_30d", "this_month"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setDateRange(r)}
                className={`px-3 py-1 text-xs rounded ${
                  dateRange === r
                    ? "bg-gray-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:text-white"
                }`}
              >
                {r === "last_7d" ? "7 días" : r === "last_30d" ? "30 días" : "Este mes"}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Left — Gasto diario */}
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
              <h3 className="text-white font-semibold mb-4 text-sm">Gasto diario</h3>
              {chartData.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-10">Sin datos</p>
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
                      formatter={(v: number) => [`$${v.toFixed(2)}`, "Gasto"]}
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

            {/* Right — Rendimiento diario */}
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-semibold text-sm">Rendimiento diario</h3>
                <div className="flex gap-1">
                  {(["ctr", "cpc", "frequency"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setChartMetric(m)}
                      className={`px-2 py-0.5 text-xs rounded ${
                        chartMetric === m
                          ? "bg-indigo-700 text-white"
                          : "bg-gray-700 text-gray-400 hover:text-white"
                      }`}
                    >
                      {m === "ctr" ? "CTR" : m === "cpc" ? "CPC" : "Frecuencia"}
                    </button>
                  ))}
                </div>
              </div>
              {chartData.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-10">Sin datos</p>
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
                      name="Resultados"
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

        {/* ── BOTTOM THREE PANELS ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Ad Sets */}
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
            <h3 className="text-white font-semibold mb-4 text-sm">Ad Sets</h3>
            {detail.adsets.length === 0 ? (
              <p className="text-gray-500 text-sm">Sin datos</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 text-xs border-b border-gray-700">
                    <th className="pb-2 text-left font-normal">Nombre</th>
                    <th className="pb-2 text-left font-normal">Status</th>
                    <th className="pb-2 text-right font-normal">Budget/día</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.adsets.map((adset) => (
                    <tr key={adset.id} className="border-b border-gray-700/50">
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
                              : "bg-gray-700 text-gray-300"
                          }`}
                        >
                          {adset.status}
                        </span>
                      </td>
                      <td className="py-2 text-right text-gray-300 text-xs">
                        ${adset.daily_budget}/día
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Ads — Creativos activos */}
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
            <h3 className="text-white font-semibold mb-4 text-sm">Creativos activos</h3>
            {detail.ads.length === 0 ? (
              <p className="text-gray-500 text-sm">Sin datos</p>
            ) : (
              <div className="space-y-3">
                {detail.ads.map((ad) => {
                  // Determine Andromeda health badge per ad using campaign-level metrics
                  const daysRunning = (Date.now() - new Date(detail.campaign.created_at).getTime()) / 86400000
                  const adHealth =
                    daysRunning < 7
                      ? { label: "Nuevo", cls: "bg-blue-900 text-blue-300" }
                      : detail.andromeda_status === "fatigued"
                      ? { label: "Fatigado", cls: "bg-orange-900 text-orange-300" }
                      : { label: "Saludable", cls: "bg-emerald-900 text-emerald-300" }

                  // Check if there's a creative_brief in the latest MODIFY/fatigue log
                  const hasBrief = detail.andromeda_status === "fatigued"

                  return (
                    <div
                      key={ad.id}
                      className="flex items-start gap-3 border-b border-gray-700/50 pb-3 last:border-0"
                    >
                      {ad.creative_thumbnail ? (
                        <img
                          src={ad.creative_thumbnail}
                          alt={ad.name}
                          className="w-12 h-12 rounded object-cover flex-shrink-0 bg-gray-700"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded bg-gray-700 flex items-center justify-center flex-shrink-0">
                          <span className="text-gray-500 text-xs">Sin img</span>
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
                                : "bg-gray-700 text-gray-300"
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
                          <span>{Math.floor(daysRunning)}d corriendo</span>
                        </div>
                        {hasBrief && (
                          <button
                            onClick={() => showToast("Abrí el panel de notificaciones para ver el brief completo.")}
                            className="mt-1.5 text-[10px] text-orange-400 hover:text-orange-300 transition-colors"
                          >
                            Ver brief →
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
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
            <h3 className="text-white font-semibold mb-4 text-sm">Logs de Optimización</h3>
            {detail.optimization_logs.length === 0 ? (
              <p className="text-gray-500 text-sm">Sin registros</p>
            ) : (
              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
                {detail.optimization_logs.map((log) => (
                  <div key={log.id} className="border-b border-gray-700/50 pb-3 last:border-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-gray-500 text-xs">{relativeTime(log.created_at)}</span>
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded font-semibold ${
                          DECISION_CLASSES[log.decision] ?? "bg-gray-700 text-gray-300"
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
                          ? "pendiente"
                          : log.approval_status === "approved"
                          ? "aprobado"
                          : log.approval_status === "rejected"
                          ? "rechazado"
                          : "auto"}
                      </span>
                    </div>

                    <p
                      className="text-gray-300 text-xs leading-relaxed"
                      title={log.rationale}
                    >
                      {log.rationale.length > 120
                        ? log.rationale.slice(0, 120) + "…"
                        : log.rationale}
                    </p>

                    {log.budget_before != null && log.budget_after != null && (
                      <p className="text-gray-500 text-xs mt-1">
                        ${log.budget_before} → ${log.budget_after}/día
                      </p>
                    )}

                    {log.approval_status === "pending" && log.approval_token && (
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={() => handleApprove(log)}
                          className="px-2 py-0.5 text-xs bg-green-800 hover:bg-green-700 text-green-200 rounded"
                        >
                          Aprobar
                        </button>
                        <button
                          onClick={() => handleReject(log)}
                          className="px-2 py-0.5 text-xs bg-red-900 hover:bg-red-800 text-red-300 rounded"
                        >
                          Rechazar
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── OPTIMIZE CONFIRM MODAL ──────────────────────────────────────────── */}
      {optimizeModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-96">
            <h3 className="text-white font-semibold mb-3">Confirmar optimización</h3>
            <p className="text-gray-400 text-sm mb-6">
              ¿Estás seguro de que querés optimizar esta campaña?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setOptimizeModalOpen(false)}
                className="flex-1 px-3 py-2 bg-gray-700 text-white rounded hover:bg-gray-600"
              >
                Cancelar
              </button>
              <button
                onClick={handleOptimizeConfirm}
                className="flex-1 px-3 py-2 bg-purple-600 text-white rounded hover:bg-purple-500"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── BUDGET MODAL ────────────────────────────────────────────────────── */}
      {budgetModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-96">
            <h3 className="text-white font-semibold mb-4">Ajustar presupuesto diario</h3>
            <p className="text-gray-400 text-sm mb-4">
              Presupuesto actual: ${detail.campaign.daily_budget}/día
            </p>
            <input
              type="number"
              value={newBudget}
              onChange={(e) => setNewBudget(Number(e.target.value))}
              className="w-full bg-gray-800 border border-gray-700 text-white px-3 py-2 rounded mb-2 focus:outline-none focus:ring-2 focus:ring-blue-600"
              placeholder="Nuevo presupuesto en USD"
              min={1}
            />
            {newBudget < 10 && newBudget > 0 && (
              <p className="text-yellow-400 text-xs mb-2">
                Se recomienda un mínimo de $10/día
              </p>
            )}
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setBudgetModalOpen(false)}
                className="flex-1 px-3 py-2 bg-gray-700 text-white rounded hover:bg-gray-600"
              >
                Cancelar
              </button>
              <button
                onClick={handleBudgetUpdate}
                className="flex-1 px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-500"
              >
                Actualizar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TOAST ───────────────────────────────────────────────────────────── */}
      {toast && (
        <div className="fixed bottom-4 right-4 bg-gray-800 border border-gray-700 text-white px-4 py-3 rounded-lg shadow-xl z-50 max-w-sm text-sm">
          {toast}
        </div>
      )}
    </div>
  )
}

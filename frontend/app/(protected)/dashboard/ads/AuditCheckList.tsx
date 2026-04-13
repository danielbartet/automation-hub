"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { Loader2, ExternalLink, ChevronDown, ChevronRight } from "lucide-react"

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

// ─── Types ───────────────────────────────────────────────────────────────────

interface AuditCheckResult {
  id: number
  check_id: string
  category: string
  severity: string // Critical | High | Medium | Low
  result: string   // PASS | WARNING | FAIL | MANUAL_REQUIRED | NA
  title: string
  detail: string
  recommendation: string
  meta_value: string
  threshold_value: string
  meta_ui_link: string
  created_at: string
}

export interface AuditCheckListProps {
  auditId: number | null
}

// ─── Constants ───────────────────────────────────────────────────────────────

const RESULT_ORDER: Record<string, number> = {
  FAIL: 0,
  MANUAL_REQUIRED: 1,
  WARNING: 2,
  PASS: 3,
  NA: 4,
}

const CATEGORY_LABELS: Record<string, string> = {
  all: "All",
  pixel: "Pixel & CAPI",
  creative: "Creative",
  structure: "Structure",
  audience: "Audience",
}

const RESULT_LABELS: Record<string, string> = {
  all: "All",
  PASS: "PASS",
  WARNING: "WARNING",
  FAIL: "FAIL",
  MANUAL_REQUIRED: "Manual",
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SeverityDot({ severity }: { severity: string }) {
  const colorMap: Record<string, string> = {
    Critical: "text-red-500",
    High: "text-orange-400",
    Medium: "text-yellow-400",
    Low: "text-gray-500",
  }
  return (
    <span className={`text-xs leading-none ${colorMap[severity] ?? "text-gray-500"}`} title={severity}>
      ●
    </span>
  )
}

function ResultBadge({ result }: { result: string }) {
  const styleMap: Record<string, string> = {
    PASS: "bg-green-900/50 text-green-400 border border-green-800",
    WARNING: "bg-yellow-900/50 text-yellow-400 border border-yellow-800",
    FAIL: "bg-red-900/50 text-red-400 border border-red-800",
    MANUAL_REQUIRED: "bg-indigo-900/50 text-indigo-400 border border-indigo-800",
    NA: "bg-gray-800 text-gray-500 border border-gray-700",
  }
  const labelMap: Record<string, string> = {
    PASS: "PASS",
    WARNING: "WARNING",
    FAIL: "FAIL",
    MANUAL_REQUIRED: "Manual Check",
    NA: "N/A",
  }
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 ${styleMap[result] ?? "bg-gray-800 text-gray-400"}`}
    >
      {labelMap[result] ?? result}
    </span>
  )
}

function CheckRow({ check }: { check: AuditCheckResult }) {
  const [expanded, setExpanded] = useState(false)
  const isManual = check.result === "MANUAL_REQUIRED"

  return (
    <div
      className={`border-b transition-colors ${isManual ? "border-l-4 border-l-indigo-400" : ""}`}
      style={{ borderBottomColor: "#1a1a1a", borderTopColor: "transparent" }}
    >
      {/* Row header — clickable */}
      <button
        className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-white/5 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        {/* Expand icon */}
        <span className="flex-shrink-0 text-gray-600">
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>

        {/* Severity dot */}
        <SeverityDot severity={check.severity} />

        {/* Result badge */}
        <ResultBadge result={check.result} />

        {/* Title */}
        <span className="flex-1 text-sm text-white font-medium min-w-0 truncate">
          {check.title}
        </span>

        {/* Meta value */}
        {check.meta_value && (
          <span className="flex-shrink-0 text-xs text-gray-400 font-mono">
            {check.meta_value}
          </span>
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div
          className={`px-10 pb-4 space-y-2 ${isManual ? "pl-12" : ""}`}
        >
          {check.detail && (
            <p className="text-sm text-gray-300 leading-relaxed">{check.detail}</p>
          )}

          {!isManual && check.recommendation && (
            <p className="text-sm leading-relaxed" style={{ color: "#9ca3af" }}>
              <span className="font-medium text-gray-400">Recommendation: </span>
              {check.recommendation}
            </p>
          )}

          {check.meta_ui_link && (
            <a
              href={check.meta_ui_link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors mt-1"
            >
              {isManual ? "Verify in Meta" : "View in Meta"}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AuditCheckList({ auditId }: AuditCheckListProps) {
  const { data: session } = useSession()
  const token = (session as { accessToken?: string } | null)?.accessToken ?? ""

  const [checks, setChecks] = useState<AuditCheckResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filterCategory, setFilterCategory] = useState<string>("all")
  const [filterResult, setFilterResult] = useState<string>("all")

  useEffect(() => {
    if (auditId == null) {
      setChecks([])
      return
    }

    setLoading(true)
    setError(null)

    fetch(`${API_BASE}/api/v1/ads/audit/${auditId}/checks`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch audit checks (${res.status})`)
        return res.json() as Promise<AuditCheckResult[]>
      })
      .then((data) => setChecks(Array.isArray(data) ? data : []))
      .catch((err) => setError(err instanceof Error ? err.message : "Unknown error"))
      .finally(() => setLoading(false))
  }, [auditId, token])

  // ── Guard: nothing to show ──
  if (auditId == null) return null

  // ── Category counts ──
  const categoryCounts: Record<string, number> = { all: checks.length }
  for (const c of checks) {
    categoryCounts[c.category] = (categoryCounts[c.category] ?? 0) + 1
  }

  // ── Result counts ──
  const resultCounts: Record<string, number> = { all: checks.length }
  for (const c of checks) {
    resultCounts[c.result] = (resultCounts[c.result] ?? 0) + 1
  }

  // ── Filtered + sorted checks ──
  const filtered = checks
    .filter((c) => {
      if (filterCategory !== "all" && c.category !== filterCategory) return false
      if (filterResult !== "all" && c.result !== filterResult) return false
      return true
    })
    .sort((a, b) => (RESULT_ORDER[a.result] ?? 99) - (RESULT_ORDER[b.result] ?? 99))

  // ── Quick Wins: Critical/High FAIL checks (from all, not filtered) ──
  const quickWins = checks.filter(
    (c) => (c.severity === "Critical" || c.severity === "High") && c.result === "FAIL"
  )

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* ── Filter bar ── */}
      <div className="rounded-lg p-4 space-y-3" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
        {/* Category filters */}
        <div className="flex flex-wrap gap-2">
          {Object.entries(CATEGORY_LABELS).map(([key, label]) => {
            const count = categoryCounts[key] ?? 0
            const active = filterCategory === key
            return (
              <button
                key={key}
                onClick={() => setFilterCategory(key)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={{
                  backgroundColor: active ? "#7c3aed" : "#1a1a1a",
                  color: active ? "#ffffff" : "#9ca3af",
                  border: active ? "1px solid #7c3aed" : "1px solid #333333",
                }}
              >
                {label}
                <span
                  className="inline-flex items-center justify-center rounded-full min-w-[18px] h-[18px] px-1 text-[10px] font-bold"
                  style={{
                    backgroundColor: active ? "rgba(255,255,255,0.2)" : "#2a2a2a",
                    color: active ? "#ffffff" : "#6b7280",
                  }}
                >
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        {/* Result filters */}
        <div className="flex flex-wrap gap-2">
          {Object.entries(RESULT_LABELS).map(([key, label]) => {
            const count = resultCounts[key] ?? 0
            const active = filterResult === key
            const emojiMap: Record<string, string> = {
              all: "",
              PASS: "✅ ",
              WARNING: "⚠️ ",
              FAIL: "❌ ",
              MANUAL_REQUIRED: "📋 ",
            }
            return (
              <button
                key={key}
                onClick={() => setFilterResult(key)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={{
                  backgroundColor: active ? "#1e1e3f" : "#1a1a1a",
                  color: active ? "#a5b4fc" : "#9ca3af",
                  border: active ? "1px solid #4338ca" : "1px solid #333333",
                }}
              >
                {emojiMap[key]}{label}
                {key !== "all" && (
                  <span className="ml-1 text-[10px]" style={{ color: active ? "#a5b4fc" : "#6b7280" }}>
                    ({count})
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="rounded-md p-4 text-sm text-red-400" style={{ backgroundColor: "#450a0a", border: "1px solid #7f1d1d" }}>
          {error}
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div className="rounded-lg" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="px-4 py-3 flex items-center gap-3 animate-pulse"
              style={{ borderBottom: i < 5 ? "1px solid #1a1a1a" : undefined }}
            >
              <div className="h-3 w-3 rounded-full bg-gray-700 flex-shrink-0" />
              <div className="h-3 w-16 rounded bg-gray-700 flex-shrink-0" />
              <div className="h-3 flex-1 rounded bg-gray-800" />
              <div className="h-3 w-12 rounded bg-gray-700 flex-shrink-0" />
            </div>
          ))}
        </div>
      )}

      {!loading && (
        <>
          {/* ── Quick Wins ── */}
          {quickWins.length > 0 && (
            <div className="rounded-lg overflow-hidden" style={{ backgroundColor: "#1a0a0a", border: "1px solid #7f1d1d" }}>
              <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid #7f1d1d" }}>
                <span className="text-sm font-semibold text-red-400">
                  Quick Wins — High impact fixes
                </span>
                <span
                  className="px-2 py-0.5 rounded-full text-xs font-bold text-red-400"
                  style={{ backgroundColor: "#450a0a" }}
                >
                  {quickWins.length}
                </span>
              </div>
              <div>
                {quickWins.map((check) => (
                  <CheckRow key={`qw-${check.id}`} check={check} />
                ))}
              </div>
            </div>
          )}

          {/* ── Check list ── */}
          <div className="rounded-lg overflow-hidden" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
            <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid #222222" }}>
              <span className="text-sm font-semibold text-white">Audit Checks</span>
              <span className="text-xs" style={{ color: "#9ca3af" }}>
                {filtered.length} check{filtered.length !== 1 ? "s" : ""}
              </span>
            </div>

            {filtered.length === 0 ? (
              <div className="flex items-center justify-center h-24 text-sm" style={{ color: "#9ca3af" }}>
                No checks match the selected filters.
              </div>
            ) : (
              <div>
                {filtered.map((check) => (
                  <CheckRow key={check.id} check={check} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

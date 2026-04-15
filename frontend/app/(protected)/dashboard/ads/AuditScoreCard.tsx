"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { useSession } from "next-auth/react"
import { Loader2, RefreshCw, AlertTriangle, CheckCircle2, AlertCircle, ClipboardList } from "lucide-react"
import type { AdsAuditDetail, TriggerAuditResponse } from "./audit-types"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? "" : "s"} ago`
}

const GRADE_CLASSES: Record<string, string> = {
  A: "text-green-400 bg-green-900/40 border border-green-700",
  B: "text-blue-400 bg-blue-900/40 border border-blue-700",
  C: "text-yellow-400 bg-yellow-900/40 border border-yellow-700",
  D: "text-orange-400 bg-orange-900/40 border border-orange-700",
  F: "text-red-400 bg-red-900/40 border border-red-700",
}

const TERMINAL_STATUSES = ["completed", "partial", "error", "failed"]

// ─── Sub-components ───────────────────────────────────────────────────────────

function CategoryBar({ label, score }: { label: string; score: number | null }) {
  const pct = score != null ? Math.round(score) : 0
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs w-32 flex-shrink-0" style={{ color: "#9ca3af" }}>{label}</span>
      <div className="flex-1 rounded-full h-2" style={{ backgroundColor: "#1a1a1a" }}>
        <div
          className="h-2 rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: "#7c3aed" }}
        />
      </div>
      <span className="text-xs w-8 text-right" style={{ color: "#9ca3af" }}>{score != null ? `${pct}%` : "—"}</span>
    </div>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface AuditScoreCardProps {
  projectSlug: string
  /** DB integer id of the campaign. When provided, audit is scoped to this campaign. */
  campaignId?: number
  onAuditCompleted?: (auditId: number) => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AuditScoreCard({ projectSlug, campaignId, onAuditCompleted }: AuditScoreCardProps) {
  const { data: session } = useSession()
  const token = (session as { accessToken?: string } | null)?.accessToken ?? ""

  const [audit, setAudit] = useState<AdsAuditDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [triggering, setTriggering] = useState(false)
  const [polling, setPolling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── API helpers ──────────────────────────────────────────────────────────────

  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? ""

  /** Build optional ?campaign_id=N query param suffix. */
  const campaignParam = campaignId != null ? `?campaign_id=${campaignId}` : ""

  const fetchLatest = useCallback(async (): Promise<AdsAuditDetail | null> => {
    const res = await fetch(
      `${apiBase}/api/v1/ads/audit/latest/${projectSlug}${campaignParam}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`Failed to fetch audit (${res.status})`)
    return res.json() as Promise<AdsAuditDetail>
  }, [apiBase, projectSlug, campaignParam, token])

  // ── Polling ──────────────────────────────────────────────────────────────────

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    setPolling(false)
  }, [])

  useEffect(() => {
    if (!polling) return

    intervalRef.current = setInterval(async () => {
      try {
        const data = await fetchLatest()
        if (!data) {
          stopPolling()
          return
        }
        setAudit(data)
        if (TERMINAL_STATUSES.includes(data.status)) {
          stopPolling()
          if ((data.status === "completed" || data.status === "partial") && onAuditCompleted) {
            onAuditCompleted(data.id)
          }
        }
      } catch {
        // Keep polling on transient errors
      }
    }, 5000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [polling, fetchLatest, stopPolling, onAuditCompleted])

  // ── Initial load ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!token || !projectSlug) return

    let cancelled = false
    setLoading(true)
    setError(null)

    fetchLatest()
      .then((data) => {
        if (cancelled) return
        setAudit(data)
        if (data && data.status === "running") {
          setPolling(true)
        } else if (data && (data.status === "completed" || data.status === "partial") && onAuditCompleted) {
          onAuditCompleted(data.id)
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, projectSlug])

  // ── Trigger audit ────────────────────────────────────────────────────────────

  const handleRunAudit = async () => {
    if (triggering || polling) return
    setTriggering(true)
    setError(null)
    try {
      const res = await fetch(
        `${apiBase}/api/v1/ads/audit/run/${projectSlug}${campaignParam}`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } },
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { detail?: string }).detail ?? `Request failed (${res.status})`)
      }
      const data: TriggerAuditResponse = await res.json()
      // Optimistically start polling — fetch latest to get the running record
      const latestAudit = await fetchLatest()
      if (latestAudit) setAudit(latestAudit)
      setPolling(true)
      void data // audit_id available if needed
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to start audit")
    } finally {
      setTriggering(false)
    }
  }

  // ── Render helpers ────────────────────────────────────────────────────────────

  const isRunning = audit?.status === "running" || polling

  const RunButton = (
    <button
      onClick={handleRunAudit}
      disabled={triggering || isRunning}
      className="flex items-center gap-2 px-4 py-2 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
      style={{ backgroundColor: triggering || isRunning ? "#4b2d8a" : "#7c3aed" }}
      onMouseEnter={(e) => {
        if (!(e.currentTarget as HTMLButtonElement).disabled)
          (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#6d28d9"
      }}
      onMouseLeave={(e) => {
        if (!(e.currentTarget as HTMLButtonElement).disabled)
          (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#7c3aed"
      }}
    >
      {triggering ? (
        <><Loader2 className="h-4 w-4 animate-spin" /> Starting…</>
      ) : isRunning ? (
        <><Loader2 className="h-4 w-4 animate-spin" /> Running…</>
      ) : (
        <><RefreshCw className="h-4 w-4" /> Run Audit</>
      )}
    </button>
  )

  // ── Card wrapper ──────────────────────────────────────────────────────────────

  const cardStyle = {
    backgroundColor: "#111111",
    border: "1px solid #222222",
  }

  // ── Loading state ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="rounded-lg p-6" style={cardStyle}>
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin" style={{ color: "#9ca3af" }} />
          <span className="text-sm" style={{ color: "#9ca3af" }}>Loading audit…</span>
        </div>
      </div>
    )
  }

  // ── No audit yet ──────────────────────────────────────────────────────────────

  if (!audit) {
    return (
      <div className="rounded-lg p-6" style={cardStyle}>
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <p className="text-base font-semibold text-white">Meta Ads Audit</p>
            <p className="mt-1 text-sm" style={{ color: "#9ca3af" }}>
              Run your first audit to get a health score for this ad account.
            </p>
            {error && (
              <p className="mt-2 text-sm text-red-400">Error: {error}</p>
            )}
          </div>
          {RunButton}
        </div>
      </div>
    )
  }

  // ── Running state ─────────────────────────────────────────────────────────────

  if (isRunning) {
    return (
      <div className="rounded-lg p-6" style={cardStyle}>
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <p className="text-base font-semibold text-white">Meta Ads Audit</p>
            <div className="flex items-center gap-2 mt-2">
              <Loader2 className="h-4 w-4 animate-spin" style={{ color: "#7c3aed" }} />
              <span className="text-sm" style={{ color: "#9ca3af" }}>Audit running — this may take a minute…</span>
            </div>
          </div>
          {RunButton}
        </div>
      </div>
    )
  }

  // ── Error / failed state ──────────────────────────────────────────────────────

  if (audit.status === "error" || audit.status === "failed") {
    return (
      <div className="rounded-lg p-6" style={cardStyle}>
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <p className="text-base font-semibold text-white">Meta Ads Audit</p>
            <div className="flex items-center gap-2 mt-2">
              <AlertTriangle className="h-4 w-4 text-red-400" />
              <span className="text-sm text-red-400">
                Audit failed{audit.error_message ? `: ${audit.error_message}` : "."}
              </span>
            </div>
          </div>
          <button
            onClick={handleRunAudit}
            disabled={triggering}
            className="flex items-center gap-2 px-4 py-2 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            style={{ backgroundColor: "#7c3aed" }}
            onMouseEnter={(e) => { (e.currentTarget.style.backgroundColor = "#6d28d9") }}
            onMouseLeave={(e) => { (e.currentTarget.style.backgroundColor = "#7c3aed") }}
          >
            {triggering ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Try Again
          </button>
        </div>
      </div>
    )
  }

  // ── Completed / partial state ─────────────────────────────────────────────────

  const grade = audit.grade ?? "—"
  const gradeClass = grade in GRADE_CLASSES ? GRADE_CLASSES[grade] : "text-gray-400 bg-gray-800 border border-gray-600"

  return (
    <div className="rounded-lg p-6 space-y-5" style={cardStyle}>
      {/* Header row */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <p className="text-base font-semibold text-white">Meta Ads Audit</p>
        {RunButton}
      </div>

      {/* Partial warning */}
      {audit.status === "partial" && (
        <div
          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-yellow-400"
          style={{ backgroundColor: "#2d2d00", border: "1px solid #525200" }}
        >
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          Partial audit — rate limit reached. Results may be incomplete.
        </div>
      )}

      {/* Score + grade */}
      <div className="flex items-center gap-5">
        <div className="text-center">
          <p className="text-5xl font-bold text-white leading-none">
            {audit.health_score != null ? audit.health_score.toFixed(1) : "—"}
          </p>
          <p className="text-xs mt-1" style={{ color: "#9ca3af" }}>Health Score</p>
        </div>
        <div className={`px-4 py-2 rounded-lg text-2xl font-bold ${gradeClass}`}>
          {grade}
        </div>
      </div>

      {/* Category bars */}
      <div className="space-y-2">
        <CategoryBar label="Pixel & CAPI" score={audit.score_pixel} />
        <CategoryBar label="Creative" score={audit.score_creative} />
        <CategoryBar label="Structure" score={audit.score_structure} />
        <CategoryBar label="Audience" score={audit.score_audience} />
      </div>

      {/* Check counts */}
      <div className="flex flex-wrap gap-4 text-sm">
        <span className="flex items-center gap-1.5">
          <CheckCircle2 className="h-4 w-4 text-green-400" />
          <span className="font-semibold text-white">{audit.checks_pass}</span>
          <span style={{ color: "#9ca3af" }}>PASS</span>
        </span>
        <span className="flex items-center gap-1.5">
          <AlertTriangle className="h-4 w-4 text-yellow-400" />
          <span className="font-semibold text-white">{audit.checks_warning}</span>
          <span style={{ color: "#9ca3af" }}>WARNING</span>
        </span>
        <span className="flex items-center gap-1.5">
          <AlertCircle className="h-4 w-4 text-red-400" />
          <span className="font-semibold text-white">{audit.checks_fail}</span>
          <span style={{ color: "#9ca3af" }}>FAIL</span>
        </span>
        <span className="flex items-center gap-1.5">
          <ClipboardList className="h-4 w-4 text-blue-400" />
          <span className="font-semibold text-white">{audit.checks_manual}</span>
          <span style={{ color: "#9ca3af" }}>MANUAL</span>
        </span>
      </div>

      {/* iOS disclaimer */}
      {audit.ios_disclaimer && (
        <p className="text-xs italic" style={{ color: "#6b7280" }}>
          Conversion data may be understated due to iOS 14+ opt-outs.
        </p>
      )}

      {/* Footer */}
      <p className="text-xs" style={{ color: "#6b7280" }}>
        Last run: {audit.completed_at ? relativeTime(audit.completed_at) : relativeTime(audit.created_at)}
      </p>
    </div>
  )
}

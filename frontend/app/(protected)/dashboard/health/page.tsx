"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { Header } from "@/components/layout/Header";
import { getHealthSummary, refreshProjectHealth, ProjectHealth } from "@/lib/api";
import { RefreshCw, AlertTriangle, CheckCircle, XCircle, Clock, Wifi, WifiOff } from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(isoString: string): string {
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 60) return "hace menos de 1 min";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  return `hace ${Math.floor(diff / 3600)}h`;
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function HealthCardSkeleton() {
  return (
    <div
      className="rounded-xl p-6 space-y-4 animate-pulse"
      style={{ backgroundColor: "#111111", border: "1px solid #222222" }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-gray-700" />
          <div className="h-5 w-40 rounded bg-gray-700" />
        </div>
        <div className="h-8 w-24 rounded bg-gray-700" />
      </div>
      <div className="h-px" style={{ backgroundColor: "#222222" }} />
      {[1, 2, 3].map((i) => (
        <div key={i} className="space-y-2">
          <div className="h-4 w-32 rounded bg-gray-800" />
          <div className="h-4 w-48 rounded bg-gray-800" />
        </div>
      ))}
    </div>
  );
}

// ── StatusDot ─────────────────────────────────────────────────────────────────

function StatusDot({ color }: { color: "green" | "yellow" | "red" }) {
  const colors = {
    green: "bg-green-500",
    yellow: "bg-yellow-500",
    red: "bg-red-500",
  };
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${colors[color]}`}
    />
  );
}

// ── AccountStatusBadge ────────────────────────────────────────────────────────

function AccountStatusBadge({
  label,
  color,
}: {
  label: string;
  color: string;
}) {
  const colorMap: Record<string, { bg: string; text: string }> = {
    green: { bg: "rgba(34,197,94,0.15)", text: "#22c55e" },
    yellow: { bg: "rgba(234,179,8,0.15)", text: "#eab308" },
    red: { bg: "rgba(239,68,68,0.15)", text: "#ef4444" },
    gray: { bg: "rgba(107,114,128,0.15)", text: "#6b7280" },
  };
  const style = colorMap[color] ?? colorMap["gray"];
  return (
    <span
      className="inline-block px-2 py-0.5 rounded text-xs font-semibold"
      style={{ backgroundColor: style.bg, color: style.text }}
    >
      {label}
    </span>
  );
}

// ── TokenStatus ───────────────────────────────────────────────────────────────

function TokenStatus({ token }: { token: ProjectHealth["token"] }) {
  if (!token.is_valid) {
    return (
      <div className="flex items-center gap-2 text-sm" style={{ color: "#ef4444" }}>
        <XCircle className="h-4 w-4 flex-shrink-0" />
        <span>Token expirado o inválido</span>
      </div>
    );
  }

  const days = token.days_remaining;
  let textColor = "#22c55e";
  let Icon = CheckCircle;
  let label = `Válido — ${days} días restantes`;

  if (days === null) {
    label = "Válido — sin fecha de expiración";
  } else if (days < 7) {
    textColor = "#ef4444";
    Icon = AlertTriangle;
    label = `Expira en ${days} días — renovar urgente`;
  } else if (days < 30) {
    textColor = "#eab308";
    Icon = AlertTriangle;
    label = `Válido — ${days} días restantes`;
  }

  return (
    <div className="flex items-center gap-2 text-sm" style={{ color: textColor }}>
      <Icon className="h-4 w-4 flex-shrink-0" />
      <span>{label}</span>
    </div>
  );
}

// ── ProjectHealthCard ─────────────────────────────────────────────────────────

interface ProjectHealthCardProps {
  health: ProjectHealth;
  sessionToken: string;
  onRefreshed: (updated: ProjectHealth) => void;
}

function ProjectHealthCard({ health, sessionToken, onRefreshed }: ProjectHealthCardProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const borderColor =
    health.health_color === "green"
      ? "rgba(34,197,94,0.3)"
      : health.health_color === "yellow"
      ? "rgba(234,179,8,0.3)"
      : "rgba(239,68,68,0.3)";

  const startCountdown = useCallback((seconds: number) => {
    setCountdown(seconds);
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(intervalRef.current!);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current); }, []);

  const handleRefresh = async () => {
    if (refreshing || countdown !== null) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      const result = await refreshProjectHealth(sessionToken, health.project_id);
      if (result.retry_after_seconds !== undefined && !result.refreshed) {
        startCountdown(result.retry_after_seconds);
      } else if (result.project_id) {
        onRefreshed(result as ProjectHealth);
      }
    } catch {
      setRefreshError("Error al actualizar");
    } finally {
      setRefreshing(false);
    }
  };

  // Error state
  if (health.error) {
    return (
      <div
        className="rounded-xl p-6 space-y-3"
        style={{ backgroundColor: "#111111", border: `1px solid rgba(239,68,68,0.3)` }}
      >
        <div className="flex items-center gap-3">
          <StatusDot color="red" />
          <h3 className="font-semibold text-white">{health.project_name}</h3>
        </div>
        <div className="flex items-center gap-2 text-sm" style={{ color: "#ef4444" }}>
          <XCircle className="h-4 w-4" />
          <span>Error al cargar datos: {health.error}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl p-6 space-y-5"
      style={{ backgroundColor: "#111111", border: `1px solid ${borderColor}` }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <StatusDot color={health.health_color} />
            <h3 className="font-semibold text-white text-base">{health.project_name}</h3>
          </div>
          <div className="flex items-center gap-1.5 text-xs" style={{ color: "#6b7280" }}>
            <Clock className="h-3 w-3" />
            <span>Última actualización: {timeAgo(health.last_updated)}</span>
          </div>
          {health.is_stale && (
            <span
              className="inline-block px-2 py-0.5 rounded text-xs font-medium"
              style={{ backgroundColor: "rgba(234,179,8,0.15)", color: "#eab308" }}
            >
              Datos desactualizados
            </span>
          )}
        </div>

        <button
          onClick={handleRefresh}
          disabled={refreshing || countdown !== null}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex-shrink-0"
          style={{
            backgroundColor:
              refreshing || countdown !== null ? "#1a1a1a" : "rgba(124,58,237,0.15)",
            color: refreshing || countdown !== null ? "#4b5563" : "#a78bfa",
            border: "1px solid",
            borderColor:
              refreshing || countdown !== null ? "#222222" : "rgba(124,58,237,0.3)",
            cursor: refreshing || countdown !== null ? "not-allowed" : "pointer",
          }}
        >
          <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
          {countdown !== null
            ? formatCountdown(countdown)
            : refreshing
            ? "Actualizando..."
            : "Actualizar"}
        </button>
      </div>

      {refreshError && (
        <p className="text-xs" style={{ color: "#ef4444" }}>{refreshError}</p>
      )}

      <div className="h-px" style={{ backgroundColor: "#1e1e1e" }} />

      {/* Ad Account */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#6b7280" }}>
          Ad Account
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <AccountStatusBadge
            label={health.ad_account.status_label}
            color={health.ad_account.status_color}
          />
          <span className="text-sm" style={{ color: "#9ca3af" }}>
            Gasto total:{" "}
            <span className="text-white font-medium">${health.ad_account.spend_lifetime}</span>
          </span>
          <span
            className="text-sm"
            style={{
              color:
                health.ad_account.ads_disapproved_7d > 0 ? "#ef4444" : "#9ca3af",
            }}
          >
            Ads rechazados (7d):{" "}
            <span className="font-medium">{health.ad_account.ads_disapproved_7d}</span>
          </span>
        </div>
        {health.ad_account.disable_reason && (
          <p className="text-xs" style={{ color: "#ef4444" }}>
            Razón: {health.ad_account.disable_reason}
          </p>
        )}
      </div>

      <div className="h-px" style={{ backgroundColor: "#1e1e1e" }} />

      {/* Campaigns */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#6b7280" }}>
          Campañas activas
        </p>
        {health.campaigns.length === 0 ? (
          <p className="text-sm" style={{ color: "#4b5563" }}>Sin campañas activas</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: "#6b7280" }}>
                  <th className="text-left font-medium pb-2 pr-4">Nombre</th>
                  <th className="text-left font-medium pb-2 pr-4">Estado</th>
                  <th className="text-right font-medium pb-2 pr-4">Budget/día</th>
                  <th className="text-right font-medium pb-2">Gasto 7d</th>
                </tr>
              </thead>
              <tbody>
                {health.campaigns.map((c, i) => (
                  <tr
                    key={i}
                    className="border-t"
                    style={{ borderColor: "#1e1e1e" }}
                  >
                    <td className="py-2 pr-4 text-white truncate max-w-[160px]">{c.name}</td>
                    <td className="py-2 pr-4">
                      <span
                        className="text-xs"
                        style={{
                          color:
                            c.status === "ACTIVE" ? "#22c55e" : "#9ca3af",
                        }}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-right" style={{ color: "#9ca3af" }}>
                      ${c.daily_budget}
                    </td>
                    <td className="py-2 text-right" style={{ color: "#9ca3af" }}>
                      ${c.spend_7d}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="h-px" style={{ backgroundColor: "#1e1e1e" }} />

      {/* Token */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#6b7280" }}>
          Token del System User
        </p>
        <TokenStatus token={health.token} />
      </div>

      <div className="h-px" style={{ backgroundColor: "#1e1e1e" }} />

      {/* Organic */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#6b7280" }}>
          Orgánico
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {health.organic?.facebook_page ? (
            <div className="flex items-center gap-2">
              {health.organic.facebook_page.is_published ? (
                <Wifi className="h-4 w-4 flex-shrink-0" style={{ color: "#22c55e" }} />
              ) : (
                <WifiOff className="h-4 w-4 flex-shrink-0" style={{ color: "#ef4444" }} />
              )}
              <div>
                <p className="text-xs" style={{ color: "#6b7280" }}>Facebook</p>
                <p className="text-sm text-white">{health.organic.facebook_page.name}</p>
                <span
                  className="text-xs"
                  style={{
                    color: health.organic.facebook_page.is_published ? "#22c55e" : "#ef4444",
                  }}
                >
                  {health.organic.facebook_page.is_published ? "Activa" : "Inactiva"}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <WifiOff className="h-4 w-4 flex-shrink-0" style={{ color: "#4b5563" }} />
              <div>
                <p className="text-xs" style={{ color: "#6b7280" }}>Facebook</p>
                <p className="text-sm" style={{ color: "#4b5563" }}>No configurado</p>
              </div>
            </div>
          )}
          {health.organic?.instagram ? (
            <div className="flex items-center gap-2">
              <div
                className="h-4 w-4 flex-shrink-0 rounded flex items-center justify-center text-xs font-bold"
                style={{ background: "linear-gradient(135deg, #e1306c, #f77737, #fcaf45)", color: "white" }}
              >
                ig
              </div>
              <div>
                <p className="text-xs" style={{ color: "#6b7280" }}>Instagram</p>
                <p className="text-sm text-white">@{health.organic.instagram.username}</p>
                <span className="text-xs" style={{ color: "#6b7280" }}>
                  {health.organic.instagram.media_count} posts
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div
                className="h-4 w-4 flex-shrink-0 rounded flex items-center justify-center text-xs font-bold"
                style={{ background: "#1e1e1e", color: "#4b5563" }}
              >
                ig
              </div>
              <div>
                <p className="text-xs" style={{ color: "#6b7280" }}>Instagram</p>
                <p className="text-sm" style={{ color: "#4b5563" }}>No configurado</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HealthPage() {
  const { data: session } = useSession();
  const [healthData, setHealthData] = useState<ProjectHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  const token = session?.accessToken as string | undefined;

  const fetchData = useCallback(async () => {
    if (!token) return;
    try {
      const data = await getHealthSummary(token);
      setHealthData(data);
      setLastFetch(new Date());
      setError(null);
    } catch {
      setError("No se pudo cargar el Health Monitor");
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh every 15 minutes
  useEffect(() => {
    const id = setInterval(fetchData, 15 * 60 * 1000);
    return () => clearInterval(id);
  }, [fetchData]);

  const handleRefreshed = useCallback((updated: ProjectHealth) => {
    setHealthData((prev) =>
      prev.map((h) => (h.project_id === updated.project_id ? updated : h))
    );
  }, []);

  const criticalCount = healthData.filter(
    (h) => h.token?.days_remaining !== null && (h.token?.days_remaining ?? 999) < 30
  ).length;

  return (
    <div className="flex flex-col min-h-screen" style={{ backgroundColor: "#0a0a0a" }}>
      <Header title="Health Monitor" />
      <div className="flex-1 p-6 md:p-8 max-w-7xl mx-auto w-full">
        {/* Page header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-white">Health Monitor</h1>
            {criticalCount > 0 && (
              <span
                className="px-2 py-0.5 rounded-full text-xs font-bold"
                style={{ backgroundColor: "rgba(239,68,68,0.2)", color: "#ef4444" }}
              >
                {criticalCount} alerta{criticalCount > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <p className="text-sm" style={{ color: "#6b7280" }}>
            Estado en tiempo real de todos tus proyectos
          </p>
          {lastFetch && (
            <p className="text-xs mt-1" style={{ color: "#4b5563" }}>
              Datos obtenidos {timeAgo(lastFetch.toISOString())} · Auto-refresh cada 15 min
            </p>
          )}
        </div>

        {/* Error state */}
        {error && (
          <div
            className="rounded-lg p-4 flex items-center gap-3 mb-6"
            style={{ backgroundColor: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)" }}
          >
            <AlertTriangle className="h-5 w-5 flex-shrink-0" style={{ color: "#ef4444" }} />
            <p className="text-sm" style={{ color: "#ef4444" }}>{error}</p>
          </div>
        )}

        {/* Loading */}
        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {[1, 2].map((i) => <HealthCardSkeleton key={i} />)}
          </div>
        ) : healthData.length === 0 ? (
          <div className="text-center py-20" style={{ color: "#4b5563" }}>
            <p className="text-lg">No hay proyectos disponibles</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {healthData.map((h) => (
              <ProjectHealthCard
                key={h.project_id}
                health={h}
                sessionToken={token ?? ""}
                onRefreshed={handleRefreshed}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

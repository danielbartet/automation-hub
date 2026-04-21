"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Header } from "@/components/layout/Header";
import { useProject } from "@/lib/project-context";
import { Loader2, ExternalLink } from "lucide-react";
import { adaptCompetitorAd } from "@/lib/api";

interface HookEntry {
  page_name: string;
  headline: string;
  body: string;
  days_active: number;
  start_date: string;
  snapshot_url: string;
}

type DaysFilter = "all" | "7" | "14" | "30";

const FILTER_OPTIONS: { label: string; value: DaysFilter }[] = [
  { label: "Todos", value: "all" },
  { label: "+7 días", value: "7" },
  { label: "+14 días", value: "14" },
  { label: "+30 días", value: "30" },
];

export default function HookLibraryPage() {
  const { data: session } = useSession();
  const token = (session as { accessToken?: string } | null)?.accessToken ?? "";
  const { selectedSlug } = useProject();
  const [hooks, setHooks] = useState<HookEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<DaysFilter>("all");
  const [adaptingIndex, setAdaptingIndex] = useState<number | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const loadHooks = useCallback(() => {
    if (!selectedSlug || !token) return;
    setLoading(true);
    setError(null);
    const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
    fetch(`${api}/api/v1/competitor-intelligence/${selectedSlug}/hooks`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error("Failed to fetch hooks");
        return r.json();
      })
      .then((data: HookEntry[]) => setHooks(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [selectedSlug, token]);

  useEffect(() => {
    loadHooks();
  }, [loadHooks]);

  const filteredHooks = hooks.filter((h) => {
    if (filter === "all") return true;
    return h.days_active >= parseInt(filter, 10);
  });

  const handleAdapt = async (hook: HookEntry, index: number) => {
    if (!selectedSlug) return;
    setAdaptingIndex(index);
    try {
      await adaptCompetitorAd(selectedSlug, token, {
        ad_index: index,
        competitor_ad: {
          page_name: hook.page_name,
          body: hook.body,
          title: hook.headline,
          days_active: hook.days_active,
          competitor: hook.page_name,
          platforms: [],
          snapshot_url: hook.snapshot_url,
        },
        analysis: {
          index,
          hook_analysis: "",
          psychological_angle: "",
          inferred_objective: "OUTCOME_LEADS",
          audience_signal: "",
          strength: "",
          opportunity: "",
          days_active_signal: `${hook.days_active} days active`,
        },
      });
      showToast("Concepto adaptado generado. Abrí Crear Campaña para usarlo.", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Error al adaptar el anuncio", "error");
    } finally {
      setAdaptingIndex(null);
    }
  };

  return (
    <div>
      <Header title="Hook Library" />
      <div className="p-6 space-y-6">
        {/* Title block */}
        <div>
          <h2 className="text-xl font-semibold text-white">Hook Library</h2>
          <p className="text-sm mt-1" style={{ color: "#9ca3af" }}>
            Anuncios de competidores — ordenados por duración
          </p>
        </div>

        {/* Cache freshness disclaimer */}
        <div
          className="flex items-start gap-2 rounded-md px-4 py-3 text-xs"
          style={{ backgroundColor: "#451a03", border: "1px solid #92400e", color: "#fcd34d" }}
        >
          <span className="mt-0.5 shrink-0">⚠</span>
          <span>
            Los datos provienen del caché de Apify (hasta 48h de antigüedad). Algunos anuncios pueden haber sido pausados desde la última actualización. El estado mostrado es una estimación — verificá el anuncio original antes de usarlo como referencia.
          </span>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1" style={{ borderBottom: "1px solid #222222" }}>
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value)}
              className="px-4 py-2 text-sm font-medium transition-colors"
              style={
                filter === opt.value
                  ? { color: "#ffffff", borderBottom: "2px solid #7c3aed" }
                  : { color: "#9ca3af", borderBottom: "2px solid transparent" }
              }
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div
            className="rounded-md p-4 text-sm text-red-400"
            style={{ backgroundColor: "#450a0a", border: "1px solid #7f1d1d" }}
          >
            Error: {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center h-40 text-sm" style={{ color: "#9ca3af" }}>
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Cargando hooks...
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && filteredHooks.length === 0 && (
          <div
            className="rounded-lg flex items-center justify-center h-48 text-sm"
            style={{ backgroundColor: "#111111", border: "1px solid #222222", color: "#9ca3af" }}
          >
            {hooks.length === 0
              ? "Configurá competidores en Settings → Proyecto para ver sus hooks"
              : "No hay hooks con esa duración mínima"}
          </div>
        )}

        {/* Hooks table */}
        {!loading && filteredHooks.length > 0 && (
          <div className="rounded-lg overflow-hidden" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
            <table className="w-full text-sm">
              <thead style={{ backgroundColor: "#111111", borderBottom: "1px solid #222222" }}>
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-xs" style={{ color: "#9ca3af" }}>Competidor</th>
                  <th className="text-left px-4 py-3 font-medium text-xs" style={{ color: "#9ca3af" }}>Hook</th>
                  <th className="text-left px-4 py-3 font-medium text-xs" style={{ color: "#9ca3af" }}>Días activo</th>
                  <th className="text-left px-4 py-3 font-medium text-xs" style={{ color: "#9ca3af" }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredHooks.map((hook, i) => (
                  <tr
                    key={`${hook.page_name}-${i}`}
                    style={{ borderTop: i > 0 ? "1px solid #1a1a1a" : undefined }}
                  >
                    {/* Competitor */}
                    <td className="px-4 py-3 align-top" style={{ color: "#d1d5db", whiteSpace: "nowrap", minWidth: "120px" }}>
                      {hook.page_name || "—"}
                    </td>

                    {/* Hook preview */}
                    <td className="px-4 py-3 align-top max-w-xs">
                      {hook.headline && (
                        <p className="font-semibold text-white text-sm leading-snug mb-1">{hook.headline}</p>
                      )}
                      {hook.body && (
                        <p className="text-xs leading-relaxed" style={{ color: "#9ca3af" }}>
                          {hook.body.slice(0, 80)}{hook.body.length > 80 ? "…" : ""}
                        </p>
                      )}
                    </td>

                    {/* Days active badge */}
                    <td className="px-4 py-3 align-top">
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                        style={
                          hook.days_active >= 30
                            ? { backgroundColor: "#052e16", color: "#4ade80", border: "1px solid #166534" }
                            : hook.days_active >= 14
                            ? { backgroundColor: "#1c1917", color: "#fb923c", border: "1px solid #7c2d12" }
                            : { backgroundColor: "#111111", color: "#9ca3af", border: "1px solid #333333" }
                        }
                      >
                        {hook.days_active}d
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 align-top">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleAdapt(hook, i)}
                          disabled={adaptingIndex === i}
                          className="px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-colors disabled:opacity-50"
                          style={{ backgroundColor: "#7c3aed" }}
                          onMouseEnter={e => { if (!(e.currentTarget as HTMLButtonElement).disabled) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#6d28d9"; }}
                          onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#7c3aed"}
                        >
                          {adaptingIndex === i ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            "Adaptar"
                          )}
                        </button>
                        {hook.snapshot_url && (
                          <a
                            href={hook.snapshot_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:text-blue-300 transition-colors"
                            title="Ver anuncio original"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Result count */}
        {!loading && filteredHooks.length > 0 && (
          <p className="text-xs" style={{ color: "#6b7280" }}>
            Mostrando {filteredHooks.length} de {hooks.length} hooks
          </p>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg text-sm font-medium text-white shadow-lg"
          style={{
            backgroundColor: toast.type === "success" ? "#052e16" : "#450a0a",
            border: `1px solid ${toast.type === "success" ? "#166534" : "#7f1d1d"}`,
          }}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}

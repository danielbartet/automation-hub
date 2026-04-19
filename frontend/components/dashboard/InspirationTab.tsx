"use client";
import { useState, useEffect, useCallback } from "react";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import {
  fetchCompetitorAds,
  adaptCompetitorAd,
  type CompetitorAd,
  type CompetitorAdAnalysis,
  type InspirationPrefill,
} from "@/lib/api";
import { useT } from "@/lib/i18n";

interface AdInspirationCardProps {
  ad: CompetitorAd;
  index: number;
  adapting: boolean;
  onReplicate: () => void;
  t: ReturnType<typeof useT>;
}

function formatLikes(n?: number): string {
  if (!n) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M seg.`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K seg.`;
  return `${n} seg.`;
}

function AdInspirationCard({ ad, index, adapting, onReplicate, t }: AdInspirationCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isLong = ad.body.length > 120;
  const displayBody = expanded || !isLong ? ad.body : ad.body.slice(0, 120) + "…";
  const likesLabel = formatLikes(ad.page_like_count);
  const initials = ad.page_name ? ad.page_name.slice(0, 2).toUpperCase() : "??";

  return (
    <div
      className="rounded-lg p-4 space-y-3"
      style={{ backgroundColor: "#111111", border: "1px solid #222222" }}
    >
      {/* Header row: avatar + page name + active badge */}
      <div className="flex items-center gap-2 flex-wrap">
        {ad.page_avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ad.page_avatar}
            alt={ad.page_name}
            className="rounded-full w-8 h-8 object-cover flex-shrink-0"
          />
        ) : (
          <div
            className="rounded-full w-8 h-8 flex items-center justify-center flex-shrink-0 text-xs font-bold"
            style={{ backgroundColor: "#2d1b69", color: "#a5b4fc" }}
          >
            {initials}
          </div>
        )}
        <p className="text-sm font-semibold text-white flex-1 min-w-0 truncate">{ad.page_name}</p>
        <span
          className="px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0"
          style={
            ad.is_active
              ? { backgroundColor: "#052e16", color: "#4ade80", border: "1px solid #166534" }
              : { backgroundColor: "#1a1a1a", color: "#6b7280", border: "1px solid #333" }
          }
        >
          {ad.is_active ? "Activo" : "Inactivo"}
        </span>
      </div>

      {/* Metrics row */}
      <div className="flex items-center gap-2 flex-wrap">
        {likesLabel && (
          <span
            className="px-2 py-0.5 rounded-full text-xs font-medium"
            style={
              (ad.page_like_count ?? 0) >= 1_000_000
                ? { backgroundColor: "#451a03", color: "#fbbf24", border: "1px solid #92400e" }
                : { backgroundColor: "#1a1a1a", color: "#9ca3af", border: "1px solid #333333" }
            }
          >
            {likesLabel}
          </span>
        )}
        {ad.platforms.map((p) => (
          <span
            key={p}
            className="px-2 py-0.5 rounded-full text-xs font-medium"
            style={{ backgroundColor: "#1a1a1a", color: "#9ca3af", border: "1px solid #333333" }}
          >
            {p}
          </span>
        ))}
        <span
          className="px-2 py-0.5 rounded-full text-xs font-medium"
          style={
            ad.days_active >= 30
              ? { backgroundColor: "#451a03", color: "#fbbf24", border: "1px solid #92400e" }
              : { backgroundColor: "#1a1a1a", color: "#9ca3af", border: "1px solid #333333" }
          }
        >
          {t.ads_inspiration_days_active(ad.days_active)}
        </span>
        {(ad.variations ?? 1) > 1 && (
          <span
            className="px-2 py-0.5 rounded-full text-xs font-medium"
            style={{ backgroundColor: "#1e1b4b", color: "#a5b4fc", border: "1px solid #3730a3" }}
          >
            {ad.variations} variaciones
          </span>
        )}
      </div>

      {/* Ad creative image */}
      {ad.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={ad.image_url}
          alt="Ad creative"
          className="w-full rounded-lg object-cover max-h-40"
        />
      )}

      {/* Body text */}
      <div>
        <p className="text-sm leading-relaxed" style={{ color: "#d1d5db" }}>
          {displayBody}
        </p>
        {isLong && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs mt-1 transition-colors"
            style={{ color: "#7c3aed" }}
          >
            {expanded ? t.ads_inspiration_see_less : t.ads_inspiration_see_more}
          </button>
        )}
      </div>

      {/* CTA badge */}
      {ad.cta_text && (
        <span
          className="inline-block px-2 py-0.5 rounded-full text-xs font-medium"
          style={{ backgroundColor: "#0f0a1e", color: "#c084fc", border: "1px solid #7c3aed" }}
        >
          {ad.cta_text}
        </span>
      )}

      {/* Analysis section */}
      {ad.analysis && (
        <div className="space-y-2 pt-2" style={{ borderTop: "1px solid #1f1f1f" }}>
          {ad.analysis.hook_analysis && (
            <p className="text-xs" style={{ color: "#6b7280" }}>
              <span className="font-medium" style={{ color: "#9ca3af" }}>{t.ads_inspiration_hook}: </span>
              {ad.analysis.hook_analysis}
            </p>
          )}
          {ad.analysis.strength && (
            <p className="text-xs">
              <span className="font-medium" style={{ color: "#9ca3af" }}>{t.ads_inspiration_strength}: </span>
              <span style={{ color: "#4ade80" }}>{ad.analysis.strength}</span>
            </p>
          )}
          {ad.analysis.opportunity && (
            <p className="text-xs">
              <span className="font-medium" style={{ color: "#9ca3af" }}>{t.ads_inspiration_opportunity}: </span>
              <span style={{ color: "#c084fc" }}>{ad.analysis.opportunity}</span>
            </p>
          )}
          {ad.analysis.psychological_angle && (
            <span
              className="inline-block px-2 py-0.5 rounded-full text-xs font-medium"
              style={{ backgroundColor: "#1e1b4b", color: "#a5b4fc", border: "1px solid #3730a3" }}
            >
              {t.ads_inspiration_angle}: {ad.analysis.psychological_angle}
            </span>
          )}
          {ad.analysis.days_active_signal && (
            <p className="text-xs" style={{ color: "#6b7280" }}>
              {ad.analysis.days_active_signal}
            </p>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center gap-3 pt-1 flex-wrap">
        {ad.snapshot_url && (
          <Link
            href={ad.snapshot_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs transition-colors"
            style={{ color: "#60a5fa" }}
          >
            {t.ads_inspiration_see_original}
          </Link>
        )}
        <button
          onClick={onReplicate}
          disabled={adapting}
          className="ml-auto flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-colors disabled:opacity-50"
          style={{ backgroundColor: "#7c3aed" }}
          onMouseEnter={(e) => {
            if (!(e.currentTarget as HTMLButtonElement).disabled)
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#6d28d9";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#7c3aed";
          }}
        >
          {adapting ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              {t.ads_inspiration_replicating}
            </>
          ) : (
            t.ads_inspiration_replicate
          )}
        </button>
      </div>
    </div>
  );
}

interface InspirationTabProps {
  projectSlug: string;
  token: string;
  onAdapted: (prefill: InspirationPrefill) => void;
}

export default function InspirationTab({ projectSlug, token, onAdapted }: InspirationTabProps) {
  const t = useT();
  const [ads, setAds] = useState<CompetitorAd[]>([]);
  const [competitorsConfigured, setCompetitorsConfigured] = useState<boolean | null>(null);
  const [apifyPending, setApifyPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adapting, setAdapting] = useState<number | null>(null);

  const loadAds = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchCompetitorAds(projectSlug, token)
      .then((data) => {
        setAds(data.ads);
        setCompetitorsConfigured(data.competitors_configured ?? true);
        setApifyPending(data.apify_pending ?? false);
      })
      .catch((err) => setError(err instanceof Error ? err.message : t.ads_inspiration_error))
      .finally(() => setLoading(false));
  }, [projectSlug, token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadAds();
  }, [loadAds]);

  const handleReplicate = async (ad: CompetitorAd, index: number) => {
    if (!ad.analysis) return;
    setAdapting(index);
    try {
      const result = await adaptCompetitorAd(projectSlug, token, {
        ad_index: index,
        competitor_ad: ad,
        analysis: ad.analysis as CompetitorAdAnalysis,
      });
      onAdapted(result.prefill);
    } catch {
      // silently fail — user can retry
    } finally {
      setAdapting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 gap-2" style={{ color: "#9ca3af" }}>
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">{t.ads_inspiration_loading}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-3">
        <p className="text-sm text-red-400">{error}</p>
        <button
          onClick={loadAds}
          className="px-4 py-2 text-sm font-medium text-white rounded-lg"
          style={{ backgroundColor: "#7c3aed" }}
        >
          {t.ads_inspiration_retry}
        </button>
      </div>
    );
  }

  if (ads.length === 0) {
    const noConfig = competitorsConfigured === false;

    if (noConfig) {
      return (
        <div
          className="rounded-lg p-8 text-center"
          style={{ backgroundColor: "#111111", border: "1px solid #222222" }}
        >
          <p className="text-sm mb-3" style={{ color: "#9ca3af" }}>
            {t.ads_inspiration_empty}
          </p>
          <Link
            href="/dashboard/settings"
            className="text-xs font-medium transition-colors"
            style={{ color: "#7c3aed" }}
          >
            Configuración del proyecto →
          </Link>
        </div>
      );
    }

    if (apifyPending) {
      return (
        <div
          className="rounded-lg p-8 text-center space-y-3"
          style={{ backgroundColor: "#111111", border: "1px solid #222222" }}
        >
          <p className="text-sm font-semibold" style={{ color: "#d1d5db" }}>
            Anuncios reales de competidores
          </p>
          <p className="text-sm" style={{ color: "#9ca3af" }}>
            Conectá Apify para ver anuncios reales de competidores.
          </p>
          <p className="text-xs" style={{ color: "#6b7280" }}>
            Esta función requiere integración con Apify. Mientras tanto, el análisis de competidores
            está disponible para la generación de contenido orgánico.
          </p>
        </div>
      );
    }

    return (
      <div
        className="rounded-lg p-8 text-center"
        style={{ backgroundColor: "#111111", border: "1px solid #222222" }}
      >
        <p className="text-sm mb-3" style={{ color: "#9ca3af" }}>
          No se encontraron anuncios activos para los competidores configurados.
        </p>
        <button
          onClick={loadAds}
          className="text-xs font-medium transition-colors"
          style={{ color: "#7c3aed", background: "none", border: "none", cursor: "pointer" }}
        >
          {t.ads_inspiration_retry}
        </button>
      </div>
    );
  }

  // Group ads by competitor (fall back to page_name)
  const grouped = ads.reduce((acc, ad) => {
    const key = ad.competitor || ad.page_name;
    if (!acc[key]) acc[key] = [];
    acc[key].push(ad);
    return acc;
  }, {} as Record<string, CompetitorAd[]>);

  const competitors = Object.keys(grouped);
  const colClass =
    competitors.length >= 3
      ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
      : competitors.length === 2
      ? "grid-cols-1 md:grid-cols-2"
      : "grid-cols-1";

  return (
    <div className="space-y-4">
      <div className={`grid ${colClass} gap-6`}>
        {competitors.map((competitorKey) => (
          <div key={competitorKey} className="flex flex-col gap-3">
            <p
              className="text-xs font-semibold tracking-widest uppercase pb-2"
              style={{ color: "#9ca3af", borderBottom: "1px solid #222222" }}
            >
              {competitorKey}
            </p>
            {grouped[competitorKey].map((ad) => {
              const globalIndex = ads.indexOf(ad);
              return (
                <AdInspirationCard
                  key={`${ad.competitor}-${ad.snapshot_url || ad.body.slice(0, 20)}`}
                  ad={ad}
                  index={globalIndex}
                  adapting={adapting === globalIndex}
                  onReplicate={() => handleReplicate(ad, globalIndex)}
                  t={t}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

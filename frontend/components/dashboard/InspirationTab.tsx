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

function AdInspirationCard({ ad, index, adapting, onReplicate, t }: AdInspirationCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isLong = ad.body.length > 120;
  const displayBody = expanded || !isLong ? ad.body : ad.body.slice(0, 120) + "…";

  return (
    <div
      className="rounded-lg p-4 space-y-3"
      style={{ backgroundColor: "#111111", border: "1px solid #222222" }}
    >
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <p className="text-sm font-semibold text-white">{ad.page_name}</p>
        <div className="flex items-center gap-2 flex-wrap">
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
        </div>
      </div>

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adapting, setAdapting] = useState<number | null>(null);

  const loadAds = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchCompetitorAds(projectSlug, token)
      .then((data) => setAds(data.ads))
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
          Project settings →
        </Link>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {ads.map((ad, i) => (
        <AdInspirationCard
          key={`${ad.competitor}-${ad.snapshot_url || ad.body.slice(0, 20)}`}
          ad={ad}
          index={i}
          adapting={adapting === i}
          onReplicate={() => handleReplicate(ad, i)}
          t={t}
        />
      ))}
    </div>
  );
}

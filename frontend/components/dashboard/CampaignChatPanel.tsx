"use client";

import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { Loader2, MessageSquare, RotateCcw } from "lucide-react";
import { useT, useLang } from "@/lib/i18n";
import {
  campaignChat,
  fetchCampaignsBySlug,
  type CampaignChatQuestionKey,
  type CampaignChatResponse,
  type CampaignSummary,
} from "@/lib/api";

interface Question {
  key: CampaignChatQuestionKey;
  labelKey:
    | "ads_chat_q_how_are_campaigns"
    | "ads_chat_q_wasting_money"
    | "ads_chat_q_change_this_week"
    | "ads_chat_q_creative_fatigue"
    | "ads_chat_q_ready_to_scale";
}

const QUESTIONS: Question[] = [
  { key: "how_are_campaigns", labelKey: "ads_chat_q_how_are_campaigns" },
  { key: "wasting_money", labelKey: "ads_chat_q_wasting_money" },
  { key: "change_this_week", labelKey: "ads_chat_q_change_this_week" },
  { key: "creative_fatigue", labelKey: "ads_chat_q_creative_fatigue" },
  { key: "ready_to_scale", labelKey: "ads_chat_q_ready_to_scale" },
];

interface Props {
  projectSlug: string;
}

export function CampaignChatPanel({ projectSlug }: Props) {
  const t = useT();
  const { lang } = useLang();
  const { data: session } = useSession();
  const token = (session as { accessToken?: string } | null)?.accessToken ?? "";

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CampaignChatResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeQuestion, setActiveQuestion] = useState<CampaignChatQuestionKey | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Campaign selector state
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null);

  // Load campaigns when projectSlug changes
  useEffect(() => {
    if (!projectSlug || !token) return;
    setLoadingCampaigns(true);
    setSelectedCampaignId(null);
    setCampaigns([]);
    fetchCampaignsBySlug(token, projectSlug)
      .then((list) => {
        const visible = list.filter((c) => c.status?.toLowerCase() !== "archived");
        setCampaigns(visible);
        // Auto-select if only one campaign
        if (visible.length === 1) {
          setSelectedCampaignId(visible[0].id);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingCampaigns(false));
  }, [projectSlug, token]);

  // Reset chat state when project or campaign changes
  useEffect(() => {
    setResult(null);
    setError(null);
    setActiveQuestion(null);
  }, [projectSlug, selectedCampaignId]);

  // Tick cooldown countdown
  useEffect(() => {
    if (cooldownSeconds > 0) {
      cooldownRef.current = setInterval(() => {
        setCooldownSeconds((s) => {
          if (s <= 1) {
            if (cooldownRef.current) clearInterval(cooldownRef.current);
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    }
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, [cooldownSeconds]);

  const cooldownMinutes = Math.ceil(cooldownSeconds / 60);

  const handleQuestion = async (questionKey: CampaignChatQuestionKey) => {
    if (loading || cooldownSeconds > 0) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setActiveQuestion(questionKey);

    try {
      const data = await campaignChat(token, projectSlug, questionKey, lang, selectedCampaignId);
      setResult(data);
      if (data.cooldown_remaining_seconds > 0) {
        setCooldownSeconds(data.cooldown_remaining_seconds);
      } else {
        // Start 15-min cooldown after successful call
        setCooldownSeconds(15 * 60);
      }
    } catch (err: unknown) {
      const e = err as Error & { cooldown_remaining_seconds?: number };
      if (e.message === "cooldown" && e.cooldown_remaining_seconds) {
        setCooldownSeconds(e.cooldown_remaining_seconds);
        setError(null);
      } else {
        setError(e.message || t.ads_chat_error);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setResult(null);
    setError(null);
    setActiveQuestion(null);
  };

  const selectedCampaign = campaigns.find((c) => c.id === selectedCampaignId) ?? null;

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ backgroundColor: "#111111", border: "1px solid #222222" }}
    >
      {/* Header */}
      <div
        className="px-6 py-4 flex items-center gap-3"
        style={{ borderBottom: "1px solid #222222" }}
      >
        <MessageSquare className="h-4 w-4 text-purple-400 flex-shrink-0" />
        <div>
          <h3 className="text-base font-semibold text-white">{t.ads_chat_title}</h3>
          <p className="text-xs mt-0.5" style={{ color: "#9ca3af" }}>
            {t.ads_chat_subtitle}
          </p>
        </div>
      </div>

      <div className="p-6 space-y-4">
        {/* Campaign selector */}
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium flex-shrink-0" style={{ color: "#9ca3af" }}>
            {t.ads_chat_campaign_label}
          </label>
          {loadingCampaigns ? (
            <div className="flex items-center gap-2 text-sm" style={{ color: "#6b7280" }}>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            </div>
          ) : (
            <select
              value={selectedCampaignId ?? ""}
              onChange={(e) =>
                setSelectedCampaignId(e.target.value === "" ? null : Number(e.target.value))
              }
              className="text-sm rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
              style={{
                backgroundColor: "#1a1a1a",
                border: "1px solid #333333",
                color: "#ffffff",
                minWidth: "200px",
              }}
            >
              <option value="">{t.ads_chat_campaign_all}</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {selectedCampaign && (
            <span
              className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: "#14532d", color: "#4ade80" }}
            >
              active
            </span>
          )}
        </div>

        {/* Cooldown banner */}
        {cooldownSeconds > 0 && !loading && !result && (
          <div
            className="rounded-md px-4 py-3 text-sm text-yellow-400"
            style={{ backgroundColor: "#2d2d00", border: "1px solid #4a4a00" }}
          >
            {t.ads_chat_cooldown(cooldownMinutes)}
          </div>
        )}

        {/* Question buttons — show when no result and not loading */}
        {!result && !loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {QUESTIONS.map((q) => (
              <button
                key={q.key}
                onClick={() => handleQuestion(q.key)}
                disabled={cooldownSeconds > 0}
                className="text-left px-4 py-3 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  backgroundColor: "#1a1a1a",
                  border: "1px solid #333333",
                  color: "#e5e7eb",
                }}
                onMouseEnter={(e) => {
                  if (!(e.currentTarget as HTMLButtonElement).disabled) {
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#222222";
                    (e.currentTarget as HTMLButtonElement).style.borderColor = "#7c3aed";
                  }
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1a1a1a";
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "#333333";
                }}
              >
                {t[q.labelKey] as string}
              </button>
            ))}
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-10 gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-purple-400" />
            <p className="text-sm" style={{ color: "#9ca3af" }}>
              {t.ads_chat_loading}
            </p>
            {activeQuestion && (
              <p className="text-xs px-3 py-1.5 rounded-full" style={{ backgroundColor: "#1a1a1a", color: "#7c3aed" }}>
                {t[QUESTIONS.find((q) => q.key === activeQuestion)!.labelKey] as string}
              </p>
            )}
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div className="rounded-md p-4 text-sm text-red-400" style={{ backgroundColor: "#450a0a", border: "1px solid #7f1d1d" }}>
            {error}
          </div>
        )}

        {/* Result */}
        {result && !loading && (
          <div className="space-y-4">
            {/* Active question label */}
            {activeQuestion && (
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="text-xs px-3 py-1.5 rounded-full font-medium"
                  style={{ backgroundColor: "#1a1a1a", color: "#a78bfa" }}
                >
                  {t[QUESTIONS.find((q) => q.key === activeQuestion)!.labelKey] as string}
                </span>
                {selectedCampaign && (
                  <span
                    className="text-xs px-3 py-1.5 rounded-full font-medium"
                    style={{ backgroundColor: "#1a1a1a", color: "#6b7280" }}
                  >
                    {selectedCampaign.name}
                  </span>
                )}
              </div>
            )}

            {/* Answer */}
            <div
              className="rounded-lg p-4 text-sm leading-relaxed whitespace-pre-wrap"
              style={{
                backgroundColor: "#0d0d0d",
                border: "1px solid #1a1a1a",
                color: "#e5e7eb",
              }}
            >
              {result.answer}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-xs" style={{ color: "#6b7280" }}>
                {t.ads_chat_generated_at}:{" "}
                {new Date(result.generated_at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {cooldownSeconds > 0 && (
                  <span className="ml-3 text-yellow-500">
                    · {t.ads_chat_cooldown(cooldownMinutes)}
                  </span>
                )}
              </span>
              <button
                onClick={handleReset}
                disabled={cooldownSeconds > 0}
                className="flex items-center gap-1.5 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ color: "#9ca3af" }}
                onMouseEnter={(e) => {
                  if (!(e.currentTarget as HTMLButtonElement).disabled)
                    (e.currentTarget as HTMLButtonElement).style.color = "#ffffff";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af";
                }}
              >
                <RotateCcw className="h-3 w-3" />
                {t.ads_chat_ask_another}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

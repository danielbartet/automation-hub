"use client";
import { useState, useEffect } from "react";
import { Calendar, Sparkles, Clock, AlertTriangle, RefreshCw, CalendarDays, Loader2 } from "lucide-react";
import { recommendToday } from "@/lib/api";

type RecommendationData = Awaited<ReturnType<typeof recommendToday>>;

interface WhatToPostTodayCardProps {
  projectSlug: string;
  onGenerateContent: (hint: string, format: string, category: string) => void;
  onPlanWeek: () => void;
}

const FORMAT_LABELS: Record<string, string> = {
  carousel_6_slides: "Carrusel",
  single_image: "Imagen",
  text_post: "Texto",
  story: "Historia",
  reel: "Reel",
};

const ANGLE_COLORS: Record<string, string> = {
  Logical: "bg-blue-900/50 text-blue-300 border-blue-700",
  Emotional: "bg-rose-900/50 text-rose-300 border-rose-700",
  "Social Proof": "bg-green-900/50 text-green-300 border-green-700",
  "Problem-Solution": "bg-orange-900/50 text-orange-300 border-orange-700",
  Comparative: "bg-purple-900/50 text-purple-300 border-purple-700",
  Identity: "bg-violet-900/50 text-violet-300 border-violet-700",
};

function getTodayLabel() {
  return new Date().toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).replace(/^\w/, (c) => c.toUpperCase());
}

export function WhatToPostTodayCard({ projectSlug, onGenerateContent, onPlanWeek }: WhatToPostTodayCardProps) {
  const [state, setState] = useState<"collapsed" | "loading" | "recommendation">("collapsed");
  const [data, setData] = useState<RecommendationData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setState("collapsed");
    setData(null);
    setError(null);
  }, [projectSlug]);

  const handleGetRecommendation = async (forceRefresh = false) => {
    setState("loading");
    setError(null);
    try {
      const result = await recommendToday(projectSlug, forceRefresh);
      setData(result);
      setState("recommendation");
    } catch {
      setError("No se pudo obtener la recomendación. Intenta de nuevo.");
      setState("collapsed");
    }
  };

  const handleGenerateNow = () => {
    if (!data) return;
    const hint =
      data.quick_actions.find((a) => a.action === "generate")?.topic_hint ||
      data.recommendation.suggested_topic;
    const format = data.recommendation.format || "carousel_6_slides";
    const category = (data.recommendation as { suggested_category?: string }).suggested_category || "";
    onGenerateContent(hint, format, category);
  };

  const urgency = data?.urgency ?? "medium";

  const urgencyDot =
    urgency === "high"
      ? { color: "#ef4444", label: "Conviene publicar hoy" }
      : urgency === "low"
      ? { color: "#9ca3af", label: "Podés esperar si no tenés contenido listo" }
      : { color: "#f59e0b", label: "Buen momento para publicar" };

  const formatLabel = data ? (FORMAT_LABELS[data.recommendation.format] ?? data.recommendation.format) : "";
  const angleKey = data?.recommendation.content_angle ?? "";
  const angleClass = ANGLE_COLORS[angleKey] ?? "bg-gray-800 text-gray-300 border-gray-600";

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ backgroundColor: "#111111", border: "1px solid #222222" }}
    >
      {/* Collapsed / header row */}
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <Calendar className="h-5 w-5 flex-shrink-0" style={{ color: "#7c3aed" }} />
          <div>
            <p className="text-sm font-semibold text-white">¿Qué publico hoy?</p>
            <p className="text-xs" style={{ color: "#9ca3af" }}>{getTodayLabel()}</p>
          </div>
        </div>
        {state !== "recommendation" && (
          <button
            onClick={() => handleGetRecommendation(false)}
            disabled={state === "loading"}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 transition-colors"
            style={{ backgroundColor: "#7c3aed" }}
            onMouseEnter={(e) => { if (state !== "loading") (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#6d28d9"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#7c3aed"; }}
          >
            <Sparkles className="h-4 w-4" />
            Obtener recomendación
          </button>
        )}
      </div>

      {/* Loading state */}
      {state === "loading" && (
        <div className="px-6 pb-5 flex items-center gap-3" style={{ borderTop: "1px solid #1a1a1a" }}>
          <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" style={{ color: "#9ca3af" }} />
          <p className="text-sm italic" style={{ color: "#9ca3af" }}>Analizando tu historial...</p>
        </div>
      )}

      {/* Error */}
      {error && state === "collapsed" && (
        <div className="px-6 pb-4">
          <p className="text-xs" style={{ color: "#fca5a5" }}>{error}</p>
        </div>
      )}

      {/* Recommendation state */}
      {state === "recommendation" && data && (
        <div
          className="px-6 pb-6 flex flex-col md:flex-row gap-6"
          style={{ borderTop: "1px solid #1a1a1a", paddingTop: "1.25rem" }}
        >
          {/* Left side */}
          <div className="flex-1 space-y-3">
            {/* Urgency indicator */}
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: urgencyDot.color }}
              />
              <span className="text-xs font-medium" style={{ color: urgencyDot.color }}>
                {urgencyDot.label}
              </span>
            </div>

            {/* Badges */}
            <div className="flex flex-wrap gap-2">
              <span
                className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border"
                style={{ backgroundColor: "#1a1a1a", borderColor: "#333333", color: "#d1d5db" }}
              >
                {formatLabel}
              </span>
              {angleKey && (
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${angleClass}`}
                >
                  {angleKey}
                </span>
              )}
            </div>

            {/* Topic */}
            <p className="text-lg font-bold text-white leading-snug">
              {data.recommendation.suggested_topic}
            </p>

            {/* Hook */}
            <blockquote
              className="text-sm italic"
              style={{
                borderLeft: "3px solid #7c3aed",
                paddingLeft: "0.75rem",
                color: "#9ca3af",
              }}
            >
              {data.recommendation.suggested_hook}
            </blockquote>

            {/* Best time */}
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 flex-shrink-0" style={{ color: "#9ca3af" }} />
              <span className="text-xs" style={{ color: "#9ca3af" }}>
                Mejor hora: {data.recommendation.best_time_to_post}
              </span>
            </div>

            {/* What to avoid */}
            {data.recommendation.what_to_avoid && (
              <div className="flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" style={{ color: "#f59e0b" }} />
                <span className="text-xs" style={{ color: "#f59e0b" }}>
                  Evitar hoy: {data.recommendation.what_to_avoid}
                </span>
              </div>
            )}
          </div>

          {/* Right side — actions */}
          <div className="flex flex-col gap-2 md:w-52">
            <button
              onClick={handleGenerateNow}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white transition-colors"
              style={{ backgroundColor: "#7c3aed" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#6d28d9"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#7c3aed"; }}
            >
              <Sparkles className="h-4 w-4" />
              Generar ahora
            </button>

            <button
              onClick={() => handleGetRecommendation(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
              style={{
                backgroundColor: "transparent",
                border: "1px solid #333333",
                color: "#9ca3af",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = "#e5e7eb";
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1a1a1a";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af";
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent";
              }}
            >
              <RefreshCw className="h-4 w-4" />
              Otra sugerencia
            </button>

            <button
              onClick={onPlanWeek}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
              style={{
                backgroundColor: "transparent",
                border: "1px solid #333333",
                color: "#9ca3af",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = "#e5e7eb";
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1a1a1a";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af";
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent";
              }}
            >
              <CalendarDays className="h-4 w-4" />
              Planificar la semana
            </button>

            <p className="text-xs text-center mt-1" style={{ color: "#6b7280" }}>
              Recomendación basada en tu historial y análisis del mercado.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

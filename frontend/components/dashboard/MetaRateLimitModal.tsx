"use client";

import { AlertTriangle, X, ExternalLink } from "lucide-react";

export interface MetaRateLimitDetail {
  code: "META_RATE_LIMIT";
  buc?: string;
  usage_pct?: number;
  estimated_reset_minutes?: number;
  message?: string;
}

interface Props {
  detail: MetaRateLimitDetail;
  onClose: () => void;
}

export function MetaRateLimitModal({ detail, onClose }: Props) {
  const resetMinutes = detail.estimated_reset_minutes ?? null;
  const usagePct = detail.usage_pct ?? null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[200] p-4">
      <div
        className="relative w-full max-w-md rounded-2xl border border-amber-500/30 bg-[#1a1510] text-white shadow-2xl"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="rate-limit-title"
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-400 hover:text-white transition-colors"
          aria-label="Cerrar"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-start gap-4 p-6 pb-4">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h2
              id="rate-limit-title"
              className="text-lg font-semibold text-amber-300"
            >
              Límite de Meta API alcanzado
            </h2>
            <p className="text-sm text-zinc-400 mt-0.5">
              {detail.buc ? `Tipo: ${detail.buc}` : "Marketing API"}
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 pb-4 space-y-4">
          <p className="text-sm text-zinc-300 leading-relaxed">
            Se alcanzó el límite de llamadas a la API de Meta para esta cuenta
            publicitaria. Las operaciones se reanudarán automáticamente.
          </p>

          {/* Stats row */}
          <div className="flex gap-3">
            {usagePct !== null && (
              <div className="flex-1 rounded-lg bg-black/40 border border-zinc-700/50 px-4 py-3 text-center">
                <p className="text-xs text-zinc-500 mb-1">Uso actual</p>
                <p className="text-xl font-bold text-amber-400">{usagePct}%</p>
              </div>
            )}
            {resetMinutes !== null && (
              <div className="flex-1 rounded-lg bg-black/40 border border-zinc-700/50 px-4 py-3 text-center">
                <p className="text-xs text-zinc-500 mb-1">Tiempo estimado de espera</p>
                <p className="text-xl font-bold text-zinc-200">
                  {resetMinutes} min
                </p>
              </div>
            )}
          </div>

          {/* Explanation */}
          <div className="rounded-lg bg-amber-900/20 border border-amber-700/30 px-4 py-3">
            <p className="text-xs text-amber-300/80 leading-relaxed">
              Este límite es impuesto por Meta. No afecta tus campañas activas
              — solo las operaciones nuevas desde esta plataforma.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-2 px-6 pb-6">
          <button
            onClick={onClose}
            className="w-full rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-semibold py-2.5 text-sm transition-colors"
          >
            Entendido
          </button>
          <p className="text-center text-xs text-zinc-500">
            ¿Límites frecuentes?{" "}
            <a
              href="https://developers.facebook.com/docs/graph-api/overview/rate-limiting"
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-400 hover:text-amber-300 inline-flex items-center gap-0.5 underline underline-offset-2"
            >
              Solicitá Advanced Access en Meta for Developers
              <ExternalLink className="w-3 h-3" />
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

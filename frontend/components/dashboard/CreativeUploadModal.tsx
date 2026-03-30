"use client";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { X, Loader2 } from "lucide-react";
import { ImageUploadZone } from "./ImageUploadZone";
import { refreshCreative } from "@/lib/api";

interface CreativeBrief {
  suggested_hook: string;
  suggested_body: string;
  fatigue_diagnosis: string;
  replacement_angle: string;
  visual_direction: string;
}

interface CreativeUploadModalProps {
  open: boolean;
  onClose: () => void;
  notification: {
    id: string;
    action_data: {
      campaign_id: number;
      campaign_name: string;
      ad_id: string;
      ad_name: string;
      approval_token: string;
      creative_brief: CreativeBrief;
    };
  };
  onSuccess: () => void;
}

export function CreativeUploadModal({
  open,
  onClose,
  notification,
  onSuccess,
}: CreativeUploadModalProps) {
  const { data: session } = useSession();
  const token = (session as { accessToken?: string } | null)?.accessToken ?? "";

  const brief = notification.action_data.creative_brief;
  const [imageUrl, setImageUrl] = useState("");
  const [headline, setHeadline] = useState(brief.suggested_hook ?? "");
  const [body, setBody] = useState(brief.suggested_body ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!imageUrl) {
      setError("Debés subir una imagen antes de continuar.");
      return;
    }
    if (!headline.trim()) {
      setError("El headline no puede estar vacío.");
      return;
    }
    if (!body.trim()) {
      setError("El copy no puede estar vacío.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await refreshCreative(token, notification.action_data.campaign_id, {
        ad_id: notification.action_data.ad_id,
        image_url: imageUrl,
        headline,
        body,
        approval_token: notification.action_data.approval_token,
      });
      onSuccess();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al actualizar el creativo.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-700">
          <div>
            <h3 className="text-white font-semibold text-base">Subir nuevo creativo</h3>
            <p className="text-gray-400 text-xs mt-0.5">{notification.action_data.campaign_name}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-700 rounded-md transition-colors"
          >
            <X className="h-4 w-4 text-gray-400" />
          </button>
        </div>

        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left panel — upload + fields */}
          <div className="space-y-4">
            <div>
              <p className="text-gray-300 text-xs font-medium mb-1">Imagen del creativo</p>
              <ImageUploadZone
                projectSlug="ads-creative"
                onUpload={setImageUrl}
                currentUrl={imageUrl}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-gray-300 text-xs font-medium">Headline (hook)</label>
                <span className={`text-xs ${headline.length > 60 ? "text-orange-400" : "text-gray-500"}`}>
                  {headline.length}/60
                </span>
              </div>
              <input
                type="text"
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-white text-sm px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple-600"
                placeholder="Línea de apertura impactante"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-gray-300 text-xs font-medium">Copy (body)</label>
                <span className={`text-xs ${body.length > 125 ? "text-red-400" : "text-gray-500"}`}>
                  {body.length}/125
                </span>
              </div>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                className="w-full bg-gray-800 border border-gray-700 text-white text-sm px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple-600 resize-none"
                placeholder="Mensaje principal del anuncio"
              />
              {body.length > 125 && (
                <p className="text-red-400 text-xs mt-1">
                  El copy supera 125 caracteres — puede truncarse en Meta Ads.
                </p>
              )}
            </div>

            {/* Brief context */}
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 space-y-1.5">
              <p className="text-gray-400 text-xs font-medium uppercase tracking-wide">Dirección visual</p>
              <p className="text-gray-300 text-xs italic">{brief.visual_direction}</p>
            </div>
          </div>

          {/* Right panel — preview */}
          <div className="space-y-3">
            <p className="text-gray-300 text-xs font-medium">Vista previa del anuncio</p>
            <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
              {/* Simulated Instagram post preview */}
              <div className="flex items-center gap-2 p-3 border-b border-gray-700">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-600 to-pink-500 flex-shrink-0" />
                <div>
                  <p className="text-white text-xs font-semibold leading-none">quantorialabs</p>
                  <p className="text-gray-500 text-xs">Patrocinado</p>
                </div>
              </div>

              {/* Image area */}
              <div className="aspect-square bg-gray-700 flex items-center justify-center">
                {imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imageUrl}
                    alt="Creative preview"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="text-center p-6">
                    <div className="w-12 h-12 rounded-full bg-gray-600 flex items-center justify-center mx-auto mb-2">
                      <span className="text-gray-400 text-lg">🖼</span>
                    </div>
                    <p className="text-gray-500 text-xs">Subí la imagen para ver la vista previa</p>
                  </div>
                )}
              </div>

              {/* Caption area */}
              <div className="p-3 space-y-1">
                {headline && (
                  <p className="text-white text-xs font-bold leading-snug">{headline}</p>
                )}
                {body && (
                  <p className="text-gray-300 text-xs leading-relaxed line-clamp-3">{body}</p>
                )}
                <p className="text-blue-400 text-xs mt-1">Ver más</p>
              </div>
            </div>

            {/* Diagnosis reminder */}
            <div className="bg-orange-900/30 border border-orange-700/50 rounded-lg p-3">
              <p className="text-orange-300 text-xs font-medium mb-0.5">¿Por qué cambiar?</p>
              <p className="text-orange-200 text-xs">{brief.fatigue_diagnosis}</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-5 border-t border-gray-700 gap-3">
          {error && <p className="text-red-400 text-xs flex-1">{error}</p>}
          {!error && <div className="flex-1" />}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg disabled:opacity-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || !imageUrl}
              className="px-4 py-2 bg-purple-700 hover:bg-purple-600 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Actualizando en Meta Ads...
                </>
              ) : (
                "Reemplazar creativo en Meta"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

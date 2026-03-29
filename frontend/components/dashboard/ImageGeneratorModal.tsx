"use client";
import { useState } from "react";
import { X, Loader2, ImageIcon, RefreshCw } from "lucide-react";
import { generateImage, buildAutoPrompt, updateContent } from "@/lib/api";

interface ImageGeneratorModalProps {
  open: boolean;
  onClose: () => void;
  post: { id: number; content?: any; image_url?: string };
  project: { slug: string; name?: string; media_config?: any; content_config?: any; credits_balance?: number };
  onImageSaved: (imageUrl: string) => void;
}

const STYLES = [
  { label: "Tipográfico", value: "typographic" },
  { label: "Fotorrealista", value: "photorealistic" },
  { label: "Ilustración", value: "illustration" },
  { label: "Minimal", value: "minimal" },
] as const;

const COLOR_PALETTES = [
  { label: "Dark Purple", value: "dark_purple", hex: "#7c3aed" },
  { label: "Dark Green", value: "dark_green", hex: "#22c55e" },
  { label: "Dark Blue", value: "dark_blue", hex: "#3b82f6" },
  { label: "Dark Orange", value: "dark_orange", hex: "#f97316" },
  { label: "Dark", value: "dark", hex: "#0a0a0a" },
] as const;

const ASPECT_RATIOS = ["1:1", "4:5", "9:16"] as const;

export function ImageGeneratorModal({
  open,
  onClose,
  post,
  project,
  onImageSaved,
}: ImageGeneratorModalProps) {
  const defaultPalette =
    (project.media_config?.image_color_palette as string) || "dark_purple";

  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<string>("typographic");
  const [colorPalette, setColorPalette] = useState<string>(defaultPalette);
  const [aspectRatio, setAspectRatio] = useState<string>("1:1");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [credits, setCredits] = useState<number>(project.credits_balance ?? 0);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleAutoPrompt = () => {
    setPrompt(buildAutoPrompt(post, project));
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const result = await generateImage(post.id, {
        prompt: prompt.trim() || undefined,
        style,
        aspect_ratio: aspectRatio,
        color_palette: colorPalette,
      });
      setGeneratedUrl(result.image_url);
      setCredits(result.credits_remaining);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al generar imagen");
    } finally {
      setGenerating(false);
    }
  };

  const handleUseImage = async () => {
    if (!generatedUrl) return;
    setSaving(true);
    setError(null);
    try {
      await updateContent(post.id, { image_url: generatedUrl });
      onImageSaved(generatedUrl);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar imagen");
    } finally {
      setSaving(false);
    }
  };

  const noCredits = credits <= 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-lg font-semibold">Generar imagen con IA</h2>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-gray-600 bg-gray-100 px-3 py-1 rounded-full">
              💳 {credits} créditos restantes
            </span>
            <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-md">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
              {error}
            </div>
          )}

          {noCredits && (
            <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md text-sm text-yellow-800">
              Sin créditos disponibles. Contactar para recargar.
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left panel — controls */}
            <div className="space-y-5">
              {/* Prompt */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Prompt</label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={4}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 resize-none"
                  placeholder="Describe la imagen que querés generar. Ej: 'El developer que ejecuta instrucciones será reemplazado. Dark background, neon purple, bold typography'"
                />
                <button
                  type="button"
                  onClick={handleAutoPrompt}
                  className="mt-1 text-xs text-violet-600 hover:text-violet-800 underline"
                >
                  Usar prompt automático
                </button>
              </div>

              {/* Style pills */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Estilo</label>
                <div className="flex flex-wrap gap-2">
                  {STYLES.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => setStyle(s.value)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                        style === s.value
                          ? "bg-violet-600 text-white border-violet-600"
                          : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Color palette swatches */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Paleta de colores
                </label>
                <div className="flex flex-wrap gap-3">
                  {COLOR_PALETTES.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setColorPalette(p.value)}
                      title={p.label}
                      className={`flex flex-col items-center gap-1 group`}
                    >
                      <div
                        className={`h-8 w-8 rounded-full border-2 transition-all ${
                          colorPalette === p.value
                            ? "border-violet-600 scale-110 shadow-md"
                            : "border-gray-200 hover:border-gray-400"
                        }`}
                        style={{ backgroundColor: p.hex }}
                      />
                      <span className="text-xs text-gray-500 leading-none">{p.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Aspect ratio pills */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Relación de aspecto
                </label>
                <div className="flex gap-2">
                  {ASPECT_RATIOS.map((ar) => (
                    <button
                      key={ar}
                      type="button"
                      onClick={() => setAspectRatio(ar)}
                      className={`px-4 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                        aspectRatio === ar
                          ? "bg-violet-600 text-white border-violet-600"
                          : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
                      }`}
                    >
                      {ar}
                    </button>
                  ))}
                </div>
              </div>

              {/* Generate button */}
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating || noCredits}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generando con Ideogram...
                  </>
                ) : (
                  "Generar imagen"
                )}
              </button>
            </div>

            {/* Right panel — preview */}
            <div className="flex flex-col gap-3">
              <label className="block text-sm font-medium text-gray-700">Vista previa</label>
              <div
                className={`flex-1 min-h-[240px] flex flex-col items-center justify-center rounded-lg border-2 ${
                  generatedUrl
                    ? "border-gray-200"
                    : "border-dashed border-gray-300"
                } overflow-hidden`}
              >
                {generatedUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={generatedUrl}
                    alt="Imagen generada"
                    className="w-full rounded-lg object-contain"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-3 text-gray-400 p-8">
                    <ImageIcon className="h-12 w-12" />
                    <p className="text-sm text-center">La imagen aparecerá aquí</p>
                  </div>
                )}
              </div>

              {generatedUrl && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={generating || noCredits}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Regenerar
                  </button>
                  <button
                    type="button"
                    onClick={handleUseImage}
                    disabled={saving}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    Usar esta imagen
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

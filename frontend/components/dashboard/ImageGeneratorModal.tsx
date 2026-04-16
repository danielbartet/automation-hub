"use client";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { X, Loader2, ImageIcon, RefreshCw, Wand2, Upload } from "lucide-react";
import { generateImage, buildAutoPrompt, updateContent } from "@/lib/api";
import { ImageUploadZone } from "@/components/dashboard/ImageUploadZone";

interface ImageGeneratorModalProps {
  open: boolean;
  onClose: () => void;
  post: { id: number; content?: any; image_url?: string; image_urls?: string | string[] };
  project: { slug: string; name?: string; media_config?: any; content_config?: any; credits_balance?: number };
  /** When set, saving the generated image updates this specific slide (0-based index) in image_urls. */
  slideIndex?: number;
  onImageSaved: (imageUrl: string, slideIndex?: number) => void;
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
  slideIndex,
  onImageSaved,
}: ImageGeneratorModalProps) {
  const { data: session } = useSession();
  const defaultPalette =
    (project.media_config?.image_color_palette as string) || "dark_purple";

  // "select" = mode selector, "auto" = existing AI flow, "manual" = upload flow
  const [mode, setMode] = useState<"select" | "auto" | "manual">("select");

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
      const token = (session as any)?.accessToken as string | undefined;
      if (slideIndex !== undefined) {
        // Update only the specific slide in image_urls
        const currentUrls: string[] = Array.isArray(post.image_urls)
          ? [...post.image_urls]
          : post.image_url
          ? [post.image_url]
          : [];
        // Pad the array if necessary
        while (currentUrls.length <= slideIndex) {
          currentUrls.push("");
        }
        currentUrls[slideIndex] = generatedUrl;
        await updateContent(post.id, { image_urls: currentUrls }, token);
        onImageSaved(generatedUrl, slideIndex);
      } else {
        await updateContent(post.id, { image_url: generatedUrl }, token);
        onImageSaved(generatedUrl);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar imagen");
    } finally {
      setSaving(false);
    }
  };

  const noCredits = credits <= 0;

  const handleManualUpload = async (uploadedUrl: string) => {
    if (!uploadedUrl) return;
    setSaving(true);
    setError(null);
    try {
      const token = (session as any)?.accessToken as string | undefined;
      if (slideIndex !== undefined) {
        const currentUrls: string[] = Array.isArray(post.image_urls)
          ? [...post.image_urls]
          : post.image_url
          ? [post.image_url]
          : [];
        while (currentUrls.length <= slideIndex) {
          currentUrls.push("");
        }
        currentUrls[slideIndex] = uploadedUrl;
        await updateContent(post.id, { image_urls: currentUrls }, token);
        onImageSaved(uploadedUrl, slideIndex);
      } else {
        await updateContent(post.id, { image_url: uploadedUrl }, token);
        onImageSaved(uploadedUrl);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al guardar imagen");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100] p-4">
      <div className="rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
        {/* Header */}
        <div className="flex items-center justify-between p-6" style={{ borderBottom: "1px solid #222222" }}>
          <div className="flex items-center gap-3">
            {mode !== "select" && (
              <button
                onClick={() => setMode("select")}
                className="p-1 rounded-md transition-colors text-xs"
                style={{ color: "#9ca3af" }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#ffffff"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; }}
              >
                ← Volver
              </button>
            )}
            <h2 className="text-lg font-semibold text-white">
              {mode === "select" ? "Agregar imagen" : mode === "auto" ? "Generar imagen con IA" : "Subir imagen"}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            {mode === "auto" && (
              <span className="text-sm font-medium px-3 py-1 rounded-full" style={{ color: "#9ca3af", backgroundColor: "#1a1a1a" }}>
                💳 {credits} créditos restantes
              </span>
            )}
            <button
              onClick={onClose}
              className="p-1 rounded-md transition-colors"
              style={{ color: "#9ca3af" }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1a1a1a"; (e.currentTarget as HTMLButtonElement).style.color = "#ffffff"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; }}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="p-6">
          {error && (
            <div className="mb-4 p-3 rounded-md text-sm text-red-400" style={{ backgroundColor: "#450a0a", border: "1px solid #7f1d1d" }}>
              {error}
            </div>
          )}

          {/* Mode selector */}
          {mode === "select" && (
            <div className="flex flex-col sm:flex-row gap-4 py-4">
              <button
                type="button"
                onClick={() => setMode("auto")}
                className="flex-1 flex flex-col items-center gap-4 p-8 rounded-xl transition-colors"
                style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#7c3aed"; (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1e1a2e"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#333333"; (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1a1a1a"; }}
              >
                <Wand2 className="h-10 w-10 text-violet-400" />
                <div className="text-center">
                  <p className="text-white font-semibold text-base">Automático</p>
                  <p className="text-sm mt-1" style={{ color: "#9ca3af" }}>Genera una imagen con IA a partir de un prompt</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setMode("manual")}
                className="flex-1 flex flex-col items-center gap-4 p-8 rounded-xl transition-colors"
                style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#7c3aed"; (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1e1a2e"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#333333"; (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1a1a1a"; }}
              >
                <Upload className="h-10 w-10 text-violet-400" />
                <div className="text-center">
                  <p className="text-white font-semibold text-base">Manual</p>
                  <p className="text-sm mt-1" style={{ color: "#9ca3af" }}>Subí tu propia imagen desde el dispositivo</p>
                </div>
              </button>
            </div>
          )}

          {/* Manual upload */}
          {mode === "manual" && (
            <div className="space-y-4">
              <ImageUploadZone
                projectSlug={project.slug}
                onUpload={handleManualUpload}
              />
              {saving && (
                <div className="flex items-center gap-2 text-sm" style={{ color: "#9ca3af" }}>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Guardando imagen...
                </div>
              )}
            </div>
          )}

          {/* Auto (existing) flow */}
          {mode === "auto" && noCredits && (
            <div className="mb-4 p-3 rounded-md text-sm text-yellow-400" style={{ backgroundColor: "#422006", border: "1px solid #78350f" }}>
              Sin créditos disponibles. Contactar para recargar.
            </div>
          )}

          {mode === "auto" && <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left panel — controls */}
            <div className="space-y-5">
              {/* Prompt */}
              <div>
                <label className="block text-sm font-medium text-white mb-1">Prompt</label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={4}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed] resize-none"
                  style={{ backgroundColor: "#1a1a1a", border: "1px solid #333333", color: "#ffffff" }}
                  placeholder="Describe la imagen que querés generar. Ej: 'El developer que ejecuta instrucciones será reemplazado. Dark background, neon purple, bold typography'"
                />
                <button
                  type="button"
                  onClick={handleAutoPrompt}
                  className="mt-1 text-xs text-violet-400 hover:text-violet-300 underline"
                >
                  Usar prompt automático
                </button>
              </div>

              {/* Style pills */}
              <div>
                <label className="block text-sm font-medium text-white mb-2">Estilo</label>
                <div className="flex flex-wrap gap-2">
                  {STYLES.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => setStyle(s.value)}
                      className="px-3 py-1.5 text-xs font-medium rounded-full transition-colors"
                      style={
                        style === s.value
                          ? { backgroundColor: "#7c3aed", color: "#ffffff", border: "1px solid #7c3aed" }
                          : { backgroundColor: "transparent", color: "#9ca3af", border: "1px solid #333333" }
                      }
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Color palette swatches */}
              <div>
                <label className="block text-sm font-medium text-white mb-2">
                  Paleta de colores
                </label>
                <div className="flex flex-wrap gap-3">
                  {COLOR_PALETTES.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setColorPalette(p.value)}
                      title={p.label}
                      className="flex flex-col items-center gap-1 group"
                    >
                      <div
                        className="h-8 w-8 rounded-full border-2 transition-all"
                        style={{
                          backgroundColor: p.hex,
                          borderColor: colorPalette === p.value ? "#7c3aed" : "#444444",
                          transform: colorPalette === p.value ? "scale(1.1)" : "scale(1)",
                        }}
                      />
                      <span className="text-xs leading-none" style={{ color: "#9ca3af" }}>{p.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Aspect ratio pills */}
              <div>
                <label className="block text-sm font-medium text-white mb-2">
                  Relación de aspecto
                </label>
                <div className="flex gap-2">
                  {ASPECT_RATIOS.map((ar) => (
                    <button
                      key={ar}
                      type="button"
                      onClick={() => setAspectRatio(ar)}
                      className="px-4 py-1.5 text-xs font-medium rounded-full transition-colors"
                      style={
                        aspectRatio === ar
                          ? { backgroundColor: "#7c3aed", color: "#ffffff", border: "1px solid #7c3aed" }
                          : { backgroundColor: "transparent", color: "#9ca3af", border: "1px solid #333333" }
                      }
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
                    Generando imagen...
                  </>
                ) : (
                  "Generar imagen"
                )}
              </button>
            </div>

            {/* Right panel — preview */}
            <div className="flex flex-col gap-3">
              <label className="block text-sm font-medium text-white">Vista previa</label>
              <div
                className="flex-1 min-h-[240px] flex flex-col items-center justify-center rounded-lg border-2 overflow-hidden"
                style={{
                  borderColor: generatedUrl ? "#333333" : "#222222",
                  borderStyle: generatedUrl ? "solid" : "dashed",
                  backgroundColor: "#0d0d0d",
                }}
              >
                {generatedUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={generatedUrl}
                    alt="Imagen generada"
                    className="w-full rounded-lg object-contain"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-3 p-8" style={{ color: "#9ca3af" }}>
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
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ border: "1px solid #333333", color: "#9ca3af" }}
                    onMouseEnter={e => { if (!(e.currentTarget as HTMLButtonElement).disabled) { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1a1a1a"; (e.currentTarget as HTMLButtonElement).style.color = "#ffffff"; } }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; }}
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
          </div>}
        </div>
      </div>
    </div>
  );
}

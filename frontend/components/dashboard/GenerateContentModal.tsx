"use client";
import { useState } from "react";
import { X, Loader2, Sparkles, PenLine } from "lucide-react";
import { ImageUploadZone } from "./ImageUploadZone";
import { generateContent, createContentManual } from "@/lib/api";
import { InstagramPostPreview } from "./InstagramPostPreview";

interface Project {
  slug: string;
  name?: string;
  content_config?: {
    content_categories?: string[];
    [key: string]: unknown;
  };
}

interface GenerateContentModalProps {
  projectSlug: string;
  project?: Project;
  onClose: () => void;
  onSuccess: () => void;
}

type ContentType = "carousel_6_slides" | "single_image" | "text_post";
type ImageMode = "auto" | "placeholder";

const CONTENT_TYPES: { value: ContentType; label: string; emoji: string }[] = [
  { value: "carousel_6_slides", label: "Carousel 6 slides", emoji: "📊" },
  { value: "single_image", label: "Imagen sola", emoji: "🖼" },
  { value: "text_post", label: "Text post", emoji: "📝" },
];

const IMAGE_MODES: { value: ImageMode; label: string; emoji: string }[] = [
  { value: "auto", label: "Auto (HTML)", emoji: "🤖" },
  { value: "placeholder", label: "Placeholder", emoji: "🔲" },
];

const SPINNER_LABELS: Record<ContentType, string> = {
  carousel_6_slides: "Generando carousel...",
  single_image: "Generando imagen...",
  text_post: "Generando post...",
};

export function GenerateContentModal({ projectSlug, project, onClose, onSuccess }: GenerateContentModalProps) {
  const [tab, setTab] = useState<"auto" | "manual">("auto");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [generatedData, setGeneratedData] = useState<{
    image_url?: string;
    image_urls?: string[];
    content?: { caption?: string; hashtags?: string[] };
  } | null>(null);

  // Auto form state
  const [autoContentType, setAutoContentType] = useState<ContentType>("carousel_6_slides");
  const [autoCategory, setAutoCategory] = useState<string | null>(null);
  const [autoHint, setAutoHint] = useState("");
  const [autoImageMode, setAutoImageMode] = useState<ImageMode>("auto");

  // Manual form state
  const [topic, setTopic] = useState("");
  const [tone, setTone] = useState("");
  const [contentType, setContentType] = useState("carousel_6_slides");
  const [imageUrl, setImageUrl] = useState("");
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");

  const categories: string[] = project?.content_config?.content_categories ?? [];

  // Derive slide count from content type (e.g. "carousel_6_slides" → 6)
  const slideCount = (() => {
    const match = contentType.match(/carousel_(\d+)_slides/);
    return match ? parseInt(match[1], 10) : 1;
  })();

  const handleContentTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setContentType(e.target.value);
    setImageUrl("");
    setImageUrls([]);
  };

  const handleSlideImageUpload = (index: number, url: string) => {
    setImageUrls((prev) => {
      const updated = [...prev];
      updated[index] = url;
      return updated;
    });
  };

  const handleAuto = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setGeneratedData(null);
    try {
      const data = await generateContent(projectSlug, {
        content_type: autoContentType,
        category: autoCategory ?? undefined,
        hint: autoHint.trim() || undefined,
        // Only send image_mode when forcing placeholder; otherwise let the backend
        // use the project's media_config.image_provider (HTML renderer by default).
        image_mode: autoImageMode === "placeholder" ? "placeholder" : undefined,
      });
      setGeneratedData(data);
      setResult(data.content?.caption || data.content?.title || "Contenido generado con éxito");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al generar");
    } finally {
      setLoading(false);
    }
  };

  const handleManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) {
      setError("Topic is required");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const tags = hashtags
        .split(",")
        .map((t) => t.trim().replace(/^#/, ""))
        .filter(Boolean);
      const isCarousel = slideCount > 1;
      await createContentManual(projectSlug, {
        topic: topic.trim(),
        tone: tone.trim() || undefined,
        content_type: contentType,
        image_url: isCarousel ? undefined : (imageUrl || undefined),
        image_urls: isCarousel ? imageUrls.filter(Boolean) : undefined,
        caption: caption.trim() || undefined,
        hashtags: tags,
        scheduled_at: scheduledAt || undefined,
      });
      onSuccess();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
        <div className="flex items-center justify-between p-6" style={{ borderBottom: "1px solid #222222" }}>
          <h2 className="text-lg font-semibold text-white">Generar nuevo contenido</h2>
          <button onClick={onClose} className="p-1 rounded-md transition-colors" style={{ color: "#9ca3af" }} onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#1f1f1f")} onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}>
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex" style={{ borderBottom: "1px solid #222222" }}>
          {(
            [
              { key: "auto", label: "Automático", icon: Sparkles },
              { key: "manual", label: "Manual", icon: PenLine },
            ] as const
          ).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => {
                setTab(key);
                setError(null);
                setResult(null);
              }}
              className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === key
                  ? "border-[#7c3aed] text-white"
                  : "border-transparent hover:text-gray-300"
              }`}
              style={{ color: tab === key ? "#ffffff" : "#9ca3af" }}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        <div className="p-6">
          {error && (
            <div className="mb-4 p-3 rounded-md text-sm text-red-400" style={{ backgroundColor: "#450a0a", border: "1px solid #7f1d1d" }}>
              {error}
            </div>
          )}

          {tab === "auto" ? (
            <div className="space-y-5">
              {result ? (
                <div className="space-y-4">
                  {/* Success banner */}
                  <div className="p-4 rounded-md" style={{ backgroundColor: "#052e16", border: "1px solid #166534" }}>
                    <p className="text-sm font-medium text-green-400 mb-1">Contenido generado exitosamente</p>
                    <p className="text-sm text-green-500 italic line-clamp-2">&ldquo;{result}&rdquo;</p>
                    <button
                      onClick={() => {
                        onSuccess();
                        onClose();
                      }}
                      className="mt-3 text-sm font-medium text-green-400 underline"
                    >
                      Listo
                    </button>
                  </div>
                  {/* Instagram preview */}
                  {generatedData && (
                    <div className="flex justify-center overflow-y-auto max-h-[520px]">
                      <InstagramPostPreview
                        imageUrls={
                          generatedData.image_urls && generatedData.image_urls.length > 0
                            ? generatedData.image_urls
                            : generatedData.image_url
                            ? [generatedData.image_url]
                            : []
                        }
                        caption={generatedData.content?.caption ?? ""}
                        hashtags={generatedData.content?.hashtags ?? []}
                        username={project?.slug ?? "quantorialabs"}
                      />
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {/* Tipo de contenido */}
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: "#d1d5db" }}>
                      Tipo de contenido
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {CONTENT_TYPES.map(({ value, label, emoji }) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setAutoContentType(value)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                            autoContentType === value
                              ? "bg-[#7c3aed] text-white border-[#7c3aed]"
                              : "text-gray-400 hover:text-white"
                          }`}
                          style={autoContentType !== value ? { border: "1px solid #333333", backgroundColor: "transparent" } : {}}
                        >
                          <span>{emoji}</span>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Categoría */}
                  {categories.length > 0 && (
                    <div>
                      <label className="block text-sm font-medium mb-2" style={{ color: "#d1d5db" }}>
                        Categoría <span className="font-normal" style={{ color: "#9ca3af" }}>(opcional)</span>
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setAutoCategory(null)}
                          className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                            autoCategory === null
                              ? "bg-[#7c3aed] text-white border-[#7c3aed]"
                              : "text-gray-400 hover:text-white"
                          }`}
                          style={autoCategory !== null ? { border: "1px solid #333333", backgroundColor: "transparent" } : {}}
                        >
                          Cualquier categoría
                        </button>
                        {categories.map((cat) => (
                          <button
                            key={cat}
                            type="button"
                            onClick={() => setAutoCategory(autoCategory === cat ? null : cat)}
                            className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                              autoCategory === cat
                                ? "bg-[#7c3aed] text-white border-[#7c3aed]"
                                : "text-gray-400 hover:text-white"
                            }`}
                            style={autoCategory !== cat ? { border: "1px solid #333333", backgroundColor: "transparent" } : {}}
                          >
                            {cat}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Pista de tema */}
                  <div>
                    <label className="block text-sm font-medium mb-1" style={{ color: "#d1d5db" }}>
                      Pista de tema <span className="font-normal" style={{ color: "#9ca3af" }}>(opcional)</span>
                    </label>
                    <textarea
                      value={autoHint}
                      onChange={(e) => setAutoHint(e.target.value)}
                      rows={3}
                      maxLength={500}
                      className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed] resize-none text-white placeholder-gray-500"
                      style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}
                      placeholder="Ej: hablar de recursión, burnout del dev, primer trabajo..."
                    />
                  </div>

                  {/* Imagen (sólo si no es text_post) */}
                  {autoContentType !== "text_post" && (
                    <div>
                      <label className="block text-sm font-medium mb-2" style={{ color: "#d1d5db" }}>
                        Imagen
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {IMAGE_MODES.map(({ value, label, emoji }) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setAutoImageMode(value)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                              autoImageMode === value
                                ? "bg-[#7c3aed] text-white border-[#7c3aed]"
                                : "text-gray-400 hover:text-white"
                            }`}
                            style={autoImageMode !== value ? { border: "1px solid #333333", backgroundColor: "transparent" } : {}}
                          >
                            <span>{emoji}</span>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Generar button */}
                  <button
                    onClick={handleAuto}
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-purple-700 text-white text-sm font-medium rounded-lg hover:bg-purple-800 disabled:opacity-50 transition-colors"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {SPINNER_LABELS[autoContentType]}
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" /> Generar con Claude
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          ) : (
            <form onSubmit={handleManual} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: "#d1d5db" }}>Topic *</label>
                <input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  required
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed] text-white placeholder-gray-500"
                  style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}
                  placeholder="What should this post be about?"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: "#d1d5db" }}>Tone</label>
                  <input
                    value={tone}
                    onChange={(e) => setTone(e.target.value)}
                    className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed] text-white placeholder-gray-500"
                    style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}
                    placeholder="Use project default"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: "#d1d5db" }}>Content Type</label>
                  <select
                    value={contentType}
                    onChange={handleContentTypeChange}
                    className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed] text-white"
                    style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}
                  >
                    <option value="carousel_6_slides">Carousel (6 slides)</option>
                    <option value="single_image">Single Image</option>
                    <option value="text_post">Text Post</option>
                  </select>
                </div>
              </div>
              <div>
                {slideCount > 1 ? (
                  <>
                    <label className="block text-sm font-medium mb-2" style={{ color: "#d1d5db" }}>
                      Slide Images <span className="font-normal" style={{ color: "#9ca3af" }}>(one per slide, optional)</span>
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      {Array.from({ length: slideCount }).map((_, i) => (
                        <div key={i}>
                          <p className="text-xs mb-1" style={{ color: "#9ca3af" }}>Slide {i + 1}</p>
                          <ImageUploadZone
                            projectSlug={projectSlug}
                            onUpload={(url) => handleSlideImageUpload(i, url)}
                            currentUrl={imageUrls[i] || ""}
                          />
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <label className="block text-sm font-medium mb-2" style={{ color: "#d1d5db" }}>Image</label>
                    <ImageUploadZone projectSlug={projectSlug} onUpload={setImageUrl} currentUrl={imageUrl} />
                  </>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: "#d1d5db" }}>Caption</label>
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed] text-white placeholder-gray-500"
                  style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}
                  placeholder="Leave blank to auto-generate with Claude"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: "#d1d5db" }}>Hashtags</label>
                <input
                  value={hashtags}
                  onChange={(e) => setHashtags(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed] text-white placeholder-gray-500"
                  style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}
                  placeholder="marketing, growth, tech (comma separated)"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: "#d1d5db" }}>Schedule for</label>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed] text-white"
                  style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
                style={{ backgroundColor: "#7c3aed" }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#6d28d9")}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#7c3aed")}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Creating...
                  </>
                ) : (
                  <>Create Post</>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

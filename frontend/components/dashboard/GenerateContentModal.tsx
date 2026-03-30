"use client";
import { useState } from "react";
import { X, Loader2, Sparkles, PenLine } from "lucide-react";
import { ImageUploadZone } from "./ImageUploadZone";
import { generateContent, createContentManual } from "@/lib/api";

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
type ImageMode = "ideogram" | "placeholder";

const CONTENT_TYPES: { value: ContentType; label: string; emoji: string }[] = [
  { value: "carousel_6_slides", label: "Carousel 6 slides", emoji: "📊" },
  { value: "single_image", label: "Imagen sola", emoji: "🖼" },
  { value: "text_post", label: "Text post", emoji: "📝" },
];

const IMAGE_MODES: { value: ImageMode; label: string; emoji: string }[] = [
  { value: "ideogram", label: "Ideogram AI", emoji: "🤖" },
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

  // Auto form state
  const [autoContentType, setAutoContentType] = useState<ContentType>("carousel_6_slides");
  const [autoCategory, setAutoCategory] = useState<string | null>(null);
  const [autoHint, setAutoHint] = useState("");
  const [autoImageMode, setAutoImageMode] = useState<ImageMode>("ideogram");

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
    try {
      const data = await generateContent(projectSlug, {
        content_type: autoContentType,
        category: autoCategory ?? undefined,
        hint: autoHint.trim() || undefined,
        image_mode: autoImageMode,
      });
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-lg font-semibold">Generar nuevo contenido</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-md">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b">
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
                  ? "border-gray-900 text-gray-900"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        <div className="p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
              {error}
            </div>
          )}

          {tab === "auto" ? (
            <div className="space-y-5">
              {result ? (
                <div className="p-4 bg-green-50 border border-green-200 rounded-md">
                  <p className="text-sm font-medium text-green-700 mb-1">¡Generado con éxito!</p>
                  <p className="text-sm text-green-600 italic">&ldquo;{result}&rdquo;</p>
                  <button
                    onClick={() => {
                      onSuccess();
                      onClose();
                    }}
                    className="mt-3 text-sm font-medium text-green-700 underline"
                  >
                    Listo
                  </button>
                </div>
              ) : (
                <>
                  {/* Tipo de contenido */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
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
                              ? "bg-gray-900 text-white border-gray-900"
                              : "bg-white text-gray-600 border-gray-300 hover:border-gray-500"
                          }`}
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
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Categoría <span className="text-gray-400 font-normal">(opcional)</span>
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setAutoCategory(null)}
                          className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                            autoCategory === null
                              ? "bg-gray-900 text-white border-gray-900"
                              : "bg-white text-gray-600 border-gray-300 hover:border-gray-500"
                          }`}
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
                                ? "bg-gray-900 text-white border-gray-900"
                                : "bg-white text-gray-600 border-gray-300 hover:border-gray-500"
                            }`}
                          >
                            {cat}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Pista de tema */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Pista de tema <span className="text-gray-400 font-normal">(opcional)</span>
                    </label>
                    <textarea
                      value={autoHint}
                      onChange={(e) => setAutoHint(e.target.value)}
                      rows={3}
                      maxLength={500}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 resize-none"
                      placeholder="Ej: hablar de recursión, burnout del dev, primer trabajo..."
                    />
                  </div>

                  {/* Imagen (sólo si no es text_post) */}
                  {autoContentType !== "text_post" && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
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
                                ? "bg-gray-900 text-white border-gray-900"
                                : "bg-white text-gray-600 border-gray-300 hover:border-gray-500"
                            }`}
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Topic *</label>
                <input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  required
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                  placeholder="What should this post be about?"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tone</label>
                  <input
                    value={tone}
                    onChange={(e) => setTone(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                    placeholder="Use project default"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Content Type</label>
                  <select
                    value={contentType}
                    onChange={handleContentTypeChange}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
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
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Slide Images <span className="text-gray-400 font-normal">(one per slide, optional)</span>
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      {Array.from({ length: slideCount }).map((_, i) => (
                        <div key={i}>
                          <p className="text-xs text-gray-500 mb-1">Slide {i + 1}</p>
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
                    <label className="block text-sm font-medium text-gray-700 mb-2">Image</label>
                    <ImageUploadZone projectSlug={projectSlug} onUpload={setImageUrl} currentUrl={imageUrl} />
                  </>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Caption</label>
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  rows={3}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                  placeholder="Leave blank to auto-generate with Claude"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Hashtags</label>
                <input
                  value={hashtags}
                  onChange={(e) => setHashtags(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                  placeholder="marketing, growth, tech (comma separated)"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Schedule for</label>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
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

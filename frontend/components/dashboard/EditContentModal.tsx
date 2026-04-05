"use client";
import { useState } from "react";
import { X, Loader2, Save, CheckCircle, XCircle, Sparkles, RefreshCw } from "lucide-react";
import { ImageUploadZone } from "./ImageUploadZone";
import { updateContent, rerenderSlide } from "@/lib/api";
import { ImageGeneratorModal } from "./ImageGeneratorModal";
import { InstagramPostPreview } from "./InstagramPostPreview";

interface Slide {
  slide_number: number;
  type: string;
  headline?: string;
  body?: string;
  subtext?: string;
  cta?: string;
}

interface ContentPost {
  id: number;
  caption: string;
  image_url?: string;
  /** Raw JSON string from the API list endpoint, or a parsed array from an update response. */
  image_urls?: string | string[];
  scheduled_at?: string;
  content?: { slides?: Slide[] | unknown[]; hashtags?: string[] };
  status: string;
  title?: string;
  platform?: string;
  published_at?: string;
}

interface EditContentModalProps {
  post: ContentPost;
  projectSlug: string;
  project?: { slug: string; name?: string; media_config?: any; content_config?: any; credits_balance?: number };
  onClose: () => void;
  onSaved: () => void;
}

/** Parse the image_urls field which may be a JSON string (from list endpoint) or an array (from update response). */
function parseImageUrls(raw: string | string[] | undefined, fallbackUrl?: string): string[] {
  if (Array.isArray(raw) && raw.length > 0) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // not JSON — treat as a single URL
      return [raw];
    }
  }
  return fallbackUrl ? [fallbackUrl] : [];
}

export function EditContentModal({ post, projectSlug, project, onClose, onSaved }: EditContentModalProps) {
  const isPublished = post.status === "published";
  const [caption, setCaption] = useState(post.caption || "");
  const [imageUrl, setImageUrl] = useState(post.image_url || "");
  // Parsed per-slide image URLs; length determines how many thumbnails to show
  const [slideImageUrls, setSlideImageUrls] = useState<string[]>(
    () => parseImageUrls(post.image_urls, post.image_url)
  );
  const [hashtags, setHashtags] = useState((post.content?.hashtags || []).join(", "));
  const [scheduledAt, setScheduledAt] = useState(
    post.scheduled_at ? post.scheduled_at.replace(" ", "T").slice(0, 16) : ""
  );
  const [slides, setSlides] = useState<Slide[]>((post.content?.slides as Slide[]) || []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rerenderingSlides, setRerenderingSlides] = useState<Set<number>>(new Set());
  const [showImageGen, setShowImageGen] = useState(false);
  const [activeImageGenSlide, setActiveImageGenSlide] = useState<number | undefined>(undefined);
  const [activeTab, setActiveTab] = useState<"edit" | "preview">("edit");

  // Preview uses the live slideImageUrls state
  const previewImageUrls = slideImageUrls.length > 0 ? slideImageUrls : (imageUrl ? [imageUrl] : []);

  const handleSave = async () => {
    setLoading(true);
    setError(null);
    try {
      const tags = hashtags
        .split(",")
        .map((t) => t.trim().replace(/^#/, ""))
        .filter(Boolean);
      await updateContent(post.id, {
        caption,
        image_url: imageUrl || undefined,
        image_urls: slideImageUrls.length > 0 ? slideImageUrls : undefined,
        hashtags: tags,
        slides: slides.length > 0 ? slides : undefined,
        scheduled_at: scheduledAt || undefined,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (newStatus: "approved" | "rejected") => {
    setLoading(true);
    setError(null);
    try {
      await updateContent(post.id, {
        status: newStatus,
        scheduled_at: scheduledAt || undefined,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update status");
    } finally {
      setLoading(false);
    }
  };

  const updateSlide = (idx: number, field: keyof Slide, value: string) => {
    setSlides((prev) => prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s)));
  };

  const handleRerender = async (slideIdx: number) => {
    setRerenderingSlides((prev) => new Set(prev).add(slideIdx));
    setError(null);
    try {
      const result = await rerenderSlide(post.id, slideIdx);
      setSlideImageUrls((prev) => {
        const next = [...prev];
        while (next.length <= slideIdx) next.push("");
        next[slideIdx] = result.image_url;
        return next;
      });
      if (slideIdx === 0) setImageUrl(result.image_url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al re-renderizar el slide");
    } finally {
      setRerenderingSlides((prev) => {
        const next = new Set(prev);
        next.delete(slideIdx);
        return next;
      });
    }
  };

  // Open the image generator for a specific slide (or for the single image when undefined)
  const openImageGen = (slideIdx?: number) => {
    setActiveImageGenSlide(slideIdx);
    setShowImageGen(true);
  };

  const handleImageSaved = (url: string, savedSlideIndex?: number) => {
    if (savedSlideIndex !== undefined) {
      setSlideImageUrls((prev) => {
        const next = [...prev];
        while (next.length <= savedSlideIndex) next.push("");
        next[savedSlideIndex] = url;
        return next;
      });
      // Keep imageUrl in sync with slide 0
      if (savedSlideIndex === 0) setImageUrl(url);
    } else {
      setImageUrl(url);
      // If no multi-slide array yet, seed slot 0
      setSlideImageUrls((prev) => {
        if (prev.length === 0) return [url];
        const next = [...prev];
        next[0] = url;
        return next;
      });
    }
    setShowImageGen(false);
  };

  return (
    <>
    {showImageGen && project && (
      <ImageGeneratorModal
        open={showImageGen}
        onClose={() => setShowImageGen(false)}
        post={{ id: post.id, content: post.content, image_url: imageUrl, image_urls: slideImageUrls }}
        project={project}
        slideIndex={activeImageGenSlide}
        onImageSaved={handleImageSaved}
      />
    )}
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
        <div className="flex items-center justify-between p-6" style={{ borderBottom: "1px solid #222222" }}>
          <h2 className="text-lg font-semibold text-white">Editar contenido</h2>
          <button onClick={onClose} className="p-1 rounded-md transition-colors" style={{ color: "#9ca3af" }} onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#1f1f1f")} onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}>
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-2 px-6 pt-4">
          <button
            type="button"
            onClick={() => setActiveTab("edit")}
            className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              activeTab === "edit"
                ? "bg-[#7c3aed] text-white border-[#7c3aed]"
                : "text-gray-400 hover:text-white"
            }`}
            style={activeTab !== "edit" ? { border: "1px solid #333333", backgroundColor: "transparent" } : {}}
          >
            ✏️ Editar
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("preview")}
            className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              activeTab === "preview"
                ? "bg-[#7c3aed] text-white border-[#7c3aed]"
                : "text-gray-400 hover:text-white"
            }`}
            style={activeTab !== "preview" ? { border: "1px solid #333333", backgroundColor: "transparent" } : {}}
          >
            👁 Vista previa
          </button>
        </div>

        {activeTab === "preview" ? (
          <div className="flex justify-center p-6">
            <InstagramPostPreview
              imageUrls={previewImageUrls}
              caption={caption}
              hashtags={(post.content?.hashtags ?? []).concat(
                hashtags
                  .split(",")
                  .map((t) => t.trim().replace(/^#/, ""))
                  .filter(Boolean)
              ).filter((v, i, arr) => arr.indexOf(v) === i)}
              username={projectSlug}
            />
          </div>
        ) : (
        <div className="p-6 space-y-5">
          {error && (
            <div className="p-3 rounded-md text-sm text-red-400" style={{ backgroundColor: "#450a0a", border: "1px solid #7f1d1d" }}>
              {error}
            </div>
          )}

          {/* Slides */}
          {slides.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-3" style={{ color: "#d1d5db" }}>Slides</label>
              <div className="space-y-3">
                {slides.map((slide, idx) => (
                  <div key={idx} className="rounded-lg p-3 space-y-2" style={{ border: "1px solid #222222" }}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-medium uppercase" style={{ color: "#9ca3af" }}>
                        Slide {slide.slide_number} · {slide.type}
                      </span>
                    </div>
                    {slide.headline !== undefined && (
                      <input
                        value={slide.headline}
                        onChange={(e) => updateSlide(idx, "headline", e.target.value)}
                        className="w-full rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#7c3aed] text-white placeholder-gray-500"
                        style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}
                        placeholder="Headline"
                      />
                    )}
                    {slide.body !== undefined && (
                      <textarea
                        value={slide.body}
                        onChange={(e) => updateSlide(idx, "body", e.target.value)}
                        rows={2}
                        className="w-full rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#7c3aed] text-white placeholder-gray-500"
                        style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}
                        placeholder="Body"
                      />
                    )}
                    {slide.subtext !== undefined && (
                      <input
                        value={slide.subtext}
                        onChange={(e) => updateSlide(idx, "subtext", e.target.value)}
                        className="w-full rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#7c3aed] text-white placeholder-gray-500"
                        style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}
                        placeholder="Subtext"
                      />
                    )}
                    {slide.cta !== undefined && (
                      <input
                        value={slide.cta}
                        onChange={(e) => updateSlide(idx, "cta", e.target.value)}
                        className="w-full rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#7c3aed] text-white placeholder-gray-500"
                        style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}
                        placeholder="CTA"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Caption */}
          <div>
            <div className="flex justify-between mb-1">
              <label className="text-sm font-medium" style={{ color: "#d1d5db" }}>Caption</label>
              <span className={`text-xs ${caption.length > 200 ? "text-red-400" : "text-gray-500"}`}>
                {caption.length} / 200
              </span>
            </div>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={4}
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed] text-white"
              style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}
            />
          </div>

          {/* Hashtags */}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "#d1d5db" }}>Hashtags</label>
            <input
              value={hashtags}
              onChange={(e) => setHashtags(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed] text-white placeholder-gray-500"
              style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}
              placeholder="tag1, tag2, tag3"
            />
          </div>

          {/* Images — 2x3 grid for carousels, single uploader otherwise */}
          <div>
            <label className="block text-sm font-medium mb-3" style={{ color: "#d1d5db" }}>
              {slideImageUrls.length > 1 ? "Imágenes por slide" : "Image"}
            </label>

            {slideImageUrls.length > 1 ? (
              /* Multi-slide grid */
              <div className="grid grid-cols-3 gap-3">
                {slideImageUrls.map((url, idx) => (
                  <div key={idx} className="flex flex-col gap-1.5">
                    {/* Thumbnail */}
                    <div className="relative aspect-square rounded-lg overflow-hidden" style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}>
                      {rerenderingSlides.has(idx) && (
                        <div className="absolute inset-0 flex items-center justify-center z-10" style={{ backgroundColor: "rgba(0,0,0,0.6)" }}>
                          <Loader2 className="h-6 w-6 animate-spin" style={{ color: "#a78bfa" }} />
                        </div>
                      )}
                      {url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url} alt={`Slide ${idx + 1}`} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center" style={{ backgroundColor: "#1a1a1a" }}>
                          <Sparkles className="h-6 w-6" style={{ color: "#6b7280" }} />
                        </div>
                      )}
                    </div>
                    {/* Label */}
                    <span className="text-xs text-center font-medium" style={{ color: "#9ca3af" }}>Slide {idx + 1}</span>
                    {/* Re-render button */}
                    <button
                      type="button"
                      onClick={() => handleRerender(idx)}
                      disabled={rerenderingSlides.has(idx)}
                      className="inline-flex items-center justify-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors disabled:opacity-50"
                      style={{ color: "#6ee7b7", border: "1px solid #065f46" }}
                      onMouseEnter={e => { if (!rerenderingSlides.has(idx)) (e.currentTarget.style.backgroundColor = "#064e3b"); }}
                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
                      title="Re-renderizar con el mismo contenido usando el renderer HTML"
                    >
                      {rerenderingSlides.has(idx) ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                      Re-renderizar
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              /* Single image uploader */
              <div>
                <div className="flex items-center justify-between mb-2">
                  {project && (
                    <button
                      type="button"
                      onClick={() => openImageGen(undefined)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
                      style={{ color: "#a78bfa", border: "1px solid #5b21b6" }}
                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#1e1b4b")}
                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      Generar imagen con IA
                    </button>
                  )}
                </div>
                <ImageUploadZone projectSlug={projectSlug} onUpload={(url) => {
                  setImageUrl(url);
                  setSlideImageUrls((prev) => {
                    const next = [...prev];
                    if (next.length === 0) return [url];
                    next[0] = url;
                    return next;
                  });
                }} currentUrl={imageUrl} />
              </div>
            )}
          </div>

          {/* Schedule */}
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "#d1d5db" }}>Scheduled for</label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed] text-white"
              style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}
            />
          </div>

          {/* Approval Actions */}
          {post.status === "pending_approval" && (
            <div className="flex gap-3 pt-2" style={{ borderTop: "1px solid #222222" }}>
              <button
                onClick={() => handleStatusChange("rejected")}
                disabled={loading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-red-400 text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
                style={{ border: "1px solid #7f1d1d" }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#450a0a")}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                Reject
              </button>
              <button
                onClick={() => handleStatusChange("approved")}
                disabled={loading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-700 text-white text-sm font-medium rounded-lg hover:bg-green-600 disabled:opacity-50 transition-colors"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                Approve
              </button>
            </div>
          )}

          {/* Published notice */}
          {isPublished && (
            <div className="px-3 py-2 rounded-md text-xs text-green-400" style={{ backgroundColor: "#052e16", border: "1px solid #166534" }}>
              Este contenido ya fue publicado en Meta. No se puede editar.
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors"
              style={{ border: "1px solid #333333", color: "#9ca3af" }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#ffffff"; (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1a1a1a"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}
            >
              {isPublished ? "Cerrar" : "Cancelar"}
            </button>
            {!isPublished && (
              <button
                onClick={handleSave}
                disabled={loading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
                style={{ backgroundColor: "#7c3aed" }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#6d28d9")}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#7c3aed")}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Guardar cambios
              </button>
            )}
          </div>
        </div>
        )}
      </div>
    </div>
    </>
  );
}

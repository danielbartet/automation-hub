"use client";
import { useState } from "react";
import { X, Loader2, Save, CheckCircle, XCircle } from "lucide-react";
import { ImageUploadZone } from "./ImageUploadZone";
import { updateContent } from "@/lib/api";

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
  scheduled_at?: string;
  content?: { slides?: Slide[]; hashtags?: string[] };
  status: string;
}

interface EditContentModalProps {
  post: ContentPost;
  projectSlug: string;
  onClose: () => void;
  onSaved: () => void;
}

export function EditContentModal({ post, projectSlug, onClose, onSaved }: EditContentModalProps) {
  const [caption, setCaption] = useState(post.caption || "");
  const [imageUrl, setImageUrl] = useState(post.image_url || "");
  const [hashtags, setHashtags] = useState((post.content?.hashtags || []).join(", "));
  const [scheduledAt, setScheduledAt] = useState(
    post.scheduled_at ? post.scheduled_at.replace(" ", "T").slice(0, 16) : ""
  );
  const [slides, setSlides] = useState<Slide[]>(post.content?.slides || []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      await updateContent(post.id, { status: newStatus });
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

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-lg font-semibold">Edit Content</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-md">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-6 space-y-5">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Slides */}
          {slides.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">Slides</label>
              <div className="space-y-3">
                {slides.map((slide, idx) => (
                  <div key={idx} className="border border-gray-200 rounded-lg p-3 space-y-2">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-medium text-gray-500 uppercase">
                        Slide {slide.slide_number} · {slide.type}
                      </span>
                    </div>
                    {slide.headline !== undefined && (
                      <input
                        value={slide.headline}
                        onChange={(e) => updateSlide(idx, "headline", e.target.value)}
                        className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
                        placeholder="Headline"
                      />
                    )}
                    {slide.body !== undefined && (
                      <textarea
                        value={slide.body}
                        onChange={(e) => updateSlide(idx, "body", e.target.value)}
                        rows={2}
                        className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
                        placeholder="Body"
                      />
                    )}
                    {slide.subtext !== undefined && (
                      <input
                        value={slide.subtext}
                        onChange={(e) => updateSlide(idx, "subtext", e.target.value)}
                        className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
                        placeholder="Subtext"
                      />
                    )}
                    {slide.cta !== undefined && (
                      <input
                        value={slide.cta}
                        onChange={(e) => updateSlide(idx, "cta", e.target.value)}
                        className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
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
              <label className="text-sm font-medium text-gray-700">Caption</label>
              <span className={`text-xs ${caption.length > 200 ? "text-red-500" : "text-gray-400"}`}>
                {caption.length} / 200
              </span>
            </div>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={4}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
          </div>

          {/* Hashtags */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Hashtags</label>
            <input
              value={hashtags}
              onChange={(e) => setHashtags(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
              placeholder="tag1, tag2, tag3"
            />
          </div>

          {/* Image */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Image</label>
            <ImageUploadZone projectSlug={projectSlug} onUpload={setImageUrl} currentUrl={imageUrl} />
          </div>

          {/* Schedule */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Scheduled for</label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
          </div>

          {/* Approval Actions */}
          {post.status === "pending_approval" && (
            <div className="flex gap-3 pt-2 border-t border-gray-100">
              <button
                onClick={() => handleStatusChange("rejected")}
                disabled={loading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 border border-red-200 text-red-700 text-sm font-medium rounded-lg hover:bg-red-50 disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                Reject
              </button>
              <button
                onClick={() => handleStatusChange("approved")}
                disabled={loading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                Approve
              </button>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-200 text-sm font-medium rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

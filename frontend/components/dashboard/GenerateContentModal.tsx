"use client";
import { useState } from "react";
import { X, Loader2, Sparkles, PenLine } from "lucide-react";
import { ImageUploadZone } from "./ImageUploadZone";
import { generateContent, createContentManual } from "@/lib/api";

interface GenerateContentModalProps {
  projectSlug: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function GenerateContentModal({ projectSlug, onClose, onSuccess }: GenerateContentModalProps) {
  const [tab, setTab] = useState<"auto" | "manual">("auto");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  // Manual form state
  const [topic, setTopic] = useState("");
  const [tone, setTone] = useState("");
  const [contentType, setContentType] = useState("carousel_6_slides");
  const [imageUrl, setImageUrl] = useState("");
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");

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
      const data = await generateContent(projectSlug);
      setResult(data.content?.caption || "Content generated successfully");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
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
          <h2 className="text-lg font-semibold">Generate New Content</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-md">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b">
          {(
            [
              { key: "auto", label: "Automatic", icon: Sparkles },
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
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Claude will automatically generate a complete carousel using your project&apos;s content
                configuration (tone, categories, language).
              </p>
              {result && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-md">
                  <p className="text-sm font-medium text-green-700 mb-1">Generated successfully!</p>
                  <p className="text-sm text-green-600 italic">&ldquo;{result}&rdquo;</p>
                  <button
                    onClick={() => {
                      onSuccess();
                      onClose();
                    }}
                    className="mt-3 text-sm font-medium text-green-700 underline"
                  >
                    Done
                  </button>
                </div>
              )}
              {!result && (
                <button
                  onClick={handleAuto}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" /> Generate with Claude
                    </>
                  )}
                </button>
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

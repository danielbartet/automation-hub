"use client";

import { useEffect, useState, useRef } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { useProject } from "@/lib/project-context";
import { useT } from "@/lib/i18n";
import { Loader2, ChevronDown, ChevronUp, Download, ExternalLink } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ── Types ─────────────────────────────────────────────────────────────────────

type ImageSize = "standard" | "square" | "short";
type Layout = "bottom_bar" | "split" | "center_box" | "badge";

interface GeneratedPin {
  id: number;
  image_url: string;
  title: string | null;
  description: string | null;
  status: string;
  pin_id: string | null;
}

interface PinterestBoard {
  id: string;
  name: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const IMAGE_SIZES: { value: ImageSize; labelKey: "pinterest_size_standard" | "pinterest_size_square" | "pinterest_size_short"; dims: string }[] = [
  { value: "standard", labelKey: "pinterest_size_standard", dims: "1000×1500" },
  { value: "square", labelKey: "pinterest_size_square", dims: "1000×1000" },
  { value: "short", labelKey: "pinterest_size_short", dims: "600×900" },
];

const LAYOUTS: { value: Layout; labelKey: "pinterest_layout_bottom" | "pinterest_layout_split" | "pinterest_layout_center" | "pinterest_layout_badge"; description: string }[] = [
  { value: "bottom_bar", labelKey: "pinterest_layout_bottom", description: "Text overlay at bottom" },
  { value: "split", labelKey: "pinterest_layout_split", description: "Image + text side by side" },
  { value: "center_box", labelKey: "pinterest_layout_center", description: "Centered text box" },
  { value: "badge", labelKey: "pinterest_layout_badge", description: "Small badge overlay" },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PinterestGeneratePage() {
  const t = useT();
  const { data: session } = useSession();
  const { selectedSlug } = useProject();

  // Form state
  const [topic, setTopic] = useState("");
  const [imageSize, setImageSize] = useState<ImageSize>("standard");
  const [layout, setLayout] = useState<Layout>("bottom_bar");
  const [titleOverride, setTitleOverride] = useState("");
  const [descOverride, setDescOverride] = useState("");
  const [showOverrides, setShowOverrides] = useState(false);

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generatedPin, setGeneratedPin] = useState<GeneratedPin | null>(null);
  const [isPreviewOnly, setIsPreviewOnly] = useState(false);

  // Preview form state
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editBoard, setEditBoard] = useState("");
  const [boards, setBoards] = useState<PinterestBoard[]>([]);
  const [boardsLoading, setBoardsLoading] = useState(false);

  // Action state
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const topicRef = useRef<HTMLTextAreaElement>(null);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  // Load boards when we have a slug and the page loads
  useEffect(() => {
    if (!selectedSlug) return;
    const token = (session as { accessToken?: string } | null)?.accessToken;
    setBoardsLoading(true);
    fetch(`${API_BASE}/api/v1/pinterest/boards/${selectedSlug}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => {
        if (!res.ok) return [];
        return res.json() as Promise<PinterestBoard[]>;
      })
      .then((data) => setBoards(Array.isArray(data) ? data : []))
      .catch(() => setBoards([]))
      .finally(() => setBoardsLoading(false));
  }, [selectedSlug, session]);

  // Sync preview edit fields when pin is generated
  useEffect(() => {
    if (generatedPin) {
      setEditTitle(generatedPin.title ?? "");
      setEditDesc(generatedPin.description ?? "");
    }
  }, [generatedPin]);

  const handleGenerate = async () => {
    if (!topic.trim() || !selectedSlug) return;
    const token = (session as { accessToken?: string } | null)?.accessToken;

    setGenerating(true);
    setGenerateError(null);
    setGeneratedPin(null);

    try {
      const body: Record<string, unknown> = {
        topic: topic.trim(),
        layout,
        image_size: imageSize,
      };
      if (titleOverride.trim()) body.title = titleOverride.trim();
      if (descOverride.trim()) body.description = descOverride.trim();

      const res = await fetch(`${API_BASE}/api/v1/pinterest/pins/generate/${selectedSlug}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { detail?: string }).detail || "Generation failed");
      }

      const data = (await res.json()) as GeneratedPin & { status?: string };
      setGeneratedPin(data);
      setIsPreviewOnly(data.status === "preview_only");
      setPublished(false);
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const handleRegenerate = () => {
    // Clear preview so form re-appears with pre-filled topic
    setGeneratedPin(null);
    setIsPreviewOnly(false);
    setPublished(false);
    // Focus topic input after clearing
    setTimeout(() => topicRef.current?.focus(), 50);
  };

  const handleSave = async () => {
    if (!generatedPin) return;
    const token = (session as { accessToken?: string } | null)?.accessToken;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      if (editTitle.trim()) body.title = editTitle.trim();
      if (editDesc.trim()) body.description = editDesc.trim();
      if (editBoard) body.board_id = editBoard;

      const res = await fetch(`${API_BASE}/api/v1/pinterest/pins/${generatedPin.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { detail?: string }).detail || t.pinterest_gen_save_error);
      }

      const updated = (await res.json()) as GeneratedPin;
      setGeneratedPin(updated);
      showToast("success", t.pinterest_gen_save_success);
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : t.pinterest_gen_save_error);
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!generatedPin) return;
    const token = (session as { accessToken?: string } | null)?.accessToken;
    setPublishing(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/pinterest/pins/${generatedPin.id}/publish`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { detail?: string }).detail || t.pinterest_publish_error);
      }

      setPublished(true);
      showToast("success", t.pinterest_publish_success);
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : t.pinterest_publish_error);
    } finally {
      setPublishing(false);
    }
  };

  const handleDownload = () => {
    if (!generatedPin?.image_url) return;
    const a = document.createElement("a");
    a.href = generatedPin.image_url;
    a.download = `pin-${generatedPin.id}.png`;
    a.target = "_blank";
    a.click();
  };

  const canPublish = generatedPin && generatedPin.pin_id && !isPreviewOnly && !published;

  return (
    <div>
      <Header title={t.pinterest_generate_title} />
      <div className="p-6">
        <div className="max-w-5xl mx-auto">
          <div className={`grid gap-8 ${generatedPin ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1 max-w-2xl mx-auto"}`}>

            {/* ── Form section ── */}
            <div className="space-y-6">
              <div className="rounded-xl p-6 space-y-5" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>

                {/* Topic */}
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: "#d1d5db" }}>
                    {t.pinterest_topic_label}
                  </label>
                  <textarea
                    ref={topicRef}
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    rows={4}
                    className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed] text-white placeholder-gray-500 resize-none"
                    style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}
                    placeholder={t.pinterest_gen_topic_placeholder}
                  />
                </div>

                {/* Image size */}
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: "#d1d5db" }}>
                    {t.pinterest_image_size_label}
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {IMAGE_SIZES.map((size) => (
                      <button
                        key={size.value}
                        onClick={() => setImageSize(size.value)}
                        className="flex flex-col items-center py-2.5 px-2 rounded-lg text-xs font-medium transition-colors"
                        style={
                          imageSize === size.value
                            ? { backgroundColor: "rgba(124, 58, 237, 0.15)", border: "1px solid #7c3aed", color: "#a78bfa" }
                            : { backgroundColor: "#1a1a1a", border: "1px solid #333333", color: "#9ca3af" }
                        }
                      >
                        <span className="font-semibold">{size.dims}</span>
                        <span className="mt-0.5 text-xs" style={{ color: imageSize === size.value ? "#a78bfa" : "#6b7280" }}>
                          {t[size.labelKey]}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Layout */}
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: "#d1d5db" }}>
                    {t.pinterest_layout_label}
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {LAYOUTS.map((l) => (
                      <button
                        key={l.value}
                        onClick={() => setLayout(l.value)}
                        className="flex flex-col items-start p-3 rounded-lg text-sm font-medium transition-colors"
                        style={
                          layout === l.value
                            ? { backgroundColor: "rgba(124, 58, 237, 0.15)", border: "1px solid #7c3aed", color: "#a78bfa" }
                            : { backgroundColor: "#1a1a1a", border: "1px solid #333333", color: "#9ca3af" }
                        }
                      >
                        <span className="font-semibold">{t[l.labelKey]}</span>
                        <span className="text-xs mt-0.5" style={{ color: layout === l.value ? "#7c5fbf" : "#6b7280" }}>
                          {l.description}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Optional overrides collapsible */}
                <div>
                  <button
                    onClick={() => setShowOverrides((prev) => !prev)}
                    className="flex items-center gap-2 text-sm font-medium transition-colors w-full text-left"
                    style={{ color: "#9ca3af" }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#ffffff")}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#9ca3af")}
                  >
                    {showOverrides ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    {t.pinterest_gen_overrides_label}
                  </button>

                  {showOverrides && (
                    <div className="mt-3 space-y-3 pl-1">
                      <div>
                        <label className="block text-xs font-medium mb-1" style={{ color: "#9ca3af" }}>
                          {t.pinterest_gen_title_override_label}
                        </label>
                        <input
                          type="text"
                          value={titleOverride}
                          onChange={(e) => setTitleOverride(e.target.value)}
                          className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed] text-white placeholder-gray-500"
                          style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}
                          placeholder={t.pinterest_gen_title_override_placeholder}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1" style={{ color: "#9ca3af" }}>
                          {t.pinterest_gen_desc_override_label}
                        </label>
                        <textarea
                          value={descOverride}
                          onChange={(e) => setDescOverride(e.target.value)}
                          rows={2}
                          className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed] text-white placeholder-gray-500 resize-none"
                          style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}
                          placeholder={t.pinterest_gen_desc_override_placeholder}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {generateError && (
                  <div className="p-3 rounded-lg text-sm text-red-400" style={{ backgroundColor: "#450a0a", border: "1px solid #7f1d1d" }}>
                    {generateError}
                  </div>
                )}

                {/* Generate button */}
                <button
                  onClick={handleGenerate}
                  disabled={generating || !topic.trim() || !selectedSlug}
                  className="w-full flex items-center justify-center gap-2 py-2.5 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
                  style={{ backgroundColor: "#7c3aed" }}
                  onMouseEnter={(e) => { if (!generating && topic.trim()) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#6d28d9"; }}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = "#7c3aed")}
                >
                  {generating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t.pinterest_generating}
                    </>
                  ) : (
                    t.pinterest_generate_btn
                  )}
                </button>

                {generating && (
                  <p className="text-xs text-center" style={{ color: "#6b7280" }}>
                    This can take 15–30 seconds...
                  </p>
                )}
              </div>
            </div>

            {/* ── Preview section ── */}
            {generatedPin && (
              <div className="space-y-4">
                <div className="rounded-xl p-5 space-y-5" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
                  <h3 className="text-sm font-semibold text-white">{t.pinterest_gen_preview_title}</h3>

                  {/* No-token banner */}
                  {isPreviewOnly && (
                    <div className="rounded-lg p-3 space-y-1" style={{ backgroundColor: "#1a1205", border: "1px solid #92400e" }}>
                      <p className="text-sm font-medium" style={{ color: "#fbbf24" }}>
                        {t.pinterest_no_token_hint}
                      </p>
                      <p className="text-xs" style={{ color: "#d97706" }}>
                        {t.pinterest_app_review_short}
                      </p>
                      <Link
                        href="/dashboard/projects"
                        className="inline-flex items-center gap-1 text-xs font-medium mt-1 transition-colors"
                        style={{ color: "#f59e0b" }}
                        onMouseEnter={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = "#fcd34d")}
                        onMouseLeave={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = "#f59e0b")}
                      >
                        <ExternalLink className="h-3 w-3" />
                        {t.pinterest_connect_link}
                      </Link>
                    </div>
                  )}

                  {/* Image */}
                  <div className="flex justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={generatedPin.image_url}
                      alt={generatedPin.title ?? "Generated pin"}
                      className="rounded-lg object-contain"
                      style={{ maxWidth: "350px", width: "100%", border: "1px solid #333333" }}
                    />
                  </div>

                  {/* Editable fields */}
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: "#9ca3af" }}>
                        {t.pinterest_gen_title_label}
                      </label>
                      <input
                        type="text"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed] text-white placeholder-gray-500"
                        style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: "#9ca3af" }}>
                        {t.pinterest_gen_desc_label}
                      </label>
                      <textarea
                        value={editDesc}
                        onChange={(e) => setEditDesc(e.target.value)}
                        rows={3}
                        className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed] text-white placeholder-gray-500 resize-none"
                        style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}
                      />
                    </div>

                    {/* Board selector */}
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: "#9ca3af" }}>
                        {t.pinterest_board_label}
                      </label>
                      {boardsLoading ? (
                        <p className="text-xs" style={{ color: "#9ca3af" }}>{t.pinterest_board_loading}</p>
                      ) : boards.length > 0 ? (
                        <select
                          value={editBoard}
                          onChange={(e) => setEditBoard(e.target.value)}
                          className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed] text-white"
                          style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}
                        >
                          <option value="">{t.pinterest_gen_board_placeholder}</option>
                          {boards.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex flex-wrap gap-2">
                    {/* Save changes — always visible when pin exists */}
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="flex-1 flex items-center justify-center gap-2 py-2 text-white text-xs font-medium rounded-lg disabled:opacity-50 transition-colors"
                      style={{ backgroundColor: "#1f2937", border: "1px solid #374151" }}
                      onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = "#374151")}
                      onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1f2937")}
                    >
                      {saving ? (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin" />
                          {t.pinterest_gen_saving}
                        </>
                      ) : (
                        t.pinterest_gen_save
                      )}
                    </button>

                    {/* Download — always visible */}
                    <button
                      onClick={handleDownload}
                      className="flex-1 flex items-center justify-center gap-2 py-2 text-white text-xs font-medium rounded-lg transition-colors"
                      style={{ backgroundColor: "#1f2937", border: "1px solid #374151" }}
                      onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = "#374151")}
                      onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1f2937")}
                    >
                      <Download className="h-3 w-3" />
                      {t.pinterest_download_btn}
                    </button>
                  </div>

                  {/* Publish — only if token is configured */}
                  {canPublish && (
                    <button
                      onClick={handlePublish}
                      disabled={publishing}
                      className="w-full flex items-center justify-center gap-2 py-2.5 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
                      style={{ backgroundColor: "#e60023" }}
                      onMouseEnter={(e) => { if (!publishing) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#c4001e"; }}
                      onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = "#e60023")}
                    >
                      {publishing ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {t.pinterest_publishing}
                        </>
                      ) : (
                        t.pinterest_publish_btn
                      )}
                    </button>
                  )}

                  {published && (
                    <div className="flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium" style={{ backgroundColor: "#052e16", color: "#4ade80", border: "1px solid #166534" }}>
                      {t.pinterest_published_label}
                    </div>
                  )}

                  {/* Regenerate */}
                  <button
                    onClick={handleRegenerate}
                    className="w-full py-2 text-xs font-medium rounded-lg transition-colors"
                    style={{ color: "#9ca3af", border: "1px solid #333333", backgroundColor: "transparent" }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.color = "#ffffff";
                      (e.currentTarget as HTMLButtonElement).style.borderColor = "#555555";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af";
                      (e.currentTarget as HTMLButtonElement).style.borderColor = "#333333";
                    }}
                  >
                    {t.pinterest_regenerate_btn}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-4 right-4 px-4 py-3 rounded-lg shadow-xl z-50 max-w-sm text-sm ${
            toast.type === "success" ? "bg-green-700 text-white" : "bg-red-700 text-white"
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}

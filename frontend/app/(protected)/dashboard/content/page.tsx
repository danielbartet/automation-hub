"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { fetchProjects, fetchContent, importFromMeta, updateContent } from "@/lib/api";
import { PlusCircle, FileText, Loader2, Pencil, Video, Image, ChevronDown, Upload, X } from "lucide-react";
import { GenerateContentModal } from "@/components/dashboard/GenerateContentModal";
import { EditContentModal } from "@/components/dashboard/EditContentModal";
import { ImageGeneratorModal } from "@/components/dashboard/ImageGeneratorModal";
import { ImageUploadZone } from "@/components/dashboard/ImageUploadZone";
import { useT } from "@/lib/i18n";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ── ReelModal ─────────────────────────────────────────────────────────────────

interface ReelModalProps {
  post: ContentPost;
  projectSlug: string;
  onClose: () => void;
  onSuccess: () => void;
}

function ReelModal({ post, projectSlug, onClose, onSuccess }: ReelModalProps) {
  const t = useT();
  const [tab, setTab] = useState<"upload" | "kling">("upload");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!["video/mp4", "video/quicktime"].includes(file.type)) {
      setError(t.reel_error_format);
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      setError(t.reel_error_size);
      return;
    }
    setError(null);
    setVideoFile(file);
  };

  const handleSubmit = async () => {
    if (!videoFile) return;
    setUploading(true);
    setError(null);
    try {
      // Upload file to S3
      const formData = new FormData();
      formData.append("file", videoFile);
      const uploadRes = await fetch(`${API_BASE}/api/v1/upload/${projectSlug}`, {
        method: "POST",
        body: formData,
      });
      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({}));
        throw new Error((err as { detail?: string }).detail || t.reel_error_upload);
      }
      const { url: videoUrl } = await uploadRes.json();

      // Save video_url to the post
      await updateContent(post.id, { video_url: videoUrl });

      // Trigger publish/n8n
      await fetch(`${API_BASE}/api/v1/content/${post.id}/publish`, { method: "POST" }).catch(() => {});

      onSuccess();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.reel_error_process);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="rounded-xl shadow-xl w-full max-w-md" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
        <div className="flex items-center justify-between p-5" style={{ borderBottom: "1px solid #222222" }}>
          <h2 className="text-base font-semibold text-white">{t.reel_modal_title}</h2>
          <button onClick={onClose} className="p-1 rounded-md transition-colors" style={{ color: "#9ca3af" }} onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#1f1f1f")} onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Tab switcher */}
          <div className="flex gap-1 rounded-lg p-1" style={{ border: "1px solid #333333", backgroundColor: "#0d0d0d" }}>
            <button
              onClick={() => setTab("upload")}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                tab === "upload" ? "bg-[#7c3aed] text-white" : "text-gray-400 hover:text-white"
              }`}
            >
              {t.reel_tab_upload}
            </button>
            <button
              onClick={() => setTab("kling")}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                tab === "kling" ? "bg-[#7c3aed] text-white" : "text-gray-400 hover:text-white"
              }`}
            >
              {t.reel_tab_kling}
            </button>
          </div>

          {tab === "upload" ? (
            <div className="space-y-3">
              {videoFile ? (
                <div className="flex items-center gap-3 p-3 rounded-lg" style={{ border: "1px solid #333333" }}>
                  <Video className="h-5 w-5 flex-shrink-0" style={{ color: "#9ca3af" }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{videoFile.name}</p>
                    <p className="text-xs" style={{ color: "#9ca3af" }}>{(videoFile.size / 1024 / 1024).toFixed(1)} MB</p>
                  </div>
                  <button onClick={() => setVideoFile(null)} className="p-1 rounded" style={{ color: "#9ca3af" }}>
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center w-full h-28 rounded-lg cursor-pointer transition-colors" style={{ border: "2px dashed #333333" }} onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#161616")} onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}>
                  <input
                    type="file"
                    className="hidden"
                    accept="video/mp4,video/quicktime"
                    onChange={handleFileChange}
                  />
                  <Upload className="h-6 w-6 mb-1" style={{ color: "#9ca3af" }} />
                  <span className="text-xs" style={{ color: "#9ca3af" }}>{t.reel_drop_hint}</span>
                  <span className="text-xs mt-0.5" style={{ color: "#6b7280" }}>{t.reel_drop_formats}</span>
                </label>
              )}

              {error && <p className="text-xs text-red-400">{error}</p>}

              <button
                onClick={handleSubmit}
                disabled={!videoFile || uploading}
                className="w-full flex items-center justify-center gap-2 py-2 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
                style={{ backgroundColor: "#7c3aed" }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#6d28d9")}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#7c3aed")}
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t.reel_uploading}
                  </>
                ) : (
                  t.reel_submit
                )}
              </button>
            </div>
          ) : (
            <div className="space-y-3 text-center py-4">
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium" style={{ backgroundColor: "#1f1f1f", color: "#9ca3af" }}>
                {t.reel_coming_soon}
              </span>
              <div>
                <button
                  disabled
                  className="w-full py-2 text-sm font-medium rounded-lg cursor-not-allowed"
                  style={{ backgroundColor: "#1a1a1a", color: "#6b7280" }}
                >
                  {t.reel_tab_kling}
                </button>
                <p className="text-xs mt-2" style={{ color: "#6b7280" }}>{t.reel_coming_soon_note}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── StoryCreatorModal ─────────────────────────────────────────────────────────

interface StoryCreatorModalProps {
  projectSlug: string;
  onClose: () => void;
  onSuccess: () => void;
}

function StoryCreatorModal({ projectSlug, onClose, onSuccess }: StoryCreatorModalProps) {
  const t = useT();
  const [imageUrl, setImageUrl] = useState("");
  const [textOverlay, setTextOverlay] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePublish = async () => {
    if (!imageUrl) {
      setError(t.story_error_image_required);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { image_url: imageUrl };
      if (textOverlay.trim()) body.text_overlay = textOverlay.trim();
      if (scheduledAt) body.scheduled_at = scheduledAt;

      const res = await fetch(`${API_BASE}/api/v1/content/create-story/${projectSlug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { detail?: string }).detail || t.story_error_publish);
      }

      onSuccess();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.story_error_publish);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="rounded-xl shadow-xl w-full max-w-md" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
        <div className="flex items-center justify-between p-5" style={{ borderBottom: "1px solid #222222" }}>
          <h2 className="text-base font-semibold text-white">{t.story_modal_title}</h2>
          <button onClick={onClose} className="p-1 rounded-md transition-colors" style={{ color: "#9ca3af" }} onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#1f1f1f")} onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: "#d1d5db" }}>
              {t.story_image_label} <span className="text-xs font-normal" style={{ color: "#9ca3af" }}>{t.story_image_ratio_hint}</span>
            </label>
            <ImageUploadZone
              projectSlug={projectSlug}
              onUpload={setImageUrl}
              currentUrl={imageUrl}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "#d1d5db" }}>
              {t.story_text_label}
            </label>
            <textarea
              value={textOverlay}
              onChange={e => setTextOverlay(e.target.value)}
              rows={2}
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed] text-white placeholder-gray-500"
              style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}
              placeholder={t.story_text_placeholder}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: "#d1d5db" }}>
              {t.story_schedule_label}
            </label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={e => setScheduledAt(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed] text-white"
              style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}
            />
          </div>

          <p className="text-xs rounded-lg p-3" style={{ color: "#9ca3af", backgroundColor: "#0d0d0d" }}>
            {t.story_note}
          </p>

          {error && (
            <div className="p-3 rounded-lg text-sm text-red-400" style={{ backgroundColor: "#450a0a", border: "1px solid #7f1d1d" }}>
              {error}
            </div>
          )}

          <button
            onClick={handlePublish}
            disabled={!imageUrl || loading}
            className="w-full flex items-center justify-center gap-2 py-2 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
            style={{ backgroundColor: "#7c3aed" }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#6d28d9")}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#7c3aed")}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t.story_publishing}
              </>
            ) : (
              t.story_publish_btn
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

interface Project {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  credits_balance?: number;
  media_config?: any;
  content_config?: any;
}

interface ContentPost {
  id: number;
  caption: string;
  status: "pending_approval" | "published" | "draft" | "approved" | "rejected";
  image_url?: string;
  image_urls?: string | string[];
  video_url?: string;
  created_at: string;
  published_at?: string;
  scheduled_at?: string;
  slide_data?: unknown;
  content?: { slides?: Array<{ slide_number: number; type: string; headline?: string; body?: string; subtext?: string; cta?: string }>; hashtags?: string[] };
}

type StatusFilter = "all" | "pending_approval" | "published" | "draft" | "approved" | "rejected";

const STATUS_LABELS: Record<ContentPost["status"], string> = {
  pending_approval: "Pending",
  published: "Published",
  draft: "Draft",
  approved: "Approved",
  rejected: "Rejected",
};

const STATUS_CLASSES: Record<ContentPost["status"], string> = {
  pending_approval: "bg-yellow-900/50 text-yellow-400",
  published: "bg-green-900/50 text-green-400",
  draft: "bg-gray-800 text-gray-400",
  approved: "bg-blue-900/50 text-blue-400",
  rejected: "bg-red-900/50 text-red-400",
};

function formatDate(dateStr: string) {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

export default function ContentPage() {
  const t = useT();
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const isClient = session?.user?.role === "client";
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [selectedProjectSlug, setSelectedProjectSlug] = useState<string>("");
  const [pendingHint, setPendingHint] = useState<string | null>(null);
  const [pendingFormat, setPendingFormat] = useState<string | null>(null);
  const [pendingCategory, setPendingCategory] = useState<string | null>(null);
  const [content, setContent] = useState<ContentPost[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingContent, setLoadingContent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [showModal, setShowModal] = useState(false);
  const [editPost, setEditPost] = useState<ContentPost | null>(null);
  const [videoResults] = useState<Record<number, { video_url: string; credits_remaining: number }>>({});
  const [imageGenPost, setImageGenPost] = useState<ContentPost | null>(null);
  const [reelPost, setReelPost] = useState<ContentPost | null>(null);
  const [showStoryModal, setShowStoryModal] = useState(false);
  const [showGenerateDropdown, setShowGenerateDropdown] = useState(false);
  const generateDropdownRef = useRef<HTMLDivElement>(null);
  const [importingMeta, setImportingMeta] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  const handleImportFromMeta = async () => {
    if (!selectedProjectSlug) return;
    setImportingMeta(true);
    try {
      const result = await importFromMeta(selectedProjectSlug);
      showToast("success", result.message || t.content_import_success(result.imported));
      loadContent();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : t.content_import_error);
    } finally {
      setImportingMeta(false);
    }
  };

  useEffect(() => {
    const hint = searchParams.get("hint");
    const format = searchParams.get("format");
    const category = searchParams.get("category");
    if (hint) setPendingHint(hint);
    if (format) setPendingFormat(format);
    if (category) setPendingCategory(category);
  }, [searchParams]);

  useEffect(() => {
    const token = (session as any)?.accessToken as string | undefined;
    fetchProjects(token)
      .then((data: Project[]) => {
        const list = Array.isArray(data) ? data : [];
        setProjects(list);
        if (list.length > 0) {
          setSelectedProjectId(list[0].id);
          setSelectedProjectSlug(list[0].slug);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoadingProjects(false));
  }, [session]);

  const loadContent = useCallback(() => {
    if (!selectedProjectSlug) return;
    const token = (session as any)?.accessToken as string | undefined;
    setLoadingContent(true);
    setError(null);
    fetchContent(selectedProjectSlug, token)
      .then((data) => setContent(Array.isArray(data) ? data : []))
      .catch((err) => setError(err.message))
      .finally(() => setLoadingContent(false));
  }, [selectedProjectSlug, session]);

  useEffect(() => {
    loadContent();
  }, [loadContent]);

  // Auto-open generate modal with hint from ?hint= query param
  useEffect(() => {
    if (pendingHint && selectedProjectSlug && !loadingProjects) {
      setShowModal(true);
    }
  }, [pendingHint, selectedProjectSlug, loadingProjects]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (generateDropdownRef.current && !generateDropdownRef.current.contains(e.target as Node)) {
        setShowGenerateDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleProjectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const proj = projects.find((p) => p.slug === e.target.value);
    if (proj) {
      setSelectedProjectId(proj.id);
      setSelectedProjectSlug(proj.slug);
    }
  };

  const filtered =
    filter === "all" ? content : content.filter((c) => c.status === filter);

  const tabs: { label: string; value: StatusFilter }[] = [
    { label: "All", value: "all" },
    { label: "Pending", value: "pending_approval" },
    { label: "Approved", value: "approved" },
    { label: "Rejected", value: "rejected" },
    { label: "Published", value: "published" },
    { label: "Draft", value: "draft" },
  ];

  return (
    <div>
      <Header title="Content" />
      <div className="p-6 space-y-6">
        {/* Top bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 justify-between">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium" style={{ color: "#9ca3af" }}>Project:</label>
            {loadingProjects ? (
              <span className="text-sm" style={{ color: "#9ca3af" }}>Loading...</span>
            ) : (
              <select
                value={selectedProjectSlug}
                onChange={handleProjectChange}
                className="text-sm rounded-md px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.slug}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          {!isClient && (
            <div className="flex items-center gap-2">
              <button
                onClick={handleImportFromMeta}
                disabled={!selectedProjectSlug || importingMeta}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                style={{ border: "1px solid #333333", color: "#9ca3af", backgroundColor: "transparent" }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#ffffff"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#555555"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#333333"; }}
              >
                {importingMeta ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z"/>
                  </svg>
                )}
                {t.content_import_from_meta}
              </button>
              <div ref={generateDropdownRef} className="relative">
                <button
                  onClick={() => setShowGenerateDropdown(prev => !prev)}
                  disabled={!selectedProjectSlug}
                  className="inline-flex items-center gap-2 px-4 py-2 text-white text-sm font-medium rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  style={{ backgroundColor: "#7c3aed" }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#6d28d9")}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#7c3aed")}
                >
                  <PlusCircle className="h-4 w-4" />
                  {t.content_generate_new}
                  <ChevronDown className="h-3.5 w-3.5 ml-0.5" />
                </button>
                {showGenerateDropdown && (
                  <div className="absolute right-0 mt-1 w-64 rounded-lg shadow-lg z-20 py-1 text-sm" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
                    <button
                      onClick={() => { setShowModal(true); setShowGenerateDropdown(false); }}
                      className="w-full text-left px-4 py-2.5 flex items-center gap-2 transition-colors"
                      style={{ color: "#ffffff" }}
                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#1a1a1a")}
                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                      <span>✨</span>
                      <div>
                        <p className="font-medium text-white">{t.content_dropdown_content_title}</p>
                        <p className="text-xs" style={{ color: "#9ca3af" }}>{t.content_dropdown_content_subtitle}</p>
                      </div>
                    </button>
                    <button
                      onClick={() => { setShowStoryModal(true); setShowGenerateDropdown(false); }}
                      className="w-full text-left px-4 py-2.5 flex items-center gap-2 transition-colors"
                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#1a1a1a")}
                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                      <span>📖</span>
                      <div>
                        <p className="font-medium text-white">{t.content_dropdown_story_title}</p>
                        <p className="text-xs" style={{ color: "#9ca3af" }}>{t.content_dropdown_story_subtitle}</p>
                      </div>
                    </button>
                    <button
                      onClick={() => { setShowGenerateDropdown(false); }}
                      className="w-full text-left px-4 py-2.5 flex items-center gap-2 cursor-default"
                      style={{ color: "#6b7280" }}
                    >
                      <span>🎬</span>
                      <div>
                        <p className="font-medium">{t.content_dropdown_reel_title}</p>
                        <p className="text-xs">{t.content_dropdown_reel_subtitle}</p>
                      </div>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="rounded-md p-4 text-sm text-red-400" style={{ backgroundColor: "#450a0a", border: "1px solid #7f1d1d" }}>
            Error: {error}
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex gap-1" style={{ borderBottom: "1px solid #222222" }}>
          {tabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setFilter(tab.value)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                filter === tab.value
                  ? "border-[#7c3aed] text-white"
                  : "border-transparent hover:text-gray-300"
              }`}
              style={{ color: filter === tab.value ? "#ffffff" : "#9ca3af" }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content table */}
        <div className="rounded-lg overflow-hidden" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
          {loadingContent ? (
            <div className="flex items-center justify-center h-40 text-sm" style={{ color: "#9ca3af" }}>
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              {t.content_loading}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3">
              <FileText className="h-10 w-10" style={{ color: "#374151" }} />
              <p className="text-sm" style={{ color: "#9ca3af" }}>{t.content_empty}</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead style={{ backgroundColor: "#111111", borderBottom: "1px solid #222222" }}>
                <tr>
                  <th className="text-left px-4 py-3 font-medium" style={{ color: "#9ca3af" }}>Thumbnail</th>
                  <th className="text-left px-4 py-3 font-medium" style={{ color: "#9ca3af" }}>Caption</th>
                  <th className="text-left px-4 py-3 font-medium" style={{ color: "#9ca3af" }}>Status</th>
                  <th className="text-left px-4 py-3 font-medium" style={{ color: "#9ca3af" }}>Created</th>
                  <th className="text-left px-4 py-3 font-medium" style={{ color: "#9ca3af" }}>Video</th>
                  <th className="text-left px-4 py-3 font-medium" style={{ color: "#9ca3af" }}>{t.content_col_image}</th>
                  <th className="text-left px-4 py-3 font-medium" style={{ color: "#9ca3af" }}>{t.content_col_actions}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((post) => (
                  <tr key={post.id} style={{ borderTop: "1px solid #1a1a1a" }} className="hover:bg-[#161616] transition-colors">
                    <td className="px-4 py-3">
                      {post.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={post.image_url}
                          alt="thumbnail"
                          className="h-12 w-12 object-cover rounded-md"
                          style={{ border: "1px solid #333333" }}
                        />
                      ) : (
                        <div className="h-12 w-12 rounded-md flex items-center justify-center" style={{ backgroundColor: "#1a1a1a" }}>
                          <FileText className="h-5 w-5" style={{ color: "#6b7280" }} />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      <p className="truncate text-white">{post.caption}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CLASSES[post.status]}`}
                      >
                        {STATUS_LABELS[post.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap" style={{ color: "#9ca3af" }}>
                      {formatDate(post.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      {/* Video preview or generate button */}
                      {(() => {
                        const videoResult = videoResults[post.id];
                        const resolvedVideoUrl = videoResult?.video_url || post.video_url;
                        if (resolvedVideoUrl) {
                          return (
                            <div className="flex flex-col gap-1">
                              <video
                                src={resolvedVideoUrl}
                                controls
                                className="h-14 w-24 rounded-md object-cover"
                                style={{ border: "1px solid #333333" }}
                              />
                              <a
                                href={resolvedVideoUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-400 hover:underline"
                              >
                                {t.content_download}
                              </a>
                            </div>
                          );
                        }
                        if (post.image_url && !isClient) {
                          return (
                            <button
                              onClick={() => setReelPost(post)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-violet-700 text-white text-xs font-medium rounded-md hover:bg-violet-600 transition-colors whitespace-nowrap"
                              title={t.reel_modal_title}
                            >
                              <Video className="h-3.5 w-3.5" />
                              🎬 {t.content_generate_reel}
                            </button>
                          );
                        }
                        return <span className="text-xs" style={{ color: "#6b7280" }}>—</span>;
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      {!isClient && (
                        <button
                          onClick={() => setImageGenPost(post)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap"
                          style={{ border: "1px solid #333333", color: "#9ca3af" }}
                          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#ffffff"; (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1a1a1a"; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}
                          title={t.content_generate_image}
                        >
                          {post.image_url ? (
                            <>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={post.image_url}
                                alt="thumb"
                                className="h-5 w-5 object-cover rounded"
                              />
                              <span>🔄</span>
                            </>
                          ) : (
                            <>
                              <Image className="h-3.5 w-3.5" />
                              {t.content_generate_image}
                            </>
                          )}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {!isClient && (
                        <button
                          onClick={() => setEditPost(post)}
                          className="p-1.5 rounded-md transition-colors"
                          style={{ color: "#9ca3af" }}
                          onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#1f1f1f")}
                          onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
                          title="Edit post"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showModal && selectedProjectSlug && (
        <GenerateContentModal
          projectSlug={selectedProjectSlug}
          project={projects.find((p) => p.slug === selectedProjectSlug)}
          initialHint={pendingHint ?? undefined}
          initialContentType={pendingFormat ?? undefined}
          initialCategory={pendingCategory ?? undefined}
          onClose={() => { setShowModal(false); setPendingHint(null); setPendingFormat(null); setPendingCategory(null); }}
          onSuccess={() => { loadContent(); setPendingHint(null); setPendingFormat(null); setPendingCategory(null); }}
        />
      )}
      {editPost && selectedProjectSlug && (
        <EditContentModal
          post={editPost}
          projectSlug={selectedProjectSlug}
          project={projects.find((p) => p.slug === selectedProjectSlug)}
          onClose={() => setEditPost(null)}
          onSaved={() => {
            setEditPost(null);
            loadContent();
          }}
        />
      )}
      {imageGenPost && (() => {
        const selectedProject = projects.find((p) => p.slug === selectedProjectSlug);
        return (
          <ImageGeneratorModal
            open={true}
            onClose={() => setImageGenPost(null)}
            post={imageGenPost}
            project={selectedProject ?? { slug: selectedProjectSlug }}
            onImageSaved={(imageUrl) => {
              setContent((prev) =>
                prev.map((p) => (p.id === imageGenPost.id ? { ...p, image_url: imageUrl } : p))
              );
              setImageGenPost(null);
            }}
          />
        );
      })()}

      {reelPost && (
        <ReelModal
          post={reelPost}
          projectSlug={selectedProjectSlug}
          onClose={() => setReelPost(null)}
          onSuccess={() => {
            showToast("success", t.content_toast_reel_sent);
            setReelPost(null);
            loadContent();
          }}
        />
      )}

      {showStoryModal && selectedProjectSlug && (
        <StoryCreatorModal
          projectSlug={selectedProjectSlug}
          onClose={() => setShowStoryModal(false)}
          onSuccess={() => {
            showToast("success", t.content_toast_story_published);
            setShowStoryModal(false);
            loadContent();
          }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-4 right-4 px-4 py-3 rounded-lg shadow-xl z-50 max-w-sm text-sm ${
            toast.type === "success"
              ? "bg-green-700 text-white"
              : "bg-red-700 text-white"
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}

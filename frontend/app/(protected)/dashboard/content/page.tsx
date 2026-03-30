"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { Header } from "@/components/layout/Header";
import { fetchProjects, fetchContent, importFromMeta, updateContent } from "@/lib/api";
import { PlusCircle, FileText, Loader2, Pencil, Video, Image, ChevronDown, Upload, X } from "lucide-react";
import { GenerateContentModal } from "@/components/dashboard/GenerateContentModal";
import { EditContentModal } from "@/components/dashboard/EditContentModal";
import { ImageGeneratorModal } from "@/components/dashboard/ImageGeneratorModal";
import { ImageUploadZone } from "@/components/dashboard/ImageUploadZone";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ── ReelModal ─────────────────────────────────────────────────────────────────

interface ReelModalProps {
  post: ContentPost;
  projectSlug: string;
  onClose: () => void;
  onSuccess: () => void;
}

function ReelModal({ post, projectSlug, onClose, onSuccess }: ReelModalProps) {
  const [tab, setTab] = useState<"upload" | "kling">("upload");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!["video/mp4", "video/quicktime"].includes(file.type)) {
      setError("Solo se aceptan archivos MP4 o MOV");
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      setError("El archivo no puede superar 100MB");
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
        throw new Error((err as { detail?: string }).detail || "Error al subir el video");
      }
      const { url: videoUrl } = await uploadRes.json();

      // Save video_url to the post
      await updateContent(post.id, { video_url: videoUrl });

      // Trigger publish/n8n
      await fetch(`${API_BASE}/api/v1/content/${post.id}/publish`, { method: "POST" }).catch(() => {});

      onSuccess();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al procesar el video");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-base font-semibold">Agregar Reel a este post</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-md">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Tab switcher */}
          <div className="flex gap-1 border border-gray-200 rounded-lg p-1">
            <button
              onClick={() => setTab("upload")}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                tab === "upload" ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              Subir video manualmente
            </button>
            <button
              onClick={() => setTab("kling")}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                tab === "kling" ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              Generar con Kling AI
            </button>
          </div>

          {tab === "upload" ? (
            <div className="space-y-3">
              {videoFile ? (
                <div className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg">
                  <Video className="h-5 w-5 text-gray-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{videoFile.name}</p>
                    <p className="text-xs text-gray-400">{(videoFile.size / 1024 / 1024).toFixed(1)} MB</p>
                  </div>
                  <button onClick={() => setVideoFile(null)} className="p-1 hover:bg-gray-100 rounded">
                    <X className="h-3 w-3 text-gray-500" />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                  <input
                    type="file"
                    className="hidden"
                    accept="video/mp4,video/quicktime"
                    onChange={handleFileChange}
                  />
                  <Upload className="h-6 w-6 text-gray-400 mb-1" />
                  <span className="text-xs text-gray-500">Arrastrá o hacé clic para subir</span>
                  <span className="text-xs text-gray-400 mt-0.5">MP4, MOV · máx 100MB</span>
                </label>
              )}

              {error && <p className="text-xs text-red-600">{error}</p>}

              <button
                onClick={handleSubmit}
                disabled={!videoFile || uploading}
                className="w-full flex items-center justify-center gap-2 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Enviando...
                  </>
                ) : (
                  "Enviar para aprobación"
                )}
              </button>
            </div>
          ) : (
            <div className="space-y-3 text-center py-4">
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                Próximamente
              </span>
              <div>
                <button
                  disabled
                  className="w-full py-2 bg-gray-100 text-gray-400 text-sm font-medium rounded-lg cursor-not-allowed"
                >
                  Generar con Kling AI
                </button>
                <p className="text-xs text-gray-400 mt-2">Disponible próximamente</p>
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
  const [imageUrl, setImageUrl] = useState("");
  const [textOverlay, setTextOverlay] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePublish = async () => {
    if (!imageUrl) {
      setError("La imagen es requerida");
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
        throw new Error((err as { detail?: string }).detail || "Error al publicar la historia");
      }

      onSuccess();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al publicar la historia");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-base font-semibold">Nueva Historia</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-md">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Imagen * <span className="text-xs font-normal text-gray-400">(relación de aspecto 9:16 recomendada)</span>
            </label>
            <ImageUploadZone
              projectSlug={projectSlug}
              onUpload={setImageUrl}
              currentUrl={imageUrl}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Texto opcional
            </label>
            <textarea
              value={textOverlay}
              onChange={e => setTextOverlay(e.target.value)}
              rows={2}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
              placeholder="Texto para mostrar en la historia..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Programar para
            </label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={e => setScheduledAt(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
          </div>

          <p className="text-xs text-gray-400 bg-gray-50 rounded-lg p-3">
            Las historias duran 24 horas y no pasan por aprobación de Telegram.
          </p>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            onClick={handlePublish}
            disabled={!imageUrl || loading}
            className="w-full flex items-center justify-center gap-2 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Publicando...
              </>
            ) : (
              "Publicar Historia"
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
  image_urls?: string;
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
  pending_approval: "bg-yellow-100 text-yellow-700",
  published: "bg-green-100 text-green-700",
  draft: "bg-gray-100 text-gray-600",
  approved: "bg-blue-100 text-blue-700",
  rejected: "bg-red-100 text-red-700",
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
  const { data: session } = useSession();
  const isClient = session?.user?.role === "client";
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [selectedProjectSlug, setSelectedProjectSlug] = useState<string>("");
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
      showToast("success", result.message || `${result.imported} posts importados de Instagram`);
      loadContent();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Error al importar de Meta");
    } finally {
      setImportingMeta(false);
    }
  };

  useEffect(() => {
    fetchProjects()
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
  }, []);

  const loadContent = useCallback(() => {
    if (!selectedProjectSlug) return;
    setLoadingContent(true);
    setError(null);
    fetchContent(selectedProjectSlug)
      .then((data) => setContent(Array.isArray(data) ? data : []))
      .catch((err) => setError(err.message))
      .finally(() => setLoadingContent(false));
  }, [selectedProjectSlug]);

  useEffect(() => {
    loadContent();
  }, [loadContent]);

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
    const proj = projects.find((p) => p.id === e.target.value);
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
            <label className="text-sm font-medium text-gray-700">Project:</label>
            {loadingProjects ? (
              <span className="text-sm text-gray-400">Loading...</span>
            ) : (
              <select
                value={selectedProjectId}
                onChange={handleProjectChange}
                className="text-sm border border-gray-200 rounded-md px-3 py-2 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
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
                className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {importingMeta ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z"/>
                  </svg>
                )}
                Importar de Meta
              </button>
              <div ref={generateDropdownRef} className="relative">
                <button
                  onClick={() => setShowGenerateDropdown(prev => !prev)}
                  disabled={!selectedProjectSlug}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-md hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <PlusCircle className="h-4 w-4" />
                  Generate New
                  <ChevronDown className="h-3.5 w-3.5 ml-0.5" />
                </button>
                {showGenerateDropdown && (
                  <div className="absolute right-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1 text-sm">
                    <button
                      onClick={() => { setShowModal(true); setShowGenerateDropdown(false); }}
                      className="w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <span>✨</span>
                      <div>
                        <p className="font-medium text-gray-800">Contenido</p>
                        <p className="text-xs text-gray-400">Carousel, imagen o texto</p>
                      </div>
                    </button>
                    <button
                      onClick={() => { setShowStoryModal(true); setShowGenerateDropdown(false); }}
                      className="w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <span>📖</span>
                      <div>
                        <p className="font-medium text-gray-800">Historia</p>
                        <p className="text-xs text-gray-400">Story de 24 horas</p>
                      </div>
                    </button>
                    <button
                      onClick={() => { setShowGenerateDropdown(false); }}
                      className="w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center gap-2 text-gray-400 cursor-default"
                    >
                      <span>🎬</span>
                      <div>
                        <p className="font-medium">Reel</p>
                        <p className="text-xs">Seleccioná un post con imagen</p>
                      </div>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-700">
            Error: {error}
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex gap-1 border-b border-gray-200">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setFilter(tab.value)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                filter === tab.value
                  ? "border-gray-900 text-gray-900"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content table */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          {loadingContent ? (
            <div className="flex items-center justify-center h-40 text-sm text-gray-500">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading content...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3">
              <FileText className="h-10 w-10 text-gray-300" />
              <p className="text-sm text-gray-500">No content found.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Thumbnail</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Caption</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Created</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Video</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Imagen</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((post) => (
                  <tr key={post.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      {post.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={post.image_url}
                          alt="thumbnail"
                          className="h-12 w-12 object-cover rounded-md border border-gray-200"
                        />
                      ) : (
                        <div className="h-12 w-12 bg-gray-100 rounded-md flex items-center justify-center">
                          <FileText className="h-5 w-5 text-gray-400" />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      <p className="truncate text-gray-900">{post.caption}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CLASSES[post.status]}`}
                      >
                        {STATUS_LABELS[post.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
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
                                className="h-14 w-24 rounded-md border border-gray-200 object-cover"
                              />
                              <a
                                href={resolvedVideoUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-600 hover:underline"
                              >
                                Descargar
                              </a>
                            </div>
                          );
                        }
                        if (post.image_url && !isClient) {
                          return (
                            <button
                              onClick={() => setReelPost(post)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white text-xs font-medium rounded-md hover:bg-violet-700 transition-colors whitespace-nowrap"
                              title="Agregar Reel a este post"
                            >
                              <Video className="h-3.5 w-3.5" />
                              🎬 Generar Reel
                            </button>
                          );
                        }
                        return <span className="text-xs text-gray-400">—</span>;
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      {!isClient && (
                        <button
                          onClick={() => setImageGenPost(post)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-700 text-xs font-medium rounded-md hover:bg-gray-50 transition-colors whitespace-nowrap"
                          title="Generar imagen con IA"
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
                              Generar imagen
                            </>
                          )}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {!isClient && (
                        <button
                          onClick={() => setEditPost(post)}
                          className="p-1.5 hover:bg-gray-100 rounded-md transition-colors"
                          title="Edit post"
                        >
                          <Pencil className="h-4 w-4 text-gray-500" />
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
          onClose={() => setShowModal(false)}
          onSuccess={loadContent}
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
            showToast("success", "Reel enviado para aprobación");
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
            showToast("success", "Historia publicada correctamente");
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

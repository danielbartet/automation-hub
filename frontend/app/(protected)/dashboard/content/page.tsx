"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Header } from "@/components/layout/Header";
import { fetchProjects, fetchContent, importFromMeta, generateVideo } from "@/lib/api";
import { PlusCircle, FileText, Loader2, Pencil, Download, Video, Image } from "lucide-react";
import { GenerateContentModal } from "@/components/dashboard/GenerateContentModal";
import { EditContentModal } from "@/components/dashboard/EditContentModal";
import { ImageGeneratorModal } from "@/components/dashboard/ImageGeneratorModal";

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
  const [importingMeta, setImportingMeta] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; message: string } | null>(null);
  const [generatingVideoId, setGeneratingVideoId] = useState<number | null>(null);
  const [videoResults, setVideoResults] = useState<Record<number, { video_url: string; credits_remaining: number }>>({});
  const [imageGenPost, setImageGenPost] = useState<ContentPost | null>(null);

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

  const handleProjectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const proj = projects.find((p) => p.id === e.target.value);
    if (proj) {
      setSelectedProjectId(proj.id);
      setSelectedProjectSlug(proj.slug);
    }
  };

  const handleGenerateVideo = async (postId: number) => {
    setGeneratingVideoId(postId);
    setError(null);
    try {
      const result = await generateVideo(postId);
      setVideoResults((prev) => ({ ...prev, [postId]: result }));
      loadContent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Video generation failed");
    } finally {
      setGeneratingVideoId(null);
    }
  };

  const handleImportFromMeta = async () => {
    if (!selectedProjectSlug) return;
    setImportingMeta(true);
    setImportResult(null);
    setError(null);
    try {
      const result = await importFromMeta(selectedProjectSlug);
      setImportResult({ imported: result.imported, skipped: result.skipped, message: result.message });
      if (result.imported > 0) {
        loadContent();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImportingMeta(false);
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
                className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {importingMeta ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Importar desde Meta
              </button>
              <button
                onClick={() => setShowModal(true)}
                disabled={!selectedProjectSlug}
                className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-md hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <PlusCircle className="h-4 w-4" />
                Generate New
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-700">
            Error: {error}
          </div>
        )}

        {importResult && (
          <div className="bg-green-50 border border-green-200 rounded-md p-4 text-sm text-green-700 flex items-center justify-between">
            <span>{importResult.message}</span>
            <button
              onClick={() => setImportResult(null)}
              className="ml-4 text-green-500 hover:text-green-700 font-medium"
            >
              Dismiss
            </button>
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
                          const isGenerating = generatingVideoId === post.id;
                          return (
                            <button
                              onClick={() => handleGenerateVideo(post.id)}
                              disabled={isGenerating || generatingVideoId !== null}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white text-xs font-medium rounded-md hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                              title="Generar Reel con Kling AI"
                            >
                              {isGenerating ? (
                                <>
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  Generando...
                                </>
                              ) : (
                                <>
                                  <Video className="h-3.5 w-3.5" />
                                  Generar Reel
                                </>
                              )}
                            </button>
                          );
                        }
                        return <span className="text-xs text-gray-400">—</span>;
                      })()}
                      {generatingVideoId === post.id && (
                        <p className="text-xs text-gray-500 mt-1 max-w-[180px]">
                          Generando video con Kling AI... (puede tardar 2-3 minutos)
                        </p>
                      )}
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
    </div>
  );
}

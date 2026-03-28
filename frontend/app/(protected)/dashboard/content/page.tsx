"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Header } from "@/components/layout/Header";
import { fetchProjects, fetchContent } from "@/lib/api";
import { PlusCircle, FileText, Loader2, Pencil } from "lucide-react";
import { GenerateContentModal } from "@/components/dashboard/GenerateContentModal";
import { EditContentModal } from "@/components/dashboard/EditContentModal";

interface Project {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
}

interface ContentPost {
  id: number;
  caption: string;
  status: "pending_approval" | "published" | "draft" | "approved" | "rejected";
  image_url?: string;
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
    if (!selectedProjectId) return;
    setLoadingContent(true);
    setError(null);
    fetchContent(selectedProjectId)
      .then((data) => setContent(Array.isArray(data) ? data : []))
      .catch((err) => setError(err.message))
      .finally(() => setLoadingContent(false));
  }, [selectedProjectId]);

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
            <button
              onClick={() => setShowModal(true)}
              disabled={!selectedProjectSlug}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-md hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <PlusCircle className="h-4 w-4" />
              Generate New
            </button>
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
          onClose={() => setShowModal(false)}
          onSuccess={loadContent}
        />
      )}
      {editPost && selectedProjectSlug && (
        <EditContentModal
          post={editPost}
          projectSlug={selectedProjectSlug}
          onClose={() => setEditPost(null)}
          onSaved={() => {
            setEditPost(null);
            loadContent();
          }}
        />
      )}
    </div>
  );
}

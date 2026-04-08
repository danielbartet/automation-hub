"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { fetchProjects } from "@/lib/api";
import { Settings, PlusCircle, ExternalLink, FolderKanban } from "lucide-react";
import { ProjectFormDialog } from "@/components/dashboard/ProjectFormDialog";

interface Project {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  content_config?: Record<string, unknown>;
  media_config?: Record<string, unknown>;
  facebook_page_id?: string | null;
  meta_token_expires_at?: string | null;
}

// ── Token expiry badge ────────────────────────────────────────────────────────

function MetaTokenBadge({ expiresAt }: { expiresAt: string }) {
  const daysRemaining = Math.ceil(
    (new Date(expiresAt).getTime() - Date.now()) / 86400000
  );

  if (daysRemaining < 0) {
    return (
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
        style={{ backgroundColor: "#450a0a", color: "#f87171", border: "1px solid #7f1d1d" }}
      >
        Token expirado — Reconectar
      </span>
    );
  }

  if (daysRemaining <= 7) {
    return (
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
        style={{ backgroundColor: "#422006", color: "#fbbf24", border: "1px solid #92400e" }}
      >
        Token expira en {daysRemaining} día{daysRemaining !== 1 ? "s" : ""}
      </span>
    );
  }

  return null;
}

// ── Inner page (needs useSearchParams) ───────────────────────────────────────

function ProjectsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const role = session?.user?.role;

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Handle OAuth callback params
  useEffect(() => {
    const connected = searchParams.get("meta_connected");
    const metaError = searchParams.get("meta_error");

    if (connected === "true") {
      setToast({ type: "success", message: "Meta account connected successfully" });
      router.replace("/dashboard/projects");
    } else if (metaError) {
      setToast({ type: "error", message: metaError });
      router.replace("/dashboard/projects");
    }
  }, [searchParams, router]);

  // Auto-dismiss toast after 5 seconds
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    fetchProjects()
      .then((data) => setProjects(Array.isArray(data) ? data : []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleProjectUpdated = (updated: Project) => {
    setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  };

  const canSeeTokenWarning = role === "admin" || role === "operator";

  return (
    <div>
      <Header title="Projects" />
      <div className="p-6 space-y-6">

        {/* Toast banner */}
        {toast && (
          <div
            className="rounded-md p-4 text-sm flex items-center justify-between gap-3"
            style={
              toast.type === "success"
                ? { backgroundColor: "#052e16", border: "1px solid #166534", color: "#4ade80" }
                : { backgroundColor: "#450a0a", border: "1px solid #7f1d1d", color: "#f87171" }
            }
          >
            <span>{toast.message}</span>
            <button
              onClick={() => setToast(null)}
              className="text-xs opacity-70 hover:opacity-100 transition-opacity"
            >
              &times;
            </button>
          </div>
        )}

        <div className="flex items-center justify-between">
          <p className="text-sm" style={{ color: "#9ca3af" }}>
            {loading ? "Loading projects..." : `${projects.length} project${projects.length !== 1 ? "s" : ""}`}
          </p>
          <button
            className="inline-flex items-center gap-2 px-4 py-2 text-white text-sm font-medium rounded-md transition-colors"
            style={{ backgroundColor: "#7c3aed" }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#6d28d9")}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#7c3aed")}
            onClick={() => alert("New project form coming soon")}
          >
            <PlusCircle className="h-4 w-4" />
            New Project
          </button>
        </div>

        {loading && (
          <div className="flex items-center justify-center h-40 text-sm" style={{ color: "#9ca3af" }}>
            Loading...
          </div>
        )}

        {error && (
          <div className="rounded-md p-4 text-sm text-red-400" style={{ backgroundColor: "#450a0a", border: "1px solid #7f1d1d" }}>
            Error: {error}
          </div>
        )}

        {!loading && !error && projects.length === 0 && (
          <div className="rounded-lg p-12 flex flex-col items-center gap-4" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
            <FolderKanban className="h-12 w-12" style={{ color: "#374151" }} />
            <div className="text-center">
              <p className="text-base font-medium text-white">No projects yet</p>
              <p className="text-sm mt-1" style={{ color: "#9ca3af" }}>Create your first project to get started.</p>
            </div>
            <button
              className="inline-flex items-center gap-2 px-4 py-2 text-white text-sm font-medium rounded-md transition-colors"
              style={{ backgroundColor: "#7c3aed" }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#6d28d9")}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#7c3aed")}
              onClick={() => alert("New project form coming soon")}
            >
              <PlusCircle className="h-4 w-4" />
              New Project
            </button>
          </div>
        )}

        {!loading && !error && projects.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => (
              <div
                key={project.id}
                className="rounded-lg p-6 flex flex-col gap-4 transition-colors"
                style={{ backgroundColor: "#111111", border: "1px solid #222222" }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#161616")}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#111111")}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-white">{project.name}</h3>
                    <span className="inline-block mt-1 px-2 py-0.5 text-xs font-mono rounded" style={{ backgroundColor: "#1a1a1a", color: "#9ca3af" }}>
                      {project.slug}
                    </span>
                  </div>
                  <span
                    className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                      project.is_active
                        ? "bg-green-900/50 text-green-400"
                        : "bg-gray-800 text-gray-500"
                    }`}
                  >
                    {project.is_active ? "Active" : "Inactive"}
                  </span>
                </div>

                {/* Meta token expiry warning — admin/operator only */}
                {canSeeTokenWarning && project.meta_token_expires_at && (
                  <div>
                    <MetaTokenBadge expiresAt={project.meta_token_expires_at} />
                  </div>
                )}

                <div className="flex items-center gap-2 mt-auto">
                  <Link
                    href={`/dashboard?project=${project.slug}`}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 text-white text-sm font-medium rounded-md transition-colors"
                    style={{ backgroundColor: "#7c3aed" }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#6d28d9")}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#7c3aed")}
                  >
                    <ExternalLink className="h-4 w-4" />
                    View Dashboard
                  </Link>
                  <button
                    className="inline-flex items-center justify-center p-2 rounded-md transition-colors"
                    style={{ color: "#9ca3af", border: "1px solid #333333" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#ffffff"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#555555"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#333333"; }}
                    title="Project settings"
                    onClick={() => setEditingProject(project)}
                  >
                    <Settings className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editingProject && (
        <ProjectFormDialog
          project={editingProject}
          onClose={() => setEditingProject(null)}
          onSuccess={handleProjectUpdated}
        />
      )}
    </div>
  );
}

// ── Page export (wrapped in Suspense for useSearchParams) ─────────────────────

export default function ProjectsPage() {
  return (
    <Suspense fallback={null}>
      <ProjectsPageInner />
    </Suspense>
  );
}

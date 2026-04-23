"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { fetchProjects, deleteProject } from "@/lib/api";
import { Settings, PlusCircle, ExternalLink, FolderKanban, Trash2 } from "lucide-react";
import { ProjectFormDialog } from "@/components/dashboard/ProjectFormDialog";
import { ProjectCreateDialog } from "@/components/dashboard/ProjectCreateDialog";
import { MetaAssetSelectModal } from "@/components/dashboard/MetaAssetSelectModal";
import { useT } from "@/lib/i18n";

interface Project {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  content_config?: Record<string, unknown>;
  media_config?: Record<string, unknown>;
  facebook_page_id?: string | null;
  instagram_account_id?: string | null;
  ad_account_id?: string | null;
  meta_token_expires_at?: string | null;
}

interface MetaAssetsPayload {
  pages: Array<{ id: string; name?: string }>;
  ad_accounts: Array<{ id: string; name?: string }>;
  instagram_accounts: Array<{ id: string; username?: string }>;
  current: {
    page_id: string | null;
    instagram_id: string | null;
    ad_account_id: string | null;
  };
}

// ── Token expiry badge ────────────────────────────────────────────────────────

function MetaTokenBadge({ expiresAt, t }: { expiresAt: string; t: ReturnType<typeof useT> }) {
  const daysRemaining = Math.ceil(
    (new Date(expiresAt).getTime() - Date.now()) / 86400000
  );

  if (daysRemaining < 0) {
    return (
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
        style={{ backgroundColor: "#450a0a", color: "#f87171", border: "1px solid #7f1d1d" }}
      >
        {t.projects_token_expired}
      </span>
    );
  }

  if (daysRemaining <= 7) {
    return (
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
        style={{ backgroundColor: "#422006", color: "#fbbf24", border: "1px solid #92400e" }}
      >
        {t.projects_token_expires_in(daysRemaining)}
      </span>
    );
  }

  return null;
}

// ── OAuth error sanitization ──────────────────────────────────────────────────

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Acceso denegado. Intenta de nuevo.",
  invalid_grant: "Sesión expirada. Por favor reconecta.",
  invalid_client: "Error de configuración. Contacta al soporte.",
  server_error: "Error del servidor. Intenta más tarde.",
  temporarily_unavailable: "Servicio no disponible. Intenta más tarde.",
  missing_token: "No se recibió token. Intenta de nuevo.",
  fetch_failed: "No se pudo obtener la URL de autorización.",
  callback_error: "Error en el callback de autorización.",
};

function getOAuthErrorMessage(code: string | null): string {
  if (!code) return "";
  return OAUTH_ERROR_MESSAGES[code] ?? "Error de autenticación desconocido.";
}

// ── Inner page (needs useSearchParams) ───────────────────────────────────────

function ProjectsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const role = session?.user?.role;
  const t = useT();

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [metaSelectSlug, setMetaSelectSlug] = useState<string | null>(null);
  const [metaSelectAssets, setMetaSelectAssets] = useState<MetaAssetsPayload | null>(null);

  // Handle OAuth callback params
  useEffect(() => {
    const connected = searchParams.get("meta_connected");
    const metaError = searchParams.get("meta_error");
    const metaSelect = searchParams.get("meta_select");
    const pinterestConnected = searchParams.get("pinterest_connected");
    const pinterestError = searchParams.get("pinterest_error");

    if (pinterestConnected === "true") {
      setToast({ type: "success", message: "Pinterest account connected successfully" });
      router.replace("/dashboard/projects");
    } else if (pinterestError) {
      setToast({ type: "error", message: getOAuthErrorMessage(pinterestError) });
      router.replace("/dashboard/projects");
    } else if (connected === "true") {
      setToast({ type: "success", message: "Meta account connected successfully" });
      router.replace("/dashboard/projects");
    } else if (metaError) {
      setToast({ type: "error", message: getOAuthErrorMessage(metaError) });
      router.replace("/dashboard/projects");
    } else if (metaSelect === "true") {
      const slug = searchParams.get("slug");
      const assetsParam = searchParams.get("assets");
      if (slug && assetsParam) {
        try {
          const decoded = JSON.parse(atob(decodeURIComponent(assetsParam)));
          // Runtime shape validation before trusting server-provided payload
          if (
            !decoded ||
            typeof decoded !== "object" ||
            !Array.isArray(decoded.pages) ||
            !Array.isArray(decoded.ad_accounts) ||
            !Array.isArray(decoded.instagram_accounts)
          ) {
            throw new Error("Invalid assets payload shape");
          }
          setMetaSelectSlug(slug);
          setMetaSelectAssets(decoded as MetaAssetsPayload);
        } catch {
          setToast({ type: "error", message: t.projects_toast_meta_error_parse });
        }
      }
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
    const token = (session as any)?.accessToken as string | undefined;
    fetchProjects(token)
      .then((data) => setProjects(Array.isArray(data) ? data : []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [session]);

  const handleProjectUpdated = (updated: Project) => {
    setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  };

  const handleProjectCreated = (created: Project) => {
    setProjects((prev) => [...prev, created]);
    setToast({ type: "success", message: t.projects_toast_created(created.name) });
  };

  const handleDeleteProject = async () => {
    if (!deletingProject) return;
    setDeleteLoading(true);
    try {
      const token = (session as any)?.accessToken as string | undefined;
      await deleteProject(deletingProject.slug, token);
      setProjects((prev) => prev.filter((p) => p.id !== deletingProject.id));
      setToast({ type: "success", message: t.projects_toast_deleted(deletingProject.name) });
      setDeletingProject(null);
    } catch (e) {
      setToast({ type: "error", message: e instanceof Error ? e.message : t.projects_toast_delete_error });
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleMetaAssetSuccess = (updated: Project) => {
    setProjects((prev) => prev.map((p) => (p.slug === updated.slug ? updated : p)));
    setMetaSelectSlug(null);
    setMetaSelectAssets(null);
    setToast({ type: "success", message: t.projects_toast_meta_saved });
  };

  const canSeeTokenWarning = role === "super_admin" || role === "admin" || role === "operator";
  const canDeleteProject = role === "super_admin" || role === "admin";

  return (
    <div>
      <Header title={t.projects_page_title} />
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
            {loading
              ? t.projects_loading
              : projects.length === 1
              ? t.projects_count_one
              : t.projects_count_many(projects.length)}
          </p>
          <button
            className="inline-flex items-center gap-2 px-4 py-2 text-white text-sm font-medium rounded-md transition-colors"
            style={{ backgroundColor: "#7c3aed" }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#6d28d9")}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#7c3aed")}
            onClick={() => setShowCreateDialog(true)}
          >
            <PlusCircle className="h-4 w-4" />
            {t.projects_new}
          </button>
        </div>

        {loading && (
          <div className="flex items-center justify-center h-40 text-sm" style={{ color: "#9ca3af" }}>
            {t.projects_loading_spinner}
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
              <p className="text-base font-medium text-white">{t.projects_empty_title}</p>
              <p className="text-sm mt-1" style={{ color: "#9ca3af" }}>{t.projects_empty_subtitle}</p>
            </div>
            <button
              className="inline-flex items-center gap-2 px-4 py-2 text-white text-sm font-medium rounded-md transition-colors"
              style={{ backgroundColor: "#7c3aed" }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#6d28d9")}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#7c3aed")}
              onClick={() => setShowCreateDialog(true)}
            >
              <PlusCircle className="h-4 w-4" />
              {t.projects_new}
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
                    {project.is_active ? t.projects_status_active : t.projects_status_inactive}
                  </span>
                </div>

                {/* Meta token expiry warning — admin/operator only */}
                {canSeeTokenWarning && project.meta_token_expires_at && (
                  <div>
                    <MetaTokenBadge expiresAt={project.meta_token_expires_at} t={t} />
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
                    {t.projects_view_dashboard}
                  </Link>
                  <button
                    className="inline-flex items-center justify-center p-2 rounded-md transition-colors"
                    style={{ color: "#9ca3af", border: "1px solid #333333" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#ffffff"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#555555"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#333333"; }}
                    title={t.projects_settings_title}
                    onClick={() => setEditingProject(project)}
                  >
                    <Settings className="h-4 w-4" />
                  </button>
                  {canDeleteProject && (
                    <button
                      className="inline-flex items-center justify-center p-2 rounded-md transition-colors"
                      style={{ color: "#6b7280", border: "1px solid #333333" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#ef4444"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#ef4444"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#6b7280"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#333333"; }}
                      title={t.projects_delete_tooltip}
                      onClick={() => setDeletingProject(project)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
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
          isOperator={role === "operator"}
        />
      )}

      {showCreateDialog && (
        <ProjectCreateDialog
          onClose={() => setShowCreateDialog(false)}
          onSuccess={handleProjectCreated}
        />
      )}

      {deletingProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.7)" }}>
          <div className="w-full max-w-sm rounded-xl p-6 space-y-4" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full" style={{ backgroundColor: "#450a0a" }}>
                <Trash2 className="h-5 w-5 text-red-400" />
              </div>
              <h2 className="text-base font-semibold text-white">{t.projects_delete_title}</h2>
            </div>
            <p className="text-sm" style={{ color: "#9ca3af" }}>
              {t.projects_delete_confirm_msg(deletingProject.name)}
            </p>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setDeletingProject(null)}
                disabled={deleteLoading}
                className="flex-1 py-2 rounded-lg text-sm font-medium"
                style={{ backgroundColor: "#1a1a1a", color: "#9ca3af", border: "1px solid #333333" }}
              >
                {t.projects_delete_cancel}
              </button>
              <button
                onClick={handleDeleteProject}
                disabled={deleteLoading}
                className="flex-1 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                style={{ backgroundColor: "#dc2626" }}
              >
                {deleteLoading ? t.projects_deleting : t.projects_delete_confirm_btn}
              </button>
            </div>
          </div>
        </div>
      )}

      {metaSelectSlug && metaSelectAssets && (
        <MetaAssetSelectModal
          slug={metaSelectSlug}
          assets={metaSelectAssets}
          onClose={() => {
            setMetaSelectSlug(null);
            setMetaSelectAssets(null);
          }}
          onSuccess={handleMetaAssetSuccess}
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

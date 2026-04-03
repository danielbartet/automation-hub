"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Header } from "@/components/layout/Header";
import { CreateAudienceModal } from "@/components/dashboard/CreateAudienceModal";
import { fetchProjects } from "@/lib/api";
import { Loader2, Plus, Trash2 } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface Project {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
}

export interface Audience {
  id: number;
  name: string;
  type: "website" | "customer_list" | "engagement" | "lookalike";
  status: "ready" | "processing" | "error";
  size: number | null;
  created_at: string;
  meta_audience_id?: string;
}

const TYPE_LABELS: Record<Audience["type"], string> = {
  website: "Visitantes del sitio",
  customer_list: "Lista de clientes",
  engagement: "Interacciones",
  lookalike: "Lookalike",
};

const TYPE_BADGE_STYLES: Record<Audience["type"], string> = {
  website: "bg-blue-900/50 text-blue-400",
  customer_list: "bg-purple-900/50 text-purple-400",
  engagement: "bg-orange-900/50 text-orange-400",
  lookalike: "bg-green-900/50 text-green-400",
};

const STATUS_BADGE_STYLES: Record<Audience["status"], string> = {
  ready: "bg-green-900/50 text-green-400",
  processing: "bg-yellow-900/50 text-yellow-400",
  error: "bg-red-900/50 text-red-400",
};

const STATUS_LABELS: Record<Audience["status"], string> = {
  ready: "Lista",
  processing: "Procesando",
  error: "Error",
};

const SOURCE_LABELS: Record<Audience["type"], string> = {
  website: "Pixel",
  customer_list: "CSV",
  engagement: "Instagram/Facebook",
  lookalike: "Basada en audiencia",
};

function relativeDate(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor(diffMs / (1000 * 60));

  if (diffMinutes < 1) return "hace un momento";
  if (diffMinutes < 60) return `hace ${diffMinutes} min`;
  if (diffHours < 24) return `hace ${diffHours}h`;
  if (diffDays === 1) return "hace 1 día";
  if (diffDays < 30) return `hace ${diffDays} días`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths === 1) return "hace 1 mes";
  return `hace ${diffMonths} meses`;
}

export default function AudiencesPage() {
  const { data: session } = useSession();
  const token = (session as { accessToken?: string } | null)?.accessToken ?? "";

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const [audiences, setAudiences] = useState<Audience[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  useEffect(() => {
    fetchProjects()
      .then((list: Project[]) => {
        const arr = Array.isArray(list) ? list : [];
        setProjects(arr);
        if (arr.length > 0) setSelectedSlug(arr[0].slug);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoadingProjects(false));
  }, []);

  const loadAudiences = useCallback(async () => {
    if (!selectedSlug || !token) return;
    setLoading(true);
    setError(null);
    try {
      // Sync sizes first (fire and forget errors gracefully)
      try {
        await fetch(`${API_BASE}/api/v1/audiences/${selectedSlug}/sync`, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // sync failure is non-fatal
      }
      const res = await fetch(`${API_BASE}/api/v1/audiences/${selectedSlug}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Error al cargar audiencias");
      const data = await res.json();
      setAudiences(Array.isArray(data) ? data : (data.items ?? []));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar audiencias");
    } finally {
      setLoading(false);
    }
  }, [selectedSlug, token]);

  useEffect(() => {
    loadAudiences();
  }, [loadAudiences]);

  const handleDelete = async (id: number) => {
    if (!selectedSlug || !token) return;
    setDeletingId(id);
    setConfirmDeleteId(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/audiences/${selectedSlug}/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Error al eliminar audiencia");
      setAudiences((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al eliminar audiencia");
    } finally {
      setDeletingId(null);
    }
  };

  const selectedProject = projects.find((p) => p.slug === selectedSlug) ?? null;

  return (
    <div>
      <Header title="Audiencias" />
      <div className="p-6 space-y-6">
        {/* Header row */}
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-sm font-medium" style={{ color: "#9ca3af" }}>
            Project:
          </label>
          {loadingProjects ? (
            <span className="text-sm" style={{ color: "#9ca3af" }}>
              Loading...
            </span>
          ) : (
            <select
              value={selectedSlug}
              onChange={(e) => setSelectedSlug(e.target.value)}
              className="text-sm rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
              style={{
                backgroundColor: "#1a1a1a",
                border: "1px solid #333333",
                color: "#ffffff",
              }}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.slug}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          {loading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
          <div className="ml-auto">
            <button
              onClick={() => setShowCreateModal(true)}
              disabled={!selectedProject}
              className="flex items-center gap-2 px-4 py-2 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              style={{ backgroundColor: "#7c3aed" }}
              onMouseEnter={(e) => {
                if (!(e.currentTarget as HTMLButtonElement).disabled)
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#6d28d9";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#7c3aed";
              }}
            >
              <Plus className="h-4 w-4" />
              Nueva audiencia
            </button>
          </div>
        </div>

        {error && (
          <div
            className="rounded-md p-4 text-sm text-red-400"
            style={{ backgroundColor: "#450a0a", border: "1px solid #7f1d1d" }}
          >
            Error: {error}
          </div>
        )}

        {/* Audiences table or empty state */}
        <div
          className="rounded-lg overflow-hidden"
          style={{ backgroundColor: "#111111", border: "1px solid #222222" }}
        >
          <div className="px-6 py-4" style={{ borderBottom: "1px solid #222222" }}>
            <h3 className="text-base font-semibold text-white">Audiencias personalizadas</h3>
          </div>

          {loading ? (
            <div
              className="flex items-center justify-center h-40 text-sm"
              style={{ color: "#9ca3af" }}
            >
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Sincronizando con Meta...
            </div>
          ) : audiences.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-56 text-center px-6">
              <p className="text-sm mb-1" style={{ color: "#9ca3af" }}>
                Sin audiencias todavía.
              </p>
              <p className="text-sm mb-6" style={{ color: "#6b7280" }}>
                Creá tu primera audiencia para hacer retargeting o encontrar personas similares a tus
                clientes.
              </p>
              <button
                onClick={() => setShowCreateModal(true)}
                disabled={!selectedProject}
                className="flex items-center gap-2 px-4 py-2 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                style={{ backgroundColor: "#7c3aed" }}
                onMouseEnter={(e) => {
                  if (!(e.currentTarget as HTMLButtonElement).disabled)
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#6d28d9";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#7c3aed";
                }}
              >
                <Plus className="h-4 w-4" />
                Crear primera audiencia
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead style={{ backgroundColor: "#111111", borderBottom: "1px solid #222222" }}>
                  <tr>
                    <th
                      className="text-left px-4 py-3 font-medium"
                      style={{ color: "#9ca3af" }}
                    >
                      Nombre
                    </th>
                    <th
                      className="text-left px-4 py-3 font-medium"
                      style={{ color: "#9ca3af" }}
                    >
                      Tipo
                    </th>
                    <th
                      className="text-left px-4 py-3 font-medium"
                      style={{ color: "#9ca3af" }}
                    >
                      Tamaño
                    </th>
                    <th
                      className="text-left px-4 py-3 font-medium"
                      style={{ color: "#9ca3af" }}
                    >
                      Estado
                    </th>
                    <th
                      className="text-left px-4 py-3 font-medium"
                      style={{ color: "#9ca3af" }}
                    >
                      Fuente
                    </th>
                    <th
                      className="text-left px-4 py-3 font-medium"
                      style={{ color: "#9ca3af" }}
                    >
                      Creada
                    </th>
                    <th
                      className="text-left px-4 py-3 font-medium"
                      style={{ color: "#9ca3af" }}
                    >
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {audiences.map((audience, i) => (
                    <tr
                      key={audience.id}
                      style={{ borderTop: i > 0 ? "1px solid #1a1a1a" : undefined }}
                    >
                      <td className="px-4 py-3 font-medium text-white max-w-[200px] truncate">
                        {audience.name}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_BADGE_STYLES[audience.type]}`}
                        >
                          {TYPE_LABELS[audience.type]}
                        </span>
                      </td>
                      <td className="px-4 py-3" style={{ color: "#9ca3af" }}>
                        {audience.size == null || audience.status === "processing"
                          ? "Procesando..."
                          : `${audience.size.toLocaleString()} personas`}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE_STYLES[audience.status]}`}
                        >
                          {STATUS_LABELS[audience.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3" style={{ color: "#9ca3af" }}>
                        {SOURCE_LABELS[audience.type]}
                      </td>
                      <td className="px-4 py-3" style={{ color: "#9ca3af" }}>
                        {relativeDate(audience.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        {confirmDeleteId === audience.id ? (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleDelete(audience.id)}
                              disabled={deletingId === audience.id}
                              className="text-xs px-2 py-1 rounded font-medium text-white"
                              style={{ backgroundColor: "#7f1d1d" }}
                            >
                              {deletingId === audience.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                "Confirmar"
                              )}
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-xs px-2 py-1 rounded font-medium"
                              style={{ color: "#9ca3af" }}
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(audience.id)}
                            disabled={deletingId === audience.id}
                            className="p-1.5 rounded transition-colors disabled:opacity-50"
                            title="Eliminar audiencia"
                            style={{ color: "#ef4444" }}
                            onMouseEnter={(e) => {
                              (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                                "#1a0000";
                            }}
                            onMouseLeave={(e) => {
                              (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                                "transparent";
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showCreateModal && selectedProject && (
        <CreateAudienceModal
          open={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          projectSlug={selectedProject.slug}
          onCreated={(newAudience) => {
            setAudiences((prev) => [newAudience, ...prev]);
          }}
        />
      )}
    </div>
  );
}

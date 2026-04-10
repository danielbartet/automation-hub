"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Header } from "@/components/layout/Header";
import { CreateAudienceModal } from "@/components/dashboard/CreateAudienceModal";
import { fetchProjects } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Loader2, Plus, Trash2, UserPlus } from "lucide-react";

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

export default function AudiencesPage() {
  const { data: session } = useSession();
  const token = (session as { accessToken?: string } | null)?.accessToken ?? "";
  const t = useT();

  const TYPE_LABELS: Record<Audience["type"], string> = {
    website: t.audiences_type_website,
    customer_list: t.audiences_type_customer_list,
    engagement: t.audiences_type_engagement,
    lookalike: t.audiences_type_lookalike,
  };

  const STATUS_LABELS: Record<Audience["status"], string> = {
    ready: t.audiences_status_ready,
    processing: t.audiences_status_processing,
    error: t.audiences_status_error,
  };

  const SOURCE_LABELS: Record<Audience["type"], string> = {
    website: t.audiences_source_website,
    customer_list: t.audiences_source_customer_list,
    engagement: t.audiences_source_engagement,
    lookalike: t.audiences_source_lookalike,
  };

  function relativeDate(isoString: string): string {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor(diffMs / (1000 * 60));

    if (diffMinutes < 1) return t.audiences_date_just_now;
    if (diffMinutes < 60) return t.audiences_date_min_ago(diffMinutes);
    if (diffHours < 24) return t.audiences_date_hours_ago(diffHours);
    if (diffDays === 1) return t.audiences_date_1day_ago;
    if (diffDays < 30) return t.audiences_date_days_ago(diffDays);
    const diffMonths = Math.floor(diffDays / 30);
    if (diffMonths === 1) return t.audiences_date_1month_ago;
    return t.audiences_date_months_ago(diffMonths);
  }

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const [audiences, setAudiences] = useState<Audience[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  // Add contacts state
  const [addContactsAudience, setAddContactsAudience] = useState<Audience | null>(null);
  const [addContactsFile, setAddContactsFile] = useState<File | null>(null);
  const [addContactsDragging, setAddContactsDragging] = useState(false);
  const [addContactsLoading, setAddContactsLoading] = useState(false);
  const [addContactsResult, setAddContactsResult] = useState<string | null>(null);
  const [addContactsError, setAddContactsError] = useState<string | null>(null);

  useEffect(() => {
    const token = (session as any)?.accessToken as string | undefined;
    fetchProjects(token)
      .then((list: Project[]) => {
        const arr = Array.isArray(list) ? list : [];
        setProjects(arr);
        if (arr.length > 0) setSelectedSlug(arr[0].slug);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoadingProjects(false));
  }, [session]);

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
      if (!res.ok) throw new Error(t.audiences_error_load);
      const data = await res.json();
      setAudiences(Array.isArray(data) ? data : (data.items ?? []));
    } catch (err) {
      setError(err instanceof Error ? err.message : t.audiences_error_load);
    } finally {
      setLoading(false);
    }
  }, [selectedSlug, token, t]);

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
      if (!res.ok) throw new Error(t.audiences_error_delete);
      setAudiences((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : t.audiences_error_delete);
    } finally {
      setDeletingId(null);
    }
  };

  const selectedProject = projects.find((p) => p.slug === selectedSlug) ?? null;

  const openAddContacts = (audience: Audience) => {
    setAddContactsAudience(audience);
    setAddContactsFile(null);
    setAddContactsResult(null);
    setAddContactsError(null);
  };

  const closeAddContacts = () => {
    setAddContactsAudience(null);
    setAddContactsFile(null);
    setAddContactsResult(null);
    setAddContactsError(null);
  };

  const handleAddContactsSubmit = async () => {
    if (!addContactsAudience || !addContactsFile || !token) return;
    setAddContactsLoading(true);
    setAddContactsResult(null);
    setAddContactsError(null);
    try {
      const formData = new FormData();
      formData.append("file", addContactsFile);
      const res = await fetch(
        `${API_BASE}/api/v1/audiences/${selectedSlug}/${addContactsAudience.id}/add-users`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail ?? t.audiences_error_upload);
      }
      setAddContactsResult(t.audiences_added_contacts(data.added));
      setAddContactsFile(null);
    } catch (err) {
      setAddContactsError(err instanceof Error ? err.message : t.audiences_error_upload);
    } finally {
      setAddContactsLoading(false);
    }
  };

  return (
    <div>
      <Header title={t.audiences_page_title} />
      <div className="p-6 space-y-6">
        {/* Header row */}
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-sm font-medium" style={{ color: "#9ca3af" }}>
            {t.audiences_project_label}
          </label>
          {loadingProjects ? (
            <span className="text-sm" style={{ color: "#9ca3af" }}>
              {t.audiences_loading}
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
              {t.audiences_new_btn}
            </button>
          </div>
        </div>

        {error && (
          <div
            className="rounded-md p-4 text-sm text-red-400"
            style={{ backgroundColor: "#450a0a", border: "1px solid #7f1d1d" }}
          >
            {t.audiences_error_prefix} {error}
          </div>
        )}

        {/* Audiences table or empty state */}
        <div
          className="rounded-lg overflow-hidden"
          style={{ backgroundColor: "#111111", border: "1px solid #222222" }}
        >
          <div className="px-6 py-4" style={{ borderBottom: "1px solid #222222" }}>
            <h3 className="text-base font-semibold text-white">{t.audiences_table_title}</h3>
          </div>

          {loading ? (
            <div
              className="flex items-center justify-center h-40 text-sm"
              style={{ color: "#9ca3af" }}
            >
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              {t.audiences_syncing}
            </div>
          ) : audiences.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-56 text-center px-6">
              <p className="text-sm mb-1" style={{ color: "#9ca3af" }}>
                {t.audiences_empty_title}
              </p>
              <p className="text-sm mb-6" style={{ color: "#6b7280" }}>
                {t.audiences_empty_subtitle}
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
                {t.audiences_create_first_btn}
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
                      {t.audiences_col_name}
                    </th>
                    <th
                      className="text-left px-4 py-3 font-medium"
                      style={{ color: "#9ca3af" }}
                    >
                      {t.audiences_col_type}
                    </th>
                    <th
                      className="text-left px-4 py-3 font-medium"
                      style={{ color: "#9ca3af" }}
                    >
                      {t.audiences_col_size}
                    </th>
                    <th
                      className="text-left px-4 py-3 font-medium"
                      style={{ color: "#9ca3af" }}
                    >
                      {t.audiences_col_status}
                    </th>
                    <th
                      className="text-left px-4 py-3 font-medium"
                      style={{ color: "#9ca3af" }}
                    >
                      {t.audiences_col_source}
                    </th>
                    <th
                      className="text-left px-4 py-3 font-medium"
                      style={{ color: "#9ca3af" }}
                    >
                      {t.audiences_col_created}
                    </th>
                    <th
                      className="text-left px-4 py-3 font-medium"
                      style={{ color: "#9ca3af" }}
                    >
                      {t.audiences_col_actions}
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
                          ? t.audiences_processing
                          : t.audiences_people(audience.size)}
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
                        <div className="flex items-center gap-1">
                          {audience.type === "customer_list" && (
                            <button
                              onClick={() => openAddContacts(audience)}
                              className="p-1.5 rounded transition-colors"
                              title={t.audiences_add_contacts_tooltip}
                              style={{ color: "#7c3aed" }}
                              onMouseEnter={(e) => {
                                (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                                  "#1a1030";
                              }}
                              onMouseLeave={(e) => {
                                (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                                  "transparent";
                              }}
                            >
                              <UserPlus className="h-4 w-4" />
                            </button>
                          )}
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
                                  t.audiences_confirm_delete
                                )}
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                className="text-xs px-2 py-1 rounded font-medium"
                                style={{ color: "#9ca3af" }}
                              >
                                {t.audiences_cancel}
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmDeleteId(audience.id)}
                              disabled={deletingId === audience.id}
                              className="p-1.5 rounded transition-colors disabled:opacity-50"
                              title={t.audiences_delete_tooltip}
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
                        </div>
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

      {/* Add contacts modal */}
      {addContactsAudience && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.7)" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeAddContacts();
          }}
        >
          <div
            className="rounded-xl p-6 w-full max-w-md space-y-4"
            style={{ backgroundColor: "#111111", border: "1px solid #333333" }}
          >
            <h2 className="text-base font-semibold text-white">
              {t.audiences_add_contacts_title(addContactsAudience.name)}
            </h2>

            {/* Drop zone */}
            <div
              className="rounded-lg border-2 border-dashed flex flex-col items-center justify-center py-8 px-4 cursor-pointer transition-colors"
              style={{
                borderColor: addContactsDragging ? "#7c3aed" : "#333333",
                backgroundColor: addContactsDragging ? "#1a1030" : "#0a0a0a",
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setAddContactsDragging(true);
              }}
              onDragLeave={() => setAddContactsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setAddContactsDragging(false);
                const dropped = e.dataTransfer.files[0];
                if (dropped) setAddContactsFile(dropped);
              }}
              onClick={() => document.getElementById("add-contacts-file-input")?.click()}
            >
              <input
                id="add-contacts-file-input"
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setAddContactsFile(f);
                }}
              />
              {addContactsFile ? (
                <p className="text-sm text-white font-medium">{addContactsFile.name}</p>
              ) : (
                <>
                  <p className="text-sm font-medium" style={{ color: "#9ca3af" }}>
                    {t.audiences_drop_hint}
                  </p>
                  <p className="text-xs mt-1" style={{ color: "#6b7280" }}>
                    {t.audiences_drop_column_hint}
                  </p>
                </>
              )}
            </div>

            {addContactsResult && (
              <p className="text-sm text-green-400">{addContactsResult}</p>
            )}
            {addContactsError && (
              <p className="text-sm text-red-400">{addContactsError}</p>
            )}

            <div className="flex justify-end gap-3 pt-1">
              <button
                onClick={closeAddContacts}
                className="px-4 py-2 text-sm rounded-lg font-medium"
                style={{ color: "#9ca3af" }}
              >
                {t.audiences_close}
              </button>
              <button
                onClick={handleAddContactsSubmit}
                disabled={!addContactsFile || addContactsLoading}
                className="flex items-center gap-2 px-4 py-2 text-sm text-white font-medium rounded-lg disabled:opacity-50"
                style={{ backgroundColor: "#7c3aed" }}
                onMouseEnter={(e) => {
                  if (!(e.currentTarget as HTMLButtonElement).disabled)
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#6d28d9";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#7c3aed";
                }}
              >
                {addContactsLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  t.audiences_upload_btn
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { useProject } from "@/lib/project-context";
import { useT } from "@/lib/i18n";
import { PlusCircle, Image, Loader2, Trash2, Upload } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PinterestPin {
  id: number;
  title: string | null;
  description: string | null;
  image_url: string | null;
  status: "pending" | "published" | "failed" | "preview_only";
  pin_id: string | null;
  created_at: string;
  published_at: string | null;
}

type StatusFilter = "all" | "pending" | "published" | "failed";

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_CLASSES: Record<PinterestPin["status"], string> = {
  pending: "bg-yellow-900/50 text-yellow-400",
  published: "bg-green-900/50 text-green-400",
  failed: "bg-red-900/50 text-red-400",
  preview_only: "bg-gray-800 text-gray-400",
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PinterestPage() {
  const t = useT();
  const { data: session } = useSession();
  const { selectedSlug } = useProject();

  const [pins, setPins] = useState<PinterestPin[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [publishingId, setPublishingId] = useState<number | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const showToast = (type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  const loadPins = useCallback(() => {
    if (!selectedSlug) return;
    const token = (session as { accessToken?: string } | null)?.accessToken;
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/api/v1/pinterest/pins?project_slug=${selectedSlug}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Error ${res.status}`);
        return res.json() as Promise<PinterestPin[]>;
      })
      .then((data) => setPins(Array.isArray(data) ? data : []))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [selectedSlug, session]);

  useEffect(() => {
    loadPins();
  }, [loadPins]);

  const handlePublish = async (pin: PinterestPin) => {
    const token = (session as { accessToken?: string } | null)?.accessToken;
    setPublishingId(pin.id);
    try {
      const res = await fetch(`${API_BASE}/api/v1/pinterest/pins/${pin.id}/publish`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { detail?: string }).detail || t.pinterest_publish_error);
      }
      showToast("success", t.pinterest_publish_success);
      loadPins();
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : t.pinterest_publish_error);
    } finally {
      setPublishingId(null);
    }
  };

  const handleDelete = async (pin: PinterestPin) => {
    if (!window.confirm(t.pinterest_delete_confirm)) return;
    const token = (session as { accessToken?: string } | null)?.accessToken;
    try {
      const res = await fetch(`${API_BASE}/api/v1/pinterest/pins/${pin.id}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(t.pinterest_delete_error);
      setPins((prev) => prev.filter((p) => p.id !== pin.id));
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : t.pinterest_delete_error);
    }
  };

  const statusLabel = (status: PinterestPin["status"]): string => {
    if (status === "pending") return t.pinterest_status_pending;
    if (status === "published") return t.pinterest_status_published;
    if (status === "failed") return t.pinterest_status_failed;
    return t.pinterest_status_preview;
  };

  const tabs: { label: string; value: StatusFilter }[] = [
    { label: "All", value: "all" },
    { label: t.pinterest_status_pending, value: "pending" },
    { label: t.pinterest_status_published, value: "published" },
    { label: t.pinterest_status_failed, value: "failed" },
  ];

  const filtered =
    filter === "all"
      ? pins
      : pins.filter((p) => p.status === filter);

  return (
    <div>
      <Header title={t.pinterest_page_title} />
      <div className="p-6 space-y-6">
        {/* Top bar */}
        <div className="flex items-center justify-between">
          <p className="text-sm" style={{ color: "#9ca3af" }}>
            {selectedSlug ? `${pins.length} pin${pins.length !== 1 ? "s" : ""}` : ""}
          </p>
          <Link
            href="/dashboard/pinterest/generate"
            className="inline-flex items-center gap-2 px-4 py-2 text-white text-sm font-medium rounded-md transition-colors"
            style={{ backgroundColor: "#7c3aed" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLAnchorElement).style.backgroundColor = "#6d28d9")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLAnchorElement).style.backgroundColor = "#7c3aed")}
          >
            <PlusCircle className="h-4 w-4" />
            {t.pinterest_generate_btn}
          </Link>
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
                filter === tab.value ? "border-[#7c3aed] text-white" : "border-transparent hover:text-gray-300"
              }`}
              style={{ color: filter === tab.value ? "#ffffff" : "#9ca3af" }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="rounded-lg overflow-hidden" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
          {loading ? (
            <div className="flex items-center justify-center h-40 text-sm" style={{ color: "#9ca3af" }}>
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              {t.pinterest_loading}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3">
              <Image className="h-10 w-10" style={{ color: "#374151" }} />
              <p className="text-sm" style={{ color: "#9ca3af" }}>{t.pinterest_empty}</p>
              <Link
                href="/dashboard/pinterest/generate"
                className="inline-flex items-center gap-2 px-4 py-2 text-white text-sm font-medium rounded-md transition-colors"
                style={{ backgroundColor: "#7c3aed" }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLAnchorElement).style.backgroundColor = "#6d28d9")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLAnchorElement).style.backgroundColor = "#7c3aed")}
              >
                <PlusCircle className="h-4 w-4" />
                {t.pinterest_generate_btn}
              </Link>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead style={{ backgroundColor: "#111111", borderBottom: "1px solid #222222" }}>
                <tr>
                  <th className="text-left px-4 py-3 font-medium" style={{ color: "#9ca3af" }}>
                    {t.pinterest_col_image}
                  </th>
                  <th className="text-left px-4 py-3 font-medium" style={{ color: "#9ca3af" }}>
                    {t.pinterest_col_title}
                  </th>
                  <th className="text-left px-4 py-3 font-medium" style={{ color: "#9ca3af" }}>
                    {t.pinterest_col_status}
                  </th>
                  <th className="text-left px-4 py-3 font-medium" style={{ color: "#9ca3af" }}>
                    {t.pinterest_col_created}
                  </th>
                  <th className="text-left px-4 py-3 font-medium" style={{ color: "#9ca3af" }}>
                    {t.pinterest_col_actions}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((pin) => (
                  <tr
                    key={pin.id}
                    style={{ borderTop: "1px solid #1a1a1a" }}
                    className="hover:bg-[#161616] transition-colors"
                  >
                    {/* Thumbnail */}
                    <td className="px-4 py-3">
                      {pin.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={pin.image_url}
                          alt={pin.title ?? "pin"}
                          className="h-16 w-11 object-cover rounded-md"
                          style={{ border: "1px solid #333333" }}
                        />
                      ) : (
                        <div
                          className="h-16 w-11 rounded-md flex items-center justify-center"
                          style={{ backgroundColor: "#1a1a1a" }}
                        >
                          <Image className="h-5 w-5" style={{ color: "#6b7280" }} />
                        </div>
                      )}
                    </td>

                    {/* Title */}
                    <td className="px-4 py-3 max-w-xs">
                      <p className="truncate text-white">{pin.title ?? "—"}</p>
                      {pin.description && (
                        <p className="text-xs truncate mt-0.5" style={{ color: "#9ca3af" }}>
                          {pin.description}
                        </p>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CLASSES[pin.status]}`}
                      >
                        {statusLabel(pin.status)}
                      </span>
                    </td>

                    {/* Created */}
                    <td className="px-4 py-3 whitespace-nowrap" style={{ color: "#9ca3af" }}>
                      {formatDate(pin.created_at)}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {/* Publish button — only if not yet published */}
                        {pin.status !== "published" && pin.pin_id && (
                          <button
                            onClick={() => handlePublish(pin)}
                            disabled={publishingId === pin.id}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-white text-xs font-medium rounded-md disabled:opacity-50 transition-colors whitespace-nowrap"
                            style={{ backgroundColor: "#7c3aed" }}
                            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = "#6d28d9")}
                            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = "#7c3aed")}
                          >
                            {publishingId === pin.id ? (
                              <>
                                <Loader2 className="h-3 w-3 animate-spin" />
                                {t.pinterest_publishing}
                              </>
                            ) : (
                              <>
                                <Upload className="h-3 w-3" />
                                {t.pinterest_publish_btn}
                              </>
                            )}
                          </button>
                        )}

                        {/* Delete button */}
                        <button
                          onClick={() => handleDelete(pin)}
                          className="p-1.5 rounded-md transition-colors"
                          style={{ color: "#9ca3af" }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#2a1515";
                            (e.currentTarget as HTMLButtonElement).style.color = "#f87171";
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent";
                            (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af";
                          }}
                          title="Delete pin"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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

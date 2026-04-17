"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Loader2, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { useT } from "@/lib/i18n";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface MetaTokenStatus {
  connected: boolean;
  expires_at: string | null;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function isExpired(expires_at: string | null): boolean {
  if (!expires_at) return false;
  return new Date(expires_at) < new Date();
}

export function MetaTokenSection() {
  const t = useT();
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const justConnected = searchParams.get("meta_connected") === "true";

  const [status, setStatus] = useState<MetaTokenStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = (session as any)?.accessToken as string | undefined;
    if (!token) return;

    fetch(`${API_BASE}/api/v1/users/me/meta-token`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
      .then((res) => {
        if (!res.ok) throw new Error("fetch failed");
        return res.json();
      })
      .then((data: MetaTokenStatus) => setStatus(data))
      .catch(() => setError(t.settings_meta_error))
      .finally(() => setLoading(false));
  }, [session]);

  const rawToken = (session as any)?.accessToken as string | undefined;
  const connectUrl = `${API_BASE}/api/v1/auth/meta/start?mode=user${rawToken ? `&jwt=${encodeURIComponent(rawToken)}` : ""}`;

  const expired = status?.connected && isExpired(status.expires_at ?? null);
  const connected = status?.connected && !expired;

  return (
    <div
      className="rounded-lg p-6 space-y-4"
      style={{ backgroundColor: "#111111", border: "1px solid #222222" }}
    >
      {/* Section header */}
      <div>
        <h2 className="text-base font-semibold text-white">
          {t.settings_meta_section_title}
        </h2>
        <p className="text-sm mt-1" style={{ color: "#9ca3af" }}>
          {t.settings_meta_section_desc}
        </p>
      </div>

      {/* Success banner — only when just returned from OAuth */}
      {justConnected && (
        <div
          className="flex items-center gap-2 rounded-md px-4 py-3 text-sm font-medium"
          style={{
            backgroundColor: "rgba(21, 128, 61, 0.2)",
            border: "1px solid rgba(21, 128, 61, 0.5)",
            color: "#4ade80",
          }}
        >
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          {t.settings_meta_success}
        </div>
      )}

      {/* Status badge */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium" style={{ color: "#9ca3af" }}>
          Status:
        </span>

        {loading ? (
          <span className="flex items-center gap-2 text-sm" style={{ color: "#9ca3af" }}>
            <Loader2 className="h-4 w-4 animate-spin" />
          </span>
        ) : error ? (
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
            style={{ backgroundColor: "rgba(239, 68, 68, 0.15)", color: "#f87171" }}
          >
            <XCircle className="h-3.5 w-3.5" />
            {t.settings_meta_error}
          </span>
        ) : connected ? (
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
              style={{ backgroundColor: "rgba(21, 128, 61, 0.2)", color: "#4ade80" }}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t.settings_meta_status_connected}
            </span>
            {status?.expires_at && (
              <span className="text-xs" style={{ color: "#9ca3af" }}>
                {t.settings_meta_expires_at(formatDate(status.expires_at))}
              </span>
            )}
          </div>
        ) : expired ? (
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
            style={{ backgroundColor: "rgba(234, 179, 8, 0.15)", color: "#facc15" }}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            {t.settings_meta_status_expired}
          </span>
        ) : (
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
            style={{ backgroundColor: "#1f2937", color: "#9ca3af" }}
          >
            {t.settings_meta_status_not_connected}
          </span>
        )}
      </div>

      {/* Connect / Reconnect button */}
      {!loading && !error && (
        <div>
          <a
            href={connectUrl}
            className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium text-white transition-colors"
            style={{ backgroundColor: "#7c3aed" }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLAnchorElement).style.backgroundColor = "#6d28d9")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLAnchorElement).style.backgroundColor = "#7c3aed")
            }
          >
            {status?.connected
              ? t.settings_meta_reconnect_btn
              : t.settings_meta_connect_btn}
          </a>
        </div>
      )}
    </div>
  );
}

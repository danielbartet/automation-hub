"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Coins } from "lucide-react";
import { useT } from "@/lib/i18n";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

interface MetaUsageSummary {
  max_pct: number | null;
  recorded_at: string | null;
  status: "ok" | "warning" | "critical";
}

export function MetaUsageBadge() {
  const { data: session } = useSession();
  const t = useT();
  const role = (session as any)?.user?.role as string | undefined;
  const token = (session as any)?.accessToken as string | undefined;

  const [summary, setSummary] = useState<MetaUsageSummary | null>(null);

  const isAdmin = role === "admin" || role === "super_admin";

  useEffect(() => {
    if (!isAdmin || !token) return;

    const fetchUsage = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/ads/meta-usage-summary`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (res.ok) {
          const data = await res.json();
          setSummary(data);
        }
      } catch {
        // silently ignore fetch errors
      }
    };

    fetchUsage();
    const interval = setInterval(fetchUsage, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isAdmin, token]);

  if (!isAdmin) return null;

  const pct = summary?.max_pct;
  const colorClass =
    pct === null || pct === undefined
      ? "text-gray-500"
      : pct >= 75
      ? "text-red-500"
      : pct >= 60
      ? "text-yellow-500"
      : "text-green-600";

  const tooltipText =
    pct !== null && pct !== undefined
      ? t.meta_usage_tooltip(pct, summary?.status === "critical" ? 75 : summary?.status === "warning" ? 60 : 40)
      : "–";

  return (
    <div
      className={`flex items-center gap-1 text-xs font-medium ${colorClass}`}
      title={tooltipText}
      style={{ cursor: "default" }}
    >
      <Coins className="h-3.5 w-3.5" />
      <span>
        {pct !== null && pct !== undefined ? `${pct.toFixed(1)}%` : "–"}
      </span>
    </div>
  );
}

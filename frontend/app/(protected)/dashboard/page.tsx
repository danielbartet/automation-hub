"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { KPICard } from "@/components/dashboard/KPICard";
import { fetchDashboard, fetchProjects } from "@/lib/api";
import { Loader2, FileText } from "lucide-react";

interface Project {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
}

interface ContentPost {
  id: string;
  caption: string;
  status: string;
  image_url?: string;
  created_at: string;
  published_at?: string;
}

interface Campaign {
  name: string;
  status: string;
  spend_today?: number;
  spend_this_month?: number;
}

interface DashboardData {
  project?: { name: string; slug: string };
  content?: {
    total_posts?: number;
    posts_this_week?: number;
    posts_this_month?: number;
    pending_approvals?: number;
    recent_posts?: ContentPost[];
  };
  meta_ads?: {
    spend_today?: number;
    spend_this_month?: number;
    active_campaigns?: number;
    campaigns?: Campaign[];
  };
}

const STATUS_CLASSES: Record<string, string> = {
  pending_approval: "bg-yellow-100 text-yellow-700",
  published: "bg-green-100 text-green-700",
  draft: "bg-gray-100 text-gray-600",
};

const STATUS_LABELS: Record<string, string> = {
  pending_approval: "Pending",
  published: "Published",
  draft: "Draft",
};

const CAMPAIGN_STATUS_CLASSES: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-700",
  PAUSED: "bg-gray-100 text-gray-500",
};

function formatDate(dateStr: string) {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

export default function DashboardPage() {
  const searchParams = useSearchParams();
  const projectParam = searchParams.get("project");

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string>(projectParam ?? "");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProjects()
      .then((list: Project[]) => {
        const arr = Array.isArray(list) ? list : [];
        setProjects(arr);
        if (!selectedSlug && arr.length > 0) {
          setSelectedSlug(arr[0].slug);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoadingProjects(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadData = useCallback(() => {
    if (!selectedSlug) return;
    setLoadingData(true);
    setError(null);
    fetchDashboard(selectedSlug)
      .then((d) => setData(d))
      .catch((err) => setError(err.message))
      .finally(() => setLoadingData(false));
  }, [selectedSlug]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const recentPosts = data?.content?.recent_posts ?? [];
  const campaigns = data?.meta_ads?.campaigns ?? [];

  const projectName =
    data?.project?.name ??
    projects.find((p) => p.slug === selectedSlug)?.name ??
    selectedSlug;

  return (
    <div>
      <Header title={`Dashboard${projectName ? ` — ${projectName}` : ""}`} />
      <div className="p-6 space-y-6">
        {/* Project selector */}
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-gray-700">Project:</label>
          {loadingProjects ? (
            <span className="text-sm text-gray-400">Loading...</span>
          ) : (
            <select
              value={selectedSlug}
              onChange={(e) => setSelectedSlug(e.target.value)}
              className="text-sm border border-gray-200 rounded-md px-3 py-2 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.slug}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          {loadingData && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-700">
            Error: {error}
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
          <KPICard
            title="Total Posts"
            value={data?.content?.total_posts ?? 0}
            subtitle="All time"
          />
          <KPICard
            title="Posts This Week"
            value={data?.content?.posts_this_week ?? 0}
            subtitle="Last 7 days"
          />
          <KPICard
            title="Posts This Month"
            value={data?.content?.posts_this_month ?? 0}
            subtitle="Last 30 days"
          />
          <KPICard
            title="Pending Approvals"
            value={data?.content?.pending_approvals ?? 0}
            subtitle="Via Telegram"
          />
          <KPICard
            title="Ad Spend This Month"
            value={`$${(data?.meta_ads?.totals?.spend_this_month ?? data?.meta_ads?.spend_this_month ?? 0).toFixed(2)}`}
            subtitle="Meta Ads"
          />
          <KPICard
            title="Active Campaigns"
            value={data?.meta_ads?.totals?.active_campaigns ?? data?.meta_ads?.active_campaigns ?? 0}
            subtitle="Meta Ads"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Posts */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-900">Recent Posts</h3>
            </div>
            {loadingData ? (
              <div className="flex items-center justify-center h-40 text-sm text-gray-500">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Loading...
              </div>
            ) : recentPosts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2">
                <FileText className="h-8 w-8 text-gray-300" />
                <p className="text-sm text-gray-500">No recent posts.</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Caption</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {recentPosts.map((post) => (
                    <tr key={post.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 max-w-[180px] truncate text-gray-900">
                        {post.caption}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            STATUS_CLASSES[post.status] ?? "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {STATUS_LABELS[post.status] ?? post.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                        {formatDate(post.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Campaigns */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-900">Campaigns</h3>
            </div>
            {loadingData ? (
              <div className="flex items-center justify-center h-40 text-sm text-gray-500">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Loading...
              </div>
            ) : campaigns.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-sm text-gray-500">
                No campaigns found.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Campaign</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Today</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">This Month</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {campaigns.map((c, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-3 max-w-[160px] truncate font-medium text-gray-900">
                        {c.name}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            CAMPAIGN_STATUS_CLASSES[c.status] ?? "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {c.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {c.spend_today != null ? `$${c.spend_today.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {c.spend_this_month != null ? `$${c.spend_this_month.toFixed(2)}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

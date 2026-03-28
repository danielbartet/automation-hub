"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Header } from "@/components/layout/Header";
import { KPICard } from "@/components/dashboard/KPICard";
import { CreateCampaignModal } from "@/components/dashboard/CreateCampaignModal";
import { CampaignOptimizationPanel } from "@/components/dashboard/CampaignOptimizationPanel";
import { fetchProjects, fetchDashboard } from "@/lib/api";
import { Loader2, Plus } from "lucide-react";
import Link from "next/link";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface Project {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
}

interface CampaignKPIs {
  leads?: number;
  cpl?: number;
  purchases?: number;
  cpa?: number;
  roas?: number;
  clicks?: number;
  cpc?: number;
}

interface Campaign {
  id: number;
  name: string;
  objective?: string;
  status: string;
  daily_budget?: number;
  spend_today?: number;
  spend_this_month?: number;
  andromeda_status?: string;
  kpis?: CampaignKPIs;
  meta_campaign_id?: string;
}

interface MetaAdsTotals {
  spend_today?: number;
  spend_this_month?: number;
  active_campaigns?: number;
  leads?: number;
  cpl?: number;
  ctr?: number;
}

interface MetaAds {
  spend_today?: number;
  spend_this_month?: number;
  active_campaigns?: number;
  campaigns?: Campaign[];
  daily_spend?: { date: string; spend: number }[];
  totals?: MetaAdsTotals;
}

interface DashboardData {
  meta_ads?: MetaAds;
}

const CAMPAIGN_STATUS_CLASSES: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-700",
  active: "bg-green-100 text-green-700",
  PAUSED: "bg-gray-100 text-gray-500",
  paused: "bg-gray-100 text-gray-500",
  DELETED: "bg-red-100 text-red-700",
};

const ANDROMEDA_STATUS_CLASSES: Record<string, string> = {
  running: "bg-blue-100 text-blue-700",
  paused: "bg-yellow-100 text-yellow-700",
  stopped: "bg-gray-100 text-gray-500",
  error: "bg-red-100 text-red-700",
};

export default function AdsPage() {
  const { data: session } = useSession();
  const isClient = session?.user?.role === "client";
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);

  useEffect(() => {
    fetchProjects()
      .then((list: Project[]) => {
        const arr = Array.isArray(list) ? list : [];
        setProjects(arr);
        if (arr.length > 0) setSelectedSlug(arr[0].slug);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoadingProjects(false));
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

  const selectedProject = projects.find(p => p.slug === selectedSlug) ?? null;
  const metaAds = data?.meta_ads;
  const metaTotals = metaAds?.totals ?? metaAds;
  const campaigns = metaAds?.campaigns ?? [];
  const spendData = metaAds?.daily_spend ?? [];

  return (
    <div>
      <Header title="Ads" />
      <div className="p-6 space-y-6">
        {/* Project selector + Create Campaign button */}
        <div className="flex items-center gap-3 flex-wrap">
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
          {!isClient && (
            <div className="ml-auto">
              <button
                onClick={() => setShowCreateModal(true)}
                disabled={!selectedProject}
                className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />Create Campaign
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-700">
            Error: {error}
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KPICard
            title="Spend This Month"
            value={`$${((metaTotals as any)?.spend_this_month ?? 0).toFixed(2)}`}
            subtitle="Meta Ads"
          />
          <KPICard
            title="Spend Today"
            value={`$${((metaTotals as any)?.spend_today ?? 0).toFixed(2)}`}
            subtitle="Meta Ads"
          />
          <KPICard
            title="Active Campaigns"
            value={(metaTotals as any)?.active_campaigns ?? 0}
            subtitle="Meta Ads"
          />
        </div>

        {/* Spend chart */}
        {spendData.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-4">Ad Spend (30 days)</h3>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={spendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${v}`} />
                <Tooltip formatter={(v: number) => [`$${v.toFixed(2)}`, "Spend"]} />
                <Line
                  type="monotone"
                  dataKey="spend"
                  stroke="#111827"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Campaigns table */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h3 className="text-base font-semibold text-gray-900">Campaigns</h3>
          </div>
          {loadingData ? (
            <div className="flex items-center justify-center h-40 text-sm text-gray-500">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading campaigns...
            </div>
          ) : campaigns.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-sm text-gray-500">
              No campaigns found.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Objective</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Daily Budget</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Spend Today</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Spend / Month</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">KPIs</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Andromeda</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Detalle</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {campaigns.map((c, i) => (
                    <tr
                      key={c.id ?? i}
                      onClick={() => { if (!isClient) setSelectedCampaign(c); }}
                      className={`hover:bg-gray-50 transition-colors ${!isClient ? "cursor-pointer" : ""}`}
                    >
                      <td className="px-4 py-3 font-medium text-gray-900 max-w-[200px] truncate">
                        {c.name}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{c.objective ?? "—"}</td>
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
                        {c.daily_budget != null ? `$${c.daily_budget.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {c.spend_today != null ? `$${c.spend_today.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {c.spend_this_month != null ? `$${c.spend_this_month.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-xs">
                        {c.objective === "LEADS" || c.objective === "OUTCOME_LEADS" ? (
                          <span>
                            {c.kpis?.leads != null ? `${c.kpis.leads} leads` : "—"}
                            {c.kpis?.cpl != null ? ` · $${c.kpis.cpl.toFixed(2)} CPL` : ""}
                          </span>
                        ) : c.objective === "SALES" || c.objective === "OUTCOME_SALES" ? (
                          <span>
                            {c.kpis?.purchases != null ? `${c.kpis.purchases} sales` : "—"}
                            {c.kpis?.roas != null ? ` · ${c.kpis.roas.toFixed(2)}x ROAS` : ""}
                          </span>
                        ) : c.objective === "TRAFFIC" || c.objective === "OUTCOME_TRAFFIC" ? (
                          <span>
                            {c.kpis?.clicks != null ? `${c.kpis.clicks} clicks` : "—"}
                            {c.kpis?.cpc != null ? ` · $${c.kpis.cpc.toFixed(2)} CPC` : ""}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {c.andromeda_status ? (
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                              ANDROMEDA_STATUS_CLASSES[c.andromeda_status] ?? "bg-gray-100 text-gray-600"
                            }`}
                          >
                            {c.andromeda_status}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <Link
                          href={`/dashboard/ads/${c.id}?project_slug=${selectedSlug}`}
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                        >
                          Ver detalle →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {showCreateModal && selectedProject && (
        <CreateCampaignModal
          projectSlug={selectedProject.slug}
          projectId={selectedProject.id}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            loadData();
          }}
        />
      )}
      {selectedCampaign && (
        <CampaignOptimizationPanel
          campaign={selectedCampaign}
          onClose={() => setSelectedCampaign(null)}
          onStatusChanged={() => {
            setSelectedCampaign(null);
            loadData();
          }}
        />
      )}
    </div>
  );
}

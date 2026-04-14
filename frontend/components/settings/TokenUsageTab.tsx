"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  fetchTokenUsageSummary,
  fetchTokenUsageTrend,
  fetchTokenLimits,
  setTokenLimit,
} from "@/lib/api";

interface SummaryRow {
  user_id: string | null;
  user_name: string | null;
  project_id: number | null;
  project_name: string | null;
  tokens_input: number;
  tokens_output: number;
  tokens_total: number;
  cost_usd: number;
  operation_count: number;
  monthly_limit: number;
  percent_used: number | null;
}

interface SummaryResponse {
  period: string;
  rows: SummaryRow[];
  totals: {
    tokens_total: number;
    cost_usd: number;
    operation_count: number;
  };
}

interface TrendResponse {
  labels: string[];
  tokens: number[];
  cost_usd: number[];
}

interface LimitRow {
  user_id: string;
  user_name: string;
  user_email: string;
  monthly_token_limit: number;
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function formatCost(n: number): string {
  return `$${n.toFixed(4)}`;
}

function rowBgClass(pct: number | null): string {
  if (pct === null) return "";
  if (pct >= 100) return "border-l-2 border-red-500 bg-red-950/20";
  if (pct >= 80) return "border-l-2 border-amber-500 bg-amber-950/20";
  return "";
}

export function TokenUsageTab() {
  const { data: session } = useSession();
  const role = (session as any)?.user?.role as string | undefined;
  const token = (session as any)?.accessToken as string | undefined;

  const [period, setPeriod] = useState("month");
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [trend, setTrend] = useState<TrendResponse | null>(null);
  const [limits, setLimits] = useState<LimitRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [limitEdits, setLimitEdits] = useState<Record<string, string>>({});
  const [savingLimit, setSavingLimit] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [summaryData, trendData] = await Promise.all([
        fetchTokenUsageSummary(token, period),
        fetchTokenUsageTrend(token, period),
      ]);
      setSummary(summaryData);
      setTrend(trendData);

      if (role === "super_admin" && !limits) {
        const limitsData = await fetchTokenLimits(token);
        setLimits(limitsData);
        const edits: Record<string, string> = {};
        for (const l of limitsData) {
          edits[l.user_id] = String(l.monthly_token_limit);
        }
        setLimitEdits(edits);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load token usage data");
    } finally {
      setLoading(false);
    }
  }, [token, period, role]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleSaveLimit(userId: string) {
    if (!token) return;
    const val = parseInt(limitEdits[userId] || "0", 10);
    if (isNaN(val) || val < 0) return;
    setSavingLimit(userId);
    try {
      const updated = await setTokenLimit(token, userId, val);
      setLimits((prev) =>
        prev
          ? prev.map((l) =>
              l.user_id === userId ? { ...l, monthly_token_limit: updated.monthly_token_limit } : l
            )
          : prev
      );
    } catch {
      // silent
    } finally {
      setSavingLimit(null);
    }
  }

  const trendData =
    trend?.labels.map((label, i) => ({
      date: label,
      tokens: trend.tokens[i],
      cost: trend.cost_usd[i],
    })) ?? [];

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-400">Period:</span>
        {["week", "month", "year"].map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
              period === p
                ? "bg-purple-700 text-white"
                : "bg-[#1a1a1a] text-gray-400 hover:text-white"
            }`}
          >
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </button>
        ))}
        <button
          onClick={loadData}
          className="ml-auto px-3 py-1 rounded text-sm bg-[#1a1a1a] text-gray-400 hover:text-white transition-colors"
        >
          Refresh
        </button>
      </div>

      {loading && (
        <p className="text-sm text-gray-500">Loading token usage data...</p>
      )}

      {error && (
        <div className="rounded-md px-4 py-3 text-sm" style={{ backgroundColor: "rgba(239,68,68,0.15)", color: "#f87171" }}>
          {error}
        </div>
      )}

      {!loading && !error && summary && (
        <>
          {/* Totals */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Total tokens", value: formatNumber(summary.totals.tokens_total) },
              { label: "Total cost", value: formatCost(summary.totals.cost_usd) },
              { label: "Operations", value: formatNumber(summary.totals.operation_count) },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-lg p-4"
                style={{ backgroundColor: "#111111", border: "1px solid #222222" }}
              >
                <p className="text-xs text-gray-500 uppercase tracking-wide">{item.label}</p>
                <p className="text-2xl font-semibold text-white mt-1">{item.value}</p>
                <p className="text-xs text-gray-600 mt-0.5">{summary.period}</p>
              </div>
            ))}
          </div>

          {/* Summary table */}
          <div
            className="rounded-lg overflow-hidden"
            style={{ backgroundColor: "#111111", border: "1px solid #222222" }}
          >
            <div className="px-4 py-3 border-b border-[#222222]">
              <h3 className="text-sm font-medium text-white">Usage by User &amp; Project</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#222222]">
                    {["User", "Project", "Tokens In", "Tokens Out", "Cost (USD)", "Limit", "Used %"].map(
                      (h) => (
                        <th
                          key={h}
                          className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide"
                        >
                          {h}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {summary.rows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-gray-500 text-sm">
                        No token usage recorded for this period.
                      </td>
                    </tr>
                  ) : (
                    summary.rows.map((row, i) => (
                      <tr
                        key={i}
                        className={`border-b border-[#1a1a1a] ${rowBgClass(row.percent_used)}`}
                      >
                        <td className="px-4 py-2 text-gray-300">{row.user_name ?? "—"}</td>
                        <td className="px-4 py-2 text-gray-300">{row.project_name ?? "—"}</td>
                        <td className="px-4 py-2 text-gray-400">{formatNumber(row.tokens_input)}</td>
                        <td className="px-4 py-2 text-gray-400">{formatNumber(row.tokens_output)}</td>
                        <td className="px-4 py-2 text-gray-400">{formatCost(row.cost_usd)}</td>
                        <td className="px-4 py-2 text-gray-400">
                          {row.monthly_limit === 0 ? "Unlimited" : formatNumber(row.monthly_limit)}
                        </td>
                        <td className="px-4 py-2">
                          {row.percent_used !== null ? (
                            <span
                              className={`font-medium ${
                                row.percent_used >= 100
                                  ? "text-red-400"
                                  : row.percent_used >= 80
                                  ? "text-amber-400"
                                  : "text-gray-400"
                              }`}
                            >
                              {row.percent_used.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Trend chart */}
          {trendData.length > 0 && (
            <div
              className="rounded-lg p-4"
              style={{ backgroundColor: "#111111", border: "1px solid #222222" }}
            >
              <h3 className="text-sm font-medium text-white mb-4">Daily Token Usage</h3>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={trendData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#222222" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "#6b7280", fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: "#222222" }}
                  />
                  <YAxis
                    tick={{ fill: "#6b7280", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={50}
                    tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v)}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#1a1a1a",
                      border: "1px solid #333",
                      borderRadius: "6px",
                      fontSize: "12px",
                    }}
                    labelStyle={{ color: "#9ca3af" }}
                    itemStyle={{ color: "#c4b5fd" }}
                    formatter={(value: number, name: string) =>
                      name === "tokens"
                        ? [formatNumber(value), "Tokens"]
                        : [formatCost(value), "Cost"]
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="tokens"
                    stroke="#7c3aed"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Limit editor (super_admin only) */}
          {role === "super_admin" && limits && limits.length > 0 && (
            <div
              className="rounded-lg overflow-hidden"
              style={{ backgroundColor: "#111111", border: "1px solid #222222" }}
            >
              <div className="px-4 py-3 border-b border-[#222222]">
                <h3 className="text-sm font-medium text-white">Monthly Token Limits</h3>
                <p className="text-xs text-gray-500 mt-0.5">Set to 0 for unlimited. Press Enter or click away to save.</p>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#222222]">
                    {["User", "Email", "Monthly Limit"].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {limits.map((l) => (
                    <tr key={l.user_id} className="border-b border-[#1a1a1a]">
                      <td className="px-4 py-2 text-gray-300">{l.user_name}</td>
                      <td className="px-4 py-2 text-gray-500">{l.user_email}</td>
                      <td className="px-4 py-2">
                        <input
                          type="number"
                          min={0}
                          value={limitEdits[l.user_id] ?? String(l.monthly_token_limit)}
                          onChange={(e) =>
                            setLimitEdits((prev) => ({ ...prev, [l.user_id]: e.target.value }))
                          }
                          onBlur={() => handleSaveLimit(l.user_id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveLimit(l.user_id);
                          }}
                          disabled={savingLimit === l.user_id}
                          className="w-32 rounded px-2 py-1 text-sm bg-[#1a1a1a] border border-[#333] text-white focus:outline-none focus:border-purple-500 disabled:opacity-50"
                          placeholder="0 = unlimited"
                        />
                        {savingLimit === l.user_id && (
                          <span className="ml-2 text-xs text-gray-500">Saving...</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

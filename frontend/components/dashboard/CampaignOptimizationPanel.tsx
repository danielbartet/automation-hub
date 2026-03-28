"use client";
import { useEffect, useState } from "react";
import { X, Loader2, TrendingUp, TrendingDown, Minus, Zap, Play, Pause } from "lucide-react";
import { fetchCampaignLogs, optimizeCampaign, updateCampaignStatus } from "@/lib/api";

interface OptLog {
  id: number;
  checked_at: string;
  decision: "SCALE" | "MODIFY" | "PAUSE" | "KEEP";
  rationale: string;
  action_taken: string;
  old_budget?: number;
  new_budget?: number;
  metrics_snapshot?: string;
}

interface Campaign {
  id: number;
  name: string;
  status: string;
  objective?: string;
  daily_budget?: number;
  meta_campaign_id?: string;
}

interface CampaignOptimizationPanelProps {
  campaign: Campaign;
  onClose: () => void;
  onStatusChanged: () => void;
}

const DECISION_STYLES: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  SCALE: { color: "text-green-700 bg-green-50 border-green-200", icon: <TrendingUp className="h-4 w-4" />, label: "Scale" },
  MODIFY: { color: "text-orange-700 bg-orange-50 border-orange-200", icon: <Minus className="h-4 w-4" />, label: "Modify" },
  PAUSE: { color: "text-red-700 bg-red-50 border-red-200", icon: <TrendingDown className="h-4 w-4" />, label: "Pause" },
  KEEP: { color: "text-gray-700 bg-gray-50 border-gray-200", icon: <Minus className="h-4 w-4" />, label: "Keep" },
};

interface OptimizeResult {
  decision: string;
  rationale: string;
  recommendations: string[];
}

export function CampaignOptimizationPanel({ campaign, onClose, onStatusChanged }: CampaignOptimizationPanelProps) {
  const [logs, setLogs] = useState<OptLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [optimizing, setOptimizing] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latestResult, setLatestResult] = useState<OptimizeResult | null>(null);

  useEffect(() => {
    fetchCampaignLogs(campaign.id)
      .then(setLogs)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [campaign.id]);

  const handleOptimize = async () => {
    setOptimizing(true); setError(null); setLatestResult(null);
    try {
      const result = await optimizeCampaign(campaign.id);
      setLatestResult(result);
      // Reload logs
      const newLogs = await fetchCampaignLogs(campaign.id);
      setLogs(newLogs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Optimization failed");
    } finally {
      setOptimizing(false);
    }
  };

  const handleToggleStatus = async () => {
    setToggling(true); setError(null);
    try {
      const newStatus = campaign.status === "active" ? "paused" : "active";
      await updateCampaignStatus(campaign.id, newStatus);
      onStatusChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update status");
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-lg sm:rounded-xl shadow-xl max-h-[80vh] flex flex-col">
        <div className="flex items-start justify-between p-5 border-b">
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold truncate">{campaign.name}</h3>
            <div className="flex items-center gap-2 mt-1">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${campaign.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                {campaign.status}
              </span>
              {campaign.objective && <span className="text-xs text-gray-400">{campaign.objective.replace("OUTCOME_", "")}</span>}
              {campaign.daily_budget && <span className="text-xs text-gray-400">${campaign.daily_budget}/day</span>}
            </div>
          </div>
          <button onClick={onClose} className="ml-3 p-1 hover:bg-gray-100 rounded-md flex-shrink-0"><X className="h-5 w-5" /></button>
        </div>

        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">{error}</div>}

          {/* Actions */}
          <div className="flex gap-2">
            <button onClick={handleToggleStatus} disabled={toggling}
              className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border transition-colors disabled:opacity-50 ${
                campaign.status === "active"
                  ? "border-red-200 text-red-600 hover:bg-red-50"
                  : "border-green-200 text-green-600 hover:bg-green-50"
              }`}>
              {toggling ? <Loader2 className="h-4 w-4 animate-spin" /> : campaign.status === "active" ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {campaign.status === "active" ? "Pause Campaign" : "Activate Campaign"}
            </button>
            <button onClick={handleOptimize} disabled={optimizing}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50">
              {optimizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              {optimizing ? "Analyzing..." : "Optimize Now"}
            </button>
          </div>

          {/* Latest optimization result */}
          {latestResult && (
            <div className={`p-4 rounded-xl border ${DECISION_STYLES[latestResult.decision]?.color || "border-gray-200 bg-gray-50"}`}>
              <div className="flex items-center gap-2 mb-2">
                {DECISION_STYLES[latestResult.decision]?.icon}
                <span className="font-semibold text-sm">Decision: {DECISION_STYLES[latestResult.decision]?.label || latestResult.decision}</span>
              </div>
              <p className="text-sm">{latestResult.rationale}</p>
              {latestResult.recommendations?.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {latestResult.recommendations.map((r, i) => (
                    <li key={i} className="text-xs flex gap-1"><span>→</span>{r}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Optimization history */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-3">Optimization History</h4>
            {loading ? (
              <div className="flex items-center justify-center py-8 text-gray-400 text-sm">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />Loading...
              </div>
            ) : logs.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-400">
                <Zap className="h-8 w-8 mx-auto mb-2 text-gray-200" />
                No optimization runs yet.<br />
                <span className="text-xs">Runs automatically every 3 days, or click &quot;Optimize Now&quot;</span>
              </div>
            ) : (
              <div className="space-y-3">
                {logs.map(log => {
                  const style = DECISION_STYLES[log.decision] || DECISION_STYLES.KEEP;
                  return (
                    <div key={log.id} className={`rounded-lg border p-3 ${style.color}`}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          {style.icon}
                          <span className="text-sm font-medium">{style.label}</span>
                        </div>
                        <span className="text-xs opacity-70">
                          {new Date(log.checked_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <p className="text-xs">{log.rationale}</p>
                      {log.new_budget && log.old_budget && log.new_budget !== log.old_budget && (
                        <p className="text-xs mt-1 font-medium">
                          Budget: ${log.old_budget} → ${log.new_budget}/day
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

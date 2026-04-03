"use client";
import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import {
  X, FileText, TrendingUp, PauseCircle, CheckCircle, XCircle,
  AlertTriangle, Bell, Check, Loader2, Copy, ChevronDown, ChevronUp,
} from "lucide-react";
import {
  fetchNotifications, markNotificationRead, markAllNotificationsRead,
  approveOptimizerAction, rejectOptimizerAction,
} from "@/lib/api";
import { CreativeUploadModal } from "@/components/dashboard/CreativeUploadModal";

interface CreativeBrief {
  fatigue_diagnosis?: string;
  current_angle?: string;
  current_persona?: string;
  replacement_angle?: string;
  replacement_persona?: string;
  replacement_awareness?: string;
  suggested_hook?: string;
  suggested_body?: string;
  visual_direction?: string;
  what_to_avoid?: string;
  urgency?: string;
  urgency_reason?: string;
}

interface FatigueMetrics {
  ctr_current?: number;
  ctr_7d_ago?: number;
  ctr_drop_pct?: number;
  frequency?: number;
  cost_per_result?: number;
  cpl_7d_ago?: number;
  days_running?: number;
}

interface ActionData {
  approval_token?: string;
  action?: string;
  current_budget?: number;
  new_budget?: number;
  approved?: boolean;
  // campaign_fatigued fields
  type?: string;
  campaign_id?: number;
  campaign_name?: string;
  ad_id?: string;
  ad_name?: string;
  metrics?: FatigueMetrics;
  creative_brief?: CreativeBrief;
}

interface NotifItem {
  id: string;
  type: string;
  title: string;
  message: string;
  action_url?: string;
  action_label?: string;
  action_data?: ActionData;
  is_read: boolean;
  created_at: string;
}

const TYPE_STYLES: Record<string, { border: string; icon: React.ReactNode }> = {
  content_pending:  { border: "border-l-yellow-400", icon: <FileText className="h-4 w-4 text-yellow-500" /> },
  optimizer_scale:  { border: "border-l-blue-400",   icon: <TrendingUp className="h-4 w-4 text-blue-500" /> },
  optimizer_pause:  { border: "border-l-orange-400", icon: <PauseCircle className="h-4 w-4 text-orange-500" /> },
  post_published:   { border: "border-l-green-400",  icon: <CheckCircle className="h-4 w-4 text-green-500" /> },
  post_failed:      { border: "border-l-red-400",    icon: <XCircle className="h-4 w-4 text-red-500" /> },
  campaign_fatigued:{ border: "border-l-orange-500", icon: <AlertTriangle className="h-4 w-4 text-orange-500" /> },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={handleCopy}
      className="flex-shrink-0 p-1 hover:bg-gray-600 rounded transition-colors"
      title="Copiar"
    >
      {copied ? (
        <span className="text-green-400 text-xs font-medium">Copiado ✓</span>
      ) : (
        <Copy className="h-3 w-3 text-gray-400 hover:text-white" />
      )}
    </button>
  );
}

interface FatigueBriefPanelProps {
  notif: NotifItem;
  onOpenUpload: (notif: NotifItem) => void;
}

function FatigueBriefPanel({ notif, onOpenUpload }: FatigueBriefPanelProps) {
  const brief = notif.action_data?.creative_brief;
  const metrics = notif.action_data?.metrics;
  if (!brief) return null;

  return (
    <div className="mt-3 space-y-3 text-xs">
      {/* Diagnóstico */}
      <div>
        <p className="text-gray-500 uppercase tracking-wider text-[10px] font-semibold mb-1">── Diagnóstico</p>
        <div className="bg-gray-800 rounded px-3 py-2">
          <p className="text-gray-300">{brief.fatigue_diagnosis}</p>
          {metrics && (
            <p className="text-gray-500 mt-1">
              CTR: <span className="text-white">{metrics.ctr_current?.toFixed(2)}%</span>
              {metrics.ctr_7d_ago ? <> ← era <span className="text-white">{metrics.ctr_7d_ago.toFixed(2)}%</span></> : null}
              {metrics.frequency != null && (
                <> &nbsp;|&nbsp; Frecuencia: <span className={metrics.frequency > 3.0 ? "text-orange-400" : "text-white"}>{metrics.frequency.toFixed(1)}</span></>
              )}
            </p>
          )}
        </div>
      </div>

      {/* Problema */}
      <div>
        <p className="text-gray-500 uppercase tracking-wider text-[10px] font-semibold mb-1">── Problema</p>
        <div className="space-y-1">
          {brief.current_angle && (
            <p className="text-gray-400">
              Ángulo actual:{" "}
              <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-700 text-gray-300 text-[10px] font-medium">
                {brief.current_angle}
              </span>
            </p>
          )}
          {brief.current_persona && (
            <p className="text-gray-400">Persona actual: <span className="text-gray-300">{brief.current_persona}</span></p>
          )}
        </div>
      </div>

      {/* Qué crear */}
      <div className="border-l-2 border-green-600 pl-3 space-y-2">
        <p className="text-gray-500 uppercase tracking-wider text-[10px] font-semibold">── Qué crear</p>
        {brief.replacement_angle && (
          <p className="text-gray-400">
            Ángulo nuevo:{" "}
            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-green-900 text-green-300 text-[10px] font-medium">
              {brief.replacement_angle}
            </span>
          </p>
        )}
        {brief.replacement_persona && (
          <p className="text-gray-400">Persona: <span className="text-gray-300">{brief.replacement_persona}</span></p>
        )}
        {brief.replacement_awareness && (
          <p className="text-gray-400">Etapa: <span className="text-gray-300">{brief.replacement_awareness}</span></p>
        )}

        {brief.suggested_hook && (
          <div>
            <p className="text-gray-500 mb-1">Hook sugerido:</p>
            <div className="flex items-start gap-2 bg-gray-800 rounded px-3 py-2">
              <p className="text-white flex-1 leading-snug">{brief.suggested_hook}</p>
              <CopyButton text={brief.suggested_hook} />
            </div>
          </div>
        )}

        {brief.suggested_body && (
          <div>
            <p className="text-gray-500 mb-1">Copy (125 chars):</p>
            <div className="flex items-start gap-2 bg-gray-800 rounded px-3 py-2">
              <p className="text-white flex-1 leading-snug">{brief.suggested_body}</p>
              <CopyButton text={brief.suggested_body} />
            </div>
          </div>
        )}

        {brief.visual_direction && (
          <p className="text-gray-400 italic">Visual: {brief.visual_direction}</p>
        )}
      </div>

      {/* Evitar */}
      {brief.what_to_avoid && (
        <div>
          <p className="text-gray-500 uppercase tracking-wider text-[10px] font-semibold mb-1">── Evitar</p>
          <div className="bg-orange-900/30 border border-orange-700/50 rounded px-3 py-2">
            <p className="text-orange-200">{brief.what_to_avoid}</p>
          </div>
        </div>
      )}

      {/* Urgencia */}
      {brief.urgency && (
        <div>
          <p className="text-gray-500 uppercase tracking-wider text-[10px] font-semibold mb-1">── Urgencia</p>
          <div className="flex items-start gap-2">
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold flex-shrink-0 ${
                brief.urgency === "high"
                  ? "bg-red-900 text-red-300"
                  : "bg-yellow-900 text-yellow-300"
              }`}
            >
              {brief.urgency === "high" ? "URGENTE" : "MODERADO"}
            </span>
            {brief.urgency_reason && (
              <p className="text-gray-400">{brief.urgency_reason}</p>
            )}
          </div>
        </div>
      )}

      {/* CTA */}
      <button
        onClick={() => onOpenUpload(notif)}
        className="w-full mt-2 py-2 bg-purple-700 hover:bg-purple-600 text-white text-xs font-semibold rounded-lg transition-colors"
      >
        Subir nuevo creativo →
      </button>
    </div>
  );
}

interface NotificationPanelProps {
  onClose: () => void;
}

export function NotificationPanel({ onClose }: NotificationPanelProps) {
  const { data: session } = useSession();
  const token = session?.accessToken || "";
  const [items, setItems] = useState<NotifItem[]>([]);
  const [filter, setFilter] = useState<"all" | "unread" | "pending">("all");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionResults, setActionResults] = useState<Record<string, { text: string; ok: boolean }>>({});
  const [expandedBriefs, setExpandedBriefs] = useState<Record<string, boolean>>({});
  const [expandedMessages, setExpandedMessages] = useState<Record<string, boolean>>({});
  const [uploadModalNotif, setUploadModalNotif] = useState<NotifItem | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    if (!token) return;
    try {
      const data = await fetchNotifications(token, 1, filter === "unread");
      setItems(data.items || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [token, filter]);

  // Close on outside click — but not if upload modal is open
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (uploadModalNotif) return;
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose, uploadModalNotif]);

  const handleMarkAllRead = async () => {
    if (!token) return;
    await markAllNotificationsRead(token);
    setItems(prev => prev.map(n => ({ ...n, is_read: true })));
  };

  const dismissAfterDelay = (id: string) => {
    setTimeout(() => {
      setItems(prev => prev.filter(n => n.id !== id));
      setActionResults(prev => { const next = { ...prev }; delete next[id]; return next; });
    }, 3500);
  };

  const handleApprove = async (notif: NotifItem) => {
    const approvalToken = notif.action_data?.approval_token;
    if (!approvalToken || !token) return;
    setActionLoading(notif.id);
    try {
      const result = await approveOptimizerAction(token, approvalToken);
      setActionResults(prev => ({ ...prev, [notif.id]: { text: result.result || "Acción ejecutada", ok: true } }));
      setItems(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n));
      dismissAfterDelay(notif.id);
    } catch (e) {
      setActionResults(prev => ({ ...prev, [notif.id]: { text: `Error: ${e instanceof Error ? e.message : "Falló la acción"}`, ok: false } }));
    } finally { setActionLoading(null); }
  };

  const handleReject = async (notif: NotifItem) => {
    const approvalToken = notif.action_data?.approval_token;
    if (!approvalToken || !token) return;
    setActionLoading(notif.id);
    try {
      await rejectOptimizerAction(token, approvalToken);
      setActionResults(prev => ({ ...prev, [notif.id]: { text: "Acción cancelada", ok: false } }));
      setItems(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n));
      dismissAfterDelay(notif.id);
    } catch { /* ignore */ }
    finally { setActionLoading(null); }
  };

  const handleNotifClick = async (notif: NotifItem) => {
    if (!notif.is_read && token) {
      await markNotificationRead(token, notif.id);
      setItems(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n));
    }
    if (notif.action_url) window.location.href = notif.action_url;
  };

  const isOptimizerAction = (notif: NotifItem) =>
    (notif.type === "optimizer_scale" || notif.type === "optimizer_pause") &&
    notif.action_data?.approval_token &&
    !notif.is_read &&
    !notif.action_data?.approved &&
    !actionResults[notif.id];

  const [toastMsg, setToastMsg] = useState<string | null>(null);
  useEffect(() => {
    const lastResult = Object.values(actionResults).at(-1);
    if (lastResult) {
      setToastMsg(lastResult.text);
      const t = setTimeout(() => setToastMsg(null), 3500);
      return () => clearTimeout(t);
    }
  }, [actionResults]);

  const isFatigueWithBrief = (notif: NotifItem) =>
    notif.type === "campaign_fatigued" && !!notif.action_data?.creative_brief;

  const toggleBrief = (id: string) => {
    setExpandedBriefs(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleMessage = (id: string) => {
    setExpandedMessages(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const filtered = items.filter(n => {
    if (filter === "unread") return !n.is_read;
    if (filter === "pending") return isOptimizerAction(n);
    return true;
  });


  return (
    <>
      <div
        ref={panelRef}
        className="fixed right-0 top-0 h-full w-full sm:w-[400px] shadow-2xl z-50 flex flex-col"
        style={{ backgroundColor: "#111111", borderLeft: "1px solid #222222" }}
      >
        {/* Toast banner */}
        {toastMsg && (
          <div className="flex items-center gap-2 px-4 py-3 bg-green-900/80 border-b border-green-700/60 text-green-300 text-sm font-medium animate-in slide-in-from-top-2 duration-200">
            <CheckCircle className="h-4 w-4 flex-shrink-0 text-green-400" />
            {toastMsg}
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between p-4" style={{ borderBottom: "1px solid #222222" }}>
          <h3 className="text-white font-semibold">Notificaciones</h3>
          <div className="flex items-center gap-2">
            <button onClick={handleMarkAllRead} className="text-xs transition-colors" style={{ color: "#9ca3af" }}
              onMouseEnter={e => (e.currentTarget.style.color = "#ffffff")}
              onMouseLeave={e => (e.currentTarget.style.color = "#9ca3af")}
            >
              Marcar todo
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded-md transition-colors"
              style={{ color: "#9ca3af" }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1a1a1a"; (e.currentTarget as HTMLButtonElement).style.color = "#ffffff"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex" style={{ borderBottom: "1px solid #222222" }}>
          {(["all", "unread", "pending"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className="flex-1 py-2 text-xs font-medium transition-colors"
              style={filter === f ? { color: "#ffffff", borderBottom: "2px solid #7c3aed" } : { color: "#9ca3af" }}
              onMouseEnter={e => { if (filter !== f) (e.currentTarget as HTMLButtonElement).style.color = "#ffffff"; }}
              onMouseLeave={e => { if (filter !== f) (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; }}
            >
              {f === "all" ? "Todas" : f === "unread" ? "No leídas" : "Pendientes"}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-500 text-sm">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />Cargando...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-600">
              <Bell className="h-10 w-10 mb-3" />
              <p className="text-sm">No hay notificaciones</p>
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: "#1a1a1a" }}>
              {filtered.map(notif => {
                const style = TYPE_STYLES[notif.type] || { border: "border-l-gray-500", icon: <Bell className="h-4 w-4 text-gray-400" /> };
                const isAction = isOptimizerAction(notif);
                const isFatigue = isFatigueWithBrief(notif);
                const result = actionResults[notif.id];
                const isLoading = actionLoading === notif.id;
                const briefExpanded = expandedBriefs[notif.id] ?? false;
                const msgExpanded = expandedMessages[notif.id] ?? false;
                const msgLong = notif.message && notif.message.length > 120;

                return (
                  <div
                    key={notif.id}
                    className={`border-l-4 ${result ? (result.ok ? "border-l-green-500" : style.border) : style.border} ${notif.is_read && !result ? "opacity-60" : ""} p-4 transition-colors`}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#161616")}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
                  >
                    <div className="flex gap-3">
                      <div className="flex-shrink-0 mt-0.5">{style.icon}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`text-sm font-medium leading-tight ${notif.is_read ? "text-gray-400" : "text-white"}`}>
                            {notif.title}
                          </p>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {!notif.is_read && <div className="w-1.5 h-1.5 bg-blue-400 rounded-full" />}
                            <span className="text-xs text-gray-600">{timeAgo(notif.created_at)}</span>
                          </div>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5 break-words">
                          {msgLong && !msgExpanded ? notif.message.slice(0, 120) + "…" : notif.message}
                        </p>
                        {msgLong && (
                          <button
                            onClick={() => toggleMessage(notif.id)}
                            className="mt-0.5 text-xs text-gray-600 hover:text-gray-400 transition-colors"
                          >
                            {msgExpanded ? "Ver menos ↑" : "Ver más ↓"}
                          </button>
                        )}

                        {/* Optimizer approve/reject buttons */}
                        {isAction && !result && (
                          <div className="flex gap-2 mt-2">
                            <button
                              onClick={() => handleApprove(notif)}
                              disabled={isLoading}
                              className="flex items-center gap-1 px-2.5 py-1 bg-green-600 hover:bg-green-500 text-white text-xs font-medium rounded-md disabled:opacity-50 transition-colors"
                            >
                              {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                              Confirmar
                            </button>
                            <button
                              onClick={() => handleReject(notif)}
                              disabled={isLoading}
                              className="flex items-center gap-1 px-2.5 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs font-medium rounded-md disabled:opacity-50 transition-colors"
                            >
                              <X className="h-3 w-3" />
                              Cancelar
                            </button>
                          </div>
                        )}

                        {/* Campaign detail link for optimizer/fatigue notifications */}
                        {(notif.type === "optimizer_scale" || notif.type === "optimizer_pause" || notif.type === "optimizer_modify" || notif.type === "campaign_fatigued") && (
                          <a
                            href={
                              notif.action_data?.campaign_id
                                ? `/dashboard/ads/${notif.action_data.campaign_id}`
                                : notif.action_url
                            }
                            className="mt-2 block text-sm text-blue-400 hover:text-blue-300 hover:underline transition-colors"
                          >
                            Ver campaña completa →
                          </a>
                        )}

                        {/* Fatigue brief toggle */}
                        {isFatigue && !result && (
                          <>
                            <button
                              onClick={() => toggleBrief(notif.id)}
                              className="mt-2 flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300 transition-colors"
                            >
                              {briefExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                              {briefExpanded ? "Ocultar brief" : "Ver brief →"}
                            </button>

                            {briefExpanded && (
                              <FatigueBriefPanel
                                notif={notif}
                                onOpenUpload={(n) => setUploadModalNotif(n)}
                              />
                            )}
                          </>
                        )}

                        {/* Result after action */}
                        {result && (
                          <div className={`mt-2 flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium ${result.ok ? "bg-green-900/50 border border-green-700/60 text-green-300" : "bg-gray-800 border border-gray-700 text-gray-400"}`}>
                            {result.ok
                              ? <CheckCircle className="h-3.5 w-3.5 flex-shrink-0 text-green-400" />
                              : <XCircle className="h-3.5 w-3.5 flex-shrink-0 text-gray-500" />
                            }
                            {result.text}
                          </div>
                        )}

                        {/* Regular action button (non-fatigue, non-optimizer-action) */}
                        {notif.action_label && !isAction && !isFatigue && !result && (
                          <button
                            onClick={() => {
                              if (notif.type === "post_failed") {
                                toggleMessage(notif.id);
                                if (!notif.is_read && token) {
                                  markNotificationRead(token, notif.id).catch(() => {});
                                  setItems(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n));
                                }
                              } else {
                                handleNotifClick(notif);
                              }
                            }}
                            className="mt-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                          >
                            {notif.type === "post_failed"
                              ? (msgExpanded ? "Ocultar detalle ↑" : "Ver detalle →")
                              : `${notif.action_label} →`}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Creative upload modal */}
      {uploadModalNotif && uploadModalNotif.action_data?.creative_brief && (
        <CreativeUploadModal
          open={true}
          onClose={() => setUploadModalNotif(null)}
          notification={{
            id: uploadModalNotif.id,
            action_data: {
              campaign_id: uploadModalNotif.action_data.campaign_id ?? 0,
              campaign_name: uploadModalNotif.action_data.campaign_name ?? "",
              ad_id: uploadModalNotif.action_data.ad_id ?? "",
              ad_name: uploadModalNotif.action_data.ad_name ?? "",
              approval_token: uploadModalNotif.action_data.approval_token ?? "",
              creative_brief: {
                suggested_hook: uploadModalNotif.action_data.creative_brief?.suggested_hook ?? "",
                suggested_body: uploadModalNotif.action_data.creative_brief?.suggested_body ?? "",
                fatigue_diagnosis: uploadModalNotif.action_data.creative_brief?.fatigue_diagnosis ?? "",
                replacement_angle: uploadModalNotif.action_data.creative_brief?.replacement_angle ?? "",
                visual_direction: uploadModalNotif.action_data.creative_brief?.visual_direction ?? "",
              },
            },
          }}
          onSuccess={() => {
            setItems(prev => prev.map(n =>
              n.id === uploadModalNotif.id ? { ...n, is_read: true } : n
            ));
            load();
          }}
        />
      )}
    </>
  );
}

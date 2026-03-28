"use client";
import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import {
  X, FileText, TrendingUp, PauseCircle, CheckCircle, XCircle,
  AlertTriangle, Bell, Check, Loader2
} from "lucide-react";
import {
  fetchNotifications, markNotificationRead, markAllNotificationsRead,
  approveOptimizerAction, rejectOptimizerAction,
} from "@/lib/api";

interface ActionData {
  approval_token?: string;
  action?: string;
  current_budget?: number;
  new_budget?: number;
  approved?: boolean;
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
  campaign_fatigued:{ border: "border-l-orange-400", icon: <AlertTriangle className="h-4 w-4 text-orange-500" /> },
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
  const [actionResults, setActionResults] = useState<Record<string, string>>({});
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

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const handleMarkAllRead = async () => {
    if (!token) return;
    await markAllNotificationsRead(token);
    setItems(prev => prev.map(n => ({ ...n, is_read: true })));
  };

  const handleApprove = async (notif: NotifItem) => {
    const approvalToken = notif.action_data?.approval_token;
    if (!approvalToken || !token) return;
    setActionLoading(notif.id);
    try {
      const result = await approveOptimizerAction(token, approvalToken);
      setActionResults(prev => ({ ...prev, [notif.id]: result.result || "Action executed" }));
      setItems(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n));
    } catch (e) {
      setActionResults(prev => ({ ...prev, [notif.id]: `Error: ${e instanceof Error ? e.message : "Failed"}` }));
    } finally { setActionLoading(null); }
  };

  const handleReject = async (notif: NotifItem) => {
    const approvalToken = notif.action_data?.approval_token;
    if (!approvalToken || !token) return;
    setActionLoading(notif.id);
    try {
      await rejectOptimizerAction(token, approvalToken);
      setActionResults(prev => ({ ...prev, [notif.id]: "Action cancelled" }));
      setItems(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n));
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

  const filtered = items.filter(n => {
    if (filter === "unread") return !n.is_read;
    if (filter === "pending") return isOptimizerAction(n);
    return true;
  });

  return (
    <div
      ref={panelRef}
      className="fixed right-0 top-0 h-full w-full sm:w-[380px] bg-gray-900 border-l border-gray-700 shadow-2xl z-50 flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <h3 className="text-white font-semibold">Notificaciones</h3>
        <div className="flex items-center gap-2">
          <button onClick={handleMarkAllRead} className="text-xs text-gray-400 hover:text-white transition-colors">
            Marcar todo
          </button>
          <button onClick={onClose} className="p-1 hover:bg-gray-700 rounded-md">
            <X className="h-4 w-4 text-gray-400" />
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex border-b border-gray-700">
        {(["all", "unread", "pending"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${filter === f ? "text-white border-b-2 border-white" : "text-gray-500 hover:text-gray-300"}`}>
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
          <div className="divide-y divide-gray-800">
            {filtered.map(notif => {
              const style = TYPE_STYLES[notif.type] || { border: "border-l-gray-500", icon: <Bell className="h-4 w-4 text-gray-400" /> };
              const isAction = isOptimizerAction(notif);
              const resultText = actionResults[notif.id];
              const isLoading = actionLoading === notif.id;

              return (
                <div
                  key={notif.id}
                  className={`border-l-4 ${style.border} ${notif.is_read ? "opacity-60" : ""} p-4 hover:bg-gray-800/50 transition-colors`}
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
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{notif.message}</p>

                      {/* Optimizer approve/reject buttons */}
                      {isAction && !resultText && (
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

                      {/* Result after action */}
                      {resultText && (
                        <p className="mt-1.5 text-xs text-gray-400 italic">{resultText}</p>
                      )}

                      {/* Regular action button */}
                      {notif.action_label && !isAction && !resultText && (
                        <button
                          onClick={() => handleNotifClick(notif)}
                          className="mt-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                        >
                          {notif.action_label} →
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
  );
}

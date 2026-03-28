"use client";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Bell } from "lucide-react";
import { fetchUnreadCount } from "@/lib/api";
import { NotificationPanel } from "@/components/notifications/NotificationPanel";

export function NotificationBell() {
  const { data: session } = useSession();
  const token = session?.accessToken || "";
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  const poll = useCallback(async () => {
    if (!token) return;
    try {
      const data = await fetchUnreadCount(token);
      setUnread(data.unread || 0);
    } catch { /* ignore */ }
  }, [token]);

  useEffect(() => {
    poll();
    const interval = setInterval(poll, 30000);
    return () => clearInterval(interval);
  }, [poll]);

  return (
    <>
      <button
        onClick={() => setOpen(prev => !prev)}
        className="relative p-2 hover:bg-gray-100 rounded-md transition-colors"
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5 text-gray-600" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white leading-none">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && <NotificationPanel onClose={() => { setOpen(false); poll(); }} />}
    </>
  );
}

"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { LayoutDashboard, FileText, Megaphone, FolderKanban, CalendarDays, UsersRound, Activity, Users2 } from "lucide-react";
import { getHealthSummary } from "@/lib/api";
import { useT } from "@/lib/i18n";

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const role = session?.user?.role || "";
  const isClient = role === "client";
  const [criticalTokenCount, setCriticalTokenCount] = useState(0);
  const t = useT();

  const navItems = [
    { href: "/dashboard", label: t.nav_overview, icon: LayoutDashboard },
    { href: "/dashboard/projects", label: t.nav_projects, icon: FolderKanban },
    { href: "/dashboard/content", label: t.nav_content, icon: FileText },
    { href: "/dashboard/calendar", label: t.nav_calendar, icon: CalendarDays },
    { href: "/dashboard/ads", label: t.nav_ads, icon: Megaphone },
    { href: "/dashboard/ads/audiences", label: t.nav_audiences, icon: Users2 },
    { href: "/dashboard/health", label: t.nav_health, icon: Activity },
  ];

  const token = session?.accessToken as string | undefined;

  // Items hidden from clients
  const clientHiddenPaths = ["/dashboard/calendar", "/dashboard/health"];

  // Poll health summary every 5 minutes to show alert badge
  useEffect(() => {
    if (!token || isClient) return;

    const fetchBadge = async () => {
      try {
        const data = await getHealthSummary(token);
        const critical = data.filter(
          (h) =>
            h.token &&
            (h.token.days_remaining === null
              ? false
              : h.token.days_remaining < 30 || !h.token.is_valid)
        ).length;
        setCriticalTokenCount(critical);
      } catch {
        // silently ignore badge fetch errors
      }
    };

    fetchBadge();
    const id = setInterval(fetchBadge, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [token, isClient]);

  return (
    <aside className="w-64 min-h-screen flex flex-col" style={{ backgroundColor: "#050505" }}>
      <div className="p-6" style={{ borderBottom: "1px solid #1a1a1a" }}>
        <h1 className="text-xl font-bold text-white">Automation Hub</h1>
        <p className="text-xs mt-1" style={{ color: "#9ca3af" }}>Quantoria Labs</p>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => {
          if (isClient && clientHiddenPaths.includes(href)) return null;
          const isActive =
            pathname === href ||
            (pathname.startsWith(href + "/") &&
              href !== "/dashboard" &&
              !(href === "/dashboard/ads" && pathname.startsWith("/dashboard/ads/audiences")));
          const showBadge = href === "/dashboard/health" && criticalTokenCount > 0;
          return (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors"
              style={
                isActive
                  ? {
                      backgroundColor: "rgba(124, 58, 237, 0.1)",
                      borderLeft: "2px solid #7c3aed",
                      color: "#ffffff",
                      paddingLeft: "10px",
                    }
                  : {
                      color: "#9ca3af",
                    }
              }
              onMouseEnter={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLAnchorElement).style.color = "#e5e7eb";
                  (e.currentTarget as HTMLAnchorElement).style.backgroundColor = "#111111";
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLAnchorElement).style.color = "#9ca3af";
                  (e.currentTarget as HTMLAnchorElement).style.backgroundColor = "transparent";
                }
              }}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              <span className="flex-1">{label}</span>
              {showBadge && (
                <span
                  className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-xs font-bold px-1"
                  style={{ backgroundColor: "#ef4444", color: "#ffffff" }}
                >
                  {criticalTokenCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Settings section — admin and super_admin */}
      {(role === "admin" || role === "super_admin") && (
        <div className="p-4" style={{ borderTop: "1px solid #1a1a1a" }}>
          <p className="text-xs uppercase tracking-wider mb-2 px-3" style={{ color: "#6b7280" }}>{t.nav_settings_label}</p>
          <Link
            href="/dashboard/settings/users"
            className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors"
            style={
              pathname.startsWith("/dashboard/settings")
                ? {
                    backgroundColor: "rgba(124, 58, 237, 0.1)",
                    borderLeft: "2px solid #7c3aed",
                    color: "#ffffff",
                    paddingLeft: "10px",
                  }
                : { color: "#9ca3af" }
            }
          >
            <UsersRound className="h-4 w-4" />{t.nav_settings_users}
          </Link>
        </div>
      )}
    </aside>
  );
}

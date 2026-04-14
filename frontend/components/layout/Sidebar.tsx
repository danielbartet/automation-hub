"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { LayoutDashboard, FileText, Megaphone, FolderKanban, CalendarDays, UsersRound, Activity, Users2, Settings, ChevronDown, ChevronRight, ClipboardCheck, Link2, Layers } from "lucide-react";
import { getHealthSummary } from "@/lib/api";
import { useT } from "@/lib/i18n";

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const role = session?.user?.role || "";
  const isClient = role === "client";
  const [criticalTokenCount, setCriticalTokenCount] = useState(0);
  const t = useT();

  // Auto-expand Orgánico group when on content or calendar paths
  const isOnOrganicoPath =
    pathname.startsWith("/dashboard/content") ||
    pathname.startsWith("/dashboard/calendar");
  const [organicoOpen, setOrganicoOpen] = useState(isOnOrganicoPath);

  // Auto-expand Ads group when on any /ads/* path
  const isOnAdsPath = pathname.startsWith("/dashboard/ads");
  const [adsOpen, setAdsOpen] = useState(isOnAdsPath);

  // Auto-expand Settings group when on settings or projects paths
  const isOnSettingsPath =
    pathname.startsWith("/dashboard/settings") ||
    pathname.startsWith("/dashboard/projects");
  const [settingsOpen, setSettingsOpen] = useState(isOnSettingsPath);

  // Keep organicoOpen in sync when navigating to/from organic paths
  useEffect(() => {
    if (isOnOrganicoPath) setOrganicoOpen(true);
  }, [isOnOrganicoPath]);

  // Keep adsOpen in sync when navigating to/from ads paths
  useEffect(() => {
    if (isOnAdsPath) setAdsOpen(true);
  }, [isOnAdsPath]);

  // Keep settingsOpen in sync when navigating to/from settings/projects paths
  useEffect(() => {
    if (isOnSettingsPath) setSettingsOpen(true);
  }, [isOnSettingsPath]);

  const topNavItems = [
    { href: "/dashboard", label: t.nav_overview, icon: LayoutDashboard },
  ];

  const organicoChildren = [
    { href: "/dashboard/content", label: t.nav_content, icon: FileText },
    { href: "/dashboard/calendar", label: t.nav_calendar, icon: CalendarDays },
  ];

  const adsChildren = [
    { href: "/dashboard/ads", label: t.nav_campanias, icon: Megaphone, exact: true },
    { href: "/dashboard/ads/audiences", label: t.nav_audiences, icon: Users2, exact: false },
    { href: "/dashboard/ads/audit", label: t.nav_audit, icon: ClipboardCheck, exact: false },
  ];

  const settingsChildren = [
    { href: "/dashboard/settings/users", label: t.nav_settings_users, icon: UsersRound },
    { href: "/dashboard/projects", label: t.nav_projects, icon: FolderKanban },
    { href: "/dashboard/settings", label: t.nav_settings_meta, icon: Link2, exact: true },
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

  const activeLinkStyle = {
    backgroundColor: "rgba(124, 58, 237, 0.1)",
    borderLeft: "2px solid #7c3aed",
    color: "#ffffff",
    paddingLeft: "10px",
  };

  const inactiveLinkStyle = { color: "#9ca3af" };

  const handleHover = (e: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>, active: boolean) => {
    if (!active) {
      (e.currentTarget as HTMLElement).style.color = "#e5e7eb";
      (e.currentTarget as HTMLElement).style.backgroundColor = "#111111";
    }
  };

  const handleHoverLeave = (e: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>, active: boolean) => {
    if (!active) {
      (e.currentTarget as HTMLElement).style.color = "#9ca3af";
      (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
    }
  };

  const renderNavLink = (href: string, label: string, Icon: React.ElementType, exact?: boolean) => {
    if (isClient && clientHiddenPaths.includes(href)) return null;
    const isActive = exact
      ? pathname === href
      : pathname === href || (pathname.startsWith(href + "/") && href !== "/dashboard");
    const showBadge = href === "/dashboard/health" && criticalTokenCount > 0;

    return (
      <Link
        key={href}
        href={href}
        className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors"
        style={isActive ? activeLinkStyle : inactiveLinkStyle}
        onMouseEnter={(e) => handleHover(e, isActive)}
        onMouseLeave={(e) => handleHoverLeave(e, isActive)}
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
  };

  return (
    <aside className="w-64 flex flex-col h-full" style={{ backgroundColor: "#050505" }}>
      {/* Logo / Header */}
      <div className="p-6 flex-shrink-0" style={{ borderBottom: "1px solid #1a1a1a" }}>
        <h1 className="text-xl font-bold text-white">Automation Hub</h1>
        <p className="text-xs mt-1" style={{ color: "#9ca3af" }}>Quantoria Labs</p>
      </div>

      {/* Main nav — scrollable */}
      <nav className="flex-1 overflow-y-auto p-4 space-y-1">
        {/* Top nav items */}
        {topNavItems.map(({ href, label, icon: Icon }) =>
          renderNavLink(href, label, Icon)
        )}

        {/* Orgánico collapsible group */}
        <div>
          <button
            onClick={() => setOrganicoOpen((prev) => !prev)}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors"
            style={isOnOrganicoPath ? { color: "#a78bfa" } : { color: "#9ca3af" }}
            onMouseEnter={(e) => handleHover(e, isOnOrganicoPath)}
            onMouseLeave={(e) => handleHoverLeave(e, isOnOrganicoPath)}
          >
            <Layers className="h-4 w-4 flex-shrink-0" />
            <span className="flex-1 text-left">{t.nav_organico}</span>
            {organicoOpen ? (
              <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" />
            )}
          </button>

          {organicoOpen && (
            <div className="mt-1 ml-3 pl-3 space-y-1" style={{ borderLeft: "1px solid #1e1e1e" }}>
              {organicoChildren.map(({ href, label, icon: Icon }) => {
                if (isClient && clientHiddenPaths.includes(href)) return null;
                const isActive = pathname === href || pathname.startsWith(href + "/");
                return (
                  <Link
                    key={href}
                    href={href}
                    className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors"
                    style={isActive ? activeLinkStyle : inactiveLinkStyle}
                    onMouseEnter={(e) => handleHover(e, isActive)}
                    onMouseLeave={(e) => handleHoverLeave(e, isActive)}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    <span className="flex-1">{label}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Ads collapsible group */}
        <div>
          <button
            onClick={() => setAdsOpen((prev) => !prev)}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors"
            style={isOnAdsPath ? { color: "#a78bfa" } : { color: "#9ca3af" }}
            onMouseEnter={(e) => handleHover(e, isOnAdsPath)}
            onMouseLeave={(e) => handleHoverLeave(e, isOnAdsPath)}
          >
            <Megaphone className="h-4 w-4 flex-shrink-0" />
            <span className="flex-1 text-left">{t.nav_ads}</span>
            {adsOpen ? (
              <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" />
            )}
          </button>

          {adsOpen && (
            <div className="mt-1 ml-3 pl-3 space-y-1" style={{ borderLeft: "1px solid #1e1e1e" }}>
              {adsChildren.map(({ href, label, icon: Icon, exact }) => {
                const isActive = exact ? pathname === href : pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors"
                    style={isActive ? activeLinkStyle : inactiveLinkStyle}
                    onMouseEnter={(e) => handleHover(e, isActive)}
                    onMouseLeave={(e) => handleHoverLeave(e, isActive)}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    <span className="flex-1">{label}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Health Monitor */}
        {!isClient && renderNavLink("/dashboard/health", t.nav_health, Activity)}
      </nav>

      {/* Settings — pinned to bottom, always visible */}
      <div className="flex-shrink-0 p-4" style={{ borderTop: "1px solid #1a1a1a" }}>
        {/* Settings collapsible — admin and super_admin only */}
        {(role === "admin" || role === "super_admin") ? (
          <div>
            <button
              onClick={() => setSettingsOpen((prev) => !prev)}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors"
              style={isOnSettingsPath ? { color: "#a78bfa" } : { color: "#9ca3af" }}
              onMouseEnter={(e) => handleHover(e, isOnSettingsPath)}
              onMouseLeave={(e) => handleHoverLeave(e, isOnSettingsPath)}
            >
              <Settings className="h-4 w-4 flex-shrink-0" />
              <span className="flex-1 text-left">{t.nav_settings_label}</span>
              {settingsOpen ? (
                <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" />
              )}
            </button>

            {settingsOpen && (
              <div className="mt-1 ml-3 pl-3 space-y-1" style={{ borderLeft: "1px solid #1e1e1e" }}>
                {settingsChildren.map(({ href, label, icon: Icon, exact }) => {
                  const isActive = exact
                    ? pathname === href
                    : pathname === href || pathname.startsWith(href + "/");
                  return (
                    <Link
                      key={href}
                      href={href}
                      className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors"
                      style={isActive ? activeLinkStyle : inactiveLinkStyle}
                      onMouseEnter={(e) => handleHover(e, isActive)}
                      onMouseLeave={(e) => handleHoverLeave(e, isActive)}
                    >
                      <Icon className="h-4 w-4 flex-shrink-0" />
                      <span className="flex-1">{label}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* Non-admin: show plain settings link if needed, or nothing */
          renderNavLink("/dashboard/settings", t.nav_settings_meta, Settings)
        )}
      </div>
    </aside>
  );
}

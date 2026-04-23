"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  FileText,
  Megaphone,
  FolderKanban,
  CalendarDays,
  UsersRound,
  Activity,
  Users2,
  Settings,
  ChevronDown,
  ChevronRight,
  Link2,
  Layers,
  Pin,
  LayoutGrid,
  Sparkles,
  Globe,
  Linkedin,
  Music,
  Facebook,
  BookOpen,
} from "lucide-react";
import { getHealthSummary } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useProject } from "@/lib/project-context";

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const role = session?.user?.role || "";
  const isClient = role === "client";
  const [criticalTokenCount, setCriticalTokenCount] = useState(0);
  const t = useT();

  // ── Path helpers ────────────────────────────────────────────────────────────
  const isOnMetaPath =
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/content") ||
    pathname.startsWith("/dashboard/calendar") ||
    pathname.startsWith("/dashboard/ads");

  const isOnOrganicoPath =
    pathname.startsWith("/dashboard/content") ||
    pathname.startsWith("/dashboard/calendar");

  const isOnAdsPath = pathname.startsWith("/dashboard/ads");

  const isOnGooglePath = pathname.startsWith("/dashboard/google");

  const isOnPinterestPath = pathname.startsWith("/dashboard/pinterest");

  const isOnSettingsPath =
    pathname.startsWith("/dashboard/settings") ||
    pathname.startsWith("/dashboard/projects");

  const isOnHealthPath =
    pathname.startsWith("/dashboard/health") ||
    pathname.startsWith("/dashboard/token-usage");

  // ── Collapsible open states ─────────────────────────────────────────────────
  const [metaOpen, setMetaOpen] = useState(isOnMetaPath);
  const [googleOpen, setGoogleOpen] = useState(isOnGooglePath);
  const [pinterestOpen, setPinterestOpen] = useState(isOnPinterestPath);
  const [settingsOpen, setSettingsOpen] = useState(isOnSettingsPath);
  const [healthOpen, setHealthOpen] = useState(isOnHealthPath);

  // Keep open states in sync when navigating
  useEffect(() => { if (isOnMetaPath) setMetaOpen(true); }, [isOnMetaPath]);
  useEffect(() => { if (isOnGooglePath) setGoogleOpen(true); }, [isOnGooglePath]);
  useEffect(() => { if (isOnPinterestPath) setPinterestOpen(true); }, [isOnPinterestPath]);
  useEffect(() => { if (isOnSettingsPath) setSettingsOpen(true); }, [isOnSettingsPath]);
  useEffect(() => { if (isOnHealthPath) setHealthOpen(true); }, [isOnHealthPath]);

  const { projects: ctxProjects, selectedSlug: ctxSelectedSlug, setSelectedSlug: ctxSetSelectedSlug, loading: ctxLoading } = useProject();

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

  // ── Styles ──────────────────────────────────────────────────────────────────
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

  // ── Render helpers ───────────────────────────────────────────────────────────

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

  /** Renders a sub-item inside an indented collapsible group */
  const renderSubLink = (href: string, label: string, Icon: React.ElementType, exact?: boolean) => {
    if (isClient && clientHiddenPaths.includes(href)) return null;
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
  };

  /** Renders a grayed-out "coming soon" nav item — still navigable */
  const renderGrayedLink = (href: string, label: string, Icon: React.ElementType) => {
    const isActive = pathname === href || pathname.startsWith(href + "/");
    return (
      <Link
        key={href}
        href={href}
        className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors opacity-50"
        style={isActive ? activeLinkStyle : inactiveLinkStyle}
        onMouseEnter={(e) => handleHover(e, isActive)}
        onMouseLeave={(e) => handleHoverLeave(e, isActive)}
      >
        <Icon className="h-4 w-4 flex-shrink-0" />
        <span className="flex-1">{label}</span>
      </Link>
    );
  };

  /** Renders a collapsible group header button */
  const renderGroupHeader = (
    label: string,
    Icon: React.ElementType,
    isOnPath: boolean,
    isOpen: boolean,
    onToggle: () => void,
    badge?: React.ReactNode
  ) => (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors"
      style={isOnPath ? { color: "#a78bfa" } : { color: "#9ca3af" }}
      onMouseEnter={(e) => handleHover(e, isOnPath)}
      onMouseLeave={(e) => handleHoverLeave(e, isOnPath)}
    >
      <Icon className="h-4 w-4 flex-shrink-0" />
      <span className="flex-1 text-left">{label}</span>
      {badge}
      {isOpen ? (
        <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" />
      ) : (
        <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" />
      )}
    </button>
  );

  return (
    <aside className="w-64 flex flex-col h-full" style={{ backgroundColor: "#050505" }}>
      {/* Logo / Header */}
      <div className="p-6 flex-shrink-0" style={{ borderBottom: "1px solid #1a1a1a" }}>
        <h1 className="text-xl font-bold text-white">Automation Hub</h1>
        <p className="text-xs mt-1" style={{ color: "#9ca3af" }}>Quantoria Labs</p>
      </div>

      {/* Project selector */}
      <div className="px-4 py-3 flex-shrink-0" style={{ borderBottom: "1px solid #1a1a1a" }}>
        {ctxLoading ? (
          <div className="h-8 rounded-md animate-pulse" style={{ backgroundColor: "#1a1a1a" }} />
        ) : ctxProjects.length > 1 ? (
          <select
            value={ctxSelectedSlug}
            onChange={(e) => ctxSetSelectedSlug(e.target.value)}
            className="w-full text-sm rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#7c3aed]"
            style={{
              backgroundColor: "#111111",
              border: "1px solid #2a2a2a",
              color: "#e5e7eb",
            }}
          >
            {ctxProjects.map((p) => (
              <option key={p.id} value={p.slug}>
                {p.name}
              </option>
            ))}
          </select>
        ) : ctxProjects.length === 1 ? (
          <p className="text-sm font-medium truncate" style={{ color: "#e5e7eb" }}>
            {ctxProjects[0].name}
          </p>
        ) : null}
      </div>

      {/* Main nav — scrollable */}
      <nav className="flex-1 overflow-y-auto p-4 space-y-1">
        {/* ── Meta collapsible group ────────────────────────────────────────── */}
        <div>
          {renderGroupHeader(
            t.nav_meta_group,
            Facebook,
            isOnMetaPath,
            metaOpen,
            () => setMetaOpen((prev) => !prev)
          )}

          {metaOpen && (
            <div className="mt-1 ml-3 pl-3 space-y-1" style={{ borderLeft: "1px solid #1e1e1e" }}>
              {renderSubLink("/dashboard", t.nav_overview, LayoutDashboard, true)}
              {/* Orgánico sub-group label */}
              <p className="px-3 pt-1 pb-0.5 text-xs font-semibold uppercase tracking-wider" style={{ color: "#4b5563" }}>
                {t.nav_organico}
              </p>
              {renderSubLink("/dashboard/content", t.nav_content, FileText)}
              {!isClient && renderSubLink("/dashboard/calendar", t.nav_calendar, CalendarDays)}

              {/* Ads sub-group label */}
              <p className="px-3 pt-2 pb-0.5 text-xs font-semibold uppercase tracking-wider" style={{ color: "#4b5563" }}>
                {t.nav_ads}
              </p>
              {renderSubLink("/dashboard/ads", t.nav_campanias, Megaphone, true)}
              {renderSubLink("/dashboard/ads/audiences", t.nav_audiences, Users2, false)}
              {!isClient && renderSubLink("/dashboard/ads/hooks", "Hooks", BookOpen, false)}
            </div>
          )}
        </div>

        {/* ── Google collapsible group ──────────────────────────────────────── */}
        <div>
          {renderGroupHeader(
            t.nav_google_group,
            Globe,
            isOnGooglePath,
            googleOpen,
            () => setGoogleOpen((prev) => !prev)
          )}

          {googleOpen && (
            <div className="mt-1 ml-3 pl-3 space-y-1" style={{ borderLeft: "1px solid #1e1e1e" }}>
              {renderSubLink("/dashboard/google/ga4", t.nav_google_ga4, Activity, true)}
              {renderSubLink("/dashboard/google/gsc", t.nav_google_gsc, Globe, true)}
              {renderSubLink("/dashboard/google/gtm", t.nav_google_gtm, Layers, true)}
              {renderSubLink("/dashboard/google/ads", t.nav_google_ads, Megaphone, true)}
            </div>
          )}
        </div>

        {/* ── LinkedIn (grayed out) ─────────────────────────────────────────── */}
        {renderGrayedLink("/dashboard/linkedin", t.nav_linkedin, Linkedin)}

        {/* ── TikTok (grayed out) ──────────────────────────────────────────── */}
        {renderGrayedLink("/dashboard/tiktok", t.nav_tiktok, Music)}

        {/* ── Pinterest collapsible group ───────────────────────────────────── */}
        <div>
          {renderGroupHeader(
            t.nav_pinterest,
            Pin,
            isOnPinterestPath,
            pinterestOpen,
            () => setPinterestOpen((prev) => !prev)
          )}

          {pinterestOpen && (
            <div className="mt-1 ml-3 pl-3 space-y-1" style={{ borderLeft: "1px solid #1e1e1e" }}>
              {renderSubLink("/dashboard/pinterest", t.nav_pinterest_pins, LayoutGrid, true)}
              {renderSubLink("/dashboard/pinterest/generate", t.nav_pinterest_generate, Sparkles, false)}
            </div>
          )}
        </div>

        {/* ── Health Monitor collapsible group ──────────────────────────────── */}
        {!isClient && (
          <div>
            {renderGroupHeader(
              t.nav_health,
              Activity,
              isOnHealthPath,
              healthOpen,
              () => setHealthOpen((prev) => !prev),
              criticalTokenCount > 0 ? (
                <span
                  className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-xs font-bold px-1"
                  style={{ backgroundColor: "#ef4444", color: "#ffffff" }}
                >
                  {criticalTokenCount}
                </span>
              ) : undefined
            )}

            {healthOpen && (
              <div className="mt-1 ml-3 pl-3 space-y-1" style={{ borderLeft: "1px solid #1e1e1e" }}>
                {(() => {
                  const metaHealthActive = pathname === "/dashboard/health" || pathname.startsWith("/dashboard/health/");
                  const showTokenUsage = role === "admin" || role === "super_admin";
                  const tokenUsageActive = pathname === "/dashboard/token-usage" || pathname.startsWith("/dashboard/token-usage/");
                  return (
                    <>
                      <Link
                        href="/dashboard/health"
                        className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors"
                        style={metaHealthActive ? activeLinkStyle : inactiveLinkStyle}
                        onMouseEnter={(e) => handleHover(e, metaHealthActive)}
                        onMouseLeave={(e) => handleHoverLeave(e, metaHealthActive)}
                      >
                        <Activity className="h-4 w-4 flex-shrink-0" />
                        <span className="flex-1">{t.nav_meta_health}</span>
                      </Link>
                      {showTokenUsage && (
                        <Link
                          href="/dashboard/token-usage"
                          className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors"
                          style={tokenUsageActive ? activeLinkStyle : inactiveLinkStyle}
                          onMouseEnter={(e) => handleHover(e, tokenUsageActive)}
                          onMouseLeave={(e) => handleHoverLeave(e, tokenUsageActive)}
                        >
                          <Layers className="h-4 w-4 flex-shrink-0" />
                          <span className="flex-1">{t.nav_token_usage}</span>
                        </Link>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        )}
      </nav>

      {/* Settings — pinned to bottom, always visible */}
      <div className="flex-shrink-0 p-4" style={{ borderTop: "1px solid #1a1a1a" }}>
        {/* Settings collapsible — admin and super_admin only */}
        {(role === "admin" || role === "super_admin") ? (
          <div>
            {renderGroupHeader(
              t.nav_settings_label,
              Settings,
              isOnSettingsPath,
              settingsOpen,
              () => setSettingsOpen((prev) => !prev)
            )}

            {settingsOpen && (
              <div className="mt-1 ml-3 pl-3 space-y-1" style={{ borderLeft: "1px solid #1e1e1e" }}>
                {[
                  { href: "/dashboard/settings/users", label: t.nav_settings_users, icon: UsersRound, exact: undefined },
                  { href: "/dashboard/projects", label: t.nav_projects, icon: FolderKanban, exact: undefined },
                  { href: "/dashboard/settings", label: t.nav_settings_meta, icon: Link2, exact: true },
                ].map(({ href, label, icon: Icon, exact }) => {
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
          /* Non-admin: show plain settings link */
          renderNavLink("/dashboard/settings", t.nav_settings_meta, Settings)
        )}
      </div>
    </aside>
  );
}

"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { LayoutDashboard, FileText, Megaphone, FolderKanban, CalendarDays, UsersRound } from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/projects", label: "Projects", icon: FolderKanban },
  { href: "/dashboard/content", label: "Content", icon: FileText },
  { href: "/dashboard/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/dashboard/ads", label: "Ads", icon: Megaphone },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const role = session?.user?.role || "";
  const isClient = role === "client";

  // Items hidden from clients
  const clientHiddenPaths = ["/dashboard/calendar"];

  return (
    <aside className="w-64 min-h-screen flex flex-col" style={{ backgroundColor: "#050505" }}>
      <div className="p-6" style={{ borderBottom: "1px solid #1a1a1a" }}>
        <h1 className="text-xl font-bold text-white">Automation Hub</h1>
        <p className="text-xs mt-1" style={{ color: "#9ca3af" }}>Quantoria Labs</p>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => {
          if (isClient && clientHiddenPaths.includes(href)) return null;
          const isActive = pathname === href;
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
              <Icon className="h-4 w-4" />{label}
            </Link>
          );
        })}
      </nav>

      {/* Settings section — admin only */}
      {role === "admin" && (
        <div className="p-4" style={{ borderTop: "1px solid #1a1a1a" }}>
          <p className="text-xs uppercase tracking-wider mb-2 px-3" style={{ color: "#6b7280" }}>Settings</p>
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
            <UsersRound className="h-4 w-4" />Users
          </Link>
        </div>
      )}
    </aside>
  );
}

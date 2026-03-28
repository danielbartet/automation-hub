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
    <aside className="w-64 min-h-screen bg-gray-900 text-white flex flex-col">
      <div className="p-6 border-b border-gray-700">
        <h1 className="text-xl font-bold">Automation Hub</h1>
        <p className="text-xs text-gray-400 mt-1">Quantoria Labs</p>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => {
          if (isClient && clientHiddenPaths.includes(href)) return null;
          const isActive = pathname === href;
          return (
            <Link key={href} href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${isActive ? "bg-gray-700 text-white" : "text-gray-300 hover:bg-gray-800 hover:text-white"}`}>
              <Icon className="h-4 w-4" />{label}
            </Link>
          );
        })}
      </nav>

      {/* Settings section — admin only */}
      {role === "admin" && (
        <div className="p-4 border-t border-gray-700">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-2 px-3">Settings</p>
          <Link href="/dashboard/settings/users"
            className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${pathname.startsWith("/dashboard/settings") ? "bg-gray-700 text-white" : "text-gray-300 hover:bg-gray-800 hover:text-white"}`}>
            <UsersRound className="h-4 w-4" />Users
          </Link>
        </div>
      )}
    </aside>
  );
}

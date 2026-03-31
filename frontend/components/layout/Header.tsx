"use client";
import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { NotificationBell } from "@/components/layout/NotificationBell";

interface HeaderProps {
  title: string;
}

export function Header({ title }: HeaderProps) {
  return (
    <header className="h-16 flex items-center justify-between px-6" style={{ borderBottom: "1px solid #222222", backgroundColor: "#0a0a0a" }}>
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <div className="flex items-center gap-2">
        <NotificationBell />
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex items-center gap-2 text-sm transition-colors ml-2"
          style={{ color: "#9ca3af" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#ffffff"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; }}
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </header>
  );
}

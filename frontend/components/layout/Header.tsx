"use client";
import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { useLang, useT } from "@/lib/i18n";

interface HeaderProps {
  title: string;
}

export function Header({ title }: HeaderProps) {
  const t = useT();
  const { lang, setLang } = useLang();

  return (
    <header className="h-16 flex items-center justify-between px-6" style={{ borderBottom: "1px solid #222222", backgroundColor: "#0a0a0a" }}>
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <div className="flex items-center gap-3">
        {/* Language toggle */}
        <div className="flex items-center rounded-md overflow-hidden" style={{ border: "1px solid #333333" }}>
          {(["es", "en"] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className="px-2.5 py-1 text-xs font-medium transition-colors"
              style={
                lang === l
                  ? { backgroundColor: "#7c3aed", color: "#ffffff" }
                  : { backgroundColor: "transparent", color: "#6b7280" }
              }
              onMouseEnter={(e) => {
                if (lang !== l) (e.currentTarget as HTMLButtonElement).style.color = "#e5e7eb";
              }}
              onMouseLeave={(e) => {
                if (lang !== l) (e.currentTarget as HTMLButtonElement).style.color = "#6b7280";
              }}
            >
              {t[`lang_${l}` as "lang_es" | "lang_en"]}
            </button>
          ))}
        </div>

        <NotificationBell />

        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex items-center gap-2 text-sm transition-colors"
          style={{ color: "#9ca3af" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#ffffff"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; }}
        >
          <LogOut className="h-4 w-4" />
          {t.header_sign_out}
        </button>
      </div>
    </header>
  );
}

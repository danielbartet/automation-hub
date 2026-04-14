"use client";

import { useSession } from "next-auth/react";
import { Header } from "@/components/layout/Header";
import { CampaignChatPanel } from "@/components/dashboard/CampaignChatPanel";
import { useEffect, useState } from "react";
import { fetchProjects } from "@/lib/api";
import { Lock, Sparkles } from "lucide-react";
import { useT } from "@/lib/i18n";
import { Loader2 } from "lucide-react";

interface Project {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
}

function UpgradeGate() {
  const t = useT();

  const bullets = [
    t.ads_chat_gate_bullet_1,
    t.ads_chat_gate_bullet_2,
    t.ads_chat_gate_bullet_3,
    t.ads_chat_gate_bullet_4,
  ];

  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4">
      <div
        className="w-full max-w-md rounded-2xl p-8 text-center space-y-6"
        style={{ backgroundColor: "#111111", border: "1px solid #222222" }}
      >
        {/* Icon */}
        <div className="flex justify-center">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center"
            style={{ backgroundColor: "#1a1a1a", border: "1px solid #333333" }}
          >
            <Lock className="h-6 w-6" style={{ color: "#7c3aed" }} />
          </div>
        </div>

        {/* Title + description */}
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-400" />
            <h2 className="text-xl font-bold text-white">{t.ads_chat_gate_title}</h2>
          </div>
          <p className="text-sm leading-relaxed" style={{ color: "#9ca3af" }}>
            {t.ads_chat_gate_description}
          </p>
        </div>

        {/* Preview questions */}
        <div className="space-y-2">
          {bullets.map((bullet, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-4 py-3 rounded-lg text-left opacity-50"
              style={{ backgroundColor: "#1a1a1a", border: "1px solid #2a2a2a" }}
            >
              <div
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: "#7c3aed" }}
              />
              <span className="text-sm" style={{ color: "#e5e7eb" }}>
                {bullet}
              </span>
            </div>
          ))}
        </div>

        {/* CTA */}
        <button
          onClick={() => {}}
          className="w-full py-3 px-6 rounded-lg text-sm font-semibold text-white transition-opacity"
          style={{ backgroundColor: "#7c3aed" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#6d28d9"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#7c3aed"; }}
        >
          {t.ads_chat_gate_cta}
        </button>
      </div>
    </div>
  );
}

export default function CampaignChatPage() {
  const { data: session, status } = useSession();
  const role = session?.user?.role ?? "";
  const isSuperAdmin = role === "super_admin";
  const token = (session as { accessToken?: string } | null)?.accessToken ?? "";

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const [loadingProjects, setLoadingProjects] = useState(true);

  useEffect(() => {
    if (!isSuperAdmin) return;
    fetchProjects(token)
      .then((list: Project[]) => {
        const arr = Array.isArray(list) ? list : [];
        setProjects(arr);
        if (arr.length > 0) setSelectedSlug(arr[0].slug);
      })
      .catch(() => {})
      .finally(() => setLoadingProjects(false));
  }, [isSuperAdmin, token]);

  if (status === "loading") {
    return (
      <div>
        <Header title="Campaign Chat" />
        <div className="flex items-center justify-center h-40">
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <Header title="Campaign Chat" />
      <div className="p-6">
        {isSuperAdmin ? (
          <div className="space-y-4 max-w-4xl">
            {/* Project selector */}
            {loadingProjects ? (
              <div className="flex items-center gap-2 text-sm" style={{ color: "#9ca3af" }}>
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading...
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium" style={{ color: "#9ca3af" }}>Project:</label>
                <select
                  value={selectedSlug}
                  onChange={(e) => setSelectedSlug(e.target.value)}
                  className="text-sm rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                  style={{ backgroundColor: "#1a1a1a", border: "1px solid #333333", color: "#ffffff" }}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.slug}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Chat panel */}
            {selectedSlug && <CampaignChatPanel projectSlug={selectedSlug} />}
          </div>
        ) : (
          <UpgradeGate />
        )}
      </div>
    </div>
  );
}

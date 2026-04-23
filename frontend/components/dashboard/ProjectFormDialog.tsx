"use client";
import { useState, useEffect } from "react";
import { X, Loader2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { updateProject, connectMetaOAuth, discoverMetaAssets } from "@/lib/api";
import { MetaAssetSelectModal } from "@/components/dashboard/MetaAssetSelectModal";
import { useT } from "@/lib/i18n";

interface Project {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  content_config?: Record<string, unknown>;
  media_config?: Record<string, unknown>;
  facebook_page_id?: string | null;
  instagram_account_id?: string | null;
  ad_account_id?: string | null;
  meta_token_expires_at?: string | null;
}

interface ProjectFormDialogProps {
  project: Project;
  onClose: () => void;
  onSuccess: (updated: Project) => void;
  isOperator?: boolean;
}

const PLATFORM_OPTIONS_STATIC = [
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  // { value: "tiktok", label: "TikTok" },
  // { value: "x_twitter", label: "X/Twitter" },
  // { value: "linkedin", label: "LinkedIn" },
];


function deriveColorPalette(primaryHex: string): string {
  const h = primaryHex.toLowerCase().replace("#", "");
  if (h.includes("7c") || h.includes("8b") || h.includes("6d") || h.includes("5e")) return "dark_purple";
  if (h.startsWith("2") || h.startsWith("3") || h.startsWith("16") || h.startsWith("22") || h.startsWith("0f9")) return "dark_green";
  if (h.includes("3b") || h.includes("60") || h.includes("29") || h.includes("1d")) return "dark_blue";
  if (h.includes("f9") || h.includes("ea") || h.includes("ef") || h.includes("dc")) return "dark_orange";
  return "dark";
}

function ColorPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium" style={{ color: "#9ca3af" }}>{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-9 h-9 rounded cursor-pointer p-0.5"
          style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            if (/^#[0-9a-fA-F]{0,6}$/.test(v)) onChange(v);
          }}
          className="w-24 rounded-lg px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
          style={{ backgroundColor: "#1a1a1a", border: "1px solid #333333", color: "#ffffff" }}
          placeholder="#000000"
          maxLength={7}
        />
      </div>
    </div>
  );
}

export function ProjectFormDialog({ project, onClose, onSuccess, isOperator = false }: ProjectFormDialogProps) {
  const t = useT();
  const { data: session } = useSession();
  const cc = project.content_config ?? {};
  const mc = project.media_config ?? {};

  // Operators see only Content / Audience / Brand tabs (no Platforms)
  const TABS = isOperator
    ? [
        t.form_dialog_tab_content,
        t.form_dialog_tab_audience,
        t.form_dialog_tab_brand,
      ]
    : [
        t.form_dialog_tab_platforms,
        t.form_dialog_tab_content,
        t.form_dialog_tab_audience,
        t.form_dialog_tab_brand,
      ];

  // Map visible tab index to the canonical tab index used in {tab === N} guards below
  // For admins: identity mapping. For operators: shift by +1 (skip Platforms=0)
  const canonicalTab = (visibleIdx: number) => (isOperator ? visibleIdx + 1 : visibleIdx);

  const VISUAL_STYLE_OPTIONS = [
    { value: "typographic", label: t.vs_typographic },
    { value: "photorealistic", label: t.vs_photorealistic },
    { value: "illustration", label: t.vs_illustration },
    { value: "minimal", label: t.vs_minimal },
    { value: "data_visual", label: t.vs_data_visual },
  ];

  const BUSINESS_OBJECTIVE_OPTIONS = [
    { value: "generate_leads", label: t.bo_generate_leads },
    { value: "sell_product", label: t.bo_sell_product },
    { value: "build_community", label: t.bo_build_community },
    { value: "brand_positioning", label: t.bo_brand_positioning },
  ];

  const POSTING_FREQUENCY_OPTIONS = [
    { value: "daily", label: t.pf_daily },
    { value: "3-4x_week", label: t.pf_3_4x_week },
    { value: "1-2x_week", label: t.pf_1_2x_week },
    { value: "on_demand", label: t.pf_on_demand },
  ];

  // Visible tab index (0-based within the tabs the current role can see)
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // UserMetaToken status (null = loading, true = connected, false = not connected)
  const [userHasMetaToken, setUserHasMetaToken] = useState<boolean | null>(null);

  useEffect(() => {
    const token = (session as any)?.accessToken as string | undefined;
    if (!token) return;
    fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/api/v1/users/me/meta-token`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => setUserHasMetaToken(data?.connected === true))
      .catch(() => setUserHasMetaToken(false));
  }, [session]);

  // Pinterest connection state (null = loading, true = connected, false = not connected)
  const [pinterestConnected, setPinterestConnected] = useState<boolean | null>(null);
  const [pinterestDisconnecting, setPinterestDisconnecting] = useState(false);

  useEffect(() => {
    const token = (session as any)?.accessToken as string | undefined;
    if (!token) return;
    fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/api/v1/pinterest/boards/${project.slug}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => setPinterestConnected(r.ok))
      .catch(() => setPinterestConnected(false));
  }, [session, project.slug]);

  const handlePinterestDisconnect = async () => {
    const token = (session as any)?.accessToken as string | undefined;
    if (!token) return;
    setPinterestDisconnecting(true);
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/api/v1/auth/pinterest/disconnect/${project.slug}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      setPinterestConnected(false);
    } catch {
      // silently ignore
    } finally {
      setPinterestDisconnecting(false);
    }
  };

  // Meta asset discovery state
  const [discoveringAssets, setDiscoveringAssets] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [metaSelectAssets, setMetaSelectAssets] = useState<{
    pages: Array<{ id: string; name: string }>;
    ad_accounts: Array<{ id: string; name: string }>;
    instagram_accounts: Array<{ id: string; username: string }>;
    facebook_page_id: string | null;
    instagram_account_id: string | null;
    ad_account_id: string | null;
  } | null>(null);

  // Tab 1 — Contenido
  const [tone, setTone] = useState((cc.tone as string) ?? "");
  const [coreMessage, setCoreMessage] = useState((cc.core_message as string) ?? "");
  const [additionalRules, setAdditionalRules] = useState(
    Array.isArray(cc.additional_rules) ? (cc.additional_rules as string[]).join("\n") : ""
  );

  // Tab 2 — Audiencia
  const [targetAudience, setTargetAudience] = useState((cc.target_audience as string) ?? "");
  const [contentCategories, setContentCategories] = useState(
    Array.isArray(cc.content_categories) ? (cc.content_categories as string[]).join("\n") : ""
  );

  // Tab 2 — Mercado y Ventas
  const [marketRegion, setMarketRegion] = useState((cc.market_region as string) ?? "Global");
  const [targetCountries, setTargetCountries] = useState(
    Array.isArray(cc.target_countries)
      ? (cc.target_countries as string[]).join(", ")
      : (cc.target_countries as string) ?? ""
  );
  const [postingTimezone, setPostingTimezone] = useState((cc.posting_timezone as string) ?? "UTC");
  const [priceRange, setPriceRange] = useState((cc.price_range as string) ?? "");
  const [socialProof, setSocialProof] = useState((cc.social_proof_examples as string) ?? "");
  const [offer, setOffer] = useState((cc.offer as string) ?? "");
  const [adLibraryCountries, setAdLibraryCountries] = useState(
    Array.isArray(cc.ad_library_countries)
      ? (cc.ad_library_countries as string[]).join(", ")
      : (cc.ad_library_countries as string) ?? ""
  );

  // Tab 3 — Plataformas (basic info)
  const [facebookPageId, setFacebookPageId] = useState((project as unknown as Record<string, string>).facebook_page_id ?? "");
  const [instagramAccountId, setInstagramAccountId] = useState((project as unknown as Record<string, string>).instagram_account_id ?? "");
  const [adAccountId, setAdAccountId] = useState(project.ad_account_id ?? "");

  // Tab 3 (Brand) — brand_voice
  const [brandVoice, setBrandVoice] = useState((cc.brand_voice as string) ?? "conversational");
  const [brandName, setBrandName] = useState((cc.brand_name as string) ?? "");

  // Tab 4 — Marca y Visual
  const [brandPrimaryColor, setBrandPrimaryColor] = useState((cc.brand_primary_color as string) ?? "#7c3aed");
  const [brandSecondaryColor, setBrandSecondaryColor] = useState((cc.brand_secondary_color as string) ?? "#00FF41");
  const [brandBgColor, setBrandBgColor] = useState((cc.brand_bg_color as string) ?? "#0a0a0a");
  const [visualStyle, setVisualStyle] = useState((cc.visual_style as string) ?? "typographic");
  const [imageMood, setImageMood] = useState((cc.image_mood as string) ?? "");
  const [brandFonts, setBrandFonts] = useState((cc.brand_fonts as string) ?? "");
  // Competitors — structured list with backward-compat parsing
  const parseCompetitorsFromConfig = (raw: unknown): Array<{ handle: string }> => {
    if (!raw) return [];
    if (Array.isArray(raw)) {
      return raw.map((item) => {
        if (typeof item === "object" && item !== null && "handle" in item) {
          return { handle: String((item as Record<string, unknown>).handle ?? "").replace(/^@/, "") };
        }
        return { handle: String(item).replace(/^@/, "").trim() };
      }).filter((c) => c.handle);
    }
    return String(raw)
      .replace(/\n/g, ",")
      .split(",")
      .map((c) => ({ handle: c.replace(/^@/, "").trim() }))
      .filter((c) => c.handle);
  };
  const [competitorsList, setCompetitorsList] = useState<Array<{ handle: string }>>(
    parseCompetitorsFromConfig(cc.competitors)
  );
  const [newCompetitorHandle, setNewCompetitorHandle] = useState("");
  const [website, setWebsite] = useState((cc.website as string) ?? "");

  // Optimizer config
  const rawOptimizerConfig = (cc.optimizer_config as Record<string, unknown>) ?? {};
  const [optimizerTargetCpl, setOptimizerTargetCpl] = useState(
    rawOptimizerConfig.target_cpl != null ? String(rawOptimizerConfig.target_cpl) : ""
  );
  const [optimizerTargetRoas, setOptimizerTargetRoas] = useState(
    rawOptimizerConfig.target_roas != null ? String(rawOptimizerConfig.target_roas) : ""
  );
  const [optimizerTargetCpc, setOptimizerTargetCpc] = useState(
    rawOptimizerConfig.target_cpc != null ? String(rawOptimizerConfig.target_cpc) : ""
  );
  const [businessObjective, setBusinessObjective] = useState((cc.business_objective as string) ?? "generate_leads");
  const [targetPlatforms, setTargetPlatforms] = useState<string[]>(
    Array.isArray(cc.target_platforms) ? (cc.target_platforms as string[]) : []
  );
  const [postingFrequency, setPostingFrequency] = useState((cc.posting_frequency as string) ?? "3-4x_week");

  const togglePlatform = (val: string) => {
    setTargetPlatforms((prev) =>
      prev.includes(val) ? prev.filter((p) => p !== val) : [...prev, val]
    );
  };

  const handleDiscoverAssets = async () => {
    const token = (session as any)?.accessToken as string | undefined;
    if (!token) return;
    setDiscoveringAssets(true);
    setDiscoverError(null);
    try {
      const assets = await discoverMetaAssets(token, project.slug);
      setMetaSelectAssets(assets);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error";
      setDiscoverError(msg);
    } finally {
      setDiscoveringAssets(false);
    }
  };

  const handleMetaAssetSuccess = (updated: Project) => {
    // Sync the form fields with the newly selected assets
    setFacebookPageId(updated.facebook_page_id ?? "");
    setInstagramAccountId(updated.instagram_account_id ?? "");
    setAdAccountId(updated.ad_account_id ?? "");
    setMetaSelectAssets(null);
    onSuccess(updated);
  };

  const handleSave = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = (session as any)?.accessToken as string | undefined;
      const updatedContentConfig = {
        ...cc,
        tone,
        core_message: coreMessage,
        additional_rules: additionalRules
          .split("\n")
          .map((r) => r.trim())
          .filter(Boolean),
        target_audience: targetAudience,
        content_categories: contentCategories
          .split("\n")
          .map((r) => r.trim())
          .filter(Boolean),
        market_region: marketRegion,
        target_countries: targetCountries
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean),
        posting_timezone: postingTimezone,
        price_range: priceRange,
        social_proof_examples: socialProof,
        offer,
        ad_library_countries: adLibraryCountries
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean),
        brand_name: brandName || (cc.brand_name as string) || undefined,
        brand_voice: brandVoice,
        brand_primary_color: brandPrimaryColor,
        brand_secondary_color: brandSecondaryColor,
        brand_bg_color: brandBgColor,
        visual_style: visualStyle,
        image_mood: imageMood,
        brand_fonts: brandFonts,
        competitors: competitorsList.map((c) => c.handle),
        website,
        business_objective: businessObjective,
        target_platforms: targetPlatforms,
        posting_frequency: postingFrequency,
        optimizer_config: {
          ...(rawOptimizerConfig),
          ...(optimizerTargetCpl !== "" ? { target_cpl: parseFloat(optimizerTargetCpl) } : {}),
          ...(optimizerTargetRoas !== "" ? { target_roas: parseFloat(optimizerTargetRoas) } : {}),
          ...(optimizerTargetCpc !== "" ? { target_cpc: parseFloat(optimizerTargetCpc) } : {}),
        },
      };

      // Auto-derive media_config from brand visual settings
      const updatedMediaConfig = {
        ...mc,
        image_style: visualStyle,
        image_mood: imageMood,
        image_primary_color: brandPrimaryColor,
        image_secondary_color: brandSecondaryColor,
        image_bg_color: brandBgColor,
        image_fonts: brandFonts,
        image_color_palette: deriveColorPalette(brandPrimaryColor),
      };

      const result = await updateProject(project.slug, {
        content_config: updatedContentConfig,
        media_config: updatedMediaConfig,
        // Operators cannot modify platform connection fields
        ...(isOperator ? {} : {
          facebook_page_id: facebookPageId || undefined,
          instagram_account_id: instagramAccountId || undefined,
          ad_account_id: adAccountId || undefined,
        }),
      }, token);

      onSuccess(result);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.form_error_default);
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    backgroundColor: "#1a1a1a",
    border: "1px solid #333333",
    color: "#ffffff",
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
        {/* Header */}
        <div className="flex items-center justify-between p-6 flex-shrink-0" style={{ borderBottom: "1px solid #222222" }}>
          <div>
            <h2 className="text-lg font-semibold text-white">{t.form_dialog_title}</h2>
            <p className="text-sm" style={{ color: "#9ca3af" }}>{project.name}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md transition-colors"
            style={{ color: "#9ca3af" }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1a1a1a"; (e.currentTarget as HTMLButtonElement).style.color = "#ffffff"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; }}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex flex-shrink-0" style={{ borderBottom: "1px solid #222222" }}>
          {TABS.map((label, i) => (
            <button
              key={i}
              onClick={() => setTab(i)}
              className="flex-1 py-2.5 text-xs font-medium transition-colors"
              style={
                tab === i
                  ? { backgroundColor: "#7c3aed", color: "#ffffff" }
                  : { backgroundColor: "transparent", color: "#9ca3af" }
              }
              onMouseEnter={e => { if (tab !== i) { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1a1a1a"; (e.currentTarget as HTMLButtonElement).style.color = "#ffffff"; } }}
              onMouseLeave={e => { if (tab !== i) { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; } }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 p-3 rounded-md text-sm text-red-400" style={{ backgroundColor: "#450a0a", border: "1px solid #7f1d1d" }}>
              {error}
            </div>
          )}

          {/* ── TAB 1: Contenido ── */}
          {canonicalTab(tab) === 1 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-white mb-1">{t.form_tone_label}</label>
                <textarea
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                  style={inputStyle}
                  placeholder={t.form_tone_placeholder}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white mb-1">{t.form_core_message_label}</label>
                <textarea
                  value={coreMessage}
                  onChange={(e) => setCoreMessage(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                  style={inputStyle}
                  placeholder={t.form_core_message_placeholder}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white mb-1">
                  {t.form_additional_rules_label} <span className="font-normal" style={{ color: "#9ca3af" }}>{t.form_additional_rules_hint}</span>
                </label>
                <textarea
                  value={additionalRules}
                  onChange={(e) => setAdditionalRules(e.target.value)}
                  rows={4}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                  style={inputStyle}
                  placeholder={t.form_additional_rules_placeholder}
                />
              </div>
            </div>
          )}

          {/* ── TAB 2: Audiencia ── */}
          {canonicalTab(tab) === 2 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-white mb-1">{t.form_target_audience_label}</label>
                <textarea
                  value={targetAudience}
                  onChange={(e) => setTargetAudience(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                  style={inputStyle}
                  placeholder={t.form_target_audience_placeholder}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white mb-1">
                  {t.form_content_categories_label} <span className="font-normal" style={{ color: "#9ca3af" }}>{t.form_content_categories_hint}</span>
                </label>
                <textarea
                  value={contentCategories}
                  onChange={(e) => setContentCategories(e.target.value)}
                  rows={5}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                  style={inputStyle}
                  placeholder={t.form_content_categories_placeholder}
                />
              </div>

              {/* ── Contexto de Mercado y Ventas ── */}
              <div style={{ borderTop: "1px solid #222222", paddingTop: "1.25rem" }}>
                <p className="text-sm font-semibold text-white mb-4">{t.form_market_context_section}</p>
                <div className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-white mb-1">{t.form_market_region_label}</label>
                    <select
                      value={marketRegion}
                      onChange={(e) => setMarketRegion(e.target.value)}
                      className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                      style={inputStyle}
                    >
                      <option value="LATAM">LATAM</option>
                      <option value="North America">North America</option>
                      <option value="Europe">Europe</option>
                      <option value="Global">Global</option>
                    </select>
                    <p className="text-xs mt-1" style={{ color: "#6b7280" }}>{t.form_market_region_affects_hint}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-white mb-1">{t.form_target_countries_label}</label>
                    <input
                      value={targetCountries}
                      onChange={(e) => setTargetCountries(e.target.value)}
                      className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                      style={inputStyle}
                      placeholder={t.form_target_countries_placeholder}
                    />
                    <p className="text-xs mt-1" style={{ color: "#6b7280" }}>{t.form_target_countries_hint}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-white mb-1">{t.form_posting_timezone_label}</label>
                    <select
                      value={postingTimezone}
                      onChange={(e) => setPostingTimezone(e.target.value)}
                      className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                      style={inputStyle}
                    >
                      <option value="UTC">UTC</option>
                      <option value="America/Argentina/Buenos_Aires">America/Argentina/Buenos_Aires</option>
                      <option value="America/Mexico_City">America/Mexico_City</option>
                      <option value="America/Bogota">America/Bogota</option>
                      <option value="America/Santiago">America/Santiago</option>
                      <option value="America/Lima">America/Lima</option>
                      <option value="America/New_York">America/New_York</option>
                      <option value="America/Sao_Paulo">America/Sao_Paulo</option>
                      <option value="Europe/London">Europe/London</option>
                      <option value="Europe/Madrid">Europe/Madrid</option>
                      <option value="Europe/Paris">Europe/Paris</option>
                      <option value="Asia/Tokyo">Asia/Tokyo</option>
                      <option value="Australia/Sydney">Australia/Sydney</option>
                    </select>
                    <p className="text-xs mt-1" style={{ color: "#6b7280" }}>{t.form_posting_timezone_hint}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-white mb-1">{t.form_price_range_label}</label>
                    <input
                      value={priceRange}
                      onChange={(e) => setPriceRange(e.target.value)}
                      className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                      style={inputStyle}
                      placeholder={t.form_price_range_placeholder}
                    />
                    <p className="text-xs mt-1" style={{ color: "#6b7280" }}>{t.form_price_range_hint}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-white mb-1">{t.form_social_proof_label}</label>
                    <textarea
                      value={socialProof}
                      onChange={(e) => setSocialProof(e.target.value)}
                      rows={2}
                      className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                      style={inputStyle}
                      placeholder={t.form_social_proof_placeholder}
                    />
                    <p className="text-xs mt-1" style={{ color: "#6b7280" }}>{t.form_social_proof_hint}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-white mb-1">{t.form_offer_label}</label>
                    <input
                      value={offer}
                      onChange={(e) => setOffer(e.target.value)}
                      className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                      style={inputStyle}
                      placeholder={t.form_offer_placeholder}
                    />
                    <p className="text-xs mt-1" style={{ color: "#6b7280" }}>{t.form_offer_hint}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-white mb-1">{t.form_ad_library_countries_label}</label>
                    <input
                      value={adLibraryCountries}
                      onChange={(e) => setAdLibraryCountries(e.target.value)}
                      className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                      style={inputStyle}
                      placeholder={t.form_ad_library_countries_placeholder}
                    />
                    <p className="text-xs mt-1" style={{ color: "#6b7280" }}>{t.form_ad_library_countries_hint}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── TAB 0: Plataformas (primer tab) ── */}
          {canonicalTab(tab) === 0 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-white mb-1">{t.form_fb_page_id_label}</label>
                <input
                  value={facebookPageId}
                  onChange={(e) => setFacebookPageId(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                  style={inputStyle}
                  placeholder={t.form_fb_page_id_placeholder}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white mb-1">{t.form_ig_account_id_label}</label>
                <input
                  value={instagramAccountId}
                  onChange={(e) => setInstagramAccountId(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                  style={inputStyle}
                  placeholder={t.form_ig_account_id_placeholder}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white mb-1">{t.form_ad_account_id_label}</label>
                <input
                  value={adAccountId}
                  onChange={(e) => setAdAccountId(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                  style={inputStyle}
                  placeholder={t.form_ad_account_id_placeholder}
                />
                <p className="text-xs mt-1" style={{ color: "#6b7280" }}>{t.form_ad_account_hint}</p>
              </div>

              {/* Meta connection — shows one section based on whether user has UserMetaToken */}
              <div style={{ borderTop: "1px solid #222222", paddingTop: "1.25rem" }}>
                {userHasMetaToken === null ? (
                  /* Loading */
                  <div className="flex items-center gap-2" style={{ color: "#6b7280" }}>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-xs">{t.form_meta_discovering}</span>
                  </div>
                ) : userHasMetaToken ? (
                  /* User has UserMetaToken — show asset selector */
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <label className="block text-sm font-medium text-white mb-0.5">
                          {t.form_meta_connected_assets}
                        </label>
                        {(facebookPageId || instagramAccountId || adAccountId) && (
                          <p className="text-xs font-mono" style={{ color: "#6b7280" }}>
                            {[
                              facebookPageId && `Page: ${facebookPageId}`,
                              instagramAccountId && `IG: ${instagramAccountId}`,
                              adAccountId && `Ad: ${adAccountId}`,
                            ].filter(Boolean).join(" · ")}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={handleDiscoverAssets}
                        disabled={discoveringAssets}
                        className="px-4 py-2 text-white text-xs font-medium rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
                        style={{ backgroundColor: "#7c3aed" }}
                      >
                        {discoveringAssets
                          ? t.form_meta_discovering
                          : (facebookPageId || instagramAccountId || adAccountId)
                            ? t.form_meta_change_assets_btn
                            : t.form_meta_select_assets_btn}
                      </button>
                    </div>
                    {discoverError && (
                      <p className="text-xs rounded-md px-3 py-2" style={{ backgroundColor: "#450a0a", color: "#f87171", border: "1px solid #7f1d1d" }}>
                        {discoverError}
                      </p>
                    )}
                  </div>
                ) : (
                  /* No UserMetaToken — show project-level OAuth button */
                  <div className="space-y-3">
                    <label className="block text-sm font-medium text-white">{t.form_meta_account_label}</label>
                    {project.facebook_page_id ? (
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium" style={{ backgroundColor: "#052e16", color: "#4ade80", border: "1px solid #166534" }}>
                            {t.form_meta_connected}
                          </span>
                          <span className="text-xs font-mono" style={{ color: "#9ca3af" }}>
                            Page ID: {project.facebook_page_id}
                          </span>
                          {project.meta_token_expires_at && (
                            <span className="text-xs" style={{ color: "#6b7280" }}>
                              · {t.form_meta_token_expires} {new Date(project.meta_token_expires_at).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" })}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => { window.location.href = connectMetaOAuth(project.slug); }}
                          className="px-4 py-2 text-white text-xs font-medium rounded-lg transition-opacity hover:opacity-90"
                          style={{ backgroundColor: "#1877f2" }}
                        >
                          {t.form_meta_reconnect}
                        </button>
                      </div>
                    ) : (
                      <>
                        <p className="text-xs" style={{ color: "#9ca3af" }}>{t.form_meta_connect_description}</p>
                        <button
                          type="button"
                          onClick={() => { window.location.href = connectMetaOAuth(project.slug); }}
                          className="inline-flex items-center gap-2 px-4 py-2 text-white text-sm font-medium rounded-lg transition-opacity hover:opacity-90"
                          style={{ backgroundColor: "#1877f2" }}
                        >
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z"/>
                          </svg>
                          {t.form_meta_connect_btn}
                        </button>
                        <p className="text-xs" style={{ color: "#6b7280" }}>{t.form_meta_or_settings_hint}</p>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Pinterest connection */}
              <div style={{ borderTop: "1px solid #222222", paddingTop: "1.25rem" }}>
                <label className="block text-sm font-medium text-white mb-3">Pinterest</label>
                {pinterestConnected === null ? (
                  <div className="flex items-center gap-2" style={{ color: "#6b7280" }}>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-xs">{t.form_meta_discovering}</span>
                  </div>
                ) : pinterestConnected ? (
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium" style={{ backgroundColor: "#3b0764", color: "#e9d5ff", border: "1px solid #6d28d9" }}>
                      {t.pinterest_connected}
                    </span>
                    <button
                      type="button"
                      onClick={handlePinterestDisconnect}
                      disabled={pinterestDisconnecting}
                      className="px-4 py-2 text-white text-xs font-medium rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
                      style={{ backgroundColor: "#dc2626" }}
                    >
                      {t.pinterest_disconnect}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <a
                      href={`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/api/v1/auth/pinterest/start?project_slug=${project.slug}`}
                      className="inline-flex items-center gap-2 px-4 py-2 text-white text-sm font-medium rounded-lg transition-opacity hover:opacity-90"
                      style={{ backgroundColor: "#e60023" }}
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 0C5.373 0 0 5.373 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/>
                      </svg>
                      {t.pinterest_connect_btn}
                    </a>
                    <p className="text-xs" style={{ color: "#6b7280" }}>{t.pinterest_app_review_note}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── TAB 3: Marca y Visual ── */}
          {canonicalTab(tab) === 3 && (
            <div className="space-y-6">
              {/* Brand Name */}
              <div>
                <label className="block text-sm font-medium text-white mb-1">{t.form_brand_name_label}</label>
                <input
                  type="text"
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                  style={inputStyle}
                  placeholder="e.g. Quantoria Labs"
                />
              </div>

              {/* Brand Voice */}
              <div>
                <label className="block text-sm font-medium text-white mb-1">{t.form_brand_voice_label}</label>
                <select
                  value={brandVoice}
                  onChange={(e) => setBrandVoice(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                  style={inputStyle}
                >
                  <option value="formal">{t.form_brand_voice_formal}</option>
                  <option value="conversational">{t.form_brand_voice_conversational}</option>
                  <option value="bold">{t.form_brand_voice_bold}</option>
                  <option value="educational">{t.form_brand_voice_educational}</option>
                  <option value="playful">{t.form_brand_voice_playful}</option>
                </select>
              </div>

              {/* Color pickers */}
              <div>
                <label className="block text-sm font-medium text-white mb-3">{t.form_brand_colors_label}</label>
                <div className="flex flex-wrap gap-6">
                  <ColorPicker
                    label={t.form_color_primary}
                    value={brandPrimaryColor}
                    onChange={setBrandPrimaryColor}
                  />
                  <ColorPicker
                    label={t.form_color_secondary}
                    value={brandSecondaryColor}
                    onChange={setBrandSecondaryColor}
                  />
                  <ColorPicker
                    label={t.form_color_bg}
                    value={brandBgColor}
                    onChange={setBrandBgColor}
                  />
                </div>
                {/* Live preview strip */}
                <div
                  className="mt-3 h-8 rounded-lg flex overflow-hidden"
                  style={{ border: "1px solid #333333" }}
                  title={t.form_color_preview_title}
                >
                  <div className="flex-1" style={{ backgroundColor: brandBgColor }} />
                  <div className="w-8" style={{ backgroundColor: brandPrimaryColor }} />
                  <div className="w-8" style={{ backgroundColor: brandSecondaryColor }} />
                </div>
              </div>

              {/* Visual style */}
              <div>
                <label className="block text-sm font-medium text-white mb-1">{t.form_visual_style_label}</label>
                <select
                  value={visualStyle}
                  onChange={(e) => setVisualStyle(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                  style={inputStyle}
                >
                  {VISUAL_STYLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Image mood */}
              <div>
                <label className="block text-sm font-medium text-white mb-1">{t.form_image_mood_label}</label>
                <textarea
                  value={imageMood}
                  onChange={(e) => setImageMood(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                  style={inputStyle}
                  placeholder={t.form_image_mood_placeholder}
                />
              </div>

              {/* Typography */}
              <div>
                <label className="block text-sm font-medium text-white mb-1">{t.form_fonts_label}</label>
                <input
                  value={brandFonts}
                  onChange={(e) => setBrandFonts(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                  style={inputStyle}
                  placeholder={t.form_fonts_placeholder}
                />
              </div>

              {/* Competitors — structured list */}
              <div>
                <label className="block text-sm font-medium text-white mb-1">{t.form_competitors_label}</label>
                {competitorsList.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {competitorsList.map((c, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
                        style={{ backgroundColor: "#1a1a2e", border: "1px solid #333333", color: "#d1d5db" }}
                      >
                        <span>@{c.handle}</span>
                        <button
                          type="button"
                          onClick={() => setCompetitorsList((prev) => prev.filter((_, i) => i !== idx))}
                          className="text-gray-500 hover:text-red-400 transition-colors ml-1"
                          style={{ lineHeight: 1 }}
                        >
                          &times;
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    value={newCompetitorHandle}
                    onChange={(e) => setNewCompetitorHandle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const handle = newCompetitorHandle.replace(/^@/, "").trim();
                        if (handle && !competitorsList.some((c) => c.handle === handle)) {
                          setCompetitorsList((prev) => [...prev, { handle }]);
                        }
                        setNewCompetitorHandle("");
                      }
                    }}
                    className="flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                    style={inputStyle}
                    placeholder={t.form_competitor_placeholder}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const handle = newCompetitorHandle.replace(/^@/, "").trim();
                      if (handle && !competitorsList.some((c) => c.handle === handle)) {
                        setCompetitorsList((prev) => [...prev, { handle }]);
                      }
                      setNewCompetitorHandle("");
                    }}
                    className="px-3 py-2 text-sm rounded-lg font-medium text-white transition-colors"
                    style={{ backgroundColor: "#7c3aed" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#6d28d9"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#7c3aed"; }}
                  >
                    {t.form_add_competitor_btn}
                  </button>
                </div>
              </div>

              {/* Website / Landing URL */}
              <div>
                <label className="block text-sm font-medium text-white mb-1">{t.form_website_label}</label>
                <input
                  type="url"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                  style={inputStyle}
                  placeholder="https://..."
                />
              </div>

              {/* Business objective */}
              <div>
                <label className="block text-sm font-medium text-white mb-1">{t.form_business_objective_label}</label>
                <select
                  value={businessObjective}
                  onChange={(e) => setBusinessObjective(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                  style={inputStyle}
                >
                  {BUSINESS_OBJECTIVE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Target platforms */}
              <div>
                <label className="block text-sm font-medium text-white mb-2">{t.form_target_platforms_label}</label>
                <div className="flex flex-wrap gap-2">
                  {PLATFORM_OPTIONS_STATIC.map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => togglePlatform(value)}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
                      style={
                        targetPlatforms.includes(value)
                          ? { backgroundColor: "#7c3aed", color: "#ffffff", border: "1px solid #7c3aed" }
                          : { backgroundColor: "transparent", color: "#9ca3af", border: "1px solid #333333" }
                      }
                      onMouseEnter={e => { if (!targetPlatforms.includes(value)) { (e.currentTarget as HTMLButtonElement).style.borderColor = "#555555"; (e.currentTarget as HTMLButtonElement).style.color = "#ffffff"; } }}
                      onMouseLeave={e => { if (!targetPlatforms.includes(value)) { (e.currentTarget as HTMLButtonElement).style.borderColor = "#333333"; (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; } }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Posting frequency */}
              <div>
                <label className="block text-sm font-medium text-white mb-1">{t.form_posting_frequency_label}</label>
                <select
                  value={postingFrequency}
                  onChange={(e) => setPostingFrequency(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                  style={inputStyle}
                >
                  {POSTING_FREQUENCY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Andromeda optimizer thresholds */}
              <div>
                <label className="block text-sm font-medium text-white mb-1">{t.form_andromeda_targets_label}</label>
                <p className="text-xs mb-3" style={{ color: "#9ca3af" }}>
                  {t.form_andromeda_targets_hint}
                </p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs mb-1" style={{ color: "#9ca3af" }}>{t.form_target_cpl_label}</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={optimizerTargetCpl}
                      onChange={(e) => setOptimizerTargetCpl(e.target.value)}
                      className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                      style={inputStyle}
                      placeholder="5.00"
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1" style={{ color: "#9ca3af" }}>{t.form_target_roas_label}</label>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={optimizerTargetRoas}
                      onChange={(e) => setOptimizerTargetRoas(e.target.value)}
                      className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                      style={inputStyle}
                      placeholder="2.0"
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1" style={{ color: "#9ca3af" }}>{t.form_target_cpc_label}</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={optimizerTargetCpc}
                      onChange={(e) => setOptimizerTargetCpc(e.target.value)}
                      className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                      style={inputStyle}
                      placeholder="0.30"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 flex-shrink-0" style={{ borderTop: "1px solid #222222" }}>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg transition-colors"
            style={{ border: "1px solid #333333", color: "#9ca3af" }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#ffffff"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#555555"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#333333"; }}
          >
            {t.form_cancel}
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="flex items-center gap-2 px-5 py-2 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            style={{ backgroundColor: "#7c3aed" }}
            onMouseEnter={e => { if (!(e.currentTarget as HTMLButtonElement).disabled) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#6d28d9"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#7c3aed"; }}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t.form_saving}
              </>
            ) : (
              t.form_save
            )}
          </button>
        </div>
      </div>

      {/* Meta asset selection modal — triggered from Platforms tab */}
      {metaSelectAssets && (
        <MetaAssetSelectModal
          slug={project.slug}
          assets={{
            pages: metaSelectAssets.pages,
            ad_accounts: metaSelectAssets.ad_accounts,
            instagram_accounts: metaSelectAssets.instagram_accounts,
            current: {
              page_id: metaSelectAssets.facebook_page_id,
              instagram_id: metaSelectAssets.instagram_account_id,
              ad_account_id: metaSelectAssets.ad_account_id,
            },
          }}
          authToken={(session as any)?.accessToken as string | undefined}
          onClose={() => setMetaSelectAssets(null)}
          onSuccess={handleMetaAssetSuccess}
        />
      )}
    </div>
  );
}

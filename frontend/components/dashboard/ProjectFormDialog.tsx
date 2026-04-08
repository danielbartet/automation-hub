"use client";
import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import { updateProject, connectMetaOAuth } from "@/lib/api";

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
}

const TABS = ["Contenido", "Audiencia", "Plataformas", "Marca y Visual"];

const VISUAL_STYLE_OPTIONS = [
  { value: "typographic", label: "Tipográfico dark — texto bold sobre fondo oscuro" },
  { value: "photorealistic", label: "Fotorrealista — fotos reales, personas, productos" },
  { value: "illustration", label: "Ilustración — vectores, iconos, colores planos" },
  { value: "minimal", label: "Minimalista — mucho espacio en blanco, tipografía simple" },
  { value: "data_visual", label: "Data/Stats — números grandes, gráficos, infografías" },
];

const BUSINESS_OBJECTIVE_OPTIONS = [
  { value: "generate_leads", label: "Generar leads — capturar emails o contactos" },
  { value: "sell_product", label: "Vender producto — conversiones directas" },
  { value: "build_community", label: "Construir comunidad — engagement y seguidores" },
  { value: "brand_positioning", label: "Posicionamiento de marca — awareness y autoridad" },
];

const POSTING_FREQUENCY_OPTIONS = [
  { value: "daily", label: "Diario" },
  { value: "3-4x_week", label: "3-4 veces por semana" },
  { value: "1-2x_week", label: "1-2 veces por semana" },
  { value: "on_demand", label: "Solo cuando hay novedad" },
];

const PLATFORM_OPTIONS = [
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "tiktok", label: "TikTok" },
  { value: "x_twitter", label: "X/Twitter" },
  { value: "linkedin", label: "LinkedIn" },
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

export function ProjectFormDialog({ project, onClose, onSuccess }: ProjectFormDialogProps) {
  const cc = project.content_config ?? {};
  const mc = project.media_config ?? {};

  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // Tab 3 — Plataformas (basic info)
  const [facebookPageId, setFacebookPageId] = useState((project as unknown as Record<string, string>).facebook_page_id ?? "");
  const [instagramAccountId, setInstagramAccountId] = useState((project as unknown as Record<string, string>).instagram_account_id ?? "");
  const [adAccountId, setAdAccountId] = useState(project.ad_account_id ?? "");

  // Tab 4 — Marca y Visual
  const [brandPrimaryColor, setBrandPrimaryColor] = useState((cc.brand_primary_color as string) ?? "#7c3aed");
  const [brandSecondaryColor, setBrandSecondaryColor] = useState((cc.brand_secondary_color as string) ?? "#00FF41");
  const [brandBgColor, setBrandBgColor] = useState((cc.brand_bg_color as string) ?? "#0a0a0a");
  const [visualStyle, setVisualStyle] = useState((cc.visual_style as string) ?? "typographic");
  const [imageMood, setImageMood] = useState((cc.image_mood as string) ?? "");
  const [brandFonts, setBrandFonts] = useState((cc.brand_fonts as string) ?? "");
  const [competitors, setCompetitors] = useState((cc.competitors as string) ?? "");
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

  const handleSave = async () => {
    setLoading(true);
    setError(null);
    try {
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
        brand_primary_color: brandPrimaryColor,
        brand_secondary_color: brandSecondaryColor,
        brand_bg_color: brandBgColor,
        visual_style: visualStyle,
        image_mood: imageMood,
        brand_fonts: brandFonts,
        competitors,
        business_objective: businessObjective,
        target_platforms: targetPlatforms,
        posting_frequency: postingFrequency,
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
        facebook_page_id: facebookPageId || undefined,
        instagram_account_id: instagramAccountId || undefined,
        ad_account_id: adAccountId || undefined,
      });

      onSuccess(result);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error guardando el proyecto");
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
            <h2 className="text-lg font-semibold text-white">Configurar proyecto</h2>
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
          {tab === 0 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-white mb-1">Tono de voz</label>
                <textarea
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                  style={inputStyle}
                  placeholder="Ej: Técnico, directo, elegante. Confrontacional pero inteligente."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white mb-1">Mensaje central de marca</label>
                <textarea
                  value={coreMessage}
                  onChange={(e) => setCoreMessage(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                  style={inputStyle}
                  placeholder="Ej: AI no reemplaza developers. Reemplaza developers promedio."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white mb-1">
                  Reglas adicionales <span className="font-normal" style={{ color: "#9ca3af" }}>(una por línea)</span>
                </label>
                <textarea
                  value={additionalRules}
                  onChange={(e) => setAdditionalRules(e.target.value)}
                  rows={4}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                  style={inputStyle}
                  placeholder={"El slide 1 debe hacer que alguien pare de scrollear\nCada slide debe tener UNA sola idea clara"}
                />
              </div>
            </div>
          )}

          {/* ── TAB 2: Audiencia ── */}
          {tab === 1 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-white mb-1">Audiencia objetivo</label>
                <textarea
                  value={targetAudience}
                  onChange={(e) => setTargetAudience(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                  style={inputStyle}
                  placeholder="Ej: Developers 22-32 años, 0-5 años experiencia, que sienten que el AI los puede dejar atrás"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white mb-1">
                  Categorías de contenido <span className="font-normal" style={{ color: "#9ca3af" }}>(una por línea)</span>
                </label>
                <textarea
                  value={contentCategories}
                  onChange={(e) => setContentCategories(e.target.value)}
                  rows={5}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                  style={inputStyle}
                  placeholder={"Confrontación estratégica — desafiar suposiciones cómodas\nErrores comunes de juniors"}
                />
              </div>
            </div>
          )}

          {/* ── TAB 3: Plataformas ── */}
          {tab === 2 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-white mb-1">Facebook Page ID</label>
                <input
                  value={facebookPageId}
                  onChange={(e) => setFacebookPageId(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                  style={inputStyle}
                  placeholder="Ej: 1010286398835015"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white mb-1">Instagram Account ID</label>
                <input
                  value={instagramAccountId}
                  onChange={(e) => setInstagramAccountId(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                  style={inputStyle}
                  placeholder="Ej: 17841449394293930"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white mb-1">Ad Account ID</label>
                <input
                  value={adAccountId}
                  onChange={(e) => setAdAccountId(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                  style={inputStyle}
                  placeholder="Ej: act_1337773745049119"
                />
                <p className="text-xs mt-1" style={{ color: "#6b7280" }}>Se completa automáticamente al conectar Meta Account</p>
              </div>

              {/* Meta Account OAuth */}
              <div style={{ borderTop: "1px solid #222222", paddingTop: "1.25rem" }}>
                <label className="block text-sm font-medium text-white mb-3">Meta Account</label>
                {project.facebook_page_id ? (
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium" style={{ backgroundColor: "#052e16", color: "#4ade80", border: "1px solid #166534" }}>
                        Conectado
                      </span>
                      <span className="text-xs font-mono" style={{ color: "#9ca3af" }}>
                        Page ID: {project.facebook_page_id}
                      </span>
                      {project.meta_token_expires_at && (
                        <span className="text-xs" style={{ color: "#6b7280" }}>
                          · Token expira: {new Date(project.meta_token_expires_at).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" })}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => { window.location.href = connectMetaOAuth(project.slug); }}
                      className="px-4 py-2 text-white text-xs font-medium rounded-lg transition-opacity hover:opacity-90"
                      style={{ backgroundColor: "#1877f2" }}
                    >
                      Reconectar
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs" style={{ color: "#9ca3af" }}>
                      Conectá tu cuenta de Meta para publicar en Instagram y Facebook directamente desde el dashboard.
                    </p>
                    <button
                      type="button"
                      onClick={() => { window.location.href = connectMetaOAuth(project.slug); }}
                      className="inline-flex items-center gap-2 px-4 py-2 text-white text-sm font-medium rounded-lg transition-opacity hover:opacity-90"
                      style={{ backgroundColor: "#1877f2" }}
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z"/>
                      </svg>
                      Conectar Meta Account
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── TAB 4: Marca y Visual ── */}
          {tab === 3 && (
            <div className="space-y-6">
              {/* Color pickers */}
              <div>
                <label className="block text-sm font-medium text-white mb-3">Colores de marca</label>
                <div className="flex flex-wrap gap-6">
                  <ColorPicker
                    label="Color primario"
                    value={brandPrimaryColor}
                    onChange={setBrandPrimaryColor}
                  />
                  <ColorPicker
                    label="Color secundario"
                    value={brandSecondaryColor}
                    onChange={setBrandSecondaryColor}
                  />
                  <ColorPicker
                    label="Fondo"
                    value={brandBgColor}
                    onChange={setBrandBgColor}
                  />
                </div>
                {/* Live preview strip */}
                <div
                  className="mt-3 h-8 rounded-lg flex overflow-hidden"
                  style={{ border: "1px solid #333333" }}
                  title="Vista previa de colores"
                >
                  <div className="flex-1" style={{ backgroundColor: brandBgColor }} />
                  <div className="w-8" style={{ backgroundColor: brandPrimaryColor }} />
                  <div className="w-8" style={{ backgroundColor: brandSecondaryColor }} />
                </div>
              </div>

              {/* Visual style */}
              <div>
                <label className="block text-sm font-medium text-white mb-1">Estilo visual</label>
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
                <label className="block text-sm font-medium text-white mb-1">Mood de imagen</label>
                <textarea
                  value={imageMood}
                  onChange={(e) => setImageMood(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                  style={inputStyle}
                  placeholder="Ej: oscuro, premium, tecnológico, sin caras, tipografía bold"
                />
              </div>

              {/* Typography */}
              <div>
                <label className="block text-sm font-medium text-white mb-1">Tipografías</label>
                <input
                  value={brandFonts}
                  onChange={(e) => setBrandFonts(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                  style={inputStyle}
                  placeholder="Ej: Inter Bold, Space Grotesk, Bebas Neue"
                />
              </div>

              {/* Competitors */}
              <div>
                <label className="block text-sm font-medium text-white mb-1">Competidores</label>
                <textarea
                  value={competitors}
                  onChange={(e) => setCompetitors(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                  style={inputStyle}
                  placeholder={"@midudev\n@hola.devs\n@codewithchris"}
                />
              </div>

              {/* Business objective */}
              <div>
                <label className="block text-sm font-medium text-white mb-1">Objetivo de negocio</label>
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
                <label className="block text-sm font-medium text-white mb-2">Plataformas objetivo</label>
                <div className="flex flex-wrap gap-2">
                  {PLATFORM_OPTIONS.map(({ value, label }) => (
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
                <label className="block text-sm font-medium text-white mb-1">Frecuencia de publicación</label>
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
            Cancelar
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
                Guardando...
              </>
            ) : (
              "Guardar cambios"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

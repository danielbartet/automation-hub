"use client";
import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import { updateProject } from "@/lib/api";

interface Project {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  content_config?: Record<string, unknown>;
  media_config?: Record<string, unknown>;
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
      <label className="text-xs font-medium text-gray-600">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-9 h-9 rounded cursor-pointer border border-gray-200 p-0.5"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            if (/^#[0-9a-fA-F]{0,6}$/.test(v)) onChange(v);
          }}
          className="w-24 border border-gray-200 rounded-lg px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-gray-400"
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
  const [n8nWebhookUrl, setN8nWebhookUrl] = useState((project as unknown as Record<string, string>).n8n_webhook_base_url ?? "");

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
        n8n_webhook_base_url: n8nWebhookUrl || undefined,
      });

      onSuccess(result);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error guardando el proyecto");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold">Configurar proyecto</h2>
            <p className="text-sm text-gray-500">{project.name}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-md">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b flex-shrink-0">
          {TABS.map((label, i) => (
            <button
              key={i}
              onClick={() => setTab(i)}
              className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
                tab === i
                  ? "bg-gray-900 text-white"
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
              {error}
            </div>
          )}

          {/* ── TAB 1: Contenido ── */}
          {tab === 0 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tono de voz</label>
                <textarea
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  rows={3}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                  placeholder="Ej: Técnico, directo, elegante. Confrontacional pero inteligente."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mensaje central de marca</label>
                <textarea
                  value={coreMessage}
                  onChange={(e) => setCoreMessage(e.target.value)}
                  rows={2}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                  placeholder="Ej: AI no reemplaza developers. Reemplaza developers promedio."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Reglas adicionales <span className="text-gray-400 font-normal">(una por línea)</span>
                </label>
                <textarea
                  value={additionalRules}
                  onChange={(e) => setAdditionalRules(e.target.value)}
                  rows={4}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                  placeholder={"El slide 1 debe hacer que alguien pare de scrollear\nCada slide debe tener UNA sola idea clara"}
                />
              </div>
            </div>
          )}

          {/* ── TAB 2: Audiencia ── */}
          {tab === 1 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Audiencia objetivo</label>
                <textarea
                  value={targetAudience}
                  onChange={(e) => setTargetAudience(e.target.value)}
                  rows={3}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                  placeholder="Ej: Developers 22-32 años, 0-5 años experiencia, que sienten que el AI los puede dejar atrás"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Categorías de contenido <span className="text-gray-400 font-normal">(una por línea)</span>
                </label>
                <textarea
                  value={contentCategories}
                  onChange={(e) => setContentCategories(e.target.value)}
                  rows={5}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                  placeholder={"Confrontación estratégica — desafiar suposiciones cómodas\nErrores comunes de juniors"}
                />
              </div>
            </div>
          )}

          {/* ── TAB 3: Plataformas ── */}
          {tab === 2 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Facebook Page ID</label>
                <input
                  value={facebookPageId}
                  onChange={(e) => setFacebookPageId(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                  placeholder="Ej: 1010286398835015"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Instagram Account ID</label>
                <input
                  value={instagramAccountId}
                  onChange={(e) => setInstagramAccountId(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                  placeholder="Ej: 17841449394293930"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">n8n Webhook Base URL</label>
                <input
                  value={n8nWebhookUrl}
                  onChange={(e) => setN8nWebhookUrl(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                  placeholder="Ej: https://n8n.example.com/webhook/abc123/webhook"
                />
              </div>
            </div>
          )}

          {/* ── TAB 4: Marca y Visual ── */}
          {tab === 3 && (
            <div className="space-y-6">
              {/* Color pickers */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">Colores de marca</label>
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
                  className="mt-3 h-8 rounded-lg border border-gray-200 flex overflow-hidden"
                  title="Vista previa de colores"
                >
                  <div className="flex-1" style={{ backgroundColor: brandBgColor }} />
                  <div className="w-8" style={{ backgroundColor: brandPrimaryColor }} />
                  <div className="w-8" style={{ backgroundColor: brandSecondaryColor }} />
                </div>
              </div>

              {/* Visual style */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Estilo visual</label>
                <select
                  value={visualStyle}
                  onChange={(e) => setVisualStyle(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Mood de imagen</label>
                <textarea
                  value={imageMood}
                  onChange={(e) => setImageMood(e.target.value)}
                  rows={3}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                  placeholder="Ej: oscuro, premium, tecnológico, sin caras, tipografía bold"
                />
              </div>

              {/* Typography */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tipografías</label>
                <input
                  value={brandFonts}
                  onChange={(e) => setBrandFonts(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                  placeholder="Ej: Inter Bold, Space Grotesk, Bebas Neue"
                />
              </div>

              {/* Competitors */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Competidores</label>
                <textarea
                  value={competitors}
                  onChange={(e) => setCompetitors(e.target.value)}
                  rows={3}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                  placeholder={"@midudev\n@hola.devs\n@codewithchris"}
                />
              </div>

              {/* Business objective */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Objetivo de negocio</label>
                <select
                  value={businessObjective}
                  onChange={(e) => setBusinessObjective(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
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
                <label className="block text-sm font-medium text-gray-700 mb-2">Plataformas objetivo</label>
                <div className="flex flex-wrap gap-2">
                  {PLATFORM_OPTIONS.map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => togglePlatform(value)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                        targetPlatforms.includes(value)
                          ? "bg-gray-900 text-white border-gray-900"
                          : "border-gray-200 text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Posting frequency */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Frecuencia de publicación</label>
                <select
                  value={postingFrequency}
                  onChange={(e) => setPostingFrequency(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
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
        <div className="flex items-center justify-end gap-3 p-6 border-t flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-200 text-sm rounded-lg hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="flex items-center gap-2 px-5 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 disabled:opacity-50"
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

"use client";

import { createContext, useContext, useEffect, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type Lang = "en" | "es";
export type TranslationKey = keyof typeof translations.en;

// ── Translations ──────────────────────────────────────────────────────────────

export const translations = {
  en: {
    // ── Sidebar nav ──────────────────────────────────────────────────────────
    nav_overview: "Overview",
    nav_projects: "Projects",
    nav_content: "Content",
    nav_calendar: "Calendar",
    nav_ads: "Ads",
    nav_audiences: "Audiences",
    nav_health: "Health Monitor",
    nav_settings_label: "Settings",
    nav_settings_users: "Users",

    // ── Header ───────────────────────────────────────────────────────────────
    header_sign_out: "Sign out",

    // ── Language toggle ───────────────────────────────────────────────────────
    lang_es: "ES",
    lang_en: "EN",

    // ── Login page ───────────────────────────────────────────────────────────
    login_subtitle: "Sign in to your account",
    login_email: "Email",
    login_password: "Password",
    login_submit: "Sign in",
    login_submitting: "Signing in...",
    login_invalid_credentials: "Invalid credentials",

    // ── Projects page ────────────────────────────────────────────────────────
    projects_page_title: "Projects",
    projects_loading: "Loading projects...",
    projects_count_one: "1 project",
    projects_count_many: (n: number) => `${n} projects`,
    projects_new: "New Project",
    projects_loading_spinner: "Loading...",
    projects_empty_title: "No projects yet",
    projects_empty_subtitle: "Create your first project to get started.",
    projects_status_active: "Active",
    projects_status_inactive: "Inactive",
    projects_view_dashboard: "View Dashboard",
    projects_settings_title: "Project settings",
    projects_delete_title: "Delete project",
    projects_delete_tooltip: "Delete project",
    projects_delete_confirm_msg: (name: string) =>
      `Are you sure you want to delete ${name}? This action cannot be undone.`,
    projects_delete_cancel: "Cancel",
    projects_delete_confirm_btn: "Delete",
    projects_deleting: "Deleting...",
    projects_toast_created: (name: string) => `Project "${name}" created successfully`,
    projects_toast_deleted: (name: string) => `Project "${name}" deleted`,
    projects_toast_delete_error: "Error deleting the project",
    projects_toast_meta_error_parse: "Error processing Meta assets",
    projects_toast_meta_saved: "Meta assets saved successfully",
    projects_token_expired: "Token expired — Reconnect",
    projects_token_expires_in: (days: number) =>
      `Token expires in ${days} day${days !== 1 ? "s" : ""}`,

    // ── ProjectCreateDialog ──────────────────────────────────────────────────
    create_dialog_title: "New Project",
    create_dialog_name_label: "Name",
    create_dialog_name_placeholder: "E.g.: Mas que Fútbol",
    create_dialog_slug_label: "Slug",
    create_dialog_slug_placeholder: "e.g.: mas-que-futbol",
    create_dialog_slug_hint: "Unique identifier — used in URLs. Only letters, numbers and hyphens.",
    create_dialog_lang_label: "Content language",
    create_dialog_lang_es: "Spanish",
    create_dialog_lang_en: "English",
    create_dialog_cancel: "Cancel",
    create_dialog_creating: "Creating...",
    create_dialog_submit: "Create Project",
    create_dialog_error_default: "Error creating the project",

    // ── ProjectFormDialog ─────────────────────────────────────────────────────
    form_dialog_title: "Configure project",
    form_dialog_tab_content: "Content",
    form_dialog_tab_audience: "Audience",
    form_dialog_tab_platforms: "Platforms",
    form_dialog_tab_brand: "Brand & Visual",

    // Tab 1 — Content
    form_tone_label: "Brand voice",
    form_tone_placeholder: "E.g.: Technical, direct, elegant. Confrontational but intelligent.",
    form_core_message_label: "Core brand message",
    form_core_message_placeholder: "E.g.: AI doesn't replace developers. It replaces average developers.",
    form_additional_rules_label: "Additional rules",
    form_additional_rules_hint: "(one per line)",
    form_additional_rules_placeholder:
      "Slide 1 must make someone stop scrolling\nEach slide should have ONE clear idea",

    // Tab 2 — Audience
    form_target_audience_label: "Target audience",
    form_target_audience_placeholder:
      "E.g.: Developers 22-32 years, 0-5 years experience, who feel AI might leave them behind",
    form_content_categories_label: "Content categories",
    form_content_categories_hint: "(one per line)",
    form_content_categories_placeholder:
      "Strategic challenge — challenging comfortable assumptions\nCommon junior mistakes",

    // Tab 3 — Platforms
    form_fb_page_id_label: "Facebook Page ID",
    form_fb_page_id_placeholder: "E.g.: 1010286398835015",
    form_ig_account_id_label: "Instagram Account ID",
    form_ig_account_id_placeholder: "E.g.: 17841449394293930",
    form_ad_account_id_label: "Ad Account ID",
    form_ad_account_id_placeholder: "E.g.: act_1337773745049119",
    form_ad_account_hint: "Auto-filled when you connect a Meta Account",
    form_meta_account_label: "Meta Account",
    form_meta_connected: "Connected",
    form_meta_token_expires: "Token expires:",
    form_meta_reconnect: "Reconnect",
    form_meta_connect_description:
      "Connect your Meta account to publish to Instagram and Facebook directly from the dashboard.",
    form_meta_connect_btn: "Connect Meta Account",

    // Tab 4 — Brand & Visual
    form_brand_colors_label: "Brand colors",
    form_color_primary: "Primary color",
    form_color_secondary: "Secondary color",
    form_color_bg: "Background",
    form_color_preview_title: "Color preview",
    form_visual_style_label: "Visual style",
    form_image_mood_label: "Image mood",
    form_image_mood_placeholder: "E.g.: dark, premium, tech, no faces, bold typography",
    form_fonts_label: "Typography",
    form_fonts_placeholder: "E.g.: Inter Bold, Space Grotesk, Bebas Neue",
    form_competitors_label: "Competitors",
    form_business_objective_label: "Business objective",
    form_target_platforms_label: "Target platforms",
    form_posting_frequency_label: "Posting frequency",

    // Visual style options
    vs_typographic: "Typographic dark — bold text on dark background",
    vs_photorealistic: "Photorealistic — real photos, people, products",
    vs_illustration: "Illustration — vectors, icons, flat colors",
    vs_minimal: "Minimalist — lots of white space, simple typography",
    vs_data_visual: "Data/Stats — large numbers, charts, infographics",

    // Business objective options
    bo_generate_leads: "Generate leads — capture emails or contacts",
    bo_sell_product: "Sell product — direct conversions",
    bo_build_community: "Build community — engagement and followers",
    bo_brand_positioning: "Brand positioning — awareness and authority",

    // Posting frequency options
    pf_daily: "Daily",
    pf_3_4x_week: "3-4 times per week",
    pf_1_2x_week: "1-2 times per week",
    pf_on_demand: "Only when there's news",

    // Footer buttons
    form_cancel: "Cancel",
    form_save: "Save changes",
    form_saving: "Saving...",
    form_error_default: "Error saving the project",

    // ── MetaAssetSelectModal ──────────────────────────────────────────────────
    meta_modal_title: "Select Meta assets",
    meta_modal_subtitle:
      "We found multiple linked accounts. Choose which one to use for this project.",
    meta_modal_label_pages: "Facebook Pages",
    meta_modal_label_instagram: "Instagram Accounts",
    meta_modal_label_ad_accounts: "Ad Accounts",
    meta_modal_cancel: "Cancel",
    meta_modal_save: "Save",
    meta_modal_saving: "Saving...",
    meta_modal_error_default: "Error saving",
  },

  es: {
    // ── Sidebar nav ──────────────────────────────────────────────────────────
    nav_overview: "Overview",
    nav_projects: "Proyectos",
    nav_content: "Contenido",
    nav_calendar: "Calendario",
    nav_ads: "Ads",
    nav_audiences: "Audiencias",
    nav_health: "Health Monitor",
    nav_settings_label: "Settings",
    nav_settings_users: "Usuarios",

    // ── Header ───────────────────────────────────────────────────────────────
    header_sign_out: "Cerrar sesión",

    // ── Language toggle ───────────────────────────────────────────────────────
    lang_es: "ES",
    lang_en: "EN",

    // ── Login page ───────────────────────────────────────────────────────────
    login_subtitle: "Ingresá a tu cuenta",
    login_email: "Email",
    login_password: "Contraseña",
    login_submit: "Iniciar sesión",
    login_submitting: "Iniciando sesión...",
    login_invalid_credentials: "Credenciales inválidas",

    // ── Projects page ────────────────────────────────────────────────────────
    projects_page_title: "Proyectos",
    projects_loading: "Cargando proyectos...",
    projects_count_one: "1 proyecto",
    projects_count_many: (n: number) => `${n} proyectos`,
    projects_new: "Nuevo Proyecto",
    projects_loading_spinner: "Cargando...",
    projects_empty_title: "Sin proyectos",
    projects_empty_subtitle: "Creá tu primer proyecto para comenzar.",
    projects_status_active: "Activo",
    projects_status_inactive: "Inactivo",
    projects_view_dashboard: "Ver Dashboard",
    projects_settings_title: "Configuración del proyecto",
    projects_delete_title: "Eliminar proyecto",
    projects_delete_tooltip: "Eliminar proyecto",
    projects_delete_confirm_msg: (name: string) =>
      `¿Estás seguro que querés eliminar ${name}? Esta acción no se puede deshacer.`,
    projects_delete_cancel: "Cancelar",
    projects_delete_confirm_btn: "Eliminar",
    projects_deleting: "Eliminando...",
    projects_toast_created: (name: string) => `Proyecto "${name}" creado correctamente`,
    projects_toast_deleted: (name: string) => `Proyecto "${name}" eliminado`,
    projects_toast_delete_error: "Error eliminando el proyecto",
    projects_toast_meta_error_parse: "Error al procesar los activos de Meta",
    projects_toast_meta_saved: "Activos de Meta guardados correctamente",
    projects_token_expired: "Token expirado — Reconectar",
    projects_token_expires_in: (days: number) =>
      `Token expira en ${days} día${days !== 1 ? "s" : ""}`,

    // ── ProjectCreateDialog ──────────────────────────────────────────────────
    create_dialog_title: "Nuevo Proyecto",
    create_dialog_name_label: "Nombre",
    create_dialog_name_placeholder: "Ej: Mas que Fútbol",
    create_dialog_slug_label: "Slug",
    create_dialog_slug_placeholder: "ej: mas-que-futbol",
    create_dialog_slug_hint: "Identificador único — se usa en las URLs. Solo letras, números y guiones.",
    create_dialog_lang_label: "Idioma del contenido",
    create_dialog_lang_es: "Español",
    create_dialog_lang_en: "English",
    create_dialog_cancel: "Cancelar",
    create_dialog_creating: "Creando...",
    create_dialog_submit: "Crear Proyecto",
    create_dialog_error_default: "Error creando el proyecto",

    // ── ProjectFormDialog ─────────────────────────────────────────────────────
    form_dialog_title: "Configurar proyecto",
    form_dialog_tab_content: "Contenido",
    form_dialog_tab_audience: "Audiencia",
    form_dialog_tab_platforms: "Plataformas",
    form_dialog_tab_brand: "Marca y Visual",

    // Tab 1 — Content
    form_tone_label: "Tono de voz",
    form_tone_placeholder: "Ej: Técnico, directo, elegante. Confrontacional pero inteligente.",
    form_core_message_label: "Mensaje central de marca",
    form_core_message_placeholder: "Ej: AI no reemplaza developers. Reemplaza developers promedio.",
    form_additional_rules_label: "Reglas adicionales",
    form_additional_rules_hint: "(una por línea)",
    form_additional_rules_placeholder:
      "El slide 1 debe hacer que alguien pare de scrollear\nCada slide debe tener UNA sola idea clara",

    // Tab 2 — Audience
    form_target_audience_label: "Audiencia objetivo",
    form_target_audience_placeholder:
      "Ej: Developers 22-32 años, 0-5 años experiencia, que sienten que el AI los puede dejar atrás",
    form_content_categories_label: "Categorías de contenido",
    form_content_categories_hint: "(una por línea)",
    form_content_categories_placeholder:
      "Confrontación estratégica — desafiar suposiciones cómodas\nErrores comunes de juniors",

    // Tab 3 — Platforms
    form_fb_page_id_label: "Facebook Page ID",
    form_fb_page_id_placeholder: "Ej: 1010286398835015",
    form_ig_account_id_label: "Instagram Account ID",
    form_ig_account_id_placeholder: "Ej: 17841449394293930",
    form_ad_account_id_label: "Ad Account ID",
    form_ad_account_id_placeholder: "Ej: act_1337773745049119",
    form_ad_account_hint: "Se completa automáticamente al conectar Meta Account",
    form_meta_account_label: "Meta Account",
    form_meta_connected: "Conectado",
    form_meta_token_expires: "Token expira:",
    form_meta_reconnect: "Reconectar",
    form_meta_connect_description:
      "Conectá tu cuenta de Meta para publicar en Instagram y Facebook directamente desde el dashboard.",
    form_meta_connect_btn: "Conectar Meta Account",

    // Tab 4 — Brand & Visual
    form_brand_colors_label: "Colores de marca",
    form_color_primary: "Color primario",
    form_color_secondary: "Color secundario",
    form_color_bg: "Fondo",
    form_color_preview_title: "Vista previa de colores",
    form_visual_style_label: "Estilo visual",
    form_image_mood_label: "Mood de imagen",
    form_image_mood_placeholder: "Ej: oscuro, premium, tecnológico, sin caras, tipografía bold",
    form_fonts_label: "Tipografías",
    form_fonts_placeholder: "Ej: Inter Bold, Space Grotesk, Bebas Neue",
    form_competitors_label: "Competidores",
    form_business_objective_label: "Objetivo de negocio",
    form_target_platforms_label: "Plataformas objetivo",
    form_posting_frequency_label: "Frecuencia de publicación",

    // Visual style options
    vs_typographic: "Tipográfico dark — texto bold sobre fondo oscuro",
    vs_photorealistic: "Fotorrealista — fotos reales, personas, productos",
    vs_illustration: "Ilustración — vectores, iconos, colores planos",
    vs_minimal: "Minimalista — mucho espacio en blanco, tipografía simple",
    vs_data_visual: "Data/Stats — números grandes, gráficos, infografías",

    // Business objective options
    bo_generate_leads: "Generar leads — capturar emails o contactos",
    bo_sell_product: "Vender producto — conversiones directas",
    bo_build_community: "Construir comunidad — engagement y seguidores",
    bo_brand_positioning: "Posicionamiento de marca — awareness y autoridad",

    // Posting frequency options
    pf_daily: "Diario",
    pf_3_4x_week: "3-4 veces por semana",
    pf_1_2x_week: "1-2 veces por semana",
    pf_on_demand: "Solo cuando hay novedad",

    // Footer buttons
    form_cancel: "Cancelar",
    form_save: "Guardar cambios",
    form_saving: "Guardando...",
    form_error_default: "Error guardando el proyecto",

    // ── MetaAssetSelectModal ──────────────────────────────────────────────────
    meta_modal_title: "Seleccionar activos de Meta",
    meta_modal_subtitle:
      "Encontramos múltiples cuentas vinculadas. Elegí cuál usar para este proyecto.",
    meta_modal_label_pages: "Facebook Pages",
    meta_modal_label_instagram: "Cuentas de Instagram",
    meta_modal_label_ad_accounts: "Cuentas publicitarias",
    meta_modal_cancel: "Cancelar",
    meta_modal_save: "Guardar",
    meta_modal_saving: "Guardando...",
    meta_modal_error_default: "Error al guardar",
  },
} as const;

// ── Context ───────────────────────────────────────────────────────────────────

const LanguageContext = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({
  lang: "en",
  setLang: () => {},
});

// ── Provider ──────────────────────────────────────────────────────────────────

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    const stored = localStorage.getItem("lang") as Lang | null;
    if (stored === "es" || stored === "en") setLangState(stored);
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem("lang", l);
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang }}>
      {children}
    </LanguageContext.Provider>
  );
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useT() {
  const { lang } = useContext(LanguageContext);
  return translations[lang];
}

export function useLang() {
  return useContext(LanguageContext);
}

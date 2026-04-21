"use client";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { X, Loader2, ChevronRight, LayoutGrid } from "lucide-react";
import { createProject } from "@/lib/api";
import { useT } from "@/lib/i18n";

interface Project {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  content_config?: Record<string, unknown>;
  facebook_page_id?: string | null;
  meta_token_expires_at?: string | null;
}

interface Template {
  id: string;
  name: string;
  description: string;
  content_config: Record<string, unknown>;
}

interface Props {
  onClose: () => void;
  onSuccess: (project: Project) => void;
}

function toSlug(name: string) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function ProjectCreateDialog({ onClose, onSuccess }: Props) {
  const t = useT();
  const { data: session } = useSession();

  // Step: "template" (pick template first) or "form" (fill in details)
  const [step, setStep] = useState<"template" | "form">("template");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [loadingTemplates, setLoadingTemplates] = useState(true);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManual, setSlugManual] = useState(false);
  const [language, setLanguage] = useState("es");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
    fetch(`${api}/api/v1/projects/templates`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setTemplates(Array.isArray(data) ? data : []))
      .catch(() => setTemplates([]))
      .finally(() => setLoadingTemplates(false));
  }, []);

  const handleNameChange = (val: string) => {
    setName(val);
    if (!slugManual) setSlug(toSlug(val));
  };

  const handleSlugChange = (val: string) => {
    setSlug(val);
    setSlugManual(true);
  };

  const handleSelectTemplate = (tmpl: Template | null) => {
    setSelectedTemplate(tmpl);
    setStep("form");
  };

  const handleCreate = async () => {
    if (!name.trim() || !slug.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const token = (session as any)?.accessToken as string | undefined;
      const baseConfig: Record<string, unknown> = {
        language,
        brand_name: name.trim(),
      };
      // Merge template content_config (template values as defaults, user can override later)
      const contentConfig = selectedTemplate
        ? { ...selectedTemplate.content_config, ...baseConfig }
        : baseConfig;

      const project = await createProject(token, {
        name: name.trim(),
        slug: slug.trim(),
        content_config: contentConfig,
      });
      onSuccess(project);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.create_dialog_error_default);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.7)" }}>
      <div className="w-full max-w-lg rounded-xl shadow-xl" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>

        {/* ── STEP 1: Template selector ── */}
        {step === "template" && (
          <div className="p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">{t.create_dialog_title}</h2>
                <p className="text-xs mt-0.5" style={{ color: "#9ca3af" }}>Choose a template to pre-fill your project settings</p>
              </div>
              <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>

            {loadingTemplates ? (
              <div className="flex items-center justify-center h-32 text-sm" style={{ color: "#9ca3af" }}>
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading templates…
              </div>
            ) : (
              <div className="space-y-2">
                {templates.map((tmpl) => (
                  <button
                    key={tmpl.id}
                    type="button"
                    onClick={() => handleSelectTemplate(tmpl)}
                    className="w-full text-left flex items-center justify-between px-4 py-3 rounded-lg transition-colors"
                    style={{ backgroundColor: "#1a1a1a", border: "1px solid #333333" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#7c3aed"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#333333"; }}
                  >
                    <div>
                      <p className="text-sm font-medium text-white">{tmpl.name}</p>
                      <p className="text-xs mt-0.5" style={{ color: "#9ca3af" }}>{tmpl.description}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 flex-shrink-0 ml-3" style={{ color: "#9ca3af" }} />
                  </button>
                ))}

                {/* Start from scratch */}
                <button
                  type="button"
                  onClick={() => handleSelectTemplate(null)}
                  className="w-full text-left flex items-center justify-between px-4 py-3 rounded-lg transition-colors"
                  style={{ backgroundColor: "transparent", border: "1px solid #333333" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#555555"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#333333"; }}
                >
                  <div className="flex items-center gap-2">
                    <LayoutGrid className="h-4 w-4" style={{ color: "#9ca3af" }} />
                    <p className="text-sm font-medium" style={{ color: "#9ca3af" }}>Start from scratch</p>
                  </div>
                  <ChevronRight className="h-4 w-4 flex-shrink-0 ml-3" style={{ color: "#6b7280" }} />
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── STEP 2: Project details form ── */}
        {step === "form" && (
          <div className="p-6 space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">{t.create_dialog_title}</h2>
                {selectedTemplate && (
                  <p className="text-xs mt-0.5" style={{ color: "#7c3aed" }}>
                    Template: {selectedTemplate.name}
                  </p>
                )}
              </div>
              <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Back to templates */}
            <button
              type="button"
              onClick={() => setStep("template")}
              className="text-xs flex items-center gap-1 transition-colors"
              style={{ color: "#9ca3af" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#ffffff"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; }}
            >
              ← Change template
            </button>

            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-white mb-1">
                {t.create_dialog_name_label} <span className="text-red-400">*</span>
              </label>
              <input
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                style={inputStyle}
                placeholder={t.create_dialog_name_placeholder}
                autoFocus
              />
            </div>

            {/* Slug */}
            <div>
              <label className="block text-sm font-medium text-white mb-1">
                {t.create_dialog_slug_label} <span className="text-red-400">*</span>
              </label>
              <input
                value={slug}
                onChange={(e) => handleSlugChange(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed] font-mono"
                style={inputStyle}
                placeholder={t.create_dialog_slug_placeholder}
              />
              <p className="text-xs mt-1" style={{ color: "#6b7280" }}>{t.create_dialog_slug_hint}</p>
            </div>

            {/* Language */}
            <div>
              <label className="block text-sm font-medium text-white mb-2">{t.create_dialog_lang_label}</label>
              <div className="flex gap-3">
                {[{ value: "es", label: t.create_dialog_lang_es }, { value: "en", label: t.create_dialog_lang_en }].map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setLanguage(value)}
                    className="flex-1 py-2 rounded-lg text-sm font-medium transition-colors"
                    style={
                      language === value
                        ? { backgroundColor: "#7c3aed", color: "#ffffff", border: "1px solid #7c3aed" }
                        : { backgroundColor: "#1a1a1a", color: "#9ca3af", border: "1px solid #333333" }
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <button
                onClick={onClose}
                className="flex-1 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{ backgroundColor: "#1a1a1a", color: "#9ca3af", border: "1px solid #333333" }}
              >
                {t.create_dialog_cancel}
              </button>
              <button
                onClick={handleCreate}
                disabled={loading || !name.trim() || !slug.trim()}
                className="flex-1 py-2 rounded-lg text-sm font-medium text-white flex items-center justify-center gap-2 transition-opacity disabled:opacity-50"
                style={{ backgroundColor: "#7c3aed" }}
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {loading ? t.create_dialog_creating : t.create_dialog_submit}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

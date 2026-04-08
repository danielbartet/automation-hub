"use client";
import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import { createProject } from "@/lib/api";

interface Project {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  content_config?: Record<string, unknown>;
  facebook_page_id?: string | null;
  meta_token_expires_at?: string | null;
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
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManual, setSlugManual] = useState(false);
  const [language, setLanguage] = useState("es");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleNameChange = (val: string) => {
    setName(val);
    if (!slugManual) setSlug(toSlug(val));
  };

  const handleSlugChange = (val: string) => {
    setSlug(val);
    setSlugManual(true);
  };

  const handleCreate = async () => {
    if (!name.trim() || !slug.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const project = await createProject({
        name: name.trim(),
        slug: slug.trim(),
        content_config: { language, brand_name: name.trim() },
      });
      onSuccess(project);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error creando el proyecto");
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
      <div className="w-full max-w-md rounded-xl p-6 space-y-5" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Nuevo Proyecto</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-white mb-1">Nombre <span className="text-red-400">*</span></label>
          <input
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
            style={inputStyle}
            placeholder="Ej: Mas que Fútbol"
            autoFocus
          />
        </div>

        {/* Slug */}
        <div>
          <label className="block text-sm font-medium text-white mb-1">Slug <span className="text-red-400">*</span></label>
          <input
            value={slug}
            onChange={(e) => handleSlugChange(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed] font-mono"
            style={inputStyle}
            placeholder="ej: mas-que-futbol"
          />
          <p className="text-xs mt-1" style={{ color: "#6b7280" }}>Identificador único — se usa en las URLs. Solo letras, números y guiones.</p>
        </div>

        {/* Language */}
        <div>
          <label className="block text-sm font-medium text-white mb-2">Idioma del contenido</label>
          <div className="flex gap-3">
            {[{ value: "es", label: "Español" }, { value: "en", label: "English" }].map(({ value, label }) => (
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

        {error && (
          <p className="text-sm text-red-400">{error}</p>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{ backgroundColor: "#1a1a1a", color: "#9ca3af", border: "1px solid #333333" }}
          >
            Cancelar
          </button>
          <button
            onClick={handleCreate}
            disabled={loading || !name.trim() || !slug.trim()}
            className="flex-1 py-2 rounded-lg text-sm font-medium text-white flex items-center justify-center gap-2 transition-opacity disabled:opacity-50"
            style={{ backgroundColor: "#7c3aed" }}
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? "Creando..." : "Crear Proyecto"}
          </button>
        </div>
      </div>
    </div>
  );
}

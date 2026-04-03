"use client";

import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { X, Loader2, Upload, CheckCircle2, Clock } from "lucide-react";
import type { Audience } from "@/app/(protected)/dashboard/ads/audiences/page";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export interface CreateAudienceModalProps {
  open: boolean;
  onClose: () => void;
  projectSlug: string;
  onCreated?: (audience: Audience) => void;
  defaultTab?: "website" | "customer_list" | "engagement" | "lookalike";
}

type Tab = "website" | "customer_list" | "engagement" | "lookalike";

const TAB_LABELS: Record<Tab, string> = {
  website: "Visitantes del sitio",
  customer_list: "Lista de clientes",
  engagement: "Interacciones Instagram",
  lookalike: "Lookalike",
};

const TABS: Tab[] = ["website", "customer_list", "engagement", "lookalike"];

const RETENTION_OPTIONS = [7, 14, 30, 60, 90, 180];
const ENGAGEMENT_RETENTION_OPTIONS = [30, 60, 90, 180, 365];
const LOOKALIKE_PERCENTS = [1, 2, 5];
const COUNTRIES = [
  { code: "AR", label: "Argentina" },
  { code: "MX", label: "México" },
  { code: "CO", label: "Colombia" },
  { code: "CL", label: "Chile" },
  { code: "PE", label: "Perú" },
  { code: "ES", label: "España" },
  { code: "US", label: "Estados Unidos" },
  { code: "BR", label: "Brasil" },
];

const WEBSITE_EVENTS = [
  { value: "PageView", label: "Visitas" },
  { value: "Lead", label: "Leads" },
  { value: "Purchase", label: "Compras" },
  { value: "ViewContent", label: "Ver producto" },
];

const ENGAGEMENT_TYPES = [
  { value: "ALL", label: "Todos" },
  { value: "VIDEO_WATCHERS", label: "Solo videos" },
  { value: "POST_SAVERS", label: "Solo guardados" },
  { value: "PROFILE_VISITORS", label: "Solo visitas al perfil" },
];

export function CreateAudienceModal({
  open,
  onClose,
  projectSlug,
  onCreated,
  defaultTab = "website",
}: CreateAudienceModalProps) {
  const { data: session } = useSession();
  const token = (session as { accessToken?: string } | null)?.accessToken ?? "";

  const [activeTab, setActiveTab] = useState<Tab>(defaultTab);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [createdAudience, setCreatedAudience] = useState<Audience | null>(null);

  // Shared
  const [name, setName] = useState("");

  // Website tab
  const [retention, setRetention] = useState(30);
  const [event, setEvent] = useState("PageView");

  // Customer list tab
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Engagement tab
  const [engPlatform, setEngPlatform] = useState<"Instagram" | "Facebook">("Instagram");
  const [engRetention, setEngRetention] = useState(30);
  const [engType, setEngType] = useState("ALL");

  // Lookalike tab
  const [lookalikePct, setLookalikePct] = useState(1);
  const [lookalikeCountries, setLookalikeCountries] = useState<string[]>(["AR"]);
  const [baseAudienceId, setBaseAudienceId] = useState<string>("");
  const [baseAudiences, setBaseAudiences] = useState<Audience[]>([]);
  const [loadingBase, setLoadingBase] = useState(false);

  const handleClose = () => {
    if (createdAudience) {
      onCreated?.(createdAudience);
    }
    onClose();
  };

  // Reset state on open/tab change
  useEffect(() => {
    if (open) {
      setActiveTab(defaultTab);
      setError(null);
      setSuccess(false);
      setCreatedAudience(null);
      setName("");
      setCsvFile(null);
    }
  }, [open, defaultTab]);

  useEffect(() => {
    setError(null);
  }, [activeTab]);

  // Load base audiences for lookalike tab
  useEffect(() => {
    if (activeTab !== "lookalike" || !token || !projectSlug) return;
    setLoadingBase(true);
    fetch(`${API_BASE}/api/v1/audiences/${projectSlug}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((data) => {
        const list: Audience[] = Array.isArray(data) ? data : (data.items ?? []);
        // Only non-lookalike audiences as base
        const eligible = list.filter((a) => a.type !== "lookalike" && a.status === "ready");
        setBaseAudiences(eligible);
        if (eligible.length > 0) setBaseAudienceId(String(eligible[0].id));
      })
      .catch(() => {})
      .finally(() => setLoadingBase(false));
  }, [activeTab, token, projectSlug]);

  const toggleCountry = (code: string) => {
    setLookalikeCountries((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) setCsvFile(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setCsvFile(file);
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError("El nombre es obligatorio");
      return;
    }
    setLoading(true);
    setError(null);

    try {
      let res: Response;

      if (activeTab === "website") {
        res = await fetch(`${API_BASE}/api/v1/audiences/${projectSlug}/website`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ name, retention_days: retention, event_type: event }),
        });
      } else if (activeTab === "customer_list") {
        if (!csvFile) {
          setError("Seleccioná un archivo CSV");
          setLoading(false);
          return;
        }
        const form = new FormData();
        form.append("name", name);
        form.append("file", csvFile);
        res = await fetch(`${API_BASE}/api/v1/audiences/${projectSlug}/customer-list`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });
      } else if (activeTab === "engagement") {
        res = await fetch(`${API_BASE}/api/v1/audiences/${projectSlug}/engagement`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name,
            platform: engPlatform,
            retention_days: engRetention,
            engagement_type: engType,
          }),
        });
      } else {
        // lookalike
        if (!baseAudienceId) {
          setError("Seleccioná una audiencia base");
          setLoading(false);
          return;
        }
        if (lookalikeCountries.length === 0) {
          setError("Seleccioná al menos un país");
          setLoading(false);
          return;
        }
        res = await fetch(`${API_BASE}/api/v1/audiences/${projectSlug}/lookalike`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name,
            source_audience_id: Number(baseAudienceId),
            similarity_pct: lookalikePct,
            countries: lookalikeCountries,
          }),
        });
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const detail = (errData as { detail?: unknown }).detail;
        const message =
          typeof detail === "string"
            ? detail
            : Array.isArray(detail)
            ? detail.map((d: { msg?: string }) => d.msg ?? JSON.stringify(d)).join(", ")
            : "Error al crear audiencia";
        throw new Error(message);
      }

      const newAudience: Audience = await res.json();
      setCreatedAudience(newAudience);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear audiencia");
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  const submitLabel: Record<Tab, string> = {
    website: "Crear audiencia",
    customer_list: "Crear y subir",
    engagement: "Crear audiencia",
    lookalike: "Crear lookalike",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.7)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        className="relative w-full max-w-lg mx-4 rounded-xl shadow-2xl overflow-hidden"
        style={{ backgroundColor: "#111111", border: "1px solid #222222" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: "1px solid #222222" }}
        >
          <h2 className="text-base font-semibold text-white">Nueva audiencia</h2>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-md transition-colors"
            style={{ color: "#9ca3af" }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1a1a1a";
              (e.currentTarget as HTMLButtonElement).style.color = "#ffffff";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent";
              (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af";
            }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div
          className="flex overflow-x-auto"
          style={{ borderBottom: "1px solid #222222", backgroundColor: "#0d0d0d" }}
        >
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="px-4 py-3 text-xs font-medium whitespace-nowrap transition-colors flex-shrink-0"
              style={
                activeTab === tab
                  ? {
                      color: "#7c3aed",
                      borderBottom: "2px solid #7c3aed",
                    }
                  : { color: "#6b7280" }
              }
              onMouseEnter={(e) => {
                if (activeTab !== tab)
                  (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af";
              }}
              onMouseLeave={(e) => {
                if (activeTab !== tab)
                  (e.currentTarget as HTMLButtonElement).style.color = "#6b7280";
              }}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
          {success ? (
            <div className="space-y-4 py-2">
              <div className="flex flex-col items-center text-center gap-2">
                <div className="rounded-full p-3" style={{ backgroundColor: "rgba(34,197,94,0.15)" }}>
                  <CheckCircle2 className="h-8 w-8" style={{ color: "#4ade80" }} />
                </div>
                <h3 className="font-semibold text-lg text-white">Audiencia creada correctamente</h3>
              </div>

              <div className="rounded-md p-4 text-sm space-y-1" style={{ backgroundColor: "#1a1a1a", border: "1px solid #333333", color: "#9ca3af" }}>
                <div className="flex items-start gap-2">
                  <Clock className="h-4 w-4 mt-0.5 shrink-0 text-yellow-500" />
                  <div>
                    <p className="font-medium" style={{ color: "#d1d5db" }}>Meta está construyendo tu audiencia</p>
                    <p className="mt-0.5">Esto toma entre 24 y 48 horas. Podés verla en el panel de Audiencias — aparecerá como &quot;Procesando&quot; y cambiará a &quot;Lista&quot; cuando esté disponible para usar en campañas.</p>
                  </div>
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-2">
                <a
                  href="/dashboard/ads/audiences"
                  className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
                  style={{ border: "1px solid #333333", color: "#9ca3af" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.color = "#ffffff"; (e.currentTarget as HTMLAnchorElement).style.backgroundColor = "#1a1a1a"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.color = "#9ca3af"; (e.currentTarget as HTMLAnchorElement).style.backgroundColor = "transparent"; }}
                >
                  Ir a Audiencias
                </a>
                <button
                  onClick={handleClose}
                  className="px-4 py-1.5 text-xs font-medium rounded-lg text-white transition-colors"
                  style={{ backgroundColor: "#7c3aed" }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#6d28d9")}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#7c3aed")}
                >
                  Cerrar
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Name field — common to all tabs */}
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: "#9ca3af" }}>
                  Nombre <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej: Visitantes últimos 30 días"
                  className="w-full text-sm rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                  style={{
                    backgroundColor: "#1a1a1a",
                    border: "1px solid #333333",
                    color: "#ffffff",
                  }}
                />
              </div>

              {/* Tab-specific fields */}
              {activeTab === "website" && (
                <>
                  <div>
                    <label
                      className="block text-xs font-medium mb-2"
                      style={{ color: "#9ca3af" }}
                    >
                      Retención
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {RETENTION_OPTIONS.map((d) => (
                        <button
                          key={d}
                          onClick={() => setRetention(d)}
                          className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                          style={
                            retention === d
                              ? { backgroundColor: "#7c3aed", color: "#ffffff" }
                              : {
                                  backgroundColor: "#1a1a1a",
                                  border: "1px solid #333333",
                                  color: "#9ca3af",
                                }
                          }
                        >
                          {d} días
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label
                      className="block text-xs font-medium mb-1.5"
                      style={{ color: "#9ca3af" }}
                    >
                      Evento
                    </label>
                    <select
                      value={event}
                      onChange={(e) => setEvent(e.target.value)}
                      className="w-full text-sm rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                      style={{
                        backgroundColor: "#1a1a1a",
                        border: "1px solid #333333",
                        color: "#ffffff",
                      }}
                    >
                      {WEBSITE_EVENTS.map((ev) => (
                        <option key={ev.value} value={ev.value}>
                          {ev.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {activeTab === "customer_list" && (
                <>
                  <div>
                    <label
                      className="block text-xs font-medium mb-1.5"
                      style={{ color: "#9ca3af" }}
                    >
                      Archivo CSV <span className="text-red-400">*</span>
                    </label>
                    <div
                      className="rounded-lg p-6 text-center cursor-pointer transition-colors"
                      style={{
                        border: isDragging
                          ? "2px dashed #7c3aed"
                          : "2px dashed #333333",
                        backgroundColor: isDragging ? "rgba(124,58,237,0.05)" : "#1a1a1a",
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setIsDragging(true);
                      }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {csvFile ? (
                        <div className="flex items-center justify-center gap-2">
                          <Upload className="h-4 w-4 text-green-400" />
                          <span className="text-sm text-green-400 font-medium">{csvFile.name}</span>
                        </div>
                      ) : (
                        <>
                          <Upload className="h-6 w-6 mx-auto mb-2" style={{ color: "#6b7280" }} />
                          <p className="text-sm" style={{ color: "#9ca3af" }}>
                            Arrastrá tu archivo CSV aquí
                          </p>
                          <p className="text-xs mt-1" style={{ color: "#6b7280" }}>
                            o hacé clic para seleccionar
                          </p>
                        </>
                      )}
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv"
                      className="hidden"
                      onChange={handleFileInput}
                    />
                    <p className="text-xs mt-2" style={{ color: "#6b7280" }}>
                      El CSV debe tener una columna &quot;email&quot;
                    </p>
                  </div>
                  {loading && (
                    <p className="text-xs text-center" style={{ color: "#9ca3af" }}>
                      Subiendo y procesando...
                    </p>
                  )}
                </>
              )}

              {activeTab === "engagement" && (
                <>
                  <div>
                    <label
                      className="block text-xs font-medium mb-2"
                      style={{ color: "#9ca3af" }}
                    >
                      Plataforma
                    </label>
                    <div className="flex gap-2">
                      {(["Instagram", "Facebook"] as const).map((p) => (
                        <button
                          key={p}
                          onClick={() => setEngPlatform(p)}
                          className="px-4 py-1.5 rounded-md text-xs font-medium transition-colors"
                          style={
                            engPlatform === p
                              ? { backgroundColor: "#7c3aed", color: "#ffffff" }
                              : {
                                  backgroundColor: "#1a1a1a",
                                  border: "1px solid #333333",
                                  color: "#9ca3af",
                                }
                          }
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label
                      className="block text-xs font-medium mb-2"
                      style={{ color: "#9ca3af" }}
                    >
                      Retención
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {ENGAGEMENT_RETENTION_OPTIONS.map((d) => (
                        <button
                          key={d}
                          onClick={() => setEngRetention(d)}
                          className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                          style={
                            engRetention === d
                              ? { backgroundColor: "#7c3aed", color: "#ffffff" }
                              : {
                                  backgroundColor: "#1a1a1a",
                                  border: "1px solid #333333",
                                  color: "#9ca3af",
                                }
                          }
                        >
                          {d} días
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label
                      className="block text-xs font-medium mb-1.5"
                      style={{ color: "#9ca3af" }}
                    >
                      Tipo de interacción
                    </label>
                    <select
                      value={engType}
                      onChange={(e) => setEngType(e.target.value)}
                      className="w-full text-sm rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                      style={{
                        backgroundColor: "#1a1a1a",
                        border: "1px solid #333333",
                        color: "#ffffff",
                      }}
                    >
                      {ENGAGEMENT_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {activeTab === "lookalike" && (
                <>
                  <div>
                    <label
                      className="block text-xs font-medium mb-1.5"
                      style={{ color: "#9ca3af" }}
                    >
                      Audiencia base <span className="text-red-400">*</span>
                    </label>
                    {loadingBase ? (
                      <div className="flex items-center gap-2 text-sm" style={{ color: "#9ca3af" }}>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Cargando audiencias...
                      </div>
                    ) : baseAudiences.length === 0 ? (
                      <p className="text-xs" style={{ color: "#6b7280" }}>
                        No hay audiencias listas para usar como base. Creá primero una audiencia de
                        visitantes, lista de clientes o interacciones.
                      </p>
                    ) : (
                      <select
                        value={baseAudienceId}
                        onChange={(e) => setBaseAudienceId(e.target.value)}
                        className="w-full text-sm rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#7c3aed]"
                        style={{
                          backgroundColor: "#1a1a1a",
                          border: "1px solid #333333",
                          color: "#ffffff",
                        }}
                      >
                        {baseAudiences.map((a) => (
                          <option key={a.id} value={String(a.id)}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div>
                    <label
                      className="block text-xs font-medium mb-2"
                      style={{ color: "#9ca3af" }}
                    >
                      Similitud
                    </label>
                    <div className="flex gap-2">
                      {LOOKALIKE_PERCENTS.map((pct) => (
                        <button
                          key={pct}
                          onClick={() => setLookalikePct(pct)}
                          className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                          style={
                            lookalikePct === pct
                              ? { backgroundColor: "#7c3aed", color: "#ffffff" }
                              : {
                                  backgroundColor: "#1a1a1a",
                                  border: "1px solid #333333",
                                  color: "#9ca3af",
                                }
                          }
                        >
                          {pct}%
                          {pct === 1
                            ? " (Más similar)"
                            : pct === 5
                            ? " (Más amplia)"
                            : ""}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label
                      className="block text-xs font-medium mb-2"
                      style={{ color: "#9ca3af" }}
                    >
                      Países
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {COUNTRIES.map((c) => (
                        <button
                          key={c.code}
                          onClick={() => toggleCountry(c.code)}
                          className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                          style={
                            lookalikeCountries.includes(c.code)
                              ? { backgroundColor: "#7c3aed", color: "#ffffff" }
                              : {
                                  backgroundColor: "#1a1a1a",
                                  border: "1px solid #333333",
                                  color: "#9ca3af",
                                }
                          }
                        >
                          {c.code}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* Error message */}
              {error && (
                <div
                  className="rounded-md p-3 text-xs text-red-400"
                  style={{ backgroundColor: "#450a0a", border: "1px solid #7f1d1d" }}
                >
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!success && (
          <div
            className="flex items-center justify-end gap-3 px-6 py-4"
            style={{ borderTop: "1px solid #222222" }}
          >
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium rounded-lg transition-colors"
              style={{ color: "#9ca3af" }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = "#ffffff";
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1a1a1a";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af";
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent";
              }}
            >
              Cancelar
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              style={{ backgroundColor: "#7c3aed" }}
              onMouseEnter={(e) => {
                if (!(e.currentTarget as HTMLButtonElement).disabled)
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#6d28d9";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#7c3aed";
              }}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {activeTab === "customer_list" ? "Subiendo y procesando..." : "Creando..."}
                </>
              ) : (
                submitLabel[activeTab]
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

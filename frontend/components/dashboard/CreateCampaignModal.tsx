"use client";
import { useState, useEffect } from "react";
import { X, Loader2, ChevronRight, ChevronLeft, Check, RefreshCw, Sparkles } from "lucide-react";
import { ImageUploadZone } from "./ImageUploadZone";
import { ConceptsGrid } from "./ConceptsGrid";
import { createCampaign, fetchProjectPosts, generateAdConcepts, createCampaignWithConcepts, AdConcept, DiversityAudit } from "@/lib/api";

interface Post {
  id: number;
  image_url?: string;
  caption?: string;
}

interface CreateCampaignModalProps {
  projectSlug: string;
  projectId: string;
  onClose: () => void;
  onSuccess: () => void;
}

const OBJECTIVES = [
  { value: "OUTCOME_LEADS", label: "Leads", description: "Genera leads y registros" },
  { value: "OUTCOME_SALES", label: "Ventas", description: "Impulsa compras y conversiones" },
  { value: "OUTCOME_TRAFFIC", label: "Tráfico", description: "Envía personas a tu sitio web" },
];

const COUNTRY_OPTIONS = [
  { code: "AR", label: "Argentina" },
  { code: "MX", label: "México" },
  { code: "CO", label: "Colombia" },
  { code: "CL", label: "Chile" },
  { code: "PE", label: "Perú" },
  { code: "ES", label: "España" },
  { code: "US", label: "Estados Unidos" },
  { code: "BR", label: "Brasil" },
];

const STEPS = ["Campaña", "Conceptos", "Creativo", "Lanzar"];

export function CreateCampaignModal({ projectSlug, projectId, onClose, onSuccess }: CreateCampaignModalProps) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);

  // Step 1
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("OUTCOME_LEADS");
  const [budget, setBudget] = useState(10);
  const [countries, setCountries] = useState<string[]>(["AR", "MX", "CO", "CL"]);

  // Step 2 — Concepts
  const [generatingConcepts, setGeneratingConcepts] = useState(false);
  const [concepts, setConcepts] = useState<AdConcept[]>([]);
  const [diversityAudit, setDiversityAudit] = useState<DiversityAudit | null>(null);
  const [approvedIds, setApprovedIds] = useState<Set<number>>(new Set());
  const [conceptsError, setConceptsError] = useState<string | null>(null);

  // Step 3 — Creative assets
  const [imageUrl, setImageUrl] = useState("");
  const [imageSource, setImageSource] = useState<"posts" | "upload">("posts");
  const [adCopy, setAdCopy] = useState("");
  const [destinationUrl, setDestinationUrl] = useState("");

  // Step 3 — Per-concept image upload (Andromeda mode)
  const [conceptImageTabs, setConceptImageTabs] = useState<Record<number, "ai" | "upload">>({});
  const [conceptUploadedImages, setConceptUploadedImages] = useState<Record<number, string>>({});

  const getConceptTab = (id: number) => conceptImageTabs[id] ?? "ai";
  const setConceptTab = (id: number, tab: "ai" | "upload") =>
    setConceptImageTabs(prev => ({ ...prev, [id]: tab }));
  const setConceptImage = (id: number, url: string) =>
    setConceptUploadedImages(prev => ({ ...prev, [id]: url }));

  useEffect(() => {
    fetchProjectPosts(projectId)
      .then((data: Post[]) => setPosts(Array.isArray(data) ? data.filter(p => p.image_url) : []))
      .catch(() => {});
  }, [projectId]);

  const toggleCountry = (code: string) => {
    setCountries(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);
  };

  const toggleConcept = (id: number) => {
    setApprovedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleGenerateConcepts = async () => {
    setGeneratingConcepts(true);
    setConceptsError(null);
    try {
      const result = await generateAdConcepts(projectSlug, {
        campaign_objective: objective,
        count: 12,
      });
      setConcepts(result.concepts);
      setDiversityAudit(result.diversity_audit);
      // Approve all by default
      setApprovedIds(new Set(result.concepts.map(c => c.id)));
    } catch (e) {
      setConceptsError(e instanceof Error ? e.message : "Error generando conceptos");
    } finally {
      setGeneratingConcepts(false);
    }
  };

  const approvedConcepts = concepts.filter(c => approvedIds.has(c.id));

  const handleCreate = async () => {
    setLoading(true);
    setError(null);
    try {
      if (approvedConcepts.length >= 6) {
        // Andromeda multi-concept path
        await createCampaignWithConcepts(projectSlug, {
          name,
          objective,
          daily_budget: budget,
          countries,
          destination_url: destinationUrl,
          concepts: approvedConcepts.map(c => ({
            id: c.id,
            hook_3s: c.hook_3s,
            body: c.body,
            cta: c.cta,
            format: c.format,
            image_url: conceptUploadedImages[c.id] || undefined,
          })),
        });
      } else {
        // Legacy single-creative path
        await createCampaign(projectSlug, {
          name,
          objective,
          daily_budget: budget,
          countries,
          image_url: imageUrl,
          ad_copy: adCopy,
          destination_url: destinationUrl,
        });
      }
      onSuccess();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error creando campaña");
    } finally {
      setLoading(false);
    }
  };

  const canProceedStep1 = name.trim() && budget >= 10 && countries.length > 0;
  const canProceedStep2 = concepts.length === 0 || approvedConcepts.length >= 6;
  const canProceedStep3 = approvedConcepts.length >= 6
    ? destinationUrl.trim().length > 0
    : imageUrl && adCopy.trim() && destinationUrl.trim();

  const selectedObjective = OBJECTIVES.find(o => o.value === objective);

  // Andromeda checklist for step 4
  const uniqueAngles = new Set(approvedConcepts.map(c => c.psychological_angle));
  const uniqueFormats = new Set(approvedConcepts.map(c => c.format));
  const checklist = [
    {
      label: `Mínimo 6 creativos aprobados (${approvedConcepts.length} aprobados)`,
      ok: approvedConcepts.length >= 6,
    },
    { label: "Broad targeting habilitado", ok: true },
    { label: "Advantage+ habilitado", ok: true },
    { label: "CBO habilitado", ok: true },
    {
      label: `Diversidad de ángulos (mínimo 3 únicos — ${uniqueAngles.size} detectados)`,
      ok: uniqueAngles.size >= 3,
    },
    {
      label: `Diversidad de formatos (mínimo 2 únicos — ${uniqueFormats.size} detectados)`,
      ok: approvedConcepts.length === 0 || uniqueFormats.size >= 2,
    },
  ];
  const allChecklistOk = checklist.every(c => c.ok);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
        {/* Header */}
        <div className="flex items-center justify-between p-6" style={{ borderBottom: "1px solid #222222" }}>
          <div>
            <h2 className="text-lg font-semibold text-white">Crear Campaña</h2>
            <p className="text-sm" style={{ color: "#9ca3af" }}>Paso {step} de {STEPS.length}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-md transition-colors" style={{ color: "#9ca3af" }} onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#1f1f1f")} onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}>
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Progress tabs */}
        <div className="flex" style={{ borderBottom: "1px solid #222222" }}>
          {STEPS.map((label, i) => (
            <div
              key={i}
              className="flex-1 py-2 text-center text-xs font-medium transition-colors"
              style={{
                backgroundColor: step === i + 1 ? "#7c3aed" : step > i + 1 ? "#1a1a1a" : "transparent",
                color: step === i + 1 ? "#ffffff" : step > i + 1 ? "#9ca3af" : "#6b7280",
              }}
            >
              {step > i + 1 ? <Check className="h-3 w-3 inline mr-1" /> : null}
              {label}
            </div>
          ))}
        </div>

        <div className="p-6">
          {error && (
            <div className="mb-4 p-3 rounded-md text-sm text-red-400" style={{ backgroundColor: "#450a0a", border: "1px solid #7f1d1d" }}>
              {error}
            </div>
          )}

          {/* ── PASO 1: Campaña ── */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: "#d1d5db" }}>
                  Nombre de campaña *
                </label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed] text-white placeholder-gray-500"
                  style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}
                  placeholder="ej. Campaña Leads Marzo"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: "#d1d5db" }}>Objetivo *</label>
                <div className="space-y-2">
                  {OBJECTIVES.map(obj => (
                    <button
                      key={obj.value}
                      onClick={() => setObjective(obj.value)}
                      className="w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors"
                      style={{
                        border: objective === obj.value ? "1px solid #7c3aed" : "1px solid #333333",
                        backgroundColor: objective === obj.value ? "rgba(124,58,237,0.1)" : "transparent",
                      }}
                      onMouseEnter={e => { if (objective !== obj.value) (e.currentTarget as HTMLButtonElement).style.borderColor = "#555555"; }}
                      onMouseLeave={e => { if (objective !== obj.value) (e.currentTarget as HTMLButtonElement).style.borderColor = "#333333"; }}
                    >
                      <div
                        className="w-4 h-4 rounded-full border-2 flex-shrink-0"
                        style={{
                          borderColor: objective === obj.value ? "#7c3aed" : "#555555",
                          backgroundColor: objective === obj.value ? "#7c3aed" : "transparent",
                        }}
                      />
                      <div>
                        <p className="text-sm font-medium text-white">{obj.label}</p>
                        <p className="text-xs" style={{ color: "#9ca3af" }}>{obj.description}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: "#d1d5db" }}>
                  Presupuesto diario (USD) *
                </label>
                <div className="flex items-center gap-2">
                  <span style={{ color: "#9ca3af" }}>$</span>
                  <input
                    type="number"
                    min={10}
                    step={1}
                    value={budget}
                    onChange={e => setBudget(Number(e.target.value))}
                    className="w-32 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed] text-white"
                    style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}
                  />
                  <span className="text-xs" style={{ color: "#9ca3af" }}>mín $10/día</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: "#d1d5db" }}>
                  Países objetivo *
                </label>
                <div className="flex flex-wrap gap-2">
                  {COUNTRY_OPTIONS.map(({ code, label }) => (
                    <button
                      key={code}
                      onClick={() => toggleCountry(code)}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors"
                      style={{
                        backgroundColor: countries.includes(code) ? "#7c3aed" : "transparent",
                        color: countries.includes(code) ? "#ffffff" : "#9ca3af",
                        border: countries.includes(code) ? "1px solid #7c3aed" : "1px solid #333333",
                      }}
                      onMouseEnter={e => { if (!countries.includes(code)) (e.currentTarget as HTMLButtonElement).style.color = "#ffffff"; }}
                      onMouseLeave={e => { if (!countries.includes(code)) (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={() => setStep(2)}
                  disabled={!canProceedStep1}
                  className="flex items-center gap-2 px-5 py-2 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
                  style={{ backgroundColor: "#7c3aed" }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#6d28d9")}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#7c3aed")}
                >
                  Siguiente <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── PASO 2: Generar conceptos ── */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-white mb-1">
                  Conceptos Andromeda
                </h3>
                <p className="text-xs mb-4" style={{ color: "#9ca3af" }}>
                  Genera 12 conceptos únicos con diversidad de ángulos, formatos y P.D.A. para maximizar el alcance del algoritmo.
                </p>

                {concepts.length === 0 ? (
                  <button
                    onClick={handleGenerateConcepts}
                    disabled={generatingConcepts}
                    className="w-full flex items-center justify-center gap-2 px-5 py-3 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
                    style={{ backgroundColor: "#7c3aed" }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#6d28d9")}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#7c3aed")}
                  >
                    {generatingConcepts ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Generando 12 conceptos únicos...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        Generar conceptos con IA
                      </>
                    )}
                  </button>
                ) : (
                  <>
                    <ConceptsGrid
                      concepts={concepts}
                      diversityAudit={diversityAudit!}
                      approvedIds={approvedIds}
                      onToggle={toggleConcept}
                    />
                    <button
                      onClick={handleGenerateConcepts}
                      disabled={generatingConcepts}
                      className="mt-3 flex items-center gap-2 px-4 py-2 text-sm rounded-lg disabled:opacity-50 transition-colors"
                      style={{ border: "1px solid #333333", color: "#9ca3af" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#ffffff"; (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1a1a1a"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}
                    >
                      {generatingConcepts ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                      Regenerar conceptos
                    </button>
                  </>
                )}

                {conceptsError && (
                  <div className="mt-3 p-3 rounded-md text-sm text-red-400" style={{ backgroundColor: "#450a0a", border: "1px solid #7f1d1d" }}>
                    {conceptsError}
                  </div>
                )}
              </div>

              <div className="flex gap-3 justify-between pt-2">
                <button
                  onClick={() => setStep(1)}
                  className="flex items-center gap-1 px-4 py-2 text-sm rounded-lg transition-colors"
                  style={{ border: "1px solid #333333", color: "#9ca3af" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#ffffff"; (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1a1a1a"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}
                >
                  <ChevronLeft className="h-4 w-4" /> Atrás
                </button>
                <button
                  onClick={() => setStep(3)}
                  disabled={!canProceedStep2}
                  className="flex items-center gap-2 px-5 py-2 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
                  style={{ backgroundColor: "#7c3aed" }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#6d28d9")}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#7c3aed")}
                >
                  Siguiente <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── PASO 3: Creativo ── */}
          {step === 3 && (
            <div className="space-y-5">
              {approvedConcepts.length >= 6 ? (
                /* Andromeda mode: per-concept image upload + destination URL */
                <div className="space-y-5">
                  <div className="p-3 rounded-lg text-xs" style={{ backgroundColor: "rgba(124,58,237,0.1)", border: "1px solid rgba(124,58,237,0.3)", color: "#c4b5fd" }}>
                    <strong>{approvedConcepts.length} conceptos aprobados.</strong> Podés subir una imagen por concepto o dejar que se genere automáticamente.
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1" style={{ color: "#d1d5db" }}>
                      URL de destino *
                    </label>
                    <input
                      value={destinationUrl}
                      onChange={e => setDestinationUrl(e.target.value)}
                      type="url"
                      className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed] text-white placeholder-gray-500"
                      style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}
                      placeholder="https://tusitio.com/landing"
                    />
                  </div>

                  <div>
                    <p className="text-sm font-medium mb-3" style={{ color: "#d1d5db" }}>Imágenes por concepto (opcional)</p>
                    <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-1">
                      {approvedConcepts.map(concept => (
                        <div key={concept.id} className="rounded-xl p-3" style={{ border: "1px solid #222222" }}>
                          <p className="text-xs font-semibold mb-2 line-clamp-1 text-white">{concept.hook_3s}</p>
                          <div className="flex gap-1 mb-3">
                            {(["ai", "upload"] as const).map(tab => (
                              <button
                                key={tab}
                                type="button"
                                onClick={() => setConceptTab(concept.id, tab)}
                                className="px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors"
                                style={{
                                  backgroundColor: getConceptTab(concept.id) === tab ? "#7c3aed" : "transparent",
                                  color: getConceptTab(concept.id) === tab ? "#ffffff" : "#9ca3af",
                                  border: getConceptTab(concept.id) === tab ? "1px solid #7c3aed" : "1px solid #333333",
                                }}
                              >
                                {tab === "ai" ? "Generar con IA" : "Subir imagen"}
                              </button>
                            ))}
                          </div>
                          {getConceptTab(concept.id) === "ai" ? (
                            <p className="text-xs py-2" style={{ color: "#9ca3af" }}>La imagen se generará automáticamente al lanzar la campaña.</p>
                          ) : (
                            <div>
                              {conceptUploadedImages[concept.id] ? (
                                <div className="flex items-center gap-3">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={conceptUploadedImages[concept.id]}
                                    alt="preview"
                                    className="h-16 w-16 object-cover rounded-lg"
                                    style={{ border: "1px solid #333333" }}
                                  />
                                  <div className="flex-1">
                                    <p className="text-xs text-green-400 font-medium">Imagen cargada</p>
                                    <button
                                      type="button"
                                      onClick={() => setConceptImage(concept.id, "")}
                                      className="text-xs mt-1"
                                      style={{ color: "#9ca3af" }}
                                      onMouseEnter={e => (e.currentTarget.style.color = "#ffffff")}
                                      onMouseLeave={e => (e.currentTarget.style.color = "#9ca3af")}
                                    >
                                      Cambiar imagen
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <ImageUploadZone
                                  projectSlug={projectSlug}
                                  onUpload={(url) => setConceptImage(concept.id, url)}
                                />
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                /* Legacy mode: full creative fields */
                <>
                  <div>
                    <label className="block text-sm font-medium mb-2" style={{ color: "#d1d5db" }}>
                      Imagen del anuncio *
                    </label>
                    <div className="flex gap-2 mb-3">
                      {(["posts", "upload"] as const).map(src => (
                        <button
                          key={src}
                          onClick={() => setImageSource(src)}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors"
                          style={{
                            backgroundColor: imageSource === src ? "#7c3aed" : "transparent",
                            color: imageSource === src ? "#ffffff" : "#9ca3af",
                            border: imageSource === src ? "1px solid #7c3aed" : "1px solid #333333",
                          }}
                        >
                          {src === "posts" ? "Desde posts existentes" : "Subir nueva"}
                        </button>
                      ))}
                    </div>

                    {imageSource === "posts" ? (
                      <div>
                        {posts.length === 0 ? (
                          <p className="text-sm py-4 text-center" style={{ color: "#9ca3af" }}>
                            No se encontraron posts con imagen
                          </p>
                        ) : (
                          <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto">
                            {posts.map(post => (
                              <button
                                key={post.id}
                                onClick={() => setImageUrl(post.image_url!)}
                                className="relative aspect-square rounded-lg overflow-hidden border-2 transition-colors"
                                style={{
                                  borderColor: imageUrl === post.image_url ? "#7c3aed" : "transparent",
                                }}
                                onMouseEnter={e => { if (imageUrl !== post.image_url) (e.currentTarget as HTMLButtonElement).style.borderColor = "#555555"; }}
                                onMouseLeave={e => { if (imageUrl !== post.image_url) (e.currentTarget as HTMLButtonElement).style.borderColor = "transparent"; }}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={post.image_url} alt="" className="w-full h-full object-cover" />
                                {imageUrl === post.image_url && (
                                  <div className="absolute inset-0 bg-[#7c3aed]/40 flex items-center justify-center">
                                    <Check className="h-5 w-5 text-white" />
                                  </div>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                        {imageUrl && imageSource === "posts" && (
                          <p className="text-xs text-green-400 mt-1">Imagen seleccionada</p>
                        )}
                      </div>
                    ) : (
                      <ImageUploadZone
                        projectSlug={projectSlug}
                        onUpload={setImageUrl}
                        currentUrl={imageUrl}
                      />
                    )}
                  </div>

                  <div>
                    <div className="flex justify-between mb-1">
                      <label className="text-sm font-medium" style={{ color: "#d1d5db" }}>Texto del anuncio *</label>
                      <span className={`text-xs ${adCopy.length > 125 ? "text-orange-400" : "text-gray-500"}`}>
                        {adCopy.length} chars
                      </span>
                    </div>
                    <textarea
                      value={adCopy}
                      onChange={e => setAdCopy(e.target.value)}
                      rows={4}
                      className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed] text-white placeholder-gray-500"
                      style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}
                      placeholder="Escribe un copy convincente..."
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1" style={{ color: "#d1d5db" }}>
                      URL de destino *
                    </label>
                    <input
                      value={destinationUrl}
                      onChange={e => setDestinationUrl(e.target.value)}
                      type="url"
                      className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed] text-white placeholder-gray-500"
                      style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}
                      placeholder="https://tusitio.com/landing"
                    />
                  </div>

                  {imageUrl && adCopy && (
                    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #333333" }}>
                      <div className="p-2 flex items-center gap-2" style={{ borderBottom: "1px solid #333333", backgroundColor: "#0d0d0d" }}>
                        <div className="w-6 h-6 rounded-full" style={{ backgroundColor: "#374151" }} />
                        <div>
                          <p className="text-xs font-medium text-white">Tu Página</p>
                          <p className="text-xs" style={{ color: "#9ca3af" }}>Patrocinado</p>
                        </div>
                      </div>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={imageUrl} alt="Vista previa" className="w-full aspect-square object-cover" />
                      <div className="p-3" style={{ backgroundColor: "#0d0d0d" }}>
                        <p className="text-xs line-clamp-3" style={{ color: "#d1d5db" }}>{adCopy}</p>
                        <div className="mt-2 flex items-center justify-between">
                          <div>
                            <p className="text-xs" style={{ color: "#9ca3af" }}>{destinationUrl || "tusitio.com"}</p>
                            <p className="text-xs font-semibold text-white">Más información →</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              <div className="flex gap-3 justify-between pt-2">
                <button
                  onClick={() => setStep(2)}
                  className="flex items-center gap-1 px-4 py-2 text-sm rounded-lg transition-colors"
                  style={{ border: "1px solid #333333", color: "#9ca3af" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#ffffff"; (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1a1a1a"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}
                >
                  <ChevronLeft className="h-4 w-4" /> Atrás
                </button>
                <button
                  onClick={() => setStep(4)}
                  disabled={!canProceedStep3}
                  className="flex items-center gap-2 px-5 py-2 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
                  style={{ backgroundColor: "#7c3aed" }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#6d28d9")}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#7c3aed")}
                >
                  Siguiente <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── PASO 4: Revisar y lanzar ── */}
          {step === 4 && (
            <div className="space-y-4">
              {/* Campaign summary */}
              <div className="rounded-xl p-4 space-y-3 text-sm" style={{ backgroundColor: "#1a1a1a", border: "1px solid #222222" }}>
                <div className="flex justify-between">
                  <span style={{ color: "#9ca3af" }}>Nombre</span>
                  <span className="font-medium text-white">{name}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: "#9ca3af" }}>Objetivo</span>
                  <span className="font-medium text-white">{selectedObjective?.label}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: "#9ca3af" }}>Presupuesto diario</span>
                  <span className="font-medium text-white">${budget}/día</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: "#9ca3af" }}>Países</span>
                  <span className="font-medium text-white">{countries.join(", ")}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: "#9ca3af" }}>Targeting</span>
                  <span className="font-medium text-green-400">Broad (Andromeda)</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: "#9ca3af" }}>Destino</span>
                  <span className="font-medium text-white truncate max-w-[200px]">{destinationUrl}</span>
                </div>
                {approvedConcepts.length >= 6 && (
                  <div className="flex justify-between">
                    <span style={{ color: "#9ca3af" }}>Creativos</span>
                    <span className="font-medium" style={{ color: "#a78bfa" }}>{approvedConcepts.length} conceptos Andromeda</span>
                  </div>
                )}
              </div>

              {/* Andromeda checklist */}
              <div className="rounded-xl p-4 space-y-2" style={{ border: "1px solid #222222" }}>
                <h4 className="text-sm font-semibold text-white mb-3">Checklist Andromeda</h4>
                {checklist.map((item, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <div
                      className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-0.5 ${
                        item.ok ? "bg-green-900/50 text-green-400" : "bg-red-900/50 text-red-400"
                      }`}
                    >
                      {item.ok ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <span className="text-xs font-bold">✗</span>
                      )}
                    </div>
                    <span className={item.ok ? "text-white" : "text-red-400"}>{item.label}</span>
                  </div>
                ))}
              </div>

              {!allChecklistOk && (
                <div className="p-3 rounded-lg text-sm text-red-400" style={{ backgroundColor: "#450a0a", border: "1px solid #7f1d1d" }}>
                  Corrige los items marcados con ✗ para lanzar
                </div>
              )}

              <div className="rounded-lg p-3 text-xs text-yellow-400" style={{ backgroundColor: "#422006", border: "1px solid #78350f" }}>
                La campaña se creará en estado <strong>PAUSADO</strong>. Revisa en Meta Ads Manager y activa cuando estés listo.
              </div>

              <div className="flex gap-3 justify-between pt-2">
                <button
                  onClick={() => setStep(3)}
                  className="flex items-center gap-1 px-4 py-2 text-sm rounded-lg transition-colors"
                  style={{ border: "1px solid #333333", color: "#9ca3af" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#ffffff"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#555555"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#333333"; }}
                >
                  <ChevronLeft className="h-4 w-4" /> Atrás
                </button>
                <button
                  onClick={handleCreate}
                  disabled={loading || !allChecklistOk}
                  className="flex items-center justify-center gap-2 px-6 py-2 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                  style={{ backgroundColor: "#7c3aed" }}
                  onMouseEnter={e => { if (!(e.currentTarget as HTMLButtonElement).disabled) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#6d28d9"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#7c3aed"; }}
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Creando campaña...
                    </>
                  ) : (
                    "Lanzar campaña"
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

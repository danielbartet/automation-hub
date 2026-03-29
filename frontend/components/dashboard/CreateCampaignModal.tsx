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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-lg font-semibold">Crear Campaña</h2>
            <p className="text-sm text-gray-500">Paso {step} de {STEPS.length}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-md">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Progress tabs */}
        <div className="flex border-b">
          {STEPS.map((label, i) => (
            <div
              key={i}
              className={`flex-1 py-2 text-center text-xs font-medium transition-colors ${
                step === i + 1
                  ? "bg-gray-900 text-white"
                  : step > i + 1
                  ? "bg-gray-100 text-gray-600"
                  : "text-gray-400"
              }`}
            >
              {step > i + 1 ? <Check className="h-3 w-3 inline mr-1" /> : null}
              {label}
            </div>
          ))}
        </div>

        <div className="p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
              {error}
            </div>
          )}

          {/* ── PASO 1: Campaña ── */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nombre de campaña *
                </label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                  placeholder="ej. Campaña Leads Marzo"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Objetivo *</label>
                <div className="space-y-2">
                  {OBJECTIVES.map(obj => (
                    <button
                      key={obj.value}
                      onClick={() => setObjective(obj.value)}
                      className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                        objective === obj.value
                          ? "border-gray-900 bg-gray-50"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      <div
                        className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${
                          objective === obj.value ? "border-gray-900 bg-gray-900" : "border-gray-300"
                        }`}
                      />
                      <div>
                        <p className="text-sm font-medium">{obj.label}</p>
                        <p className="text-xs text-gray-500">{obj.description}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Presupuesto diario (USD) *
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">$</span>
                  <input
                    type="number"
                    min={10}
                    step={1}
                    value={budget}
                    onChange={e => setBudget(Number(e.target.value))}
                    className="w-32 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                  />
                  <span className="text-xs text-gray-400">mín $10/día</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Países objetivo *
                </label>
                <div className="flex flex-wrap gap-2">
                  {COUNTRY_OPTIONS.map(({ code, label }) => (
                    <button
                      key={code}
                      onClick={() => toggleCountry(code)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                        countries.includes(code)
                          ? "bg-gray-900 text-white border-gray-900"
                          : "border-gray-200 text-gray-600 hover:bg-gray-50"
                      }`}
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
                  className="flex items-center gap-2 px-5 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 disabled:opacity-50"
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
                <h3 className="text-sm font-semibold text-gray-800 mb-1">
                  Conceptos Andromeda
                </h3>
                <p className="text-xs text-gray-500 mb-4">
                  Genera 12 conceptos únicos con diversidad de ángulos, formatos y P.D.A. para maximizar el alcance del algoritmo.
                </p>

                {concepts.length === 0 ? (
                  <button
                    onClick={handleGenerateConcepts}
                    disabled={generatingConcepts}
                    className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
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
                      className="mt-3 flex items-center gap-2 px-4 py-2 border border-gray-200 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50"
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
                  <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
                    {conceptsError}
                  </div>
                )}
              </div>

              <div className="flex gap-3 justify-between pt-2">
                <button
                  onClick={() => setStep(1)}
                  className="flex items-center gap-1 px-4 py-2 border border-gray-200 text-sm rounded-lg hover:bg-gray-50"
                >
                  <ChevronLeft className="h-4 w-4" /> Atrás
                </button>
                <button
                  onClick={() => setStep(3)}
                  disabled={!canProceedStep2}
                  className="flex items-center gap-2 px-5 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 disabled:opacity-50"
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
                /* Andromeda mode: only need destination URL */
                <div>
                  <div className="mb-4 p-3 bg-purple-50 border border-purple-200 rounded-lg text-xs text-purple-700">
                    <strong>{approvedConcepts.length} conceptos aprobados.</strong> Las imágenes se generarán automáticamente. Solo necesitas la URL de destino.
                  </div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    URL de destino *
                  </label>
                  <input
                    value={destinationUrl}
                    onChange={e => setDestinationUrl(e.target.value)}
                    type="url"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                    placeholder="https://tusitio.com/landing"
                  />
                </div>
              ) : (
                /* Legacy mode: full creative fields */
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Imagen del anuncio *
                    </label>
                    <div className="flex gap-2 mb-3">
                      {(["posts", "upload"] as const).map(src => (
                        <button
                          key={src}
                          onClick={() => setImageSource(src)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                            imageSource === src
                              ? "bg-gray-900 text-white border-gray-900"
                              : "border-gray-200 text-gray-600"
                          }`}
                        >
                          {src === "posts" ? "Desde posts existentes" : "Subir nueva"}
                        </button>
                      ))}
                    </div>

                    {imageSource === "posts" ? (
                      <div>
                        {posts.length === 0 ? (
                          <p className="text-sm text-gray-400 py-4 text-center">
                            No se encontraron posts con imagen
                          </p>
                        ) : (
                          <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto">
                            {posts.map(post => (
                              <button
                                key={post.id}
                                onClick={() => setImageUrl(post.image_url!)}
                                className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-colors ${
                                  imageUrl === post.image_url
                                    ? "border-gray-900"
                                    : "border-transparent hover:border-gray-300"
                                }`}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={post.image_url} alt="" className="w-full h-full object-cover" />
                                {imageUrl === post.image_url && (
                                  <div className="absolute inset-0 bg-gray-900/30 flex items-center justify-center">
                                    <Check className="h-5 w-5 text-white" />
                                  </div>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                        {imageUrl && imageSource === "posts" && (
                          <p className="text-xs text-green-600 mt-1">Imagen seleccionada</p>
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
                      <label className="text-sm font-medium text-gray-700">Texto del anuncio *</label>
                      <span className={`text-xs ${adCopy.length > 125 ? "text-orange-500" : "text-gray-400"}`}>
                        {adCopy.length} chars
                      </span>
                    </div>
                    <textarea
                      value={adCopy}
                      onChange={e => setAdCopy(e.target.value)}
                      rows={4}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                      placeholder="Escribe un copy convincente..."
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      URL de destino *
                    </label>
                    <input
                      value={destinationUrl}
                      onChange={e => setDestinationUrl(e.target.value)}
                      type="url"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                      placeholder="https://tusitio.com/landing"
                    />
                  </div>

                  {imageUrl && adCopy && (
                    <div className="border border-gray-200 rounded-xl overflow-hidden">
                      <div className="p-2 bg-gray-50 border-b flex items-center gap-2">
                        <div className="w-6 h-6 bg-gray-300 rounded-full" />
                        <div>
                          <p className="text-xs font-medium">Tu Página</p>
                          <p className="text-xs text-gray-400">Patrocinado</p>
                        </div>
                      </div>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={imageUrl} alt="Vista previa" className="w-full aspect-square object-cover" />
                      <div className="p-3">
                        <p className="text-xs text-gray-700 line-clamp-3">{adCopy}</p>
                        <div className="mt-2 flex items-center justify-between">
                          <div>
                            <p className="text-xs text-gray-400">{destinationUrl || "tusitio.com"}</p>
                            <p className="text-xs font-semibold text-gray-700">Más información →</p>
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
                  className="flex items-center gap-1 px-4 py-2 border border-gray-200 text-sm rounded-lg hover:bg-gray-50"
                >
                  <ChevronLeft className="h-4 w-4" /> Atrás
                </button>
                <button
                  onClick={() => setStep(4)}
                  disabled={!canProceedStep3}
                  className="flex items-center gap-2 px-5 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 disabled:opacity-50"
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
              <div className="bg-gray-50 rounded-xl p-4 space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Nombre</span>
                  <span className="font-medium">{name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Objetivo</span>
                  <span className="font-medium">{selectedObjective?.label}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Presupuesto diario</span>
                  <span className="font-medium">${budget}/día</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Países</span>
                  <span className="font-medium">{countries.join(", ")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Targeting</span>
                  <span className="font-medium text-green-600">Broad (Andromeda)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Destino</span>
                  <span className="font-medium truncate max-w-[200px]">{destinationUrl}</span>
                </div>
                {approvedConcepts.length >= 6 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Creativos</span>
                    <span className="font-medium text-purple-700">{approvedConcepts.length} conceptos Andromeda</span>
                  </div>
                )}
              </div>

              {/* Andromeda checklist */}
              <div className="border border-gray-200 rounded-xl p-4 space-y-2">
                <h4 className="text-sm font-semibold text-gray-800 mb-3">Checklist Andromeda</h4>
                {checklist.map((item, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <div
                      className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-0.5 ${
                        item.ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                      }`}
                    >
                      {item.ok ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <span className="text-xs font-bold">✗</span>
                      )}
                    </div>
                    <span className={item.ok ? "text-gray-700" : "text-red-700"}>{item.label}</span>
                  </div>
                ))}
              </div>

              {!allChecklistOk && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  Corrige los items marcados con ✗ para lanzar
                </div>
              )}

              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-700">
                La campaña se creará en estado <strong>PAUSADO</strong>. Revisa en Meta Ads Manager y activa cuando estés listo.
              </div>

              <div className="flex gap-3 justify-between pt-2">
                <button
                  onClick={() => setStep(3)}
                  className="flex items-center gap-1 px-4 py-2 border border-gray-200 text-sm rounded-lg hover:bg-gray-50"
                >
                  <ChevronLeft className="h-4 w-4" /> Atrás
                </button>
                <button
                  onClick={handleCreate}
                  disabled={loading || !allChecklistOk}
                  className="flex items-center justify-center gap-2 px-6 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 disabled:opacity-50"
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

"use client";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { X, Loader2, ChevronRight, ChevronLeft, Check, RefreshCw, Sparkles, AlertTriangle, XCircle, Upload } from "lucide-react";
import { ImageUploadZone } from "./ImageUploadZone";
import { ConceptsGrid } from "./ConceptsGrid";
import { CreateAudienceModal } from "./CreateAudienceModal";
import { createCampaign, fetchProjectPosts, generateAdConcepts, createCampaignWithConcepts, fetchAudiences, generateConceptImage, AdConcept, DiversityAudit, InspirationPrefill, MetaRateLimitError } from "@/lib/api";
import { useMetaRateLimit } from "./MetaRateLimitProvider";
import { useT } from "@/lib/i18n";

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
  prefill?: InspirationPrefill;
  contentConfig?: Record<string, unknown>;
  initialContext?: string;
}

// Static placement options (not translated — platform names)
const PLACEMENT_OPTIONS = [
  { value: "instagram_feed", label: "Instagram Feed" },
  { value: "instagram_reels", label: "Instagram Reels" },
  { value: "instagram_stories", label: "Instagram Stories" },
  { value: "facebook_feed", label: "Facebook Feed" },
  { value: "audience_network", label: "Audience Network" },
];

export function CreateCampaignModal({ projectSlug, projectId, onClose, onSuccess, prefill, contentConfig, initialContext }: CreateCampaignModalProps) {
  const t = useT();
  const { data: session } = useSession();
  const token = (session as any)?.accessToken as string | undefined;
  const { triggerRateLimit } = useMetaRateLimit();

  const OBJECTIVES = [
    { value: "OUTCOME_LEADS", label: t.campaign_obj_leads_label, description: t.campaign_obj_leads_desc },
    { value: "OUTCOME_SALES", label: t.campaign_obj_sales_label, description: t.campaign_obj_sales_desc },
    { value: "OUTCOME_TRAFFIC", label: t.campaign_obj_traffic_label, description: t.campaign_obj_traffic_desc },
    { value: "OUTCOME_AWARENESS", label: t.campaign_obj_awareness_label, description: t.campaign_obj_awareness_desc },
  ];

  const PIXEL_EVENTS = [
    { value: "Purchase", label: t.pixel_purchase },
    { value: "Lead", label: t.pixel_lead },
    { value: "AddToCart", label: t.pixel_add_to_cart },
    { value: "ViewContent", label: t.pixel_view_content },
    { value: "CompleteRegistration", label: t.pixel_registration },
  ];

  const AUDIENCE_TYPE_LABELS: Record<string, string> = {
    broad: t.audience_broad,
    custom: t.audience_custom,
    lookalike: t.audience_lookalike,
    retargeting_lookalike: t.audience_retargeting_lookalike,
  };

  const COUNTRY_OPTIONS = [
    { code: "AR", label: t.country_ar },
    { code: "MX", label: t.country_mx },
    { code: "CO", label: t.country_co },
    { code: "CL", label: t.country_cl },
    { code: "PE", label: t.country_pe },
    { code: "ES", label: t.country_es },
    { code: "US", label: t.country_us },
    { code: "BR", label: t.country_br },
  ];

  const STEPS = [
    t.campaign_modal_step_campaign,
    t.campaign_modal_step_concepts,
    t.campaign_modal_step_images,
    t.campaign_modal_step_creative,
    t.campaign_modal_step_launch,
  ];
  const [step, setStep] = useState(1);
  const [prefillActive, setPrefillActive] = useState(!!prefill);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);

  // Step 1
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("OUTCOME_LEADS");
  const [budget, setBudget] = useState(10);
  const [countries, setCountries] = useState<string[]>(["AR", "MX", "CO", "CL"]);
  const [destinationUrlStep1, setDestinationUrlStep1] = useState("");
  // Track which fields were pre-filled from project config
  const [preFilledFields, setPreFilledFields] = useState<Set<string>>(new Set());
  const [pixelEvent, setPixelEvent] = useState("Purchase");
  const [audienceType, setAudienceType] = useState<"broad" | "custom" | "lookalike" | "retargeting_lookalike">("broad");
  const [customAudienceIds, setCustomAudienceIds] = useState<string[]>([]);
  const [lookalikeAudienceIds, setLookalikeAudienceIds] = useState<string[]>([]);
  const [advantagePlacements, setAdvantagePlacements] = useState(true);
  const [placements, setPlacements] = useState<string[]>([]);
  const [audiences, setAudiences] = useState<any[]>([]);
  const [audiencesLoading, setAudiencesLoading] = useState(false);
  const [showCreateAudienceModal, setShowCreateAudienceModal] = useState(false);

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
  const [headline, setHeadline] = useState("");
  const [destinationUrl, setDestinationUrl] = useState("");
  const [additionalContext, setAdditionalContext] = useState(initialContext ?? "");

  // Step 3 — Image review (pre-launch image generation)
  const [conceptImages, setConceptImages] = useState<Record<number, string>>({});
  const [generatingImageFor, setGeneratingImageFor] = useState<number | null>(null);

  // Step 4 — Per-concept image upload (Andromeda mode, legacy)
  const [conceptImageTabs, setConceptImageTabs] = useState<Record<number, "ai" | "upload">>({});
  const [conceptUploadedImages, setConceptUploadedImages] = useState<Record<number, string>>({});

  const getConceptTab = (id: number) => conceptImageTabs[id] ?? "ai";
  const setConceptTab = (id: number, tab: "ai" | "upload") =>
    setConceptImageTabs(prev => ({ ...prev, [id]: tab }));
  const setConceptImage = (id: number, url: string) =>
    setConceptUploadedImages(prev => ({ ...prev, [id]: url }));

  useEffect(() => {
    fetchProjectPosts(projectId, token)
      .then((data: Post[]) => setPosts(Array.isArray(data) ? data.filter(p => p.image_url) : []))
      .catch(() => {});
  }, [projectId, token]);

  // Clear any stale localStorage draft when the modal mounts (fresh open).
  // Drafts were previously restored on mount, causing state to persist across
  // sessions even after logout. We now start clean every time — the draft is
  // still saved during the session so a same-session page navigation won't lose
  // work, but reopening the modal always starts from scratch.
  useEffect(() => {
    try {
      localStorage.removeItem(`ad_concepts_draft_${projectSlug}`);
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Persist concepts draft to localStorage whenever concepts, approvedIds, or conceptImages change
  useEffect(() => {
    if (concepts.length === 0) return;
    try {
      localStorage.setItem(
        `ad_concepts_draft_${projectSlug}`,
        JSON.stringify({ concepts, approvedConcepts: Array.from(approvedIds), conceptImages })
      );
    } catch {}
  }, [concepts, approvedIds, conceptImages, projectSlug]);

  // Apply prefill on mount when provided
  useEffect(() => {
    if (!prefill) return;
    setName(prefill.name);
    const matchedObjective = OBJECTIVES.find(o => o.value === prefill.objective);
    if (matchedObjective) setObjective(matchedObjective.value);
    setAdCopy(prefill.ad_copy);
    if (prefill.headline) setHeadline(prefill.headline);
    setDestinationUrl(prefill.destination_url);
    setDestinationUrlStep1(prefill.destination_url);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pre-fill campaign wizard fields from project content_config
  useEffect(() => {
    if (!contentConfig) return;
    const filled = new Set<string>();

    const rawCountries = contentConfig.target_countries;
    if (rawCountries) {
      const parsed: string[] = Array.isArray(rawCountries)
        ? (rawCountries as string[])
        : String(rawCountries).split(",").map((s: string) => s.trim()).filter(Boolean);
      if (parsed.length > 0) {
        setCountries(parsed);
        filled.add("countries");
      }
    }

    const websiteUrl = contentConfig.website_url || contentConfig.website;
    if (websiteUrl && !destinationUrlStep1) {
      setDestinationUrlStep1(String(websiteUrl));
      filled.add("destinationUrl");
    }

    if (filled.size > 0) {
      setPreFilledFields(filled);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentConfig]);

  // Fetch audiences when audience type changes away from "broad"
  useEffect(() => {
    if (audienceType === "broad" || !token) return;
    setAudiencesLoading(true);
    fetchAudiences(token, projectSlug)
      .then(data => setAudiences(data))
      .catch(() => setAudiences([]))
      .finally(() => setAudiencesLoading(false));
  }, [audienceType, projectSlug, token]);

  const togglePlacement = (value: string) => {
    setPlacements(prev => prev.includes(value) ? prev.filter(p => p !== value) : [...prev, value]);
  };

  const toggleCustomAudience = (id: string) => {
    setCustomAudienceIds(prev => prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]);
  };

  const toggleLookalikeAudience = (id: string) => {
    setLookalikeAudienceIds(prev => prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]);
  };

  const handleGenerateConcepts = async () => {
    setGeneratingConcepts(true);
    setConceptsError(null);
    try {
      const result = await generateAdConcepts(projectSlug, {
        campaign_objective: objective,
        count: 12,
        destination_url: destinationUrlStep1 || undefined,
        audience_type: audienceType,
        pixel_event: objective === "OUTCOME_SALES" ? pixelEvent : undefined,
        inspiration: prefill ? {
          competitor_body: prefill.ad_copy,
          competitor_rationale: prefill.rationale,
        } : undefined,
      }, token);
      setConcepts(result.concepts);
      setDiversityAudit(result.diversity_audit);
      // Approve all by default
      setApprovedIds(new Set(result.concepts.map(c => c.id)));
    } catch (e) {
      setConceptsError(e instanceof Error ? e.message : t.campaign_concepts_error_default);
    } finally {
      setGeneratingConcepts(false);
    }
  };

  const handleRegenerateConcept = async (conceptId: number, excludedHooks: string[]) => {
    const result = await generateAdConcepts(projectSlug, {
      campaign_objective: objective,
      count: 1,
      excluded_hooks: excludedHooks,
      destination_url: destinationUrlStep1 || undefined,
      audience_type: audienceType,
      pixel_event: objective === "OUTCOME_SALES" ? pixelEvent : undefined,
    }, token);
    const newConcept = result.concepts[0];
    if (!newConcept) return;
    const wasApproved = approvedIds.has(conceptId);
    // Replace the old concept in-place, keeping its position stable by reusing the old id
    setConcepts(prev => prev.map(c => c.id === conceptId ? { ...newConcept, id: conceptId } : c));
    if (wasApproved) {
      setApprovedIds(prev => {
        const next = new Set(prev);
        next.add(conceptId);
        return next;
      });
    }
  };

  const approvedConcepts = concepts.filter(c => approvedIds.has(c.id));

  const handleGenerateConceptImage = async (concept: AdConcept) => {
    if (!token) return;
    setGeneratingImageFor(concept.id);
    try {
      const result = await generateConceptImage(token, {
        hook: concept.hook_3s,
        body: concept.body,
        format: concept.format,
        project_slug: projectSlug,
      });
      setConceptImages(prev => ({ ...prev, [concept.id]: result.image_url }));
    } catch {
      // silently fail — user can retry
    } finally {
      setGeneratingImageFor(null);
    }
  };

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
          destination_url: destinationUrl || destinationUrlStep1 || undefined,
          pixel_event: objective === "OUTCOME_SALES" ? pixelEvent : undefined,
          audience_type: audienceType,
          custom_audience_ids: customAudienceIds,
          lookalike_audience_ids: lookalikeAudienceIds,
          placements,
          advantage_placements: advantagePlacements,
          concepts: approvedConcepts.map(c => ({
            id: c.id,
            hook_3s: c.hook_3s,
            body: c.body,
            cta: c.cta,
            format: c.format,
            image_url: conceptImages[c.id] || conceptUploadedImages[c.id] || undefined,
          })),
        }, token);
      } else {
        // Legacy single-creative path
        await createCampaign(projectSlug, {
          name,
          objective,
          daily_budget: budget,
          countries,
          image_url: imageUrl,
          ad_copy: adCopy,
          headline: headline || undefined,
          destination_url: destinationUrl || destinationUrlStep1 || undefined,
          pixel_event: objective === "OUTCOME_SALES" ? pixelEvent : undefined,
          audience_type: audienceType,
          custom_audience_ids: customAudienceIds,
          lookalike_audience_ids: lookalikeAudienceIds,
          placements,
          advantage_placements: advantagePlacements,
        }, token);
      }
      localStorage.removeItem(`ad_concepts_draft_${projectSlug}`);
      onSuccess();
      onClose();
    } catch (e) {
      if (e instanceof MetaRateLimitError) {
        triggerRateLimit(e.detail);
      } else {
        setError(e instanceof Error ? e.message : t.campaign_create_error_default);
      }
    } finally {
      setLoading(false);
    }
  };

  const needsDestinationUrl = objective === "OUTCOME_SALES" || objective === "OUTCOME_TRAFFIC";
  const destinationUrlValid = !needsDestinationUrl || (destinationUrlStep1.startsWith("https://") && destinationUrlStep1.length > 8);
  const audienceValid =
    audienceType === "broad" ||
    (audienceType === "custom" && customAudienceIds.length > 0) ||
    (audienceType === "lookalike" && lookalikeAudienceIds.length > 0) ||
    (audienceType === "retargeting_lookalike" && customAudienceIds.length > 0 && lookalikeAudienceIds.length > 0);
  const canProceedStep1 = name.trim() && budget >= 10 && countries.length > 0 && destinationUrlValid && audienceValid;
  const canProceedStep2 = concepts.length === 0 || approvedConcepts.length >= 6;
  // Step 3 (image review): all approved concepts must have images (minimum 6)
  const canProceedStep3 = approvedConcepts.length >= 6
    ? approvedConcepts.filter(c => conceptImages[c.id]).length >= 6
    : true; // if not in Andromeda mode, skip this requirement
  const canProceedStep4 = approvedConcepts.length >= 6
    ? destinationUrl.trim().length > 0
    : imageUrl && adCopy.trim() && destinationUrl.trim();

  const selectedObjective = OBJECTIVES.find(o => o.value === objective);

  // Andromeda checklist for step 5
  const uniqueAngles = new Set(approvedConcepts.map(c => c.psychological_angle));
  const uniqueFormats = new Set(approvedConcepts.map(c => c.format));
  const effectiveDestUrl = destinationUrl || destinationUrlStep1;
  const conceptsWithImages = approvedConcepts.filter(c => conceptImages[c.id]).length;
  const checklist = [
    {
      label: t.checklist_min_creatives(approvedConcepts.length),
      ok: approvedConcepts.length >= 6,
    },
    { label: t.checklist_broad_targeting, ok: true },
    { label: t.checklist_advantage_plus, ok: true },
    { label: t.checklist_cbo, ok: true },
    {
      label: t.checklist_angle_diversity(uniqueAngles.size),
      ok: uniqueAngles.size >= 3,
    },
    {
      label: t.checklist_format_diversity(uniqueFormats.size),
      ok: approvedConcepts.length === 0 || uniqueFormats.size >= 2,
    },
    { label: t.checklist_audience, ok: true },
    {
      label: t.checklist_dest_url(needsDestinationUrl),
      ok: !needsDestinationUrl || (effectiveDestUrl.startsWith("https://") && effectiveDestUrl.length > 8),
    },
    ...(approvedConcepts.length >= 6 ? [{
      label: t.checklist_images(conceptsWithImages, approvedConcepts.length),
      ok: conceptsWithImages >= 6,
    }] : []),
  ];
  const allChecklistOk = checklist.every(c => c.ok);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto" style={{ backgroundColor: "#111111", border: "1px solid #222222" }}>
        {/* Header */}
        <div className="flex items-center justify-between p-6" style={{ borderBottom: "1px solid #222222" }}>
          <div>
            <h2 className="text-lg font-semibold text-white">{t.campaign_modal_title}</h2>
            <p className="text-sm" style={{ color: "#9ca3af" }}>{t.campaign_modal_step(step, STEPS.length)}</p>
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
              {prefill && prefillActive && (
                <div
                  className="flex items-start gap-3 p-3 rounded-lg text-sm"
                  style={{ backgroundColor: "#0c1a3a", border: "1px solid #1d4ed8", color: "#93c5fd" }}
                >
                  <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" style={{ color: "#60a5fa" }} />
                  <span>{t.campaign_prefill_banner}</span>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: "#d1d5db" }}>
                  {t.campaign_name_label}
                </label>
                <input
                  value={name}
                  onChange={e => { setName(e.target.value); setPrefillActive(false); }}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed] text-white placeholder-gray-500"
                  style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}
                  placeholder={t.campaign_name_placeholder}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: "#d1d5db" }}>{t.campaign_objective_label}</label>
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
                  {t.campaign_budget_label}
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
                  <span className="text-xs" style={{ color: "#9ca3af" }}>{t.campaign_budget_min}</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: "#d1d5db" }}>
                  {t.campaign_countries_label}
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
                {preFilledFields.has("countries") && (
                  <p className="text-xs text-gray-400 mt-1">{t.campaign_countries_prefilled}</p>
                )}
              </div>

              {/* Destination URL — shown for OUTCOME_SALES and OUTCOME_TRAFFIC */}
              {(objective === "OUTCOME_SALES" || objective === "OUTCOME_TRAFFIC") && (
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: "#d1d5db" }}>
                    {t.campaign_url_label}
                  </label>
                  <input
                    value={destinationUrlStep1}
                    onChange={e => setDestinationUrlStep1(e.target.value)}
                    type="url"
                    className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed] text-white placeholder-gray-500"
                    style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}
                    placeholder={t.campaign_url_placeholder}
                  />
                  {destinationUrlStep1 && !destinationUrlStep1.startsWith("https://") && (
                    <p className="text-xs mt-1 text-red-400">{t.campaign_url_https_error}</p>
                  )}
                  {preFilledFields.has("destinationUrl") && (
                    <p className="text-xs text-gray-400 mt-1">{t.campaign_url_prefilled}</p>
                  )}
                </div>
              )}

              {/* Pixel Event — shown only for OUTCOME_SALES */}
              {objective === "OUTCOME_SALES" && (
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: "#d1d5db" }}>
                    {t.campaign_pixel_event_label}
                  </label>
                  <select
                    value={pixelEvent}
                    onChange={e => setPixelEvent(e.target.value)}
                    className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed] text-white"
                    style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}
                  >
                    {PIXEL_EVENTS.map(ev => (
                      <option key={ev.value} value={ev.value}>{ev.label}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Audience Type */}
              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: "#d1d5db" }}>
                  {t.campaign_audience_type_label}
                </label>
                <div className="space-y-2">
                  {(["broad", "custom", "lookalike", "retargeting_lookalike"] as const).map(type => (
                    <button
                      key={type}
                      onClick={() => {
                        setAudienceType(type);
                        setCustomAudienceIds([]);
                        setLookalikeAudienceIds([]);
                      }}
                      className="w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors"
                      style={{
                        border: audienceType === type ? "1px solid #7c3aed" : "1px solid #333333",
                        backgroundColor: audienceType === type ? "rgba(124,58,237,0.1)" : "transparent",
                      }}
                      onMouseEnter={e => { if (audienceType !== type) (e.currentTarget as HTMLButtonElement).style.borderColor = "#555555"; }}
                      onMouseLeave={e => { if (audienceType !== type) (e.currentTarget as HTMLButtonElement).style.borderColor = "#333333"; }}
                    >
                      <div
                        className="w-4 h-4 rounded-full border-2 flex-shrink-0"
                        style={{
                          borderColor: audienceType === type ? "#7c3aed" : "#555555",
                          backgroundColor: audienceType === type ? "#7c3aed" : "transparent",
                        }}
                      />
                      <span className="text-sm font-medium text-white">{AUDIENCE_TYPE_LABELS[type]}</span>
                    </button>
                  ))}
                </div>

                {/* Audience sub-selectors */}
                {audienceType !== "broad" && (
                  <div className="mt-3 space-y-3">
                    {audiencesLoading ? (
                      <div className="flex items-center gap-2 text-sm" style={{ color: "#9ca3af" }}>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t.campaign_audiences_loading}
                      </div>
                    ) : audiences.length === 0 ? (
                      <div className="text-sm rounded-md p-3 space-y-1" style={{ border: "1px solid #333333", color: "#9ca3af" }}>
                        <p className="font-medium" style={{ color: "#d1d5db" }}>{t.campaign_audiences_none_title}</p>
                        <p>{t.campaign_audiences_none_desc}</p>
                        <a href="/dashboard/ads/audiences" className="text-xs underline" style={{ color: "#7c3aed" }}>
                          {t.campaign_audiences_go_link}
                        </a>
                      </div>
                    ) : (
                      <>
                        {(() => {
                          const hasReadyAudiences = audiences.some((a: any) => a.status === "ready");
                          return (
                            <>
                              {(audienceType === "custom" || audienceType === "retargeting_lookalike") && (
                                <div>
                                  <p className="text-xs font-medium mb-2" style={{ color: "#d1d5db" }}>
                                    {audienceType === "retargeting_lookalike" ? t.campaign_audience_retargeting_label : t.campaign_audience_select_label}
                                  </p>
                                  <div className="space-y-1 max-h-40 overflow-y-auto">
                                    {audiences.filter((a: any) => a.type !== "lookalike").map((a: any) => {
                                      const isReady = a.status === "ready";
                                      const isProcessing = a.status === "processing";
                                      const isError = a.status === "error";
                                      const isSelected = customAudienceIds.includes(a.meta_audience_id);
                                      return (
                                        <button
                                          key={a.meta_audience_id}
                                          disabled={!isReady}
                                          onClick={() => {
                                            if (!isReady) return;
                                            if (audienceType === "retargeting_lookalike") {
                                              setCustomAudienceIds(prev =>
                                                prev.includes(a.meta_audience_id)
                                                  ? prev.filter(id => id !== a.meta_audience_id)
                                                  : [...prev, a.meta_audience_id]
                                              );
                                            } else {
                                              toggleCustomAudience(a.meta_audience_id);
                                            }
                                          }}
                                          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-xs transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                          style={{
                                            backgroundColor: isSelected ? "rgba(124,58,237,0.15)" : "#1a1a1a",
                                            border: isSelected ? "1px solid #7c3aed" : "1px solid #333333",
                                            color: isReady ? "#d1d5db" : "#6b7280",
                                          }}
                                        >
                                          <div className="w-3 h-3 rounded border flex-shrink-0 flex items-center justify-center"
                                            style={{ borderColor: isSelected ? "#7c3aed" : "#555555", backgroundColor: isSelected ? "#7c3aed" : "transparent" }}>
                                            {isSelected && <Check className="h-2 w-2 text-white" />}
                                          </div>
                                          <span className="flex-1">
                                            {a.name}
                                            {isReady && a.approximate_count ? ` (${a.approximate_count.toLocaleString()} personas)` : ""}
                                            {isProcessing && t.campaign_audience_processing("24-48hs")}
                                            {isError && t.campaign_audience_error}
                                          </span>
                                          {isProcessing && <Loader2 className="h-3 w-3 animate-spin text-yellow-500 flex-shrink-0" />}
                                          {isError && <XCircle className="h-3 w-3 text-red-500 flex-shrink-0" />}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              {(audienceType === "lookalike" || audienceType === "retargeting_lookalike") && (
                                <div>
                                  <p className="text-xs font-medium mb-2" style={{ color: "#d1d5db" }}>
                                    {audienceType === "retargeting_lookalike" ? t.campaign_audience_lookalike_label : t.campaign_audience_lookalike_select_label}
                                  </p>
                                  <div className="space-y-1 max-h-40 overflow-y-auto">
                                    {audiences.filter((a: any) => a.type === "lookalike").map((a: any) => {
                                      const isReady = a.status === "ready";
                                      const isProcessing = a.status === "processing";
                                      const isError = a.status === "error";
                                      const isSelected = lookalikeAudienceIds.includes(a.meta_audience_id);
                                      return (
                                        <button
                                          key={a.meta_audience_id}
                                          disabled={!isReady}
                                          onClick={() => { if (isReady) toggleLookalikeAudience(a.meta_audience_id); }}
                                          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-xs transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                          style={{
                                            backgroundColor: isSelected ? "rgba(124,58,237,0.15)" : "#1a1a1a",
                                            border: isSelected ? "1px solid #7c3aed" : "1px solid #333333",
                                            color: isReady ? "#d1d5db" : "#6b7280",
                                          }}
                                        >
                                          <div className="w-3 h-3 rounded border flex-shrink-0 flex items-center justify-center"
                                            style={{ borderColor: isSelected ? "#7c3aed" : "#555555", backgroundColor: isSelected ? "#7c3aed" : "transparent" }}>
                                            {isSelected && <Check className="h-2 w-2 text-white" />}
                                          </div>
                                          <span className="flex-1">
                                            {a.name}
                                            {isReady && a.approximate_count ? ` (${a.approximate_count.toLocaleString()} personas)` : ""}
                                            {isProcessing && t.campaign_audience_processing("24-48hs")}
                                            {isError && t.campaign_audience_error}
                                          </span>
                                          {isProcessing && <Loader2 className="h-3 w-3 animate-spin text-yellow-500 flex-shrink-0" />}
                                          {isError && <XCircle className="h-3 w-3 text-red-500 flex-shrink-0" />}
                                        </button>
                                      );
                                    })}
                                    {audiences.filter((a: any) => a.type === "lookalike").length === 0 && (
                                      <p className="text-xs py-2" style={{ color: "#9ca3af" }}>{t.campaign_audience_lookalike_empty}</p>
                                    )}
                                  </div>
                                </div>
                              )}

                              {!hasReadyAudiences && (
                                <div className="flex items-start gap-2 rounded-md p-3 text-sm" style={{ backgroundColor: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.3)" }}>
                                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" style={{ color: "#ca8a04" }} />
                                  <div className="space-y-2 flex-1">
                                    <p style={{ color: "#ca8a04" }}>
                                      {t.campaign_audience_not_ready_warning}
                                    </p>
                                    <div>
                                      <a
                                        href="/dashboard/ads/audiences"
                                        className="text-xs font-medium underline"
                                        style={{ color: "#9ca3af" }}
                                      >
                                        {t.campaign_audience_not_ready_link}
                                      </a>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </>
                    )}

                    {audienceType === "retargeting_lookalike" && (
                      <div className="p-2 rounded-lg text-xs" style={{ backgroundColor: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.2)", color: "#c4b5fd" }}>
                        {t.campaign_audience_2adsets}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => setShowCreateAudienceModal(true)}
                      className="text-xs font-medium transition-colors"
                      style={{ color: "#7c3aed" }}
                      onMouseEnter={e => (e.currentTarget.style.color = "#a78bfa")}
                      onMouseLeave={e => (e.currentTarget.style.color = "#7c3aed")}
                    >
                      {t.campaign_create_audience_btn}
                    </button>
                  </div>
                )}
              </div>

              {/* Additional context / competitive insight */}
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: "#d1d5db" }}>
                  {t.campaign_additional_context_label}{" "}
                  <span className="font-normal text-xs" style={{ color: "#6b7280" }}>{t.campaign_additional_context_hint}</span>
                </label>
                <textarea
                  value={additionalContext}
                  onChange={e => setAdditionalContext(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed] text-white placeholder-gray-500 resize-none"
                  style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}
                  placeholder={t.campaign_additional_context_placeholder}
                />
                {initialContext && additionalContext === initialContext && (
                  <p className="text-xs mt-1" style={{ color: "#7c3aed" }}>{t.campaign_context_prefilled}</p>
                )}
              </div>

              {/* Placements */}
              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: "#d1d5db" }}>
                  {t.campaign_placements_label}
                </label>
                <div className="flex items-center justify-between p-3 rounded-lg mb-2" style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}>
                  <span className="text-sm text-white">Advantage+ Placements</span>
                  <button
                    type="button"
                    onClick={() => setAdvantagePlacements(prev => !prev)}
                    className="relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors"
                    style={{ backgroundColor: advantagePlacements ? "#7c3aed" : "#374151" }}
                  >
                    <span
                      className="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform"
                      style={{ transform: advantagePlacements ? "translateX(16px)" : "translateX(0)" }}
                    />
                  </button>
                </div>
                {!advantagePlacements && (
                  <div className="space-y-1">
                    {PLACEMENT_OPTIONS.map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => togglePlacement(value)}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-xs transition-colors"
                        style={{
                          backgroundColor: placements.includes(value) ? "rgba(124,58,237,0.15)" : "#1a1a1a",
                          border: placements.includes(value) ? "1px solid #7c3aed" : "1px solid #333333",
                          color: "#d1d5db",
                        }}
                      >
                        <div className="w-3 h-3 rounded border flex-shrink-0 flex items-center justify-center"
                          style={{ borderColor: placements.includes(value) ? "#7c3aed" : "#555555", backgroundColor: placements.includes(value) ? "#7c3aed" : "transparent" }}>
                          {placements.includes(value) && <Check className="h-2 w-2 text-white" />}
                        </div>
                        {label}
                      </button>
                    ))}
                  </div>
                )}
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
                  {t.campaign_next_btn} <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── PASO 2: Generar conceptos ── */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-sm font-semibold text-white">
                    {t.campaign_concepts_title}
                  </h3>
                  {concepts.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        localStorage.removeItem(`ad_concepts_draft_${projectSlug}`);
                        setConcepts([]);
                        setApprovedIds(new Set());
                        setDiversityAudit(null);
                      }}
                      className="text-xs transition-colors"
                      style={{ color: "#6b7280" }}
                      onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")}
                      onMouseLeave={e => (e.currentTarget.style.color = "#6b7280")}
                    >
                      {t.campaign_concepts_clear_draft}
                    </button>
                  )}
                </div>
                <p className="text-xs mb-4" style={{ color: "#9ca3af" }}>
                  {t.campaign_concepts_desc}
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
                        {t.campaign_generating_concepts}
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        {t.campaign_generate_concepts_btn}
                      </>
                    )}
                  </button>
                ) : (
                  <>
                    <ConceptsGrid
                      concepts={concepts}
                      diversityAudit={diversityAudit ?? { angles_covered: [], formats_covered: [], pda_combinations: 0, estimated_unique_entity_ids: 0, warnings: [] }}
                      approvedIds={approvedIds}
                      onToggle={toggleConcept}
                      onRegenerateConcept={handleRegenerateConcept}
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
                      {t.campaign_regenerate_btn}
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
                  <ChevronLeft className="h-4 w-4" /> {t.campaign_back_btn}
                </button>
                <button
                  onClick={() => approvedConcepts.length >= 6 ? setStep(3) : setStep(4)}
                  disabled={!canProceedStep2}
                  className="flex items-center gap-2 px-5 py-2 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
                  style={{ backgroundColor: "#7c3aed" }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#6d28d9")}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#7c3aed")}
                >
                  {t.campaign_next_btn} <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── PASO 3: Revisión de imágenes ── */}
          {step === 3 && approvedConcepts.length >= 6 && (
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-white mb-1">{t.campaign_images_title}</h3>
                <p className="text-xs mb-4" style={{ color: "#9ca3af" }}>
                  {t.campaign_images_desc}
                </p>
                <div className="grid grid-cols-2 gap-3 max-h-[55vh] overflow-y-auto pr-1">
                  {approvedConcepts.map(concept => {
                    const hasImage = !!conceptImages[concept.id];
                    const isGenerating = generatingImageFor === concept.id;
                    return (
                      <div key={concept.id} className="rounded-xl p-3 flex flex-col gap-2" style={{ border: "1px solid #222222", backgroundColor: "#111111" }}>
                        <p className="text-xs font-semibold text-white line-clamp-2">{concept.hook_3s}</p>
                        <p className="text-xs line-clamp-2" style={{ color: "#9ca3af" }}>{concept.body.slice(0, 80)}{concept.body.length > 80 ? "…" : ""}</p>
                        {hasImage ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={conceptImages[concept.id]} className="w-full rounded-lg aspect-square object-cover" alt="concept preview" />
                        ) : (
                          <div
                            className="w-full aspect-square rounded-lg flex items-center justify-center"
                            style={{ border: "2px dashed #333333", backgroundColor: "#1a1a1a" }}
                          >
                            <span className="text-xs" style={{ color: "#6b7280" }}>{t.campaign_image_no_image}</span>
                          </div>
                        )}
                        <div className="flex gap-2 flex-wrap">
                          {!hasImage ? (
                            <button
                              type="button"
                              disabled={isGenerating || generatingImageFor !== null}
                              onClick={() => handleGenerateConceptImage(concept)}
                              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg disabled:opacity-50 transition-colors"
                              style={{ backgroundColor: "#7c3aed", color: "#ffffff" }}
                              onMouseEnter={e => { if (!(e.currentTarget as HTMLButtonElement).disabled) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#6d28d9"; }}
                              onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#7c3aed")}
                            >
                              {isGenerating ? (
                                <><Loader2 className="h-3 w-3 animate-spin" /> {t.campaign_image_generating}</>
                              ) : (
                                <><Sparkles className="h-3 w-3" /> {t.campaign_image_generate_btn}</>
                              )}
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={isGenerating || generatingImageFor !== null}
                              onClick={() => handleGenerateConceptImage(concept)}
                              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg disabled:opacity-50 transition-colors"
                              style={{ border: "1px solid #333333", color: "#9ca3af" }}
                              onMouseEnter={e => { if (!(e.currentTarget as HTMLButtonElement).disabled) { (e.currentTarget as HTMLButtonElement).style.color = "#ffffff"; (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1a1a1a"; } }}
                              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}
                            >
                              {isGenerating ? (
                                <><Loader2 className="h-3 w-3 animate-spin" /> {t.campaign_image_generating}</>
                              ) : (
                                <><RefreshCw className="h-3 w-3" /> {t.campaign_image_regenerate_btn}</>
                              )}
                            </button>
                          )}
                          <label
                            className="flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg cursor-pointer transition-colors"
                            style={{ border: "1px solid #333333", color: "#9ca3af" }}
                            onMouseEnter={e => { (e.currentTarget as HTMLLabelElement).style.color = "#ffffff"; (e.currentTarget as HTMLLabelElement).style.backgroundColor = "#1a1a1a"; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLLabelElement).style.color = "#9ca3af"; (e.currentTarget as HTMLLabelElement).style.backgroundColor = "transparent"; }}
                          >
                            <input
                              type="file"
                              className="hidden"
                              accept="image/jpeg,image/png,image/webp"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                const formData = new FormData();
                                formData.append("file", file);
                                const uploadHeaders: HeadersInit = {};
                                if (token) uploadHeaders["Authorization"] = `Bearer ${token}`;
                                try {
                                  const res = await fetch(
                                    `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/v1/upload/${projectSlug}`,
                                    { method: "POST", body: formData, headers: uploadHeaders }
                                  );
                                  if (res.ok) {
                                    const data = await res.json();
                                    setConceptImages(prev => ({ ...prev, [concept.id]: data.url }));
                                  } else {
                                    const err = await res.json().catch(() => ({}));
                                    console.error("Image upload failed:", (err as { detail?: string }).detail || res.status);
                                  }
                                } catch (err) {
                                  console.error("Image upload error:", err);
                                }
                              }}
                            />
                            <Upload className="h-3 w-3" /> {t.campaign_upload_image}
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {approvedConcepts.filter(c => conceptImages[c.id]).length < 6 && (
                  <p className="text-xs mt-3" style={{ color: "#9ca3af" }}>
                    {t.campaign_images_progress(approvedConcepts.filter(c => conceptImages[c.id]).length, approvedConcepts.length)}
                  </p>
                )}
              </div>

              <div className="flex gap-3 justify-between pt-2">
                <button
                  onClick={() => setStep(2)}
                  className="flex items-center gap-1 px-4 py-2 text-sm rounded-lg transition-colors"
                  style={{ border: "1px solid #333333", color: "#9ca3af" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#ffffff"; (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1a1a1a"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}
                >
                  <ChevronLeft className="h-4 w-4" /> {t.campaign_back_btn}
                </button>
                <button
                  onClick={() => setStep(4)}
                  disabled={!canProceedStep3}
                  className="flex items-center gap-2 px-5 py-2 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
                  style={{ backgroundColor: "#7c3aed" }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#6d28d9")}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#7c3aed")}
                >
                  {t.campaign_next_btn} <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── PASO 4: Creativo ── */}
          {step === 4 && (
            <div className="space-y-5">
              {approvedConcepts.length >= 6 ? (
                /* Andromeda mode: per-concept image upload + destination URL */
                <div className="space-y-5">
                  <div className="p-3 rounded-lg text-xs" style={{ backgroundColor: "rgba(124,58,237,0.1)", border: "1px solid rgba(124,58,237,0.3)", color: "#c4b5fd" }}>
                    {t.campaign_andromeda_concepts_info(approvedConcepts.length)}
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1" style={{ color: "#d1d5db" }}>
                      {t.campaign_url_dest_label}
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
                    <p className="text-sm font-medium mb-3" style={{ color: "#d1d5db" }}>{t.campaign_images_per_concept}</p>
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
                                {tab === "ai" ? t.campaign_generate_ai : t.campaign_upload_image}
                              </button>
                            ))}
                          </div>
                          {getConceptTab(concept.id) === "ai" ? (
                            <p className="text-xs py-2" style={{ color: "#9ca3af" }}>{t.campaign_auto_generate_hint}</p>
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
                                    <p className="text-xs text-green-400 font-medium">{t.campaign_image_loaded}</p>
                                    <button
                                      type="button"
                                      onClick={() => setConceptImage(concept.id, "")}
                                      className="text-xs mt-1"
                                      style={{ color: "#9ca3af" }}
                                      onMouseEnter={e => (e.currentTarget.style.color = "#ffffff")}
                                      onMouseLeave={e => (e.currentTarget.style.color = "#9ca3af")}
                                    >
                                      {t.campaign_image_change}
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <ImageUploadZone
                                  projectSlug={projectSlug}
                                  token={token}
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
                      {t.campaign_ad_image_label}
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
                          {src === "posts" ? t.campaign_from_posts : t.campaign_upload_new}
                        </button>
                      ))}
                    </div>

                    {imageSource === "posts" ? (
                      <div>
                        {posts.length === 0 ? (
                          <p className="text-sm py-4 text-center" style={{ color: "#9ca3af" }}>
                            {t.campaign_no_posts_with_image}
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
                          <p className="text-xs text-green-400 mt-1">{t.campaign_image_selected}</p>
                        )}
                      </div>
                    ) : (
                      <ImageUploadZone
                        projectSlug={projectSlug}
                        token={token}
                        onUpload={setImageUrl}
                        currentUrl={imageUrl}
                      />
                    )}
                  </div>

                  <div>
                    <div className="flex justify-between mb-1">
                      <label className="text-sm font-medium" style={{ color: "#d1d5db" }}>{t.campaign_ad_copy_label}</label>
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
                      placeholder={t.campaign_ad_copy_placeholder}
                    />
                  </div>

                  <div>
                    <div className="flex justify-between mb-1">
                      <label className="text-sm font-medium" style={{ color: "#d1d5db" }}>{t.campaign_headline_label}</label>
                      <span className={`text-xs ${headline.length > 40 ? "text-orange-400" : "text-gray-500"}`}>
                        {headline.length} / 40
                      </span>
                    </div>
                    <input
                      value={headline}
                      onChange={e => setHeadline(e.target.value)}
                      maxLength={40}
                      className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#7c3aed] text-white placeholder-gray-500"
                      style={{ border: "1px solid #333333", backgroundColor: "#1a1a1a" }}
                      placeholder="max 40 chars"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1" style={{ color: "#d1d5db" }}>
                      {t.campaign_url_dest_label}
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
                          <p className="text-xs" style={{ color: "#9ca3af" }}>{t.campaign_sponsor_label}</p>
                        </div>
                      </div>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={imageUrl} alt={t.campaign_preview_alt} className="w-full aspect-square object-cover" />
                      <div className="p-3" style={{ backgroundColor: "#0d0d0d" }}>
                        <p className="text-xs line-clamp-3" style={{ color: "#d1d5db" }}>{adCopy}</p>
                        <div className="mt-2 flex items-center justify-between">
                          <div>
                            <p className="text-xs" style={{ color: "#9ca3af" }}>{destinationUrl || "tusitio.com"}</p>
                            <p className="text-xs font-semibold text-white">{t.campaign_more_info}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              <div className="flex gap-3 justify-between pt-2">
                <button
                  onClick={() => approvedConcepts.length >= 6 ? setStep(3) : setStep(2)}
                  className="flex items-center gap-1 px-4 py-2 text-sm rounded-lg transition-colors"
                  style={{ border: "1px solid #333333", color: "#9ca3af" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#ffffff"; (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#1a1a1a"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; (e.currentTarget as HTMLButtonElement).style.backgroundColor = "transparent"; }}
                >
                  <ChevronLeft className="h-4 w-4" /> {t.campaign_back_btn}
                </button>
                <button
                  onClick={() => setStep(5)}
                  disabled={!canProceedStep4}
                  className="flex items-center gap-2 px-5 py-2 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
                  style={{ backgroundColor: "#7c3aed" }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#6d28d9")}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = "#7c3aed")}
                >
                  {t.campaign_next_btn} <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── PASO 5: Revisar y lanzar ── */}
          {step === 5 && (
            <div className="space-y-4">
              {/* Campaign summary */}
              <div className="rounded-xl p-4 space-y-3 text-sm" style={{ backgroundColor: "#1a1a1a", border: "1px solid #222222" }}>
                <div className="flex justify-between">
                  <span style={{ color: "#9ca3af" }}>{t.campaign_review_name}</span>
                  <span className="font-medium text-white">{name}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: "#9ca3af" }}>{t.campaign_review_objective}</span>
                  <span className="font-medium text-white">{selectedObjective?.label}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: "#9ca3af" }}>{t.campaign_review_budget}</span>
                  <span className="font-medium text-white">${budget}/día</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: "#9ca3af" }}>{t.campaign_review_countries}</span>
                  <span className="font-medium text-white">{countries.join(", ")}</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: "#9ca3af" }}>{t.campaign_review_audience}</span>
                  <span className="font-medium text-white">{AUDIENCE_TYPE_LABELS[audienceType]}</span>
                </div>
                {audienceType === "custom" && customAudienceIds.length > 0 && (
                  <div className="flex justify-between">
                    <span style={{ color: "#9ca3af" }}>{t.campaign_review_custom_audiences}</span>
                    <span className="font-medium text-white">{customAudienceIds.length} seleccionada{customAudienceIds.length > 1 ? "s" : ""}</span>
                  </div>
                )}
                {(audienceType === "lookalike" || audienceType === "retargeting_lookalike") && lookalikeAudienceIds.length > 0 && (
                  <div className="flex justify-between">
                    <span style={{ color: "#9ca3af" }}>{t.campaign_review_lookalike_audiences}</span>
                    <span className="font-medium text-white">{lookalikeAudienceIds.length} seleccionada{lookalikeAudienceIds.length > 1 ? "s" : ""}</span>
                  </div>
                )}
                {audienceType === "retargeting_lookalike" && (
                  <div className="flex justify-between">
                    <span style={{ color: "#9ca3af" }}>{t.campaign_review_adsets}</span>
                    <span className="font-medium" style={{ color: "#a78bfa" }}>{t.campaign_review_adsets_auto}</span>
                  </div>
                )}
                {objective === "OUTCOME_SALES" && (
                  <div className="flex justify-between">
                    <span style={{ color: "#9ca3af" }}>{t.campaign_review_pixel_event}</span>
                    <span className="font-medium text-white">{PIXEL_EVENTS.find(e => e.value === pixelEvent)?.label ?? pixelEvent}</span>
                  </div>
                )}
                {effectiveDestUrl && (
                  <div className="flex justify-between">
                    <span style={{ color: "#9ca3af" }}>{t.campaign_review_url}</span>
                    <span className="font-medium text-white truncate max-w-[200px]">{effectiveDestUrl}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span style={{ color: "#9ca3af" }}>{t.campaign_review_placements}</span>
                  <span className="font-medium text-white">{advantagePlacements ? t.campaign_review_placements_advantage : placements.length > 0 ? t.campaign_review_placements_manual(placements.length) : t.campaign_review_placements_none}</span>
                </div>
                {approvedConcepts.length >= 6 && (
                  <div className="flex justify-between">
                    <span style={{ color: "#9ca3af" }}>{t.campaign_review_creatives}</span>
                    <span className="font-medium" style={{ color: "#a78bfa" }}>{t.campaign_review_andromeda_concepts(approvedConcepts.length)}</span>
                  </div>
                )}
              </div>

              {/* Andromeda checklist */}
              <div className="rounded-xl p-4 space-y-2" style={{ border: "1px solid #222222" }}>
                <h4 className="text-sm font-semibold text-white mb-3">{t.campaign_checklist_title}</h4>
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
                  {t.campaign_checklist_fix_items}
                </div>
              )}

              <div className="rounded-lg p-3 text-xs text-yellow-400" style={{ backgroundColor: "#422006", border: "1px solid #78350f" }}>
                {t.campaign_paused_note}
              </div>

              <div className="flex gap-3 justify-between pt-2">
                <button
                  onClick={() => setStep(4)}
                  className="flex items-center gap-1 px-4 py-2 text-sm rounded-lg transition-colors"
                  style={{ border: "1px solid #333333", color: "#9ca3af" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#ffffff"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#555555"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#9ca3af"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#333333"; }}
                >
                  <ChevronLeft className="h-4 w-4" /> {t.campaign_back_btn}
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
                      {t.campaign_creating}
                    </>
                  ) : (
                    t.campaign_launch_btn
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {showCreateAudienceModal && (
        <CreateAudienceModal
          open={showCreateAudienceModal}
          onClose={() => setShowCreateAudienceModal(false)}
          projectSlug={projectSlug}
          onCreated={(newAudience: any) => {
            setAudiences((prev: any[]) => [...prev, newAudience]);
            if (audienceType === "custom") {
              setCustomAudienceIds(prev => [...prev, newAudience.meta_audience_id]);
            }
            setShowCreateAudienceModal(false);
          }}
        />
      )}
    </div>
  );
}

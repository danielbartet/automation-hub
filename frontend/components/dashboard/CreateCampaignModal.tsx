"use client";
import { useState, useEffect } from "react";
import { X, Loader2, ChevronRight, ChevronLeft, Check } from "lucide-react";
import { ImageUploadZone } from "./ImageUploadZone";
import { createCampaign, fetchProjectPosts } from "@/lib/api";

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
  { value: "OUTCOME_LEADS", label: "Leads", description: "Generate leads and sign-ups" },
  { value: "OUTCOME_SALES", label: "Sales", description: "Drive purchases and conversions" },
  { value: "OUTCOME_TRAFFIC", label: "Traffic", description: "Send people to your website" },
];

const COUNTRY_OPTIONS = [
  { code: "AR", label: "Argentina" },
  { code: "MX", label: "Mexico" },
  { code: "CO", label: "Colombia" },
  { code: "CL", label: "Chile" },
  { code: "PE", label: "Peru" },
  { code: "ES", label: "Spain" },
  { code: "US", label: "United States" },
  { code: "BR", label: "Brazil" },
];

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

  // Step 2
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

  const handleCreate = async () => {
    setLoading(true); setError(null);
    try {
      await createCampaign(projectSlug, {
        name,
        objective,
        daily_budget: budget,
        countries,
        image_url: imageUrl,
        ad_copy: adCopy,
        destination_url: destinationUrl,
      });
      onSuccess();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create campaign");
    } finally {
      setLoading(false);
    }
  };

  const canProceedStep1 = name.trim() && budget >= 10 && countries.length > 0;
  const canProceedStep2 = imageUrl && adCopy.trim() && destinationUrl.trim();

  const selectedObjective = OBJECTIVES.find(o => o.value === objective);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-lg font-semibold">Create Campaign</h2>
            <p className="text-sm text-gray-500">Step {step} of 3</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-md"><X className="h-5 w-5" /></button>
        </div>

        {/* Progress */}
        <div className="flex border-b">
          {["Setup", "Creative", "Confirm"].map((label, i) => (
            <div key={i} className={`flex-1 py-2 text-center text-xs font-medium ${step === i + 1 ? "bg-gray-900 text-white" : step > i + 1 ? "bg-gray-100 text-gray-600" : "text-gray-400"}`}>
              {step > i + 1 ? <Check className="h-3 w-3 inline mr-1" /> : null}{label}
            </div>
          ))}
        </div>

        <div className="p-6">
          {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">{error}</div>}

          {/* STEP 1: Campaign Setup */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Campaign Name *</label>
                <input value={name} onChange={e => setName(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                  placeholder="e.g. Spring Leads Campaign" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Objective *</label>
                <div className="space-y-2">
                  {OBJECTIVES.map(obj => (
                    <button key={obj.value} onClick={() => setObjective(obj.value)}
                      className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${objective === obj.value ? "border-gray-900 bg-gray-50" : "border-gray-200 hover:border-gray-300"}`}>
                      <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${objective === obj.value ? "border-gray-900 bg-gray-900" : "border-gray-300"}`} />
                      <div>
                        <p className="text-sm font-medium">{obj.label}</p>
                        <p className="text-xs text-gray-500">{obj.description}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Daily Budget (USD) *</label>
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">$</span>
                  <input type="number" min={10} step={1} value={budget} onChange={e => setBudget(Number(e.target.value))}
                    className="w-32 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400" />
                  <span className="text-xs text-gray-400">min $10/day</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Target Countries *</label>
                <div className="flex flex-wrap gap-2">
                  {COUNTRY_OPTIONS.map(({ code, label }) => (
                    <button key={code} onClick={() => toggleCountry(code)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${countries.includes(code) ? "bg-gray-900 text-white border-gray-900" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button onClick={() => setStep(2)} disabled={!canProceedStep1}
                  className="flex items-center gap-2 px-5 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 disabled:opacity-50">
                  Next <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: Creative */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Ad Image *</label>
                <div className="flex gap-2 mb-3">
                  {(["posts", "upload"] as const).map(src => (
                    <button key={src} onClick={() => setImageSource(src)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${imageSource === src ? "bg-gray-900 text-white border-gray-900" : "border-gray-200 text-gray-600"}`}>
                      {src === "posts" ? "From Existing Posts" : "Upload New"}
                    </button>
                  ))}
                </div>

                {imageSource === "posts" ? (
                  <div>
                    {posts.length === 0 ? (
                      <p className="text-sm text-gray-400 py-4 text-center">No posts with images found</p>
                    ) : (
                      <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto">
                        {posts.map(post => (
                          <button key={post.id} onClick={() => setImageUrl(post.image_url!)}
                            className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-colors ${imageUrl === post.image_url ? "border-gray-900" : "border-transparent hover:border-gray-300"}`}>
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
                      <p className="text-xs text-green-600 mt-1">Image selected</p>
                    )}
                  </div>
                ) : (
                  <ImageUploadZone projectSlug={projectSlug} onUpload={setImageUrl} currentUrl={imageUrl} />
                )}
              </div>

              <div>
                <div className="flex justify-between mb-1">
                  <label className="text-sm font-medium text-gray-700">Ad Copy *</label>
                  <span className={`text-xs ${adCopy.length > 125 ? "text-orange-500" : "text-gray-400"}`}>{adCopy.length} chars</span>
                </div>
                <textarea value={adCopy} onChange={e => setAdCopy(e.target.value)} rows={4}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                  placeholder="Write compelling ad copy..." />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Destination URL *</label>
                <input value={destinationUrl} onChange={e => setDestinationUrl(e.target.value)}
                  type="url"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                  placeholder="https://yourwebsite.com/landing" />
              </div>

              {/* Preview */}
              {imageUrl && adCopy && (
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <div className="p-2 bg-gray-50 border-b flex items-center gap-2">
                    <div className="w-6 h-6 bg-gray-300 rounded-full" />
                    <div>
                      <p className="text-xs font-medium">Your Page</p>
                      <p className="text-xs text-gray-400">Sponsored</p>
                    </div>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageUrl} alt="Ad preview" className="w-full aspect-square object-cover" />
                  <div className="p-3">
                    <p className="text-xs text-gray-700 line-clamp-3">{adCopy}</p>
                    <div className="mt-2 flex items-center justify-between">
                      <div>
                        <p className="text-xs text-gray-400">{destinationUrl || "yourwebsite.com"}</p>
                        <p className="text-xs font-semibold text-gray-700">Learn More →</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex gap-3 justify-between pt-2">
                <button onClick={() => setStep(1)} className="flex items-center gap-1 px-4 py-2 border border-gray-200 text-sm rounded-lg hover:bg-gray-50">
                  <ChevronLeft className="h-4 w-4" /> Back
                </button>
                <button onClick={() => setStep(3)} disabled={!canProceedStep2}
                  className="flex items-center gap-2 px-5 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 disabled:opacity-50">
                  Next <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: Confirm */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-xl p-4 space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Campaign name</span>
                  <span className="font-medium">{name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Objective</span>
                  <span className="font-medium">{selectedObjective?.label}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Daily budget</span>
                  <span className="font-medium">${budget}/day</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Countries</span>
                  <span className="font-medium">{countries.join(", ")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Targeting</span>
                  <span className="font-medium text-green-600">Broad (Andromeda)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Destination</span>
                  <span className="font-medium truncate max-w-[200px]">{destinationUrl}</span>
                </div>
              </div>

              {imageUrl && (
                <div className="flex gap-3 items-start">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageUrl} alt="" className="w-16 h-16 object-cover rounded-lg flex-shrink-0" />
                  <p className="text-xs text-gray-600 line-clamp-4">{adCopy}</p>
                </div>
              )}

              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-700">
                Campaign will be created in <strong>PAUSED</strong> state. Review in Meta Ads Manager and activate when ready.
              </div>

              <div className="flex gap-3 justify-between pt-2">
                <button onClick={() => setStep(2)} className="flex items-center gap-1 px-4 py-2 border border-gray-200 text-sm rounded-lg hover:bg-gray-50">
                  <ChevronLeft className="h-4 w-4" /> Back
                </button>
                <button onClick={handleCreate} disabled={loading}
                  className="flex items-center justify-center gap-2 px-6 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 disabled:opacity-50">
                  {loading ? <><Loader2 className="h-4 w-4 animate-spin" />Creating...</> : <>Create Campaign</>}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

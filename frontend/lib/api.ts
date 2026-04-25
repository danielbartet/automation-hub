const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ── Meta rate-limit error ───────────────────────────────────────────────────

export interface MetaRateLimitDetail {
  code: "META_RATE_LIMIT";
  buc?: string;
  usage_pct?: number;
  estimated_reset_minutes?: number;
  message?: string;
}

/**
 * Thrown by API helpers when the backend responds 429 with code "META_RATE_LIMIT".
 * Callers should catch this, check `instanceof MetaRateLimitError`, and call
 * `triggerRateLimit(err.detail)` from the MetaRateLimitContext.
 */
export class MetaRateLimitError extends Error {
  detail: MetaRateLimitDetail;
  constructor(detail: MetaRateLimitDetail) {
    super(detail.message ?? "Meta API rate limit reached");
    this.name = "MetaRateLimitError";
    this.detail = detail;
  }
}

// ── Operation rate-limit error (per-user throttle) ─────────────────────────

export interface OperationRateLimitDetail {
  reason: string;
  retry_after_seconds: number;
}

/**
 * Thrown when the backend responds 429 for per-user operation throttling
 * (not a Meta API rate limit).
 */
export class OperationRateLimitError extends Error {
  detail: OperationRateLimitDetail;
  constructor(detail: OperationRateLimitDetail) {
    super(detail.reason ?? "Operation rate limit reached");
    this.name = "OperationRateLimitError";
    this.detail = detail;
  }
}

/**
 * Thrown when the backend responds 409 for a schedule conflict.
 */
export class ScheduleConflictError extends Error {
  constructor() {
    super("Schedule conflict");
    this.name = "ScheduleConflictError";
  }
}

/**
 * Parse a non-ok Response and throw MetaRateLimitError when appropriate,
 * otherwise return the parsed error body for the caller to handle.
 */
async function parseErrorResponse(res: Response): Promise<{ detail?: unknown }> {
  try {
    const body = await res.json();
    if (
      res.status === 429 &&
      body?.detail &&
      typeof body.detail === "object" &&
      body.detail.code === "META_RATE_LIMIT"
    ) {
      throw new MetaRateLimitError(body.detail as MetaRateLimitDetail);
    }
    if (
      res.status === 429 &&
      body?.detail &&
      typeof body.detail === "object" &&
      "retry_after_seconds" in body.detail
    ) {
      throw new OperationRateLimitError(body.detail as OperationRateLimitDetail);
    }
    if (
      res.status === 409 &&
      body?.detail &&
      typeof body.detail === "object" &&
      body.detail.reason === "schedule_conflict"
    ) {
      throw new ScheduleConflictError();
    }
    return body as { detail?: unknown };
  } catch (e) {
    if (
      e instanceof MetaRateLimitError ||
      e instanceof OperationRateLimitError ||
      e instanceof ScheduleConflictError
    ) {
      throw e;
    }
    return {};
  }
}

export async function fetchDashboard(projectSlug: string, token?: string) {
  const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${API_BASE}/api/v1/dashboard/${projectSlug}`, {
    headers,
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to fetch dashboard data");
  return res.json();
}

export async function fetchProjects(token?: string) {
  const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${API_BASE}/api/v1/projects/`, { headers, cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch projects");
  return res.json();
}

export async function fetchProjectBySlug(slug: string, token?: string) {
  const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${API_BASE}/api/v1/projects/${slug}`, { headers, cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch project");
  return res.json();
}

export async function deleteProject(slug: string, token?: string) {
  const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${API_BASE}/api/v1/projects/${slug}`, {
    method: "DELETE",
    headers,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Failed to delete project");
  }
}

export async function createProject(token: string | undefined, data: {
  name: string;
  slug: string;
  content_config?: Record<string, unknown>;
}) {
  const headers: HeadersInit = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const res = await fetch(`${API_BASE}/api/v1/projects/`, {
    method: "POST",
    headers,
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Failed to create project");
  }
  return res.json();
}

export async function updateProject(slug: string, data: {
  name?: string;
  content_config?: Record<string, unknown>;
  media_config?: Record<string, unknown>;
  is_active?: boolean;
  facebook_page_id?: string;
  instagram_account_id?: string;
  ad_account_id?: string;
  n8n_webhook_base_url?: string;
}, token?: string) {
  const res = await fetch(`${API_BASE}/api/v1/projects/${slug}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Failed to update project");
  }
  return res.json();
}

export async function fetchContent(projectSlug: string, token?: string) {
  const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${API_BASE}/api/v1/content/list/${projectSlug}?per_page=100`, { headers, cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch content");
  const data = await res.json();
  // /list/{slug} returns { items: [...], total, page, per_page }
  return Array.isArray(data) ? data : (data.items ?? data);
}

export async function generateContent(
  projectSlug: string,
  body?: {
    content_type?: string;
    category?: string;
    hint?: string;
    image_mode?: string;
    num_slides?: number;
  },
  token?: string
) {
  const res = await fetch(`${API_BASE}/api/v1/content/generate/${projectSlug}`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    await parseErrorResponse(res);
    throw new Error("Failed to generate content");
  }
  return res.json();
}

export async function fetchAds(projectId: string, token?: string) {
  const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${API_BASE}/api/v1/ads/${projectId}`, { headers, cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch ads");
  return res.json();
}

export async function createContentManual(
  projectSlug: string,
  data: {
    topic: string;
    tone?: string;
    content_type?: string;
    image_url?: string;
    video_url?: string;
    image_urls?: string[];
    caption?: string;
    hashtags?: string[];
    scheduled_at?: string;
  },
  token?: string
) {
  const res = await fetch(`${API_BASE}/api/v1/content/create/${projectSlug}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    await parseErrorResponse(res);
    throw new Error("Failed to create content");
  }
  return res.json();
}

export async function updateContent(
  contentId: number,
  data: {
    caption?: string;
    image_url?: string;
    image_urls?: string[];
    video_url?: string;
    hashtags?: string[];
    slides?: unknown[];
    scheduled_at?: string;
    status?: string;
  },
  token?: string
) {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const res = await fetch(`${API_BASE}/api/v1/content/${contentId}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await parseErrorResponse(res);
    throw new Error((err as { detail?: string }).detail || "Failed to update content");
  }
  return res.json();
}

export async function batchGenerateContent(
  projectSlug: string,
  data: {
    period_start: string;
    period_end: string;
    count: number;
    days_of_week: number[];
    publish_time: string;
    content_type?: string;
  },
  token?: string
) {
  const res = await fetch(`${API_BASE}/api/v1/content/batch/${projectSlug}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to batch generate");
  return res.json();
}

export async function fetchContentByDateRange(
  projectSlug: string,
  dateFrom: string,
  dateTo: string,
  token?: string
) {
  const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
  const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${API_BASE}/api/v1/content/list/${projectSlug}?${params}`, {
    headers,
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to fetch content");
  return res.json();
}

export async function createCampaign(projectSlug: string, data: {
  name: string;
  objective: string;
  daily_budget: number;
  countries: string[];
  image_url: string;
  ad_copy: string;
  headline?: string;
  destination_url?: string;
  pixel_event?: string;
  audience_type?: string;
  custom_audience_ids?: string[];
  lookalike_audience_ids?: string[];
  placements?: string[];
  advantage_placements?: boolean;
}, token?: string) {
  const res = await fetch(`${API_BASE}/api/v1/ads/create/${projectSlug}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await parseErrorResponse(res);
    throw new Error((err as { detail?: string }).detail || "Failed to create campaign");
  }
  return res.json();
}

export async function updateCampaignStatus(campaignId: number, status: "active" | "paused", token?: string) {
  const res = await fetch(`${API_BASE}/api/v1/ads/${campaignId}/status`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error("Failed to update campaign status");
  return res.json();
}

export async function optimizeCampaign(campaignId: number, token?: string) {
  const res = await fetch(`${API_BASE}/api/v1/ads/${campaignId}/optimize`, {
    method: "POST",
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  });
  if (!res.ok) throw new Error("Failed to run optimization");
  return res.json();
}

export async function fetchCampaignLogs(campaignId: number, token?: string) {
  const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${API_BASE}/api/v1/ads/${campaignId}/logs`, { headers, cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch logs");
  return res.json();
}

export async function deleteContentPost(postId: number, token: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/v1/content/posts/${postId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("No se pudo eliminar el post");
}

export async function fetchProjectPosts(projectId: string, token?: string) {
  const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${API_BASE}/api/v1/content/${projectId}`, { headers, cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch posts");
  return res.json();
}

// Auth header helper — call this in client components that have session
export function authHeaders(token: string): HeadersInit {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

export async function fetchAudiences(token: string, projectSlug: string) {
  const res = await fetch(`${API_BASE}/api/v1/audiences/${projectSlug}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to fetch audiences");
  const data = await res.json();
  return Array.isArray(data) ? data : (data.items ?? []);
}

// Notifications
export async function fetchNotifications(token: string, page = 1, unreadOnly = false) {
  const params = new URLSearchParams({ page: String(page), unread_only: String(unreadOnly) });
  const res = await fetch(`${API_BASE}/api/v1/notifications?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

export async function fetchUnreadCount(token: string) {
  const res = await fetch(`${API_BASE}/api/v1/notifications/count`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return { unread: 0 };
  return res.json();
}

export async function markNotificationRead(token: string, id: string) {
  await fetch(`${API_BASE}/api/v1/notifications/${id}/read`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function markAllNotificationsRead(token: string) {
  await fetch(`${API_BASE}/api/v1/notifications/read-all`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function approveOptimizerAction(token: string, approvalToken: string) {
  const res = await fetch(`${API_BASE}/api/v1/ads/optimizer/approve`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ approval_token: approvalToken }),
  });
  if (!res.ok) throw new Error("Failed to approve");
  return res.json();
}

export async function rejectOptimizerAction(token: string, approvalToken: string) {
  const res = await fetch(`${API_BASE}/api/v1/ads/optimizer/reject`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ approval_token: approvalToken }),
  });
  if (!res.ok) throw new Error("Failed to reject");
  return res.json();
}

// User management
export async function fetchUsers(token: string) {
  const res = await fetch(`${API_BASE}/api/v1/users`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

export async function createUser(token: string, data: {
  email: string; name: string; password: string;
  role: string; project_ids: number[]; can_approve: boolean;
}) {
  const res = await fetch(`${API_BASE}/api/v1/users`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Failed to create user");
  }
  return res.json();
}

export async function updateUser(token: string, id: string, data: {
  role?: string; is_active?: boolean; project_ids?: number[]; can_approve?: boolean;
}) {
  const res = await fetch(`${API_BASE}/api/v1/users/${id}`, {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update user");
  return res.json();
}

export async function fetchCampaignDetail(token: string, campaignId: string | number, projectSlug?: string, datePreset: string = "last_30d") {
  const params = new URLSearchParams({ date_preset: datePreset })
  if (projectSlug) params.set("project_slug", projectSlug)
  const res = await fetch(`${API_BASE}/api/v1/ads/detail/${campaignId}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error("Failed to fetch campaign detail")
  return res.json()
}

export async function updateCampaignBudget(token: string, campaignId: number, dailyBudget: number) {
  const res = await fetch(`${API_BASE}/api/v1/ads/${campaignId}/budget`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ daily_budget: dailyBudget }),
  })
  return res.json()
}

export async function generateAdConcepts(
  projectSlug: string,
  data: {
    campaign_objective: string;
    count?: number;
    product_description?: string;
    destination_url?: string;
    audience_type?: string;
    pixel_event?: string;
    excluded_hooks?: string[];
    inspiration?: { competitor_body: string; competitor_rationale: string };
  },
  token?: string
): Promise<{
  project_slug: string;
  objective: string;
  concepts: AdConcept[];
  diversity_audit: DiversityAudit;
}> {
  const res = await fetch(`${API_BASE}/api/v1/ads/generate-concepts/${projectSlug}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ count: 12, ...data }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Failed to generate concepts");
  }
  return res.json();
}

export interface AdConcept {
  id: number;
  persona: string;
  desire: string;
  awareness: "Problem-aware" | "Solution-aware" | "Product-aware";
  psychological_angle: "Logical" | "Emotional" | "Social Proof" | "Problem-Solution";
  hook_3s: string;
  body: string;
  cta: string;
  format: "Reels 9:16" | "Feed 1:1" | "Feed 4:5";
  visual_style: string;
  entity_id_risk: "LOW" | "MEDIUM";
  entity_id_reason: string;
}

export interface DiversityAudit {
  angles_covered: string[];
  formats_covered: string[];
  pda_combinations: number;
  estimated_unique_entity_ids: number;
  warnings: string[];
}

export async function createCampaignWithConcepts(
  projectSlug: string,
  data: {
    name: string;
    objective: string;
    daily_budget: number;
    countries: string[];
    destination_url?: string;
    pixel_event?: string;
    audience_type?: string;
    custom_audience_ids?: string[];
    lookalike_audience_ids?: string[];
    placements?: string[];
    advantage_placements?: boolean;
    concepts: Array<{
      id: number;
      hook_3s: string;
      body: string;
      cta: string;
      format: string;
      image_url?: string;
    }>;
  },
  token?: string
) {
  const res = await fetch(`${API_BASE}/api/v1/ads/create/${projectSlug}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await parseErrorResponse(res);
    throw new Error((err as { detail?: string }).detail || "Failed to create campaign");
  }
  return res.json();
}

export async function generateConceptImage(
  token: string,
  params: { hook: string; body: string; format?: string; project_slug: string }
): Promise<{ image_url: string }> {
  const res = await fetch(`${API_BASE}/api/v1/ads/generate-concept-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error("Image generation failed");
  return res.json();
}

export async function generateVideo(contentId: number, token?: string): Promise<{ video_url: string; credits_remaining: number }> {
  const res = await fetch(`${API_BASE}/api/v1/content/${contentId}/generate-video`, {
    method: "POST",
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Failed to generate video");
  }
  return res.json();
}

export async function importCampaigns(projectSlug: string, token?: string): Promise<{
  imported: number
  updated: number
  total: number
  optimizer_ran: number
  campaigns: Array<{
    id: number
    meta_campaign_id: string
    name: string
    objective: string | null
    status: string
    daily_budget: number | null
    action: "imported" | "updated"
  }>
}> {
  const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${API_BASE}/api/v1/ads/import/${projectSlug}`, {
    headers,
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Error al importar campañas de Meta");
  }
  return res.json();
}

export async function importFromMeta(projectSlug: string, token?: string): Promise<{ imported: number; skipped: number; errors: string[]; message: string }> {
  const res = await fetch(`${API_BASE}/api/v1/content/import-from-meta/${projectSlug}`, {
    method: "POST",
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Failed to import from Meta");
  }
  return res.json();
}

export async function retryInstagram(contentId: number, token?: string): Promise<{ success: boolean; instagram_media_id: string }> {
  const res = await fetch(`${API_BASE}/api/v1/content/${contentId}/retry-instagram`, {
    method: "POST",
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Failed to retry Instagram publish");
  }
  return res.json();
}

export async function retryFacebook(contentId: number, token?: string): Promise<{ success: boolean; facebook_post_id: string }> {
  const res = await fetch(`${API_BASE}/api/v1/content/${contentId}/retry-facebook`, {
    method: "POST",
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Failed to retry Facebook publish");
  }
  return res.json();
}

export async function rerenderSlide(
  contentId: number,
  slideIndex: number,
  token?: string
): Promise<{ image_url: string; slide_index: number }> {
  const res = await fetch(`${API_BASE}/api/v1/content/${contentId}/rerender-slide`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ slide_index: slideIndex }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Failed to re-render slide");
  }
  return res.json();
}

export async function generateImage(
  contentId: number,
  body: {
    prompt?: string;
    style?: string;
    aspect_ratio?: string;
    color_palette?: string;
  },
  token?: string
): Promise<{ image_url: string; credits_remaining: number }> {
  const res = await fetch(`${API_BASE}/api/v1/content/${contentId}/generate-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Failed to generate image");
  }
  return res.json();
}

export async function refreshCreative(
  token: string,
  campaignId: number,
  data: {
    ad_id: string;
    image_url: string;
    headline: string;
    body: string;
    approval_token: string;
  }
): Promise<{ success: boolean; new_creative_id: string }> {
  const res = await fetch(`${API_BASE}/api/v1/ads/${campaignId}/refresh-creative`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Failed to refresh creative");
  }
  return res.json();
}

// ── Health Monitor Types ──────────────────────────────────────────────────────

export interface CampaignHealth {
  name: string;
  status: string;
  daily_budget: string;
  spend_7d: string;
  impressions_7d: number;
}

export interface ProjectHealth {
  project_id: number;
  project_name: string;
  last_updated: string;
  cache_age_seconds?: number;
  is_stale: boolean;
  health_color: "green" | "yellow" | "red";
  error?: string;
  ad_account: {
    status: string;
    status_label: string;
    status_color: string;
    disable_reason: string | null;
    spend_lifetime: string;
    ads_disapproved_7d: number;
  };
  campaigns: CampaignHealth[];
  token: {
    is_valid: boolean;
    expires_at: string | null;
    days_remaining: number | null;
    color: string;
  };
  organic: {
    facebook_page: { name: string; is_published: boolean } | null;
    instagram: { username: string; media_count: number } | null;
  };
}

// ── Health Monitor API Functions ──────────────────────────────────────────────

export async function getProjectHealth(
  token: string,
  projectId: number
): Promise<ProjectHealth> {
  const res = await fetch(`${API_BASE}/api/v1/projects/${projectId}/health`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to fetch project health");
  return res.json();
}

export async function refreshProjectHealth(
  token: string,
  projectId: number
): Promise<{ refreshed?: boolean; retry_after_seconds?: number } & Partial<ProjectHealth>> {
  const res = await fetch(
    `${API_BASE}/api/v1/projects/${projectId}/health/refresh`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  if (res.status === 429) {
    const err = await res.json().catch(() => ({}));
    const detail = (err as { detail?: { retry_after_seconds?: number } }).detail;
    return { retry_after_seconds: detail?.retry_after_seconds ?? 1800 };
  }
  if (!res.ok) throw new Error("Failed to refresh project health");
  return res.json();
}

export async function getHealthSummary(token: string): Promise<ProjectHealth[]> {
  const res = await fetch(`${API_BASE}/api/v1/projects/health/summary`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to fetch health summary");
  return res.json();
}

// ── Campaign Recommendations ──────────────────────────────────────────────────

export interface CampaignRecommendation {
  id: string
  source: string
  type: string
  created_at: string
  decision: string
  rationale: string
  approval_token: string | null
  approved: boolean | null
  budget_current: number | null
  budget_proposed: number | null
  metrics: Record<string, number> | null
  creative_brief: Record<string, string> | null
}

export interface CampaignRecommendations {
  campaign_id: number
  campaign_name: string
  has_pending: boolean
  recommendations: CampaignRecommendation[]
  last_optimization: {
    checked_at: string
    decision: string
    rationale: string
    metrics_snapshot: Record<string, unknown> | null
  } | null
}

export async function fetchCampaignRecommendations(
  token: string,
  campaignId: number
): Promise<CampaignRecommendations> {
  const res = await fetch(`${API_BASE}/api/v1/ads/${campaignId}/recommendations`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  })
  if (!res.ok) throw new Error("Failed to fetch campaign recommendations")
  return res.json()
}

export async function recommendToday(
  projectSlug: string,
  forceRefresh = false,
  token?: string
): Promise<{
  recommendation: {
    format: string;
    format_reason: string;
    content_angle: string;
    angle_reason: string;
    suggested_topic: string;
    suggested_hook: string;
    suggested_cta: string;
    best_time_to_post: string;
    best_time_reason: string;
    what_to_avoid: string;
  };
  competitive_insight: {
    competitors_analyzed: string[];
    dominant_angle: string | null;
    opportunity: string | null;
  };
  quick_actions: Array<{
    label: string;
    action: string;
    topic_hint?: string;
  }>;
  generated_at: string;
  cached: boolean;
  should_post_today?: boolean;
  urgency?: string;
  urgency_reason?: string;
}> {
  const res = await fetch(`${API_BASE}/api/v1/content/recommend-today/${projectSlug}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ force_refresh: forceRefresh }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Failed to get recommendation");
  }
  return res.json();
}

export function connectMetaOAuth(slug: string): string {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  return `${base}/api/v1/auth/meta/start?project_slug=${encodeURIComponent(slug)}`;
}

export async function discoverMetaAssets(token: string, projectSlug: string): Promise<{
  facebook_page_id: string | null;
  instagram_account_id: string | null;
  ad_account_id: string | null;
  pages: Array<{ id: string; name: string }>;
  ad_accounts: Array<{ id: string; name: string }>;
  instagram_accounts: Array<{ id: string; username: string }>;
}> {
  const res = await fetch(`${API_BASE}/api/v1/projects/${encodeURIComponent(projectSlug)}/meta-assets/discover`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Failed to discover Meta assets");
  }
  return res.json();
}

export async function assignMetaAssets(
  token: string,
  projectSlug: string,
  data: { facebook_page_id: string; instagram_account_id: string; ad_account_id: string }
) {
  const res = await fetch(`${API_BASE}/api/v1/projects/${encodeURIComponent(projectSlug)}/meta-assets`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Failed to assign Meta assets");
  }
  return res.json();
}

// ── Token Usage ───────────────────────────────────────────────────────────────

export async function fetchTokenUsageSummary(token: string, period = "month") {
  const params = new URLSearchParams({ period });
  const res = await fetch(`${API_BASE}/api/v1/token-usage/summary?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Failed to fetch token usage summary");
  }
  return res.json();
}

export async function fetchTokenUsageTrend(token: string, period = "month", projectId?: number) {
  const params = new URLSearchParams({ period });
  if (projectId !== undefined) params.set("project_id", String(projectId));
  const res = await fetch(`${API_BASE}/api/v1/token-usage/trend?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Failed to fetch token usage trend");
  }
  return res.json();
}

export async function fetchTokenLimits(token: string) {
  const res = await fetch(`${API_BASE}/api/v1/token-usage/limits`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Failed to fetch token limits");
  }
  return res.json();
}

export async function setTokenLimit(token: string, userId: string, monthlyTokenLimit: number) {
  const res = await fetch(`${API_BASE}/api/v1/token-usage/limits/${userId}`, {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify({ monthly_token_limit: monthlyTokenLimit }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Failed to set token limit");
  }
  return res.json();
}

export type CampaignChatQuestionKey =
  | "how_are_campaigns"
  | "wasting_money"
  | "change_this_week"
  | "creative_fatigue"
  | "ready_to_scale";

export interface CampaignChatResponse {
  answer: string;
  generated_at: string;
  cooldown_remaining_seconds: number;
}

export interface CampaignChatCooldownError {
  error: "cooldown";
  cooldown_remaining_seconds: number;
}

export interface CampaignSummary {
  id: number;
  name: string;
  objective: string | null;
  status: string;
  daily_budget: number | null;
  meta_campaign_id: string | null;
}

export async function fetchCampaignsBySlug(
  token: string,
  projectSlug: string,
): Promise<CampaignSummary[]> {
  const res = await fetch(`${API_BASE}/api/v1/ads/campaigns/${projectSlug}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to fetch campaigns");
  return res.json();
}

export async function campaignChat(
  token: string,
  projectSlug: string,
  questionKey: CampaignChatQuestionKey,
  language?: string,
  campaignId?: number | null,
): Promise<CampaignChatResponse> {
  const res = await fetch(`${API_BASE}/api/v1/ads/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      project_slug: projectSlug,
      question_key: questionKey,
      language: language ?? "en",
      campaign_id: campaignId ?? null,
    }),
  });
  if (res.status === 429) {
    const err = await res.json().catch(() => ({}));
    const detail = (err as { detail?: CampaignChatCooldownError }).detail;
    if (detail?.error === "cooldown") {
      const cdErr = new Error("cooldown") as Error & { cooldown_remaining_seconds: number };
      cdErr.cooldown_remaining_seconds = detail.cooldown_remaining_seconds;
      throw cdErr;
    }
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Campaign chat failed");
  }
  return res.json();
}

export function buildAutoPrompt(post: any, project: any): string {
  const content = typeof post.content === "string" ? JSON.parse(post.content) : post.content;
  const slide1 = content?.slides?.[0] ?? {};
  const headline = slide1.headline ?? "";
  const subtext = slide1.subtext ?? "";
  const brand = project?.name ?? "";
  const tone = (project?.content_config?.tone ?? "").slice(0, 50);
  return [headline, subtext, brand ? `Brand: ${brand}` : "", tone].filter(Boolean).join(". ");
}

// ── Ad Copy Editor ─────────────────────────────────────────────────────────────

export interface CampaignAd {
  id: string;
  name: string;
  headline: string | null;
  primary_text: string | null;
  image_url: string | null;
}

export async function fetchCampaignAds(
  token: string,
  campaignId: number
): Promise<CampaignAd[]> {
  const res = await fetch(`${API_BASE}/api/v1/ads/${campaignId}/ads`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Failed to fetch campaign ads");
  }
  return res.json();
}

export async function updateAdCopy(
  token: string,
  campaignId: number,
  adId: string,
  data: { headline?: string; primary_text?: string }
): Promise<{ success: boolean; creative_id: string }> {
  const res = await fetch(`${API_BASE}/api/v1/ads/${campaignId}/ads/${adId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Failed to update ad copy");
  }
  return res.json();
}

export async function updateAdImage(
  token: string,
  campaignId: number,
  adId: string,
  file: File
): Promise<{ success: boolean; image_hash: string; image_url: string }> {
  const form = new FormData()
  form.append("image", file)
  const res = await fetch(`${API_BASE}/api/v1/ads/${campaignId}/ads/${adId}/image`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { detail?: string }).detail || "Failed to update ad image")
  }
  return res.json()
}

export interface CompetitorAdAnalysis {
  index: number;
  hook_analysis: string;
  psychological_angle: string;
  inferred_objective: string;
  audience_signal: string;
  strength: string;
  opportunity: string;
  days_active_signal: string;
}

export interface CompetitorAd {
  competitor: string;
  page_name: string;
  body: string;
  title: string;
  days_active: number;
  platforms: string[];
  snapshot_url: string;
  analysis?: CompetitorAdAnalysis;
  page_like_count?: number;
  image_url?: string;
  page_avatar?: string;
  cta_text?: string;
  is_active?: boolean;
  variations?: number;
  start_date_formatted?: string;
  end_date_formatted?: string;
}

export interface InspirationPrefill {
  name: string;
  objective: string;
  ad_copy: string;
  headline: string;
  rationale: string;
  source_competitor: string;
  destination_url: string;
}

export async function fetchCompetitorAds(
  projectSlug: string,
  token: string
): Promise<{ ads: CompetitorAd[]; count: number; competitors_configured: boolean; is_synthetic?: boolean; apify_pending?: boolean }> {
  const res = await fetch(`${API_BASE}/api/v1/ads/competitor-ads/${projectSlug}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Failed to fetch competitor ads");
  }
  return res.json();
}

export async function adaptCompetitorAd(
  projectSlug: string,
  token: string,
  payload: { ad_index: number; competitor_ad: CompetitorAd; analysis: CompetitorAdAnalysis }
): Promise<{ prefill: InspirationPrefill }> {
  const res = await fetch(`${API_BASE}/api/v1/ads/adapt-competitor/${projectSlug}`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Failed to adapt competitor ad");
  }
  return res.json();
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function fetchDashboard(projectSlug: string) {
  const res = await fetch(`${API_BASE}/api/v1/dashboard/${projectSlug}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to fetch dashboard data");
  return res.json();
}

export async function fetchProjects() {
  const res = await fetch(`${API_BASE}/api/v1/projects/`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch projects");
  return res.json();
}

export async function fetchContent(projectSlug: string) {
  const res = await fetch(`${API_BASE}/api/v1/content/list/${projectSlug}?per_page=100`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch content");
  const data = await res.json();
  // /list/{slug} returns { items: [...], total, page, per_page }
  return Array.isArray(data) ? data : (data.items ?? data);
}

export async function generateContent(projectSlug: string) {
  const res = await fetch(`${API_BASE}/api/v1/content/generate/${projectSlug}`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to generate content");
  return res.json();
}

export async function fetchAds(projectId: string) {
  const res = await fetch(`${API_BASE}/api/v1/ads/${projectId}`, { cache: "no-store" });
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
    caption?: string;
    hashtags?: string[];
    scheduled_at?: string;
  }
) {
  const res = await fetch(`${API_BASE}/api/v1/content/create/${projectSlug}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create content");
  return res.json();
}

export async function updateContent(
  contentId: number,
  data: {
    caption?: string;
    image_url?: string;
    hashtags?: string[];
    slides?: unknown[];
    scheduled_at?: string;
    status?: string;
  }
) {
  const res = await fetch(`${API_BASE}/api/v1/content/${contentId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update content");
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
  }
) {
  const res = await fetch(`${API_BASE}/api/v1/content/batch/${projectSlug}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to batch generate");
  return res.json();
}

export async function fetchContentByDateRange(
  projectSlug: string,
  dateFrom: string,
  dateTo: string
) {
  const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
  const res = await fetch(`${API_BASE}/api/v1/content/list/${projectSlug}?${params}`, {
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
  destination_url: string;
}) {
  const res = await fetch(`${API_BASE}/api/v1/ads/create/${projectSlug}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Failed to create campaign");
  }
  return res.json();
}

export async function updateCampaignStatus(campaignId: number, status: "active" | "paused") {
  const res = await fetch(`${API_BASE}/api/v1/ads/${campaignId}/status`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error("Failed to update campaign status");
  return res.json();
}

export async function optimizeCampaign(campaignId: number) {
  const res = await fetch(`${API_BASE}/api/v1/ads/${campaignId}/optimize`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to run optimization");
  return res.json();
}

export async function fetchCampaignLogs(campaignId: number) {
  const res = await fetch(`${API_BASE}/api/v1/ads/${campaignId}/logs`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch logs");
  return res.json();
}

export async function fetchProjectPosts(projectId: string) {
  const res = await fetch(`${API_BASE}/api/v1/content/${projectId}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch posts");
  return res.json();
}

// Auth header helper — call this in client components that have session
export function authHeaders(token: string): HeadersInit {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
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

export async function fetchCampaignDetail(token: string, campaignId: string | number, projectSlug?: string) {
  const qs = projectSlug ? `?project_slug=${projectSlug}` : ""
  const res = await fetch(`${API_BASE}/api/v1/ads/detail/${campaignId}${qs}`, {
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

export async function importFromMeta(projectSlug: string): Promise<{ imported: number; skipped: number; errors: string[]; message: string }> {
  const res = await fetch(`${API_BASE}/api/v1/content/import-from-meta/${projectSlug}`, {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || "Failed to import from Meta");
  }
  return res.json();
}

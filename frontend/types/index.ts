export interface Project {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  is_active: boolean;
  facebook_page_id: string | null;
  instagram_account_id: string | null;
  ad_account_id: string | null;
}

export interface MetaAdsTotals {
  spend_today: number;
  spend_this_month: number;
  active_campaigns: number;
  ctr: number;
  roas: number;
  conversions: number;
  leads?: number;
  cpl?: number;
}

export interface MetaAdsKPI extends MetaAdsTotals {
  totals?: MetaAdsTotals;
  campaigns?: unknown[];
  daily_spend?: unknown[];
}

export interface ContentKPI {
  posts_this_week: number;
  pending_approvals: number;
  last_published_at: string | null;
  recent_posts: unknown[];
}

export interface N8nKPI {
  active_workflows: number;
  failed_last_24h: number;
  pending_executions: number;
}

export interface CostsKPI {
  anthropic_spend_this_month: number;
  meta_ads_spend_this_month: number;
  total_estimated: number;
}

export interface DashboardData {
  project: { name: string; slug: string; is_active: boolean };
  meta_ads: MetaAdsKPI;
  content: ContentKPI;
  n8n: N8nKPI;
  costs: CostsKPI;
}

export interface AuditCheckResult {
  id: number
  check_id: string
  category: string  // pixel | creative | structure | audience
  severity: string  // Critical | High | Medium | Low
  result: string    // PASS | WARNING | FAIL | MANUAL_REQUIRED | NA
  title: string
  detail: string
  recommendation: string
  meta_value: string
  threshold_value: string
  meta_ui_link: string
  created_at: string
}

export interface AdsAuditSummary {
  id: number
  project_id: number
  ad_account_id: string
  status: string  // running | completed | partial | error | failed
  health_score: number | null
  grade: string | null  // A | B | C | D | F
  score_pixel: number | null
  score_creative: number | null
  score_structure: number | null
  score_audience: number | null
  checks_pass: number
  checks_warning: number
  checks_fail: number
  checks_manual: number
  checks_na: number
  ios_disclaimer: boolean
  triggered_by: string
  error_message: string | null
  created_at: string
  completed_at: string | null
}

export interface AdsAuditDetail extends AdsAuditSummary {
  check_results: AuditCheckResult[]
}

export interface TriggerAuditResponse {
  audit_id: number
  status: string
  message: string
}

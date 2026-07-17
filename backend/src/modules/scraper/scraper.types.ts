export type ScraperSourceType =
  | 'google_places'
  | 'facebook'
  | 'youtube'
  | 'web_scrape'
  | 'meta_lead_forms'
  | 'google_ads_lead_forms'
  | 'linkedin_lead_forms'
  | 'apify_actor'
  | 'browser_scrape';

export type ScraperLogStatus = 'running' | 'completed' | 'failed' | 'partially_completed';

export interface ScraperConfigRow {
  id: string;
  name: string;
  source_type: ScraperSourceType;
  is_active: boolean;
  config: Record<string, unknown>;
  schedule_cron: string | null;
  last_run_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/**
 * 'failing' — the last (up to) 3 runs all failed.
 * 'unknown'  — no runs yet.
 * 'healthy'  — anything else (includes a mix of completed/partially_completed/failed).
 */
export type SourceHealth = 'healthy' | 'failing' | 'unknown';

export interface ScraperConfigWithHealth extends ScraperConfigRow {
  health: SourceHealth;
}

/** A single record that failed to import — enough to retry it without re-scraping. */
export interface FailedScrapeItem {
  lead: Record<string, unknown>;
  error: string;
}

export interface ScraperLogRow {
  id: string;
  config_id: string;
  status: ScraperLogStatus;
  started_at: string;
  completed_at: string | null;
  records_found: number;
  records_imported: number;
  records_duplicate: number;
  records_failed: number;
  error_message: string | null;
  raw_response: Record<string, unknown> | null;
  failed_items: FailedScrapeItem[];
  /** IDs of existing leads that scraped records matched (were not re-created). */
  duplicate_lead_ids: string[];
  created_at: string;
}

export interface ScraperStatsSummary {
  windowHours: number;
  totalRuns: number;
  activeSources: number;
  recordsFound: number;
  recordsImported: number;
  recordsDuplicate: number;
  recordsFailed: number;
}

export interface ScraperConfigInput {
  name: string;
  source_type: ScraperSourceType;
  is_active?: boolean;
  config: Record<string, unknown>;
  schedule_cron?: string | null;
}

export interface ScraperConfigUpdate {
  name?: string;
  is_active?: boolean;
  config?: Record<string, unknown>;
  schedule_cron?: string | null;
}

export interface ScraperActor {
  id: string;
  role: string;
  ipAddress?: string | null;
}

export interface ScraperRunResult {
  logId: string;
  recordsFound: number;
  /** Leads that were newly created — excludes duplicates. */
  recordsImported: number;
  /** Leads that already existed (matched by email/phone) and were skipped. */
  recordsDuplicate: number;
  recordsFailed: number;
  status: ScraperLogStatus;
  /** Human-readable reason when status === 'failed'; null otherwise. */
  errorMessage?: string | null;
}

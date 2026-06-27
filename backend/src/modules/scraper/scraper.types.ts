export type ScraperSourceType = 'google_places' | 'facebook' | 'youtube' | 'web_scrape';

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

export interface ScraperLogRow {
  id: string;
  config_id: string;
  status: ScraperLogStatus;
  started_at: string;
  completed_at: string | null;
  records_found: number;
  records_imported: number;
  records_failed: number;
  error_message: string | null;
  raw_response: Record<string, unknown> | null;
  created_at: string;
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
  recordsImported: number;
  recordsFailed: number;
  status: ScraperLogStatus;
  /** Human-readable reason when status === 'failed'; null otherwise. */
  errorMessage?: string | null;
}

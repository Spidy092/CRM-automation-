import { pool, query, queryOne } from '../../shared/utils/db';
import {
  ScraperConfigInput,
  ScraperConfigRow,
  ScraperConfigWithHealth,
  ScraperLogRow,
  ScraperConfigUpdate,
} from './scraper.types';

const CONFIG_COLS = `id, name, source_type, is_active, config, schedule_cron, webhook_url, group_name, last_run_at, created_by, created_at, updated_at`;
const LOG_COLS = `id, config_id, status, started_at, completed_at, records_found, records_imported, records_duplicate, records_failed, error_message, raw_response, failed_items, duplicate_lead_ids, created_at`;

// ── Scraper Configs ────────────────────────────────────────────────────────

export async function findScraperConfigs(): Promise<ScraperConfigRow[]> {
  return query<ScraperConfigRow>(
    `SELECT ${CONFIG_COLS} FROM scraper_configs ORDER BY created_at DESC`,
  );
}

export async function findScraperConfigById(id: string): Promise<ScraperConfigRow | null> {
  return queryOne<ScraperConfigRow>(`SELECT ${CONFIG_COLS} FROM scraper_configs WHERE id = $1`, [
    id,
  ]);
}

export async function findActiveScraperConfigs(): Promise<ScraperConfigRow[]> {
  return query<ScraperConfigRow>(
    `SELECT ${CONFIG_COLS} FROM scraper_configs WHERE is_active = true ORDER BY created_at DESC`,
  );
}

export async function insertScraperConfig(
  input: ScraperConfigInput,
  createdBy: string,
): Promise<ScraperConfigRow> {
  const row = await queryOne<ScraperConfigRow>(
    `INSERT INTO scraper_configs (name, source_type, is_active, config, schedule_cron, webhook_url, group_name, created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
     RETURNING ${CONFIG_COLS}`,
    [
      input.name,
      input.source_type,
      input.is_active ?? true,
      JSON.stringify(input.config),
      input.schedule_cron ?? null,
      input.webhook_url ?? null,
      input.group_name ?? null,
      createdBy,
    ],
  );
  if (!row) throw new Error('Failed to insert scraper config');
  return row;
}

export async function updateScraperConfig(
  id: string,
  input: ScraperConfigUpdate,
): Promise<ScraperConfigRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (input.name !== undefined) {
    sets.push(`name = $${i++}`);
    params.push(input.name);
  }
  if (input.is_active !== undefined) {
    sets.push(`is_active = $${i++}`);
    params.push(input.is_active);
  }
  if (input.config !== undefined) {
    sets.push(`config = $${i++}::jsonb`);
    params.push(JSON.stringify(input.config));
  }
  if (input.schedule_cron !== undefined) {
    sets.push(`schedule_cron = $${i++}`);
    params.push(input.schedule_cron);
  }
  if (input.webhook_url !== undefined) {
    sets.push(`webhook_url = $${i++}`);
    params.push(input.webhook_url);
  }
  if (input.group_name !== undefined) {
    sets.push(`group_name = $${i++}`);
    params.push(input.group_name);
  }

  if (sets.length === 0) {
    return findScraperConfigById(id);
  }

  sets.push(`updated_at = NOW()`);
  params.push(id);

  return queryOne<ScraperConfigRow>(
    `UPDATE scraper_configs SET ${sets.join(', ')} WHERE id = $${i} RETURNING ${CONFIG_COLS}`,
    params,
  );
}

export async function deleteScraperConfig(id: string): Promise<void> {
  await pool.query('DELETE FROM scraper_configs WHERE id = $1', [id]);
}

export async function updateScraperConfigLastRun(id: string, lastRunAt: string): Promise<void> {
  await pool.query(
    'UPDATE scraper_configs SET last_run_at = $1, updated_at = NOW() WHERE id = $2',
    [lastRunAt, id],
  );
}

export async function findDistinctGroupNames(): Promise<string[]> {
  const rows = await query<{ group_name: string }>(
    `SELECT DISTINCT group_name FROM scraper_configs WHERE group_name IS NOT NULL ORDER BY group_name`,
  );
  return rows.map((r) => r.group_name);
}

// ── Scraper Logs ────────────────────────────────────────────────────────────

/**
 * The most recent still-'running' log for a config, if any.
 *
 * Used to keep "Run Now" idempotent: a second click while a run is in flight
 * should attach to that run rather than start a competing one.
 *
 * `staleBeforeIso` bounds how long a 'running' row is trusted. A run whose
 * worker crashed mid-flight leaves its log stuck in 'running' forever, and
 * without this the config could never be run again.
 */
export async function findRunningLogByConfig(
  configId: string,
  staleBeforeIso: string,
): Promise<ScraperLogRow | null> {
  return queryOne<ScraperLogRow>(
    `SELECT ${LOG_COLS} FROM scraper_logs
     WHERE config_id = $1
       AND status = 'running'
       AND started_at >= $2
     ORDER BY started_at DESC
     LIMIT 1`,
    [configId, staleBeforeIso],
  );
}

export async function insertScraperLog(data: {
  config_id: string;
  status: string;
}): Promise<ScraperLogRow> {
  const row = await queryOne<ScraperLogRow>(
    `INSERT INTO scraper_logs (config_id, status) VALUES ($1, $2) RETURNING ${LOG_COLS}`,
    [data.config_id, data.status],
  );
  if (!row) throw new Error('Failed to insert scraper log');
  return row;
}

export async function updateScraperLog(
  id: string,
  fields: Partial<{
    status: string;
    completed_at: string;
    records_found: number;
    records_imported: number;
    records_duplicate: number;
    records_failed: number;
    error_message: string | null;
    raw_response: Record<string, unknown> | null;
    failed_items: Array<{ lead: Record<string, unknown>; error: string }>;
    duplicate_lead_ids: string[];
  }>,
): Promise<ScraperLogRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (fields.status !== undefined) {
    sets.push(`status = $${i++}`);
    params.push(fields.status);
  }
  if (fields.completed_at !== undefined) {
    sets.push(`completed_at = $${i++}`);
    params.push(fields.completed_at);
  }
  if (fields.records_found !== undefined) {
    sets.push(`records_found = $${i++}`);
    params.push(fields.records_found);
  }
  if (fields.records_imported !== undefined) {
    sets.push(`records_imported = $${i++}`);
    params.push(fields.records_imported);
  }
  if (fields.records_duplicate !== undefined) {
    sets.push(`records_duplicate = $${i++}`);
    params.push(fields.records_duplicate);
  }
  if (fields.records_failed !== undefined) {
    sets.push(`records_failed = $${i++}`);
    params.push(fields.records_failed);
  }
  if (fields.error_message !== undefined) {
    sets.push(`error_message = $${i++}`);
    params.push(fields.error_message);
  }
  if (fields.raw_response !== undefined) {
    sets.push(`raw_response = $${i++}::jsonb`);
    params.push(JSON.stringify(fields.raw_response));
  }
  if (fields.failed_items !== undefined) {
    sets.push(`failed_items = $${i++}::jsonb`);
    params.push(JSON.stringify(fields.failed_items));
  }
  if (fields.duplicate_lead_ids !== undefined) {
    sets.push(`duplicate_lead_ids = $${i++}`);
    params.push(fields.duplicate_lead_ids);
  }

  if (sets.length === 0) return null;

  params.push(id);
  return queryOne<ScraperLogRow>(
    `UPDATE scraper_logs SET ${sets.join(', ')} WHERE id = $${i} RETURNING ${LOG_COLS}`,
    params,
  );
}

export async function findScraperLogById(id: string): Promise<ScraperLogRow | null> {
  return queryOne<ScraperLogRow>(`SELECT ${LOG_COLS} FROM scraper_logs WHERE id = $1`, [id]);
}

export async function findScraperLogsByConfig(
  configId: string,
  limit: number,
  offset: number,
): Promise<ScraperLogRow[]> {
  return query<ScraperLogRow>(
    `SELECT ${LOG_COLS} FROM scraper_logs
     WHERE config_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [configId, limit, offset],
  );
}

export async function countScraperLogsByConfig(configId: string): Promise<number> {
  const row = await queryOne<{ count: string }>(
    'SELECT COUNT(*) as count FROM scraper_logs WHERE config_id = $1',
    [configId],
  );
  return row ? parseInt(row.count, 10) : 0;
}

/**
 * All scraper configs with a computed `health` field, derived from each
 * config's most recent (up to) 3 runs: 'failing' only when ALL of them
 * failed, 'unknown' when there are no runs yet, 'healthy' otherwise.
 */
export async function findScraperConfigsWithHealth(): Promise<ScraperConfigWithHealth[]> {
  const prefixedCols = CONFIG_COLS.split(', ')
    .map((col) => `c.${col}`)
    .join(', ');
  return query<ScraperConfigWithHealth>(
    `SELECT ${prefixedCols},
       COALESCE(
         (
           SELECT CASE
             WHEN COUNT(*) = 0 THEN 'unknown'
             WHEN COUNT(*) FILTER (WHERE recent.status = 'failed') = COUNT(*) THEN 'failing'
             ELSE 'healthy'
           END
           FROM (
             SELECT status FROM scraper_logs
             WHERE config_id = c.id
             ORDER BY created_at DESC
             LIMIT 3
           ) recent
         ),
         'unknown'
       ) AS health
     FROM scraper_configs c
     ORDER BY c.created_at DESC`,
  );
}

/** Aggregate run stats across all scraper sources since the given ISO timestamp. */
export async function sumScraperLogsSince(sinceIso: string): Promise<{
  totalRuns: number;
  activeSources: number;
  recordsFound: number;
  recordsImported: number;
  recordsDuplicate: number;
  recordsFailed: number;
}> {
  const row = await queryOne<{
    total_runs: string;
    active_sources: string;
    records_found: string;
    records_imported: string;
    records_duplicate: string;
    records_failed: string;
  }>(
    `SELECT
       COUNT(*)                                AS total_runs,
       COUNT(DISTINCT config_id)                AS active_sources,
       COALESCE(SUM(records_found), 0)          AS records_found,
       COALESCE(SUM(records_imported), 0)       AS records_imported,
       COALESCE(SUM(records_duplicate), 0)      AS records_duplicate,
       COALESCE(SUM(records_failed), 0)         AS records_failed
     FROM scraper_logs
     WHERE created_at >= $1`,
    [sinceIso],
  );
  return {
    totalRuns: row ? parseInt(row.total_runs, 10) : 0,
    activeSources: row ? parseInt(row.active_sources, 10) : 0,
    recordsFound: row ? parseInt(row.records_found, 10) : 0,
    recordsImported: row ? parseInt(row.records_imported, 10) : 0,
    recordsDuplicate: row ? parseInt(row.records_duplicate, 10) : 0,
    recordsFailed: row ? parseInt(row.records_failed, 10) : 0,
  };
}

export interface ScraperTrendPoint {
  date: string;
  runs: number;
  leads_imported: number;
  leads_found: number;
  leads_failed: number;
  success_rate: number;
}

export async function getScraperTrends(days = 14): Promise<ScraperTrendPoint[]> {
  const rows = await query<{
    day: string;
    runs: string;
    leads_imported: string;
    leads_found: string;
    leads_failed: string;
  }>(
    `SELECT
       DATE_TRUNC('day', created_at)::date::text AS day,
       COUNT(*)::text                             AS runs,
       COALESCE(SUM(records_imported), 0)::text   AS leads_imported,
       COALESCE(SUM(records_found), 0)::text      AS leads_found,
       COALESCE(SUM(records_failed), 0)::text     AS leads_failed
     FROM scraper_logs
     WHERE created_at >= NOW() - ($1 || ' days')::interval
       AND status IN ('completed', 'partially_completed', 'failed')
     GROUP BY day
     ORDER BY day ASC`,
    [String(days)],
  );

  return rows.map((r) => {
    const runs = parseInt(r.runs, 10);
    const imported = parseInt(r.leads_imported, 10);
    const found = parseInt(r.leads_found, 10);
    const failed = parseInt(r.leads_failed, 10);
    return {
      date: r.day,
      runs,
      leads_imported: imported,
      leads_found: found,
      leads_failed: failed,
      success_rate: runs > 0 ? Math.round((imported / Math.max(found, 1)) * 100) : 0,
    };
  });
}

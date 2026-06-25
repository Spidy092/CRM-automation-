import { pool, query, queryOne } from '../../shared/utils/db';
import {
  ScraperConfigInput,
  ScraperConfigRow,
  ScraperLogRow,
  ScraperConfigUpdate,
} from './scraper.types';

const CONFIG_COLS = `id, name, source_type, is_active, config, schedule_cron, last_run_at, created_by, created_at, updated_at`;
const LOG_COLS = `id, config_id, status, started_at, completed_at, records_found, records_imported, records_failed, error_message, raw_response, created_at`;

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
    `INSERT INTO scraper_configs (name, source_type, is_active, config, schedule_cron, created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)
     RETURNING ${CONFIG_COLS}`,
    [
      input.name,
      input.source_type,
      input.is_active ?? true,
      JSON.stringify(input.config),
      input.schedule_cron ?? null,
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

// ── Scraper Logs ────────────────────────────────────────────────────────────

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
    records_failed: number;
    error_message: string | null;
    raw_response: Record<string, unknown> | null;
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

  if (sets.length === 0) return null;

  params.push(id);
  return queryOne<ScraperLogRow>(
    `UPDATE scraper_logs SET ${sets.join(', ')} WHERE id = $${i} RETURNING ${LOG_COLS}`,
    params,
  );
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

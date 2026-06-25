import { pool } from '../../shared/utils/db';

interface AiSettingsRow {
  id: string;
  enabled: boolean;
  base_url: string | null;
  encrypted_api_key: string | null;
  model: string;
  max_tokens: number;
  temperature: string;
  system_prompt_override: string | null;
  cache_ttl_seconds: number;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export async function findAiSettings(): Promise<AiSettingsRow | null> {
  const result = await pool.query<AiSettingsRow>(`
    SELECT id, enabled, base_url, encrypted_api_key, model,
           max_tokens, temperature, system_prompt_override,
           cache_ttl_seconds, updated_by, created_at, updated_at
    FROM ai_settings
    LIMIT 1
  `);
  return result.rows[0] ?? null;
}

export interface UpdateAiSettingsRepoInput {
  enabled?: boolean;
  base_url?: string | null;
  encrypted_api_key?: string | null;
  model?: string;
  max_tokens?: number;
  temperature?: number;
  system_prompt_override?: string | null;
  cache_ttl_seconds?: number;
  updated_by?: string;
}

export async function upsertAiSettings(
  input: UpdateAiSettingsRepoInput,
): Promise<AiSettingsRow> {
  const setClauses: string[] = ['updated_at = NOW()'];
  const values: unknown[] = [];

  if (input.enabled !== undefined) {
    values.push(input.enabled);
    setClauses.push(`enabled = $${values.length}`);
  }
  if (input.base_url !== undefined) {
    values.push(input.base_url);
    setClauses.push(`base_url = $${values.length}`);
  }
  if (input.encrypted_api_key !== undefined) {
    values.push(input.encrypted_api_key);
    setClauses.push(`encrypted_api_key = $${values.length}`);
  }
  if (input.model !== undefined) {
    values.push(input.model);
    setClauses.push(`model = $${values.length}`);
  }
  if (input.max_tokens !== undefined) {
    values.push(input.max_tokens);
    setClauses.push(`max_tokens = $${values.length}`);
  }
  if (input.temperature !== undefined) {
    values.push(input.temperature);
    setClauses.push(`temperature = $${values.length}`);
  }
  if (input.system_prompt_override !== undefined) {
    values.push(input.system_prompt_override);
    setClauses.push(`system_prompt_override = $${values.length}`);
  }
  if (input.cache_ttl_seconds !== undefined) {
    values.push(input.cache_ttl_seconds);
    setClauses.push(`cache_ttl_seconds = $${values.length}`);
  }
  if (input.updated_by !== undefined) {
    values.push(input.updated_by);
    setClauses.push(`updated_by = $${values.length}`);
  }

  // Upsert: insert a default row if none exists, then update
  await pool.query(`
    INSERT INTO ai_settings (enabled, model, max_tokens, temperature)
    VALUES (false, 'gpt-4o', 500, 0.7)
    ON CONFLICT DO NOTHING
  `);

  const result = await pool.query<AiSettingsRow>(
    `UPDATE ai_settings SET ${setClauses.join(', ')} RETURNING
       id, enabled, base_url, encrypted_api_key, model,
       max_tokens, temperature, system_prompt_override,
       cache_ttl_seconds, updated_by, created_at, updated_at`,
    values,
  );

  return result.rows[0];
}

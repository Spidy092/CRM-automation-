export interface AiSettings {
  id: string;
  enabled: boolean;
  base_url: string | null;
  model: string;
  max_tokens: number;
  temperature: number;
  system_prompt_override: string | null;
  cache_ttl_seconds: number;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

/** What the API returns (no encrypted_api_key, no singleton_guard) */
export interface AiSettingsPublic {
  id: string;
  enabled: boolean;
  base_url: string | null;
  /** Whether an API key is currently stored (never expose the value) */
  has_api_key: boolean;
  model: string;
  max_tokens: number;
  temperature: number;
  system_prompt_override: string | null;
  cache_ttl_seconds: number;
  updated_by: string | null;
  updated_at: string;
}

export interface UpdateAiSettingsInput {
  enabled?: boolean;
  base_url?: string | null;
  /** Raw API key — will be encrypted at the service layer before storage */
  api_key?: string | null;
  model?: string;
  max_tokens?: number;
  temperature?: number;
  system_prompt_override?: string | null;
  cache_ttl_seconds?: number;
}

/**
 * Integration = a third-party vendor (WhatsApp, Twilio, SendGrid, etc.).
 * Credentials are stored encrypted at rest in `integrations.encrypted_credentials`.
 * Decrypted credentials MUST NEVER leave the server except inside the connector
 * process / outbound HTTP request.
 */
export interface Integration {
  id: string;
  name: string;
  display_name: string;
  is_enabled: boolean;
  /** Encrypted blob (`enc:v1:...`). Server-side only. Never serialise to clients. */
  encrypted_credentials: string | null;
  last_tested_at: string | null;
  last_test_status: string | null;
  updated_by: string | null;
  updated_at: string;
}

/**
 * Public projection — safe to return to any authenticated user.
 * Strips the `encrypted_credentials` field entirely.
 */
export type IntegrationPublic = Omit<Integration, 'encrypted_credentials'>;

/** Vendor-neutral credential envelope. Each connector interprets its own keys. */
export type IntegrationCredentials = Record<string, unknown>;

export interface IntegrationUpdateInput {
  is_enabled?: boolean;
  /** Plaintext credentials from the admin. Will be encrypted before write. */
  credentials?: IntegrationCredentials | null;
}

export interface IntegrationActor {
  id: string;
  ipAddress?: string | null;
}

export interface IntegrationTestResult {
  ok: boolean;
  status: 'ok' | 'failed' | 'no_credentials';
  message: string;
  tested_at: string;
}

export interface IntegrationBulkTestResult {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  results: Array<{
    id: string;
    name: string;
    ok: boolean;
    status: string;
    message: string;
    tested_at: string;
  }>;
}

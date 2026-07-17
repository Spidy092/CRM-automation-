/**
 * LinkedIn connector.
 *
 * Auth: Bearer <accessToken> (OAuth 2.0)
 * Credentials shape: { accessToken: string, organizationId?: string }
 *
 * Vendor docs: https://learn.microsoft.com/en-us/linkedin/marketing/
 * Base URL: https://api.linkedin.com/v2
 *
 * Note: Lead Gen Form responses require the Marketing Developer Platform (MDP) programme approval.
 * testConnection() uses /v2/me which works with any valid LinkedIn token.
 */

import { z } from 'zod';
import { AppError } from '../../../shared/middleware/errorHandler';
import { findByName, findCredentialsById } from '../integrations.repository';
import { decrypt } from '../../../shared/utils/encryption';
import { logger } from '../../../shared/utils/logger';

export const LINKEDIN_PROVIDER_NAME = 'linkedin';

const LINKEDIN_BASE = 'https://api.linkedin.com/v2';

export const linkedinCredentialsSchema = z
  .object({
    accessToken:    z.string().min(1, 'Access token is required'),
    organizationId: z.string().optional(),
  })
  .strict();

export type LinkedInCredentials = z.infer<typeof linkedinCredentialsSchema>;

export async function loadCredentials(): Promise<LinkedInCredentials> {
  const row = await findByName(LINKEDIN_PROVIDER_NAME);
  if (!row) throw new AppError('LinkedIn integration not configured', 404);
  const enc = await findCredentialsById(row.id);
  if (!enc) throw new AppError('LinkedIn credentials not set', 422);
  const raw = JSON.parse(decrypt(enc)) as unknown;
  const result = linkedinCredentialsSchema.safeParse(raw);
  if (!result.success) {
    throw new AppError(`LinkedIn credentials invalid: ${result.error.errors.map((e) => e.message).join(', ')}`, 422);
  }
  return result.data;
}

/**
 * Verifies the access token is valid by fetching the authenticated member profile.
 */
export async function testConnection(
  creds: LinkedInCredentials,
): Promise<{ ok: boolean; error?: string; latencyMs: number }> {
  const start = Date.now();
  try {
    const res = await fetch(`${LINKEDIN_BASE}/me`, {
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'LinkedIn-Version': '202401',
      },
    });
    if (res.ok) return { ok: true, latencyMs: Date.now() - start };
    let msg = `HTTP ${res.status}`;
    try {
      const b = await res.json() as { message?: string; serviceErrorCode?: number };
      if (b.message) msg = b.message;
    } catch { /* ignore */ }
    return { ok: false, error: msg, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error', latencyMs: Date.now() - start };
  }
}

export interface LinkedInLeadFormResponse {
  leadId: string;
  formId: string;
  submittedAt: string;
  fields: Record<string, string>;
}

/**
 * Fetches lead gen form responses for the configured organization.
 * Requires LinkedIn Marketing Developer Platform approval.
 */
export async function getLeadFormResponses(
  formId: string,
  options: { count?: number; start?: number } = {},
): Promise<LinkedInLeadFormResponse[]> {
  const creds = await loadCredentials();
  const params = new URLSearchParams({
    q: 'owner',
    ...(options.count  ? { count: String(options.count) } : {}),
    ...(options.start  ? { start: String(options.start) } : {}),
  });

  try {
    const res = await fetch(`${LINKEDIN_BASE}/leadGenerationForms/${formId}/leadGenerationFormResponses?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'LinkedIn-Version': '202401',
      },
    });

    if (!res.ok) {
      logger.warn('linkedin lead form responses fetch failed', { formId, status: res.status });
      return [];
    }

    const body = await res.json() as { elements?: Array<{ id: string; formUrn: string; submittedAt: number; fieldValues: Array<{ question: string; values: string[] }> }> };
    return (body.elements ?? []).map((el) => ({
      leadId:      el.id,
      formId:      el.formUrn,
      submittedAt: new Date(el.submittedAt).toISOString(),
      fields:      Object.fromEntries(el.fieldValues.map((f) => [f.question, f.values.join(', ')])),
    }));
  } catch (err) {
    logger.error('linkedin lead form responses error', { formId, error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

import { AppError } from '../../../shared/middleware/errorHandler';
import { logger } from '../../../shared/utils/logger';
import { findByName, findCredentialsById } from '../integrations.repository';
import { decrypt } from '../../../shared/utils/encryption';
import { z } from 'zod';

const hunterCredentialsSchema = z.object({
  api_key: z.string().min(1, 'API key is required'),
});

export type HunterCredentials = z.infer<typeof hunterCredentialsSchema>;

/**
 * Helper to fetch and decrypt the Hunter.io credentials.
 */
export async function getCredentials(): Promise<HunterCredentials> {
  const integration = await findByName('hunter');
  if (!integration || !integration.is_enabled) {
    throw new AppError('Hunter.io integration is not enabled', 400);
  }

  const encrypted = await findCredentialsById(integration.id);
  if (!encrypted) {
    throw new AppError('Hunter.io credentials not configured', 400);
  }

  try {
    const raw = JSON.parse(decrypt(encrypted));
    return hunterCredentialsSchema.parse(raw);
  } catch (err) {
    throw new AppError('Invalid Hunter.io credentials configuration', 400);
  }
}

/**
 * Implementation of the connector test logic required by IntegrationsService.
 */
export async function loadCredentials(
  rawCredentials?: Record<string, unknown>
): Promise<HunterCredentials> {
  if (rawCredentials) {
    return hunterCredentialsSchema.parse(rawCredentials);
  }
  // In a test flow that pulls from DB (like testAllIntegrations), it uses the DB:
  const integration = await findByName('hunter');
  if (!integration) throw new Error('Hunter.io not found in DB');
  const encrypted = await findCredentialsById(integration.id);
  if (!encrypted) throw new Error('No credentials');
  const raw = JSON.parse(decrypt(encrypted));
  return hunterCredentialsSchema.parse(raw);
}

export async function testConnection(
  credentials: HunterCredentials
): Promise<{ ok: boolean; error?: string; latencyMs: number }> {
  const start = Date.now();
  try {
    // Ping Hunter's Account API to verify API key
    const response = await fetch(`https://api.hunter.io/v2/account?api_key=${credentials.api_key}`);
    
    if (!response.ok) {
      return { ok: false, error: `Hunter API responded with status ${response.status}`, latencyMs: Date.now() - start };
    }
    
    const data = await response.json() as any;
    if (data.errors) {
      return { ok: false, error: data.errors[0]?.details || 'Invalid API Key', latencyMs: Date.now() - start };
    }

    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - start,
    };
  }
}

export interface HunterEmailResult {
  email: string;
  confidence: number;
  type: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  linkedin?: string;
  twitter?: string;
}

/**
 * Uses Hunter.io Domain Search API to find the best email for a domain.
 */
export async function enrichDomain(domain: string): Promise<HunterEmailResult | null> {
  const creds = await getCredentials();
  
  const cleanDomain = domain.replace(/^(?:https?:\/\/)?(?:www\.)?/i, '').split('/')[0];
  
  try {
    const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(cleanDomain)}&limit=1&api_key=${creds.api_key}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      logger.warn('hunter api domain search failed', { domain: cleanDomain, status: response.status });
      return null;
    }
    
    const data = await response.json() as any;
    const emails = data?.data?.emails;
    
    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return null;
    }
    
    const bestEmail = emails[0];
    
    return {
      email: bestEmail.value,
      confidence: bestEmail.confidence,
      type: bestEmail.type,
      first_name: bestEmail.first_name,
      last_name: bestEmail.last_name,
      position: bestEmail.position,
      linkedin: bestEmail.linkedin,
      twitter: bestEmail.twitter,
    };
  } catch (err) {
    logger.error('hunter api domain search error', { domain: cleanDomain, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

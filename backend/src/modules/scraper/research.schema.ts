import { z } from 'zod';
import type { CandidateTargets } from './candidate.schema';

/**
 * Review-first research options carried inside the scraper config blob
 * (`config.research`). Stored in JSONB so no migration is needed; absent
 * options mean "legacy automatic import with no targeting" and every
 * existing config keeps working unchanged.
 *
 * - `importMode: 'automatic'` imports leads during the run (all configs
 *   written before this feature, and every non-research source by default).
 * - `importMode: 'review'` stages assessed research candidates on the run
 *   log (`raw_response.candidates`) WITHOUT importing; an operator imports
 *   an explicit selection afterwards via POST /logs/:logId/import-selected.
 *   New AI/research runs (Google agent) default to `review`.
 */
export const importModeSchema = z.enum(['automatic', 'review']);

export const researchTargetsSchema = z.object({
  industries: z.array(z.string().trim().min(1).max(100)).max(20).optional().default([]),
  locations: z.array(z.string().trim().min(1).max(255)).max(20).optional().default([]),
  requiredContactChannel: z.enum(['email', 'phone', 'either']).optional().default('either'),
  serviceCategories: z
    .array(z.enum(['website', 'web_application', 'ai_agent']))
    .max(10)
    .optional()
    .default([]),
});

export const researchOptionsSchema = z.object({
  importMode: importModeSchema.optional(),
  targets: researchTargetsSchema.optional().default({}),
});

export type ResearchOptions = z.infer<typeof researchOptionsSchema>;

export interface NormalizedResearchOptions {
  importMode: 'automatic' | 'review';
  targets: CandidateTargets;
}

/**
 * Normalizes research options from a stored config blob. Never throws for
 * legacy blobs — absent/invalid research options fall back to automatic
 * import with no targeting (exactly the pre-feature behaviour).
 *
 * The only default with an opinion: runs that use the Google research agent
 * (`agentEnabled: true`) stage for review unless the operator explicitly
 * chose automatic import. Everything else defaults to automatic so existing
 * scheduled sources never silently stop importing.
 */
export function normalizeResearchOptions(
  config: Record<string, unknown> | null | undefined,
): NormalizedResearchOptions {
  const blob = config && typeof config === 'object' ? config : {};
  const raw = (blob.research as Record<string, unknown> | undefined) ?? {};
  const parsed = researchOptionsSchema.safeParse(raw);
  const explicit = parsed.success ? parsed.data.importMode : undefined;
  const malformedResearch =
    Object.prototype.hasOwnProperty.call(blob, 'research') && !parsed.success;
  const agentEnabled = blob.agentEnabled === true;
  const targets = (
    parsed.success && parsed.data.targets ? parsed.data.targets : {}
  ) as CandidateTargets;
  return {
    // Malformed persisted research settings fail closed: they must not erase
    // an intended review gate and silently turn a run into automatic import.
    importMode: explicit ?? (malformedResearch || agentEnabled ? 'review' : 'automatic'),
    targets: {
      industries: targets.industries ?? [],
      locations: targets.locations ?? [],
      requiredContactChannel: targets.requiredContactChannel ?? 'either',
      serviceCategories: targets.serviceCategories ?? [],
    },
  };
}

/**
 * Source capability states surfaced honestly in the UI. Discovery sources
 * find businesses; enrichment sources only ever touch the configured Page;
 * ingestion sources are fed by webhooks or files — never by a scheduled pull.
 */
export type SourceCapability =
  | 'discovery'
  | 'configured_page_enrichment'
  | 'webhook_ingestion'
  | 'manual_import'
  | 'actor_retrieval';

export function capabilityForSourceType(sourceType: string): SourceCapability {
  switch (sourceType) {
    case 'facebook':
      return 'configured_page_enrichment';
    case 'google_ads_lead_forms':
      return 'webhook_ingestion';
    case 'linkedin_lead_forms':
      return 'manual_import';
    case 'apify_actor':
      return 'actor_retrieval';
    default:
      return 'discovery';
  }
}

/**
 * Honest requirements check for a config: which credential references the
 * run needs, and whether each is currently set. Only presence is reported —
 * never values. A source whose credentials are missing runs fail fast with
 * an actionable error instead of silently producing nothing.
 */
export function requirementsForConfig(
  sourceType: string,
  config: Record<string, unknown>,
  isEnvSet: (ref: string) => boolean,
): Array<{ ref: string; label: string; met: boolean }> {
  const refs: Array<{ key: string; label: string }> = [];
  if (sourceType === 'google_places' || sourceType === 'youtube') {
    if (typeof config.apiKeyRef === 'string' && config.apiKeyRef) {
      refs.push({ key: config.apiKeyRef, label: 'API key' });
    }
  }
  if (sourceType === 'facebook') {
    if (typeof config.accessTokenRef === 'string' && config.accessTokenRef) {
      refs.push({ key: config.accessTokenRef, label: 'Access token' });
    }
  }
  if (
    sourceType === 'google_ads_lead_forms' &&
    typeof config.webhookSecretRef === 'string' &&
    config.webhookSecretRef
  ) {
    refs.push({ key: config.webhookSecretRef, label: 'Webhook secret' });
  }
  if (sourceType === 'browser_scrape') {
    refs.push({ key: 'PUPPETEER_EXECUTABLE_PATH', label: 'Browser binary' });
  }
  return refs.map((r) => ({ ref: r.key, label: r.label, met: isEnvSet(r.key) }));
}

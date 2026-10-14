import { createHash } from 'crypto';
import {
  AssessedCandidate,
  CandidateSourceType,
  ContactProvenance,
  ResearchCandidate,
} from './candidate.schema';
import { assessCandidate, makeEmailContact, makePhoneContact } from './candidate.quality';
import type { NormalizedResearchOptions } from './research.schema';
import { isPlaceholderEmail, isPlaceholderPhone } from '../../shared/utils/phone';

/** Minimal lead shape the bridge accepts (mirrors ScrapedLead + agent rows). */
export interface BridgeLead {
  business_name: string;
  contact_name?: string;
  phone?: string;
  email?: string;
  website?: string | null;
  industry?: string;
  location?: string;
  google_place_id?: string;
  fallback_id?: string;
}

/** Provenance per source for observed (non-synthetic) contacts. */
const SOURCE_EMAIL_PROVENANCE: Record<string, ContactProvenance> = {
  google_places: 'google_places_observed',
  facebook: 'facebook_page_field',
  youtube: 'youtube_description',
  web_scrape: 'website_text',
  browser_scrape: 'website_text',
  meta_lead_forms: 'form_submission',
  google_ads_lead_forms: 'form_submission',
  linkedin_lead_forms: 'form_submission',
  apify_actor: 'apify_mapped_field',
};

const SOURCE_PHONE_PROVENANCE: Record<string, ContactProvenance> = {
  google_places: 'google_places_observed',
  facebook: 'facebook_page_field',
  youtube: 'youtube_description',
  web_scrape: 'website_text',
  browser_scrape: 'website_text',
  meta_lead_forms: 'form_submission',
  google_ads_lead_forms: 'form_submission',
  linkedin_lead_forms: 'form_submission',
  apify_actor: 'apify_mapped_field',
};

export interface BridgeContext {
  sourceType: CandidateSourceType;
  configId?: string;
  runId?: string;
  /** Stable provider id when the adapter observed one (place/channel/submission). */
  providerId?: string | null;
  providerKind?: ResearchCandidate['provider']['kind'];
  collectedAt?: string;
}

/**
 * Maps one scraped lead to a staged research candidate. Contact states are
 * deliberately conservative: placeholders are synthetic; real values are
 * `unknown` (observed but DNS-unverified at staging time) unless the caller
 * supplies a verified DNS outcome. The review panel — never the importer —
 * decides eligibility via `assessCandidate`.
 */
export function scrapedLeadToCandidate(
  lead: BridgeLead,
  ctx: BridgeContext,
  emailDns: 'valid_mx' | 'no_mx' | 'dns_failed' | 'not_checked' = 'not_checked',
): ResearchCandidate {
  const emailProvenance =
    lead.email && isPlaceholderEmail(lead.email)
      ? ('placeholder_synthetic' as ContactProvenance)
      : (SOURCE_EMAIL_PROVENANCE[ctx.sourceType] ?? 'unknown');
  const phoneProvenance =
    lead.phone && isPlaceholderPhone(lead.phone)
      ? ('placeholder_synthetic' as ContactProvenance)
      : (SOURCE_PHONE_PROVENANCE[ctx.sourceType] ?? 'unknown');

  // Staged identity must always exist so review selections can address a
  // candidate. Provider identities win; otherwise a deterministic content
  // hash (stable within identical re-scrapes, best-effort across runs).
  const observedId = ctx.providerId ?? lead.google_place_id ?? lead.fallback_id ?? null;
  const providerId =
    observedId ??
    `staged:${createHash('sha256')
      .update(`${lead.business_name}|${lead.email ?? ''}|${lead.phone ?? ''}`)
      .digest('hex')
      .slice(0, 16)}`;

  return {
    provider: {
      kind: ctx.providerKind ?? 'unknown',
      id: providerId,
    },
    source: {
      sourceType: ctx.sourceType,
      ...(ctx.configId ? { configId: ctx.configId } : {}),
      ...(ctx.runId ? { runId: ctx.runId } : {}),
      collectedAt: ctx.collectedAt ?? new Date().toISOString(),
    },
    business: {
      name: lead.business_name,
      website: lead.website ?? null,
      sourceUrls: lead.website ? [lead.website] : [],
      location: lead.location ?? '',
      industry: lead.industry ?? '',
    },
    contacts: [
      ...(lead.email ? [makeEmailContact(lead.email, emailProvenance, emailDns)] : []),
      ...(lead.phone ? [makePhoneContact(lead.phone, phoneProvenance)] : []),
    ],
    evidence: [],
    observedOpportunities: [],
    modelSuggestions: [],
  };
}

/** Assesses staged candidates against the run's operator targets. */
export function assessStagedCandidates(
  candidates: ResearchCandidate[],
  options: NormalizedResearchOptions,
): AssessedCandidate[] {
  return candidates.map((candidate) => {
    const assessment = assessCandidate({ candidate, targets: options.targets });
    return {
      ...candidate,
      targetFit: assessment.targetFit,
      contactQuality: assessment.contactQuality,
      eligibility: assessment.eligibility,
      rejectionReasons: assessment.rejectionReasons,
      suggestedService: assessment.suggestedService,
    };
  });
}

/** Builds + assesses every staged candidate for a run's leads. */
export function buildStagedCandidates(
  leads: BridgeLead[],
  ctx: BridgeContext,
  options: NormalizedResearchOptions,
): AssessedCandidate[] {
  return assessStagedCandidates(
    leads.map((lead) => scrapedLeadToCandidate(lead, ctx)),
    options,
  );
}

/**
 * Reverse bridge for POST /logs/:logId/import-selected: an assessed
 * candidate back to an importable lead. Synthetic contacts are dropped, never
 * imported as destinations — a candidate with no real contact left over is
 * rejected by the caller. The placeholder seed stays stable (provider id) so
 * re-imports dedupe instead of duplicating.
 */
export function stagedCandidateToLead(candidate: AssessedCandidate): {
  ok: boolean;
  lead?: BridgeLead & { source_platform: string };
  reason?: string;
} {
  if (candidate.eligibility !== 'eligible') {
    return { ok: false, reason: 'candidate_not_eligible' };
  }
  const email = candidate.contacts.find(
    (c) => c.channel === 'email' && (c.state === 'observed' || c.state === 'dns_supported'),
  )?.value;
  const phone = candidate.contacts.find(
    (c) => c.channel === 'phone' && c.state === 'observed',
  )?.value;
  if (!email && !phone) {
    return { ok: false, reason: 'synthetic_only' };
  }
  const providerSeed =
    candidate.provider.id ?? `${candidate.business.name}|${candidate.business.location}`;
  const seedHash = createHash('sha256').update(providerSeed).digest('hex').slice(0, 40);
  return {
    ok: true,
    lead: {
      business_name: candidate.business.name,
      google_place_id:
        candidate.provider.kind === 'google_place'
          ? (candidate.provider.id ?? undefined)
          : undefined,
      phone,
      email: email ?? `no-reply-${seedHash}@review-staged.local`,
      website: candidate.business.website,
      industry: candidate.business.industry || undefined,
      location: candidate.business.location || undefined,
      source_platform:
        candidate.source.sourceType === 'google_places'
          ? 'google_business'
          : candidate.source.sourceType,
      fallback_id: candidate.provider.id ?? undefined,
    },
  };
}

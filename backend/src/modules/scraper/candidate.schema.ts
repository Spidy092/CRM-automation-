import { z } from 'zod';

/**
 * Internal research-candidate contract shared by every scraper source
 * (Google Places legacy + agent, web_scrape, browser_scrape, Facebook,
 * YouTube, Apify, Meta/Google-Ads/LinkedIn lead forms).
 *
 * INTERNAL ONLY — never parse request bodies with these schemas. Public APIs
 * must not allow callers to set provenance or trust flags; provenance/state
 * are assigned exclusively by server-side adapters and the quality pipeline
 * in `candidate.quality.ts`. The controller layer does not import this file.
 *
 * Staging note: candidates are staged in memory and surfaced through
 * `scraper_logs.raw_response.candidates` until a dedicated staging table is
 * approved. A record with only synthetic contacts is research-only and must
 * never be imported as a lead.
 */

export const candidateSourceTypeSchema = z.enum([
  'google_places',
  'facebook',
  'youtube',
  'web_scrape',
  'apify_actor',
  'browser_scrape',
  'meta_lead_forms',
  'google_ads_lead_forms',
  'linkedin_lead_forms',
]);

/** Stable provider identity kind — where the id was observed, if anywhere. */
export const providerKindSchema = z.enum([
  'google_place',
  'facebook_page',
  'youtube_channel',
  'meta_lead_submission',
  'google_ads_submission',
  'linkedin_submission',
  'apify_item',
  'website_page',
  'browser_page',
  'unknown',
]);

/**
 * How a contact value was obtained. Assigned server-side only.
 * `placeholder_synthetic` marks generated placeholders (never a destination).
 */
export const contactProvenanceSchema = z.enum([
  'google_places_observed',
  'website_mailto',
  'website_tel',
  'website_text',
  'facebook_page_field',
  'youtube_description',
  'apify_mapped_field',
  'form_submission',
  'placeholder_synthetic',
  'unknown',
]);

/**
 * Honest contact-quality state.
 *
 * - `observed`: value seen in provider data or page content with valid syntax.
 * - `malformed`: fails syntax checks; never importable on that channel.
 * - `disposable`: throwaway domain; never importable on that channel.
 * - `dns_supported`: domain has MX/A records. This is NOT proof the mailbox
 *   exists — it only means the domain can plausibly receive mail.
 * - `unknown`: DNS failed, was skipped, or no signal either way.
 * - `synthetic`: generated placeholder (`.local`, `+0…`); research-only.
 */
export const contactStateSchema = z.enum([
  'observed',
  'malformed',
  'disposable',
  'dns_supported',
  'unknown',
  'synthetic',
]);

export const contactChannelSchema = z.enum(['email', 'phone']);

export const researchContactSchema = z.object({
  channel: contactChannelSchema,
  value: z.string().trim().min(1).max(255),
  provenance: contactProvenanceSchema,
  state: contactStateSchema,
});

export const evidenceKindSchema = z.enum(['observed_fact', 'model_suggestion']);

export const researchEvidenceSchema = z.object({
  /** Bounded snippet — never a full page dump. */
  snippet: z.string().trim().min(1).max(500),
  url: z.string().url().max(2048).optional(),
  kind: evidenceKindSchema,
});

/** Fact seen in provider/page data, optionally linked to evidence. */
export const observedOpportunitySchema = z.object({
  fact: z.string().trim().min(1).max(500),
  evidenceUrl: z.string().url().max(2048).optional(),
});

/** Model guess — always kept separate from observed facts. */
export const modelSuggestionSchema = z.object({
  suggestion: z.string().trim().min(1).max(500),
  evidenceUrl: z.string().url().max(2048).optional(),
});

/** What this company can sell: websites, web applications, AI agents. */
export const serviceCategorySchema = z.enum(['website', 'web_application', 'ai_agent', 'none']);

export const candidateEligibilitySchema = z.enum(['eligible', 'research_only', 'rejected']);

/**
 * Operator-configurable targeting. Industry/location/service lists are
 * optional with NO built-in defaults — an empty list means "no filter".
 */
export const candidateTargetsSchema = z.object({
  industries: z.array(z.string().trim().min(1).max(100)).max(20).optional().default([]),
  locations: z.array(z.string().trim().min(1).max(255)).max(20).optional().default([]),
  requiredContactChannel: z.enum(['email', 'phone', 'either']).optional().default('either'),
  serviceCategories: z
    .array(z.enum(['website', 'web_application', 'ai_agent']))
    .max(10)
    .optional()
    .default([]),
});

export const researchCandidateSchema = z.object({
  provider: z.object({
    kind: providerKindSchema,
    /** Stable id where observed (place_id, channelId, submission id…); null when none. */
    id: z.string().trim().min(1).max(255).nullable(),
  }),
  source: z.object({
    sourceType: candidateSourceTypeSchema,
    configId: z.string().uuid().optional(),
    runId: z.string().uuid().optional(),
    collectedAt: z.string().datetime({ offset: true }),
  }),
  business: z.object({
    name: z.string().trim().min(1).max(255),
    website: z.string().url().max(2048).nullable().optional(),
    sourceUrls: z.array(z.string().url().max(2048)).max(10).default([]),
    location: z.string().trim().max(255).optional().default(''),
    industry: z.string().trim().max(100).optional().default(''),
  }),
  contacts: z.array(researchContactSchema).max(10).default([]),
  /** Bounded evidence snippets + URLs. Provider/page content is untrusted. */
  evidence: z.array(researchEvidenceSchema).max(10).default([]),
  /** Facts observed in provider/page data. */
  observedOpportunities: z.array(observedOpportunitySchema).max(10).default([]),
  /** Model guesses — never merged into observed facts. */
  modelSuggestions: z.array(modelSuggestionSchema).max(10).default([]),
});

export const assessedCandidateSchema = researchCandidateSchema.extend({
  targetFit: z.number().int().min(0).max(100),
  contactQuality: z.number().int().min(0).max(100),
  eligibility: candidateEligibilitySchema,
  rejectionReasons: z.array(z.string().trim().min(1).max(255)).max(10).default([]),
  suggestedService: serviceCategorySchema,
});

export type CandidateSourceType = z.infer<typeof candidateSourceTypeSchema>;
export type ProviderKind = z.infer<typeof providerKindSchema>;
export type ContactProvenance = z.infer<typeof contactProvenanceSchema>;
export type ContactState = z.infer<typeof contactStateSchema>;
export type ContactChannel = z.infer<typeof contactChannelSchema>;
export type ResearchContact = z.infer<typeof researchContactSchema>;
export type ResearchEvidence = z.infer<typeof researchEvidenceSchema>;
export type ObservedOpportunity = z.infer<typeof observedOpportunitySchema>;
export type ModelSuggestion = z.infer<typeof modelSuggestionSchema>;
export type ServiceCategory = z.infer<typeof serviceCategorySchema>;
export type CandidateEligibility = z.infer<typeof candidateEligibilitySchema>;
export type CandidateTargets = z.infer<typeof candidateTargetsSchema>;
export type ResearchCandidate = z.infer<typeof researchCandidateSchema>;
export type AssessedCandidate = z.infer<typeof assessedCandidateSchema>;

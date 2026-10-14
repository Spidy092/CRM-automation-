import {
  AssessedCandidate,
  CandidateTargets,
  ContactProvenance,
  ContactState,
  ResearchCandidate,
  ResearchContact,
  ServiceCategory,
} from './candidate.schema';
import { isEmailSyntaxValid, isDisposableDomain } from '../../shared/utils/email';
import { isE164, isPlaceholderEmail, isPlaceholderPhone } from '../../shared/utils/phone';

/**
 * Shared candidate quality pipeline (§1).
 *
 * Pure functions — no DB, no network, no model calls. DNS outcomes are passed
 * in by the caller (see `EmailDnsOutcome`); this module never performs DNS
 * itself so unit tests stay hermetic and adapters stay in control of I/O.
 *
 * Honesty rules enforced here:
 * - A record with only synthetic contacts is research-only, never eligible.
 * - A real (observed) phone keeps a candidate usable even when email DNS is
 *   negative or unknown.
 * - DNS/MX success is reported as `dns_supported`, never as proof that a
 *   mailbox exists.
 * - Ambiguous cross-source matches are grouped for review, never merged.
 */

/** DNS signal supplied by the adapter after calling `verifyEmail` (or skipping it). */
export type EmailDnsOutcome = 'valid_mx' | 'no_mx' | 'dns_failed' | 'not_checked';

export interface EmailClassificationInput {
  value: string;
  provenance: ContactProvenance;
  dns: EmailDnsOutcome;
}

export interface PhoneClassificationInput {
  value: string;
  provenance: ContactProvenance;
}

/**
 * Classify a single email value into an honest contact state.
 * Placeholder addresses are synthetic even when their syntax is valid.
 */
export function classifyEmailContact(input: EmailClassificationInput): ContactState {
  const value = input.value.trim().toLowerCase();
  if (!value || isPlaceholderEmail(value)) return 'synthetic';
  if (!isEmailSyntaxValid(value)) return 'malformed';
  if (isDisposableDomain(value)) return 'disposable';
  if (input.dns === 'valid_mx') return 'dns_supported';
  // `no_mx`, `dns_failed`, and `not_checked` are all "unknown": the domain
  // might still receive mail (transient DNS, A-record fallback, untested).
  // Callers must not describe `dns_supported` as mailbox proof either.
  return 'unknown';
}

/** Classify a single phone value. Placeholders are synthetic by construction. */
export function classifyPhoneContact(input: PhoneClassificationInput): ContactState {
  const value = input.value.trim();
  if (!value || isPlaceholderPhone(value)) return 'synthetic';
  if (isE164(value)) return 'observed';
  return 'malformed';
}

/**
 * Build a server-side contact record. Provenance is a parameter — never read
 * from public input — so callers cannot set trust flags over the API.
 */
export function makeEmailContact(
  value: string,
  provenance: ContactProvenance,
  dns: EmailDnsOutcome,
): ResearchContact {
  return {
    channel: 'email',
    value: value.trim().toLowerCase().slice(0, 255),
    provenance,
    state: classifyEmailContact({ value, provenance, dns }),
  };
}

/** Build a server-side phone contact record (same provenance rule as email). */
export function makePhoneContact(value: string, provenance: ContactProvenance): ResearchContact {
  return {
    channel: 'phone',
    value: value.trim().slice(0, 255),
    provenance,
    state: classifyPhoneContact({ value, provenance }),
  };
}

/** True when every contact is synthetic (or there are no contacts at all). */
export function isSyntheticOnly(contacts: ResearchContact[]): boolean {
  if (contacts.length === 0) return true;
  return contacts.every((c) => c.state === 'synthetic');
}

/** Usable email channels: observed or DNS-supported (not mailbox proof). */
function hasUsableEmail(contacts: ResearchContact[]): boolean {
  return contacts.some(
    (c) => c.channel === 'email' && (c.state === 'observed' || c.state === 'dns_supported'),
  );
}

/**
 * Email channels that are merely unknown (DNS failed/skipped, no MX) — still
 * worth showing in review, but not enough alone for email-channel eligibility.
 */
function hasUnknownEmail(contacts: ResearchContact[]): boolean {
  return contacts.some((c) => c.channel === 'email' && c.state === 'unknown');
}

function hasUsablePhone(contacts: ResearchContact[]): boolean {
  return contacts.some((c) => c.channel === 'phone' && c.state === 'observed');
}

function hasMalformedOnlyEmail(contacts: ResearchContact[]): boolean {
  const emails = contacts.filter((c) => c.channel === 'email');
  return (
    emails.length > 0 && emails.every((c) => c.state === 'malformed' || c.state === 'disposable')
  );
}

/**
 * Contact-quality score (0–100). Synthetic-only scores 0. A real observed
 * phone alone scores well because phone remains a usable channel even when
 * email DNS is negative or unknown.
 */
export function scoreContactQuality(contacts: ResearchContact[]): number {
  if (contacts.length === 0) return 0;
  if (isSyntheticOnly(contacts)) return 0;
  const email = hasUsableEmail(contacts);
  const phone = hasUsablePhone(contacts);
  if (email && phone) return 95;
  if (email) return 80;
  if (phone) return 70;
  if (hasUnknownEmail(contacts) && phone) return 70;
  if (hasUnknownEmail(contacts)) return 40;
  return 20;
}

/**
 * Target-fit score (0–100) against operator-configured targets.
 * Empty target lists mean "no filter" and score neutral (50) rather than
 * penalizing the candidate — defaults are never invented.
 */
export function scoreTargetFit(candidate: ResearchCandidate, targets: CandidateTargets): number {
  const industries = targets.industries ?? [];
  const locations = targets.locations ?? [];
  if (industries.length === 0 && locations.length === 0) return 50;

  let score = 50;
  const industry = candidate.business.industry.trim().toLowerCase();
  const location = candidate.business.location.trim().toLowerCase();

  if (industries.length > 0) {
    const match = industries.some(
      (t) => industry.length > 0 && industry.includes(t.trim().toLowerCase()),
    );
    score += match ? 25 : -25;
  }
  if (locations.length > 0) {
    const match = locations.some(
      (t) => location.length > 0 && location.includes(t.trim().toLowerCase()),
    );
    score += match ? 25 : -25;
  }
  return Math.max(0, Math.min(100, score));
}

function channelSatisfied(
  contacts: ResearchContact[],
  required: CandidateTargets['requiredContactChannel'],
): boolean {
  if (required === 'email') return hasUsableEmail(contacts);
  if (required === 'phone') return hasUsablePhone(contacts);
  return hasUsableEmail(contacts) || hasUsablePhone(contacts);
}

/**
 * Suggest a service category from observed opportunity facts only — model
 * suggestions never drive the category. Keyword matching is intentionally
 * conservative; ambiguous or empty evidence yields `none`.
 */
export function suggestServiceCategory(candidate: ResearchCandidate): ServiceCategory {
  const text = candidate.observedOpportunities.map((o) => o.fact.toLowerCase()).join(' ');
  if (!text.trim()) return 'none';
  const hasAi = /(ai agent|chatbot|automation|llm|gpt|machine learning)/.test(text);
  const hasWebApp = /(web app|web application|portal|dashboard|saas|platform|booking system)/.test(
    text,
  );
  const hasWebsite =
    /(no website|outdated website|no online presence|needs a website|website redesign|new website)/.test(
      text,
    );
  if (hasAi) return 'ai_agent';
  if (hasWebApp) return 'web_application';
  if (hasWebsite) return 'website';
  return 'none';
}

export interface AssessCandidateInput {
  candidate: ResearchCandidate;
  targets: CandidateTargets;
}

export interface CandidateAssessment {
  targetFit: number;
  contactQuality: number;
  eligibility: AssessedCandidate['eligibility'];
  rejectionReasons: string[];
  suggestedService: ServiceCategory;
}

/**
 * Review/import eligibility for one candidate.
 *
 * - `eligible`: at least one usable contact on the required channel.
 * - `research_only`: synthetic-only, or usable data worth reviewing but not
 *   importing (e.g. unknown email with no phone).
 * - `rejected`: no contacts, malformed/disposable-only email with no usable
 *   phone, or required channel unmet with nothing worth reviewing.
 */
export function assessCandidate(input: AssessCandidateInput): CandidateAssessment {
  const { candidate, targets } = input;
  const contacts = candidate.contacts;
  const rejectionReasons: string[] = [];

  const targetFit = scoreTargetFit(candidate, targets);
  const contactQuality = scoreContactQuality(contacts);
  const suggestedService = suggestServiceCategory(candidate);

  if (contacts.length === 0) {
    return {
      targetFit,
      contactQuality,
      eligibility: 'rejected',
      rejectionReasons: ['no_contact'],
      suggestedService,
    };
  }

  if (isSyntheticOnly(contacts)) {
    return {
      targetFit,
      contactQuality,
      eligibility: 'research_only',
      rejectionReasons: ['synthetic_only'],
      suggestedService,
    };
  }

  // Disposable/malformed email is a channel rejection, not necessarily a
  // candidate rejection — a real phone keeps the candidate usable.
  const usablePhone = hasUsablePhone(contacts);
  const usableEmail = hasUsableEmail(contacts);
  const unknownEmail = hasUnknownEmail(contacts);

  if (hasMalformedOnlyEmail(contacts) && !usablePhone) {
    rejectionReasons.push('email_malformed_or_disposable');
  }

  if (channelSatisfied(contacts, targets.requiredContactChannel ?? 'either')) {
    if (rejectionReasons.length > 0 && !usablePhone && !usableEmail) {
      return {
        targetFit,
        contactQuality,
        eligibility: 'rejected',
        rejectionReasons,
        suggestedService,
      };
    }
    return {
      targetFit,
      contactQuality,
      eligibility: 'eligible',
      rejectionReasons,
      suggestedService,
    };
  }

  // Required channel unmet. Phone-only candidates stay eligible when the
  // operator accepts either channel; unknown-email-only candidates are
  // research-only so an operator can review rather than lose them.
  if (usablePhone) {
    rejectionReasons.push('required_channel_unmet_phone_available');
    return {
      targetFit,
      contactQuality,
      eligibility: 'research_only',
      rejectionReasons,
      suggestedService,
    };
  }
  if (usableEmail) {
    rejectionReasons.push('required_channel_unmet_email_available');
    return {
      targetFit,
      contactQuality,
      eligibility: 'research_only',
      rejectionReasons,
      suggestedService,
    };
  }
  if (unknownEmail) {
    rejectionReasons.push('email_dns_unknown_needs_review');
    return {
      targetFit,
      contactQuality,
      eligibility: 'research_only',
      rejectionReasons,
      suggestedService,
    };
  }
  rejectionReasons.push('no_usable_contact_for_required_channel');
  return {
    targetFit,
    contactQuality,
    eligibility: 'rejected',
    rejectionReasons,
    suggestedService,
  };
}

/** Attach an assessment to a candidate (staging shape for review-first UI). */
export function toAssessedCandidate(input: AssessCandidateInput): AssessedCandidate {
  const assessment = assessCandidate(input);
  return {
    ...input.candidate,
    targetFit: assessment.targetFit,
    contactQuality: assessment.contactQuality,
    eligibility: assessment.eligibility,
    rejectionReasons: assessment.rejectionReasons,
    suggestedService: assessment.suggestedService,
  };
}

// ── Deduplication ────────────────────────────────────────────────────────────

export interface DedupeResult {
  /** First-seen candidate per stable provider identity. */
  unique: ResearchCandidate[];
  /** Candidates dropped as provider-identity duplicates (indices into input). */
  providerDuplicates: number[];
  /**
   * Groups of candidates that look like the same business across sources but
   * share no stable provider id — returned for human review, NEVER auto-merged.
   * Grouping keys are opaque labels (never a merge decision).
   */
  reviewGroups: ResearchCandidate[][];
}

function providerKey(candidate: ResearchCandidate): string | null {
  const id = candidate.provider.id?.trim();
  if (!id) return null;
  return `${candidate.provider.kind}:${id}`;
}

function normalizeBusinessKey(candidate: ResearchCandidate): string | null {
  const name = candidate.business.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  const loc = candidate.business.location
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  if (!name) return null;
  // Name alone is never enough to merge — location is required to even flag
  // for review, and even then the group is review-only.
  if (!loc) return null;
  return `${name}|${loc}`;
}

/**
 * Deduplicate by stable provider identity first. Candidates without a stable
 * id are never merged on name, domain, shared inbox, or switchboard number
 * alone — ambiguous cross-source matches are grouped for review instead.
 */
export function dedupeCandidates(candidates: ResearchCandidate[]): DedupeResult {
  const seenProvider = new Map<string, number>();
  const unique: ResearchCandidate[] = [];
  const providerDuplicates: number[] = [];
  const indexByProviderSlot: number[] = [];

  candidates.forEach((candidate, index) => {
    const key = providerKey(candidate);
    if (key) {
      if (seenProvider.has(key)) {
        providerDuplicates.push(index);
        return;
      }
      seenProvider.set(key, unique.length);
    }
    indexByProviderSlot.push(index);
    unique.push(candidate);
  });

  // Ambiguous cross-source review groups: same normalized name+location but
  // different (or missing) provider identities. Review-only — no merging.
  const byBusiness = new Map<string, ResearchCandidate[]>();
  for (const candidate of unique) {
    // Skip candidates that already share a provider identity — they are the
    // same record, not an ambiguous match.
    const businessKey = normalizeBusinessKey(candidate);
    if (!businessKey) continue;
    const group = byBusiness.get(businessKey) ?? [];
    group.push(candidate);
    byBusiness.set(businessKey, group);
  }
  const reviewGroups: ResearchCandidate[][] = [];
  for (const group of byBusiness.values()) {
    const identities = new Set(group.map((c) => providerKey(c) ?? `noid:${c.business.name}`));
    if (group.length > 1 && identities.size > 1) reviewGroups.push(group);
  }

  return { unique, providerDuplicates, reviewGroups };
}

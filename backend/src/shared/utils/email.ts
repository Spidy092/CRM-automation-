import dns from 'dns/promises';
import { logger } from './logger';

/**
 * Lightweight email verification utilities — no external API calls.
 * Checks syntax, disposable domains, and MX records.
 */

// ── Disposable / throwaway email blocklist ─────────────────────────────────

const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'tempmail.com', 'throwaway.email',
  'yopmail.com', 'sharklasers.com', 'guerrillamailblock.com', 'grr.la',
  'dispostable.com', 'trashmail.com', 'mailnesia.com', 'maildrop.cc',
  'tempail.com', 'tempr.email', 'temp-mail.org', 'fakeinbox.com',
  'sharklasers.com', 'guerrillamail.info', 'guerrillamail.de',
  'guerillamail.com', 'guerrillamail.net', 'guerrillamail.org',
  '10minutemail.com', 'getairmail.com', 'mohmal.com', 'burnermail.io',
  'inbox.testmail.app', 'safetymail.info', 'mailsac.com',
]);

// ── Common typo suggestions ────────────────────────────────────────────────

const TYPO_MAP: Record<string, string> = {
  'gmial.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gmal.com': 'gmail.com',
  'gamil.com': 'gmail.com',
  'gmaill.com': 'gmail.com',
  'gmail.co': 'gmail.com',
  'hotmial.com': 'hotmail.com',
  'hotmal.com': 'hotmail.com',
  'hotmai.com': 'hotmail.com',
  'hotmil.com': 'hotmail.com',
  'outlok.com': 'outlook.com',
  'outloo.com': 'outlook.com',
  'yaho.com': 'yahoo.com',
  'yahooo.com': 'yahoo.com',
  'yhaoo.com': 'yahoo.com',
  'iclod.com': 'icloud.com',
  'iclaud.com': 'icloud.com',
};

// ── Public API ─────────────────────────────────────────────────────────────

export interface EmailVerificationResult {
  valid: boolean;
  normalized: string;
  reason?: string;
  suggestion?: string;
}

/**
 * Full email verification pipeline:
 *  1. Syntax check (RFC 5322 simplified)
 *  2. Normalize (trim, lowercase)
 *  3. Disposable domain check
 *  4. Typo suggestion
 *  5. MX record check (DNS)
 *
 * Returns a result with `valid: false` and a `reason` when the email
 * should be skipped, or `valid: true` with the normalized address.
 */
export async function verifyEmail(rawEmail: string): Promise<EmailVerificationResult> {
  const email = rawEmail.trim().toLowerCase();

  // 1. Basic syntax
  if (!BASIC_EMAIL_RE.test(email)) {
    return { valid: false, normalized: email, reason: 'invalid_syntax' };
  }

  const domain = email.split('@')[1];

  // 2. Disposable domain
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { valid: false, normalized: email, reason: 'disposable_domain' };
  }

  // 3. Typo suggestion (still valid, just flag the suggestion)
  const suggestion = TYPO_MAP[domain];

  // 4. MX record check — if the domain has no MX and no A record, it can't receive mail
  try {
    const mx = await dns.resolveMx(domain);
    if (!mx || mx.length === 0) {
      // Fall back to A record check
      const a = await dns.resolve4(domain).catch(() => []);
      if (!a || a.length === 0) {
        return { valid: false, normalized: email, reason: 'no_mx_record', suggestion };
      }
    }
  } catch {
    // DNS lookup failed — domain doesn't exist or is unreachable
    return { valid: false, normalized: email, reason: 'dns_lookup_failed', suggestion };
  }

  return { valid: true, normalized: email, suggestion };
}

/**
 * Fast synchronous check — syntax + disposable only, no DNS.
 * Use this for bulk pre-filtering before the async MX check.
 */
export function isEmailSyntaxValid(email: string): boolean {
  return BASIC_EMAIL_RE.test(email.trim().toLowerCase());
}

export function isDisposableDomain(email: string): boolean {
  const domain = email.trim().toLowerCase().split('@')[1];
  return DISPOSABLE_DOMAINS.has(domain);
}

export function getEmailTypoSuggestion(email: string): string | undefined {
  const domain = email.trim().toLowerCase().split('@')[1];
  return TYPO_MAP[domain];
}

// ── Internal ───────────────────────────────────────────────────────────────

/**
 * Simplified RFC 5322 email regex — catches 99.9% of real-world emails
 * without accepting obviously garbage strings.
 */
const BASIC_EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/**
 * Bulk-verify a list of emails with concurrency control.
 * Returns a map of email → verification result.
 */
export async function verifyEmails(
  emails: string[],
  concurrency = 5,
): Promise<Map<string, EmailVerificationResult>> {
  const results = new Map<string, EmailVerificationResult>();
  const unique = [...new Set(emails.filter((e) => e && e.trim().length > 0))];

  // Process in batches to avoid DNS flooding
  for (let i = 0; i < unique.length; i += concurrency) {
    const batch = unique.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((e) => verifyEmail(e)));
    for (let j = 0; j < batch.length; j++) {
      results.set(batch[j], batchResults[j]);
    }
  }

  return results;
}

/**
 * Log email verification stats for observability.
 */
export function logVerificationStats(
  results: Map<string, EmailVerificationResult>,
  context: { configId?: string; logId?: string } = {},
): void {
  let valid = 0;
  let invalidSyntax = 0;
  let disposable = 0;
  let noMx = 0;
  let dnsFailed = 0;
  let suggestions = 0;

  for (const r of results.values()) {
    if (r.valid) valid++;
    else if (r.reason === 'invalid_syntax') invalidSyntax++;
    else if (r.reason === 'disposable_domain') disposable++;
    else if (r.reason === 'no_mx_record') noMx++;
    else if (r.reason === 'dns_lookup_failed') dnsFailed++;
    if (r.suggestion) suggestions++;
  }

  logger.info('email verification stats', {
    ...context,
    total: results.size,
    valid,
    invalidSyntax,
    disposable,
    noMx,
    dnsFailed,
    suggestions,
  });
}

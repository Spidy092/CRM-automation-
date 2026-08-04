/**
 * Best-effort phone normalization toward E.164.
 *
 * TRD §8.3 requires phones to be normalized to E.164 before insert so the
 * phone-based dedup index matches variants of the same number.
 *
 * Phase 1 uses a lightweight normalizer (no external lib) that:
 *   - trims and strips whitespace, dashes, parentheses, dots
 *   - converts a leading `00` international prefix to `+`
 *   - prefixes `+` to a digits-only string (assumed already international)
 *   - returns the cleaned `+<digits>` form when it looks like E.164 (6–15 digits)
 *
 * Limitation: it does NOT map local national numbers (e.g. leading `0` trunk
 * codes) to a country code, since the country is not always known. Upgrade to
 * `libphonenumber-js` in a later phase if richer normalization is required
 * (installing it needs explicit approval per AGENTS.md).
 */
export function normalizePhone(raw: string): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';

  let s = trimmed.replace(/[\s\-().]/g, '');

  if (s.startsWith('00')) {
    s = '+' + s.slice(2);
  } else if (/^\d+$/.test(s)) {
    // digits only with no country code -> assume international, prefix +
    s = '+' + s;
  }

  // strip anything that is not a digit or the leading +
  if (s.startsWith('+')) {
    s = '+' + s.slice(1).replace(/[^0-9]/g, '');
  } else {
    s = s.replace(/[^0-9]/g, '');
  }

  // E.164: + followed by 6 to 15 digits
  if (/^\+\d{6,15}$/.test(s)) {
    return s;
  }

  // Could not normalize to E.164; return the cleaned original so it is still
  // stored consistently rather than discarded.
  return trimmed.replace(/[\s\-().]/g, '');
}

/** True when the value is a plausible normalized phone (`+<6-15 digits>`). */
export function isE164(value: string): boolean {
  return /^\+\d{6,15}$/.test(value);
}

/**
 * True when a phone looks like the scraper's deterministic placeholder
 * (`generatePlaceholderPhone` in scraper.service.ts): `+0` followed by 10
 * digits. No real country code starts with 0, so this pattern is unambiguous
 * and never collides with a genuine E.164 number.
 */
export function isPlaceholderPhone(value: string): boolean {
  return /^\+0\d{9,}$/.test(value);
}

/**
 * True when an email looks like a scraper-generated placeholder
 * (`generatePlaceholderEmail` in scraper.service.ts uses a `*-scraped.local`
 * domain). `.local` is a reserved, non-routable TLD, so any address ending in
 * it is synthetic regardless of which scraper produced it.
 */
export function isPlaceholderEmail(value: string): boolean {
  return /\.local$/i.test(value.trim());
}

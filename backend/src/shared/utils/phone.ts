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

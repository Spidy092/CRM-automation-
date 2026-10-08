/**
 * Merge-field helpers shared by every surface that composes template bodies —
 * the full template editor and the inline composer in the campaign wizard.
 * Keep the pattern in one place so both derive the same `variables` array.
 */

const VARIABLE_PATTERN = /\{\{(\w+)\}\}/g;

/** Collect the distinct `{{merge_field}}` names used in a template body. */
export function extractVariables(body: string): string[] {
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  VARIABLE_PATTERN.lastIndex = 0;
  while ((m = VARIABLE_PATTERN.exec(body)) !== null) {
    found.add(m[1]);
  }
  return Array.from(found);
}

/** Store the email button in the existing template body; no separate campaign configuration. */
export function buildPortfolioButton(url: string): string {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Choose a portfolio with an HTTP or HTTPS link.');
  }
  const href = parsed.href.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<a data-crm-portfolio="true" href="${href}" style="display:inline-block;padding:12px 20px;background-color:#4338ca;color:#ffffff;text-decoration:none;border-radius:6px;font-family:Arial,sans-serif;font-weight:bold;">View portfolio</a>`;
}

/** Read only our generated button. Never render arbitrary template HTML in the app. */
export function splitPortfolioButton(body: string): { text: string; url: string | null } {
  let url: string | null = null;
  const text = body.replace(/<a\s+data-crm-portfolio="true"[^>]*>[\s\S]*?<\/a>/gi, (button) => {
    const anchor = new DOMParser().parseFromString(button, 'text/html').querySelector('a');
    try {
      const parsed = new URL(anchor?.getAttribute('href') ?? '');
      if (['http:', 'https:'].includes(parsed.protocol)) url = parsed.href;
    } catch {
      // Invalid links are not offered as clickable previews.
    }
    return '';
  }).trim();
  return { text, url };
}

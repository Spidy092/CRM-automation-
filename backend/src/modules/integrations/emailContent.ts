/** Preserve link destinations for recipients who read the plain-text email. */
export function emailHtmlToText(html: string): string {
  return html
    .replace(
      /<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
      (_match, href: string, label: string) =>
        `${label} (${href.replace(/&amp;/g, '&').replace(/&quot;/g, '"')})`,
    )
    .replace(/<[^>]*>/g, '');
}

/**
 * Template design system — shared backend core.
 *
 * Covers the three email authoring modes (`simple` | `visual` | `html`) plus
 * channel-specific validation for WhatsApp and SMS:
 *
 *   - `templateDesignSchema` — versioned, size-bounded Zod schema for the
 *     structured visual-design document. All design JSON is validated
 *     server-side before persistence (design docs are untrusted input).
 *   - `renderDesignToHtml` / `designToText` — deterministic, email-safe
 *     renderer (table-based, inline styles only). The structured document is
 *     always stored alongside the rendered output so reopening a template
 *     never depends on reverse-engineering HTML.
 *   - `sanitizeCustomHtml` — explicit-allowlist sanitizer for pasted/imported
 *     custom HTML (no scripts, event handlers, or unsafe protocols).
 *   - Personalization helpers — the same `{{variable}}` catalog and fallback
 *     substitution as `outreach.prompt.ts`, plus sample (non-PII) values for
 *     preview, context-aware escaping, and rendered-link validation.
 *   - `estimateSmsSegments` — GSM-7 vs UCS-2 segment estimator for the SMS
 *     plain-text editor.
 *   - `validateWhatsappBody` — validation against the actual WhatsApp Cloud
 *     API connector capabilities (`whatsapp.connector.ts`: text ≤ 4096 chars,
 *     optional single image/document media, template params as free text).
 *
 * No new runtime dependencies: sanitization is implemented with explicit
 * parsing helpers only (cheerio is intentionally avoided here so the renderer
 * stays deterministic and dependency-free).
 */

import { z } from 'zod';

// ── Variable catalog ─────────────────────────────────────────────────────────
// Mirrors the fallback vocabulary in `outreach.prompt.ts performFallback`
// (both the scraper-oriented and contact-oriented names used across existing
// templates). Single source of truth for editors, preview, and validation.

export const TEMPLATE_VARIABLE_CATALOG = [
  'business_name',
  'company_name',
  'contact_name',
  'client_name',
  'first_name',
  'industry',
  'location',
  'country',
  'rating',
  'source_platform',
  'classification',
  'unsubscribe_link',
] as const;

export type TemplateVariableName = (typeof TEMPLATE_VARIABLE_CATALOG)[number];

/**
 * Clearly-labeled fictional sample values for preview only. These are NOT
 * real lead data — previews must never use real lead PII.
 */
export const TEMPLATE_SAMPLE_VALUES: Record<string, string> = {
  business_name: 'Harbor Dental Studio',
  company_name: 'Harbor Dental Studio',
  contact_name: 'Jordan Lee',
  client_name: 'Jordan Lee',
  first_name: 'Jordan',
  industry: 'dental care',
  location: 'Portland',
  country: 'USA',
  rating: '4.8',
  source_platform: 'sample import',
  classification: 'warm',
  unsubscribe_link: 'https://example.com/unsubscribe?token=sample-token',
};

const VARIABLE_PATTERN = /\{\{\s*(\w+)\s*\}\}/g;

/** Distinct `{{variable}}` names referenced in a free-text string. */
export function extractVariableNames(text: string): string[] {
  const found = new Set<string>();
  VARIABLE_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = VARIABLE_PATTERN.exec(text)) !== null) found.add(m[1]);
  return Array.from(found);
}

/** Names referenced in `text` that are not in the supported catalog. */
export function findInvalidVariables(text: string): string[] {
  const allowed = new Set<string>(TEMPLATE_VARIABLE_CATALOG);
  return extractVariableNames(text).filter((v) => !allowed.has(v));
}

/** Escape a substituted value for an HTML text context. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Substitute `{{variables}}` using lead-like values. HTML-escapes values when
 * `htmlContext` is true (visual/custom-HTML email rendering); leaves plain
 * text untouched for SMS/WhatsApp/simple bodies. Unknown placeholders are
 * stripped, matching the existing outreach fallback behavior.
 */
export function substituteVariables(
  text: string,
  values: Record<string, string>,
  htmlContext: boolean,
): string {
  const replaced = text.replace(VARIABLE_PATTERN, (_match, name: string) => {
    const raw = values[name] ?? '';
    return htmlContext ? escapeHtml(raw) : raw;
  });
  return replaced.replace(/\{\{[^}]+\}\}/g, '');
}

/** Build the preview value map: sample values overridden by `overrides`. */
export function previewValues(overrides?: Record<string, string>): Record<string, string> {
  return { ...TEMPLATE_SAMPLE_VALUES, ...(overrides ?? {}) };
}

// ── Rendered link validation ─────────────────────────────────────────────────

const ALLOWED_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/** True when an href uses an allowed protocol (http/https/mailto/tel). */
export function isSafeLink(href: string): boolean {
  const trimmed = href.trim();
  if (!trimmed) return false;
  // A bare personalization placeholder (e.g. {{unsubscribe_link}}) is resolved
  // at send time and validated after substitution — never a raw protocol.
  if (/^\{\{\s*\w+\s*\}\}$/.test(trimmed)) return true;
  // Relative anchors/paths are safe (no protocol to abuse).
  if (trimmed.startsWith('#') || trimmed.startsWith('/')) return true;
  try {
    const parsed = new URL(trimmed);
    return ALLOWED_LINK_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

/** Collect every href/src destination in rendered HTML output. */
export function collectLinkDestinations(html: string): string[] {
  const out: string[] = [];
  const re = /(?:href|src)\s*=\s*"([^"]*)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

/** Destinations in rendered HTML that fail `isSafeLink`. */
export function findUnsafeLinks(html: string): string[] {
  return collectLinkDestinations(html).filter((href) => !isSafeLink(href));
}

// ── Custom HTML sanitizer (explicit allowlist) ───────────────────────────────

const ALLOWED_HTML_TAGS = new Set([
  'a',
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'table',
  'tbody',
  'thead',
  'tfoot',
  'tr',
  'td',
  'th',
  'div',
  'span',
  'img',
  'hr',
  'blockquote',
  'pre',
  'center',
]);

const ALLOWED_HTML_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'title', 'target', 'style', 'data-crm-portfolio']),
  p: new Set(['style', 'align']),
  div: new Set(['style', 'align']),
  span: new Set(['style']),
  img: new Set(['src', 'alt', 'title', 'width', 'height', 'style', 'align']),
  table: new Set([
    'style',
    'width',
    'cellpadding',
    'cellspacing',
    'border',
    'bgcolor',
    'align',
    'role',
  ]),
  tbody: new Set(['style']),
  thead: new Set(['style']),
  tfoot: new Set(['style']),
  tr: new Set(['style', 'bgcolor', 'align']),
  td: new Set(['style', 'width', 'align', 'valign', 'colspan', 'rowspan', 'bgcolor']),
  th: new Set(['style', 'width', 'align', 'valign', 'colspan', 'rowspan', 'bgcolor']),
  h1: new Set(['style', 'align']),
  h2: new Set(['style', 'align']),
  h3: new Set(['style', 'align']),
  h4: new Set(['style', 'align']),
  ul: new Set(['style']),
  ol: new Set(['style']),
  li: new Set(['style']),
  hr: new Set(['style', 'width', 'align']),
  blockquote: new Set(['style']),
  pre: new Set(['style']),
  strong: new Set(['style']),
  b: new Set(['style']),
  em: new Set(['style']),
  i: new Set(['style']),
  u: new Set(['style']),
  br: new Set([]),
  center: new Set(['style']),
};

const ALLOWED_STYLE_PROPS = new Set([
  'color',
  'background',
  'background-color',
  'font',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-align',
  'text-decoration',
  'line-height',
  'letter-spacing',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'border',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-color',
  'border-radius',
  'border-collapse',
  'width',
  'max-width',
  'min-width',
  'height',
  'max-height',
  'display',
  'vertical-align',
]);

/** Strip disallowed declarations from an inline style value. */
export function sanitizeInlineStyle(style: string): string {
  return style
    .split(';')
    .map((d) => d.trim())
    .filter((d) => {
      if (!d) return false;
      const colon = d.indexOf(':');
      if (colon === -1) return false;
      const prop = d.slice(0, colon).trim().toLowerCase();
      const value = d
        .slice(colon + 1)
        .trim()
        .toLowerCase();
      if (!ALLOWED_STYLE_PROPS.has(prop)) return false;
      // No active content through CSS: no url(), expressions, or bindings.
      if (/url\s*\(|expression\s*\(|behaviour|behavior|binding|-moz-binding/.test(value))
        return false;
      return true;
    })
    .join('; ');
}

function sanitizeAttributes(tag: string, rawAttrs: string): string {
  const allowed = ALLOWED_HTML_ATTRS[tag] ?? new Set<string>();
  const out: string[] = [];
  const re = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rawAttrs)) !== null) {
    const name = m[1].toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    // Drop all event handlers and scriptable attributes.
    if (name.startsWith('on')) continue;
    if (!allowed.has(name)) {
      // Preserve the portfolio marker rendered as data-crm-portfolio="true".
      if (!(tag === 'a' && name === 'data-crm-portfolio')) continue;
    }
    if (name === 'href') {
      const decoded = value.replace(/&amp;/g, '&').replace(/&quot;/g, '"');
      if (!isSafeLink(decoded)) continue;
      out.push(`href="${escapeHtml(decoded)}"`);
      continue;
    }
    if (name === 'src') {
      const decoded = value.replace(/&amp;/g, '&').replace(/&quot;/g, '"');
      // Images may only load http(s) resources — no data: or scriptable URLs.
      try {
        const parsed = new URL(decoded);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
      } catch {
        continue;
      }
      out.push(`src="${escapeHtml(decoded)}"`);
      continue;
    }
    if (name === 'style') {
      const clean = sanitizeInlineStyle(value);
      if (clean) out.push(`style="${escapeHtml(clean)}"`);
      continue;
    }
    if (name === 'target') {
      if (value !== '_blank' && value !== '_self') continue;
      out.push('target="_blank"');
      continue;
    }
    if (value === '') {
      if (name === 'data-crm-portfolio') out.push('data-crm-portfolio="true"');
      continue;
    }
    out.push(`${name}="${escapeHtml(value)}"`);
  }
  return out.length > 0 ? ` ${out.join(' ')}` : '';
}

export interface SanitizeResult {
  html: string;
  /** True when disallowed content was removed (scripts, handlers, tags). */
  stripped: boolean;
}

/**
 * Sanitize pasted/imported custom HTML against the explicit allowlist.
 * Rejects (strips) scripts, event handlers, unsafe protocols, and
 * unsupported active content (script/style/iframe/object/embed/form/
 * input/meta/link/base). Always returns safe HTML — never throws.
 */
export function sanitizeCustomHtml(input: string): SanitizeResult {
  let stripped = false;
  // Remove entire dangerous elements including their content first.
  const dangerous =
    /<(script|style|iframe|object|embed|form|input|button|meta|link|base|title|head)\b[^>]*>[\s\S]*?<\/\1\s*>|<(script|style|iframe|object|embed|form|input|button|meta|link|base)\b[^>]*\/?>/gi;
  let html = input.replace(dangerous, () => {
    stripped = true;
    return '';
  });
  // Strip comments and doctype/processing instructions.
  html = html.replace(/<!--[\s\S]*?-->/g, () => {
    stripped = true;
    return '';
  });
  html = html.replace(/<![^>]*>/g, () => {
    stripped = true;
    return '';
  });
  html = html.replace(/<\?[^?]*\?>/g, () => {
    stripped = true;
    return '';
  });

  const voidTags = new Set(['br', 'img', 'hr']);
  html = html.replace(
    /<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^<>]*)(\/?)>/g,
    (match, tagName: string, attrs: string, selfClose: string) => {
      const tag = String(tagName).toLowerCase();
      const isClose = match.startsWith('</');
      if (!ALLOWED_HTML_TAGS.has(tag)) {
        stripped = true;
        return '';
      }
      if (isClose) {
        if (voidTags.has(tag)) {
          stripped = true;
          return '';
        }
        return `</${tag}>`;
      }
      const cleanAttrs = sanitizeAttributes(tag, attrs);
      if (cleanAttrs.length !== ` ${attrs.trim()}`.length && attrs.trim()) {
        // Attribute-level filtering happened (or whitespace normalized) — mark
        // stripped only when something substantive was dropped.
        if (!match.includes(cleanAttrs.trim()) && cleanAttrs === '' && attrs.trim() !== '') {
          stripped = true;
        }
      }
      if (voidTags.has(tag)) return `<${tag}${cleanAttrs} />`;
      void _unused(selfClose);
      return `<${tag}${cleanAttrs}>`;
    },
  );

  return { html, stripped };
}

function _unused(_v: unknown): void {
  // no-op: keeps the self-closing marker acknowledged without lint noise.
}

// ── Visual design document (versioned) ───────────────────────────────────────

export const TEMPLATE_DESIGN_VERSION = 1;
const MAX_BLOCKS = 60;
const MAX_TEXT_LENGTH = 20000;
const MAX_URL_LENGTH = 2048;

const hexColor = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'must be a hex color');

const alignEnum = z.enum(['left', 'center', 'right']);
const buttonShapeEnum = z.enum(['square', 'rounded', 'pill']);

const textBlockProps = z
  .object({
    text: z.string().max(MAX_TEXT_LENGTH).default(''),
    fontSize: z.number().int().min(8).max(72).default(16),
    color: hexColor.default('#1e293b'),
    align: alignEnum.default('left'),
    bold: z.boolean().default(false),
    italic: z.boolean().default(false),
  })
  .strict();

const imageBlockProps = z
  .object({
    src: z.string().max(MAX_URL_LENGTH).default(''),
    alt: z.string().max(255).default(''),
    href: z.string().max(MAX_URL_LENGTH).default(''),
    width: z.number().int().min(16).max(1200).default(600),
    align: alignEnum.default('center'),
  })
  .strict();

const buttonBlockProps = z
  .object({
    label: z.string().min(1).max(120).default('Learn more'),
    href: z.string().max(MAX_URL_LENGTH).default(''),
    backgroundColor: hexColor.default('#4338ca'),
    textColor: hexColor.default('#ffffff'),
    shape: buttonShapeEnum.default('rounded'),
    align: alignEnum.default('center'),
  })
  .strict();

const dividerBlockProps = z
  .object({
    color: hexColor.default('#e2e8f0'),
    thickness: z.number().int().min(1).max(12).default(1),
    spacing: z.number().int().min(0).max(80).default(16),
  })
  .strict();

const spacerBlockProps = z
  .object({
    height: z.number().int().min(4).max(200).default(24),
  })
  .strict();

const columnCellSchema = z
  .object({
    text: z.string().max(MAX_TEXT_LENGTH).default(''),
    imageSrc: z.string().max(MAX_URL_LENGTH).default(''),
    imageAlt: z.string().max(255).default(''),
    buttonLabel: z.string().max(120).default(''),
    buttonHref: z.string().max(MAX_URL_LENGTH).default(''),
  })
  .strict();

const columnsBlockProps = z
  .object({
    columns: z.enum(['1', '2']).default('1'),
    left: columnCellSchema.default({}),
    right: columnCellSchema.default({}),
    gap: z.number().int().min(0).max(80).default(16),
  })
  .strict();

const headerBlockProps = z
  .object({
    logoSrc: z.string().max(MAX_URL_LENGTH).default(''),
    logoAlt: z.string().max(255).default('Company logo'),
    title: z.string().max(200).default(''),
    backgroundColor: hexColor.default('#ffffff'),
    textColor: hexColor.default('#0f172a'),
  })
  .strict();

const footerBlockProps = z
  .object({
    text: z.string().max(5000).default(''),
    backgroundColor: hexColor.default('#f8fafc'),
    textColor: hexColor.default('#64748b'),
    /** Compliance: the footer must keep an unsubscribe reference. */
    unsubscribeHref: z.string().max(MAX_URL_LENGTH).default('{{unsubscribe_link}}'),
  })
  .strict();

const socialLinkSchema = z
  .object({
    network: z.enum(['website', 'linkedin', 'facebook', 'instagram', 'youtube', 'x']),
    href: z.string().max(MAX_URL_LENGTH).default(''),
  })
  .strict();

const socialBlockProps = z
  .object({
    links: z.array(socialLinkSchema).max(6).default([]),
    align: alignEnum.default('center'),
    color: hexColor.default('#4338ca'),
  })
  .strict();

const designBlockSchema = z.discriminatedUnion('type', [
  z
    .object({
      id: z.string().min(1).max(64),
      type: z.literal('text'),
      props: textBlockProps.default({}),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1).max(64),
      type: z.literal('image'),
      props: imageBlockProps.default({}),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1).max(64),
      type: z.literal('button'),
      props: buttonBlockProps.default({}),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1).max(64),
      type: z.literal('divider'),
      props: dividerBlockProps.default({}),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1).max(64),
      type: z.literal('spacer'),
      props: spacerBlockProps.default({}),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1).max(64),
      type: z.literal('columns'),
      props: columnsBlockProps.default({}),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1).max(64),
      type: z.literal('header'),
      props: headerBlockProps.default({}),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1).max(64),
      type: z.literal('footer'),
      props: footerBlockProps.default({}),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1).max(64),
      type: z.literal('social'),
      props: socialBlockProps.default({}),
    })
    .strict(),
]);

export type DesignBlock = z.infer<typeof designBlockSchema>;

const designGlobalSchema = z
  .object({
    backgroundColor: hexColor.default('#f1f5f9'),
    contentWidth: z.number().int().min(320).max(900).default(600),
    brandColor: hexColor.default('#4338ca'),
    fontFamily: z.string().max(200).default('Arial, Helvetica, sans-serif'),
    preheader: z.string().max(300).default(''),
  })
  .strict();

export const templateDesignSchema = z
  .object({
    version: z.literal(TEMPLATE_DESIGN_VERSION),
    global: designGlobalSchema.default({}),
    blocks: z.array(designBlockSchema).min(1).max(MAX_BLOCKS),
  })
  .strict()
  .superRefine((doc, ctx) => {
    // Compliance guard: a visual email must keep at least one footer block so
    // required sender/unsubscribe content cannot be accidentally removed.
    if (!doc.blocks.some((b) => b.type === 'footer')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Design must include a footer block with unsubscribe content',
        path: ['blocks'],
      });
    }
    const ids = doc.blocks.map((b) => b.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Block ids must be unique',
        path: ['blocks'],
      });
    }
  });

export type TemplateDesign = z.infer<typeof templateDesignSchema>;

/** Validate an untrusted design document. Returns typed issues, never throws. */
export function validateDesign(
  input: unknown,
): { ok: true; design: TemplateDesign } | { ok: false; errors: string[] } {
  const parsed = templateDesignSchema.safeParse(input);
  if (parsed.success) return { ok: true, design: parsed.data };
  return {
    ok: false,
    errors: parsed.error.errors.map((e) => `${e.path.join('.') || 'design'}: ${e.message}`),
  };
}

// ── Deterministic email-safe renderer ────────────────────────────────────────
// Table-based layout with inline styles only. Responsive through fluid widths
// (100% + max-width); one progressive-enhancement media query is included but
// the layout degrades to a readable single column without it.

function renderTextContent(text: string): string {
  // Escape first, then honor explicit line breaks, then linkify bare URLs.
  const withBreaks = escapeHtml(text).replace(/\r?\n/g, '<br />');
  return withBreaks.replace(
    /(https?:\/\/[^\s<"]+)/g,
    '<a href="$1" style="color:#4338ca;text-decoration:underline;">$1</a>',
  );
}

function withVariablesPreserved(rendered: string): string {
  // Personalization placeholders survive escaping as {{name}} text — nothing
  // to restore since we escape values only at substitution time, not here.
  return rendered;
}

function renderBlock(block: DesignBlock, fontFamily: string, brandColor: string): string {
  switch (block.type) {
    case 'text': {
      const p = block.props;
      const weight = p.bold ? 'font-weight:bold;' : '';
      const style = p.italic ? 'font-style:italic;' : '';
      return `<tr><td align="${p.align}" style="font-family:${escapeHtml(fontFamily)};font-size:${p.fontSize}px;color:${p.color};${weight}${style}line-height:1.6;padding:8px 24px;word-break:break-word;">${withVariablesPreserved(renderTextContent(p.text))}</td></tr>`;
    }
    case 'image': {
      const p = block.props;
      const src = escapeHtml(p.src);
      const alt = escapeHtml(p.alt || 'Email image');
      const img = p.src
        ? `<img src="${src}" alt="${alt}" width="${p.width}" style="display:block;max-width:100%;height:auto;border:0;" />`
        : `<div style="background-color:#e2e8f0;color:#64748b;font-family:${escapeHtml(fontFamily)};font-size:13px;padding:32px 16px;text-align:center;">Image placeholder — choose an image from the media library</div>`;
      const inner =
        p.href && isSafeLink(p.href)
          ? `<a href="${escapeHtml(p.href)}" target="_blank">${img}</a>`
          : img;
      return `<tr><td align="${p.align}" style="padding:8px 24px;">${inner}</td></tr>`;
    }
    case 'button': {
      const p = block.props;
      const radius = p.shape === 'pill' ? '999px' : p.shape === 'rounded' ? '6px' : '0px';
      const href = p.href && isSafeLink(p.href) ? escapeHtml(p.href) : '#';
      return `<tr><td align="${p.align}" style="padding:12px 24px;"><a href="${href}" target="_blank" style="display:inline-block;padding:12px 28px;background-color:${p.backgroundColor};color:${p.textColor};text-decoration:none;border-radius:${radius};font-family:${escapeHtml(fontFamily)};font-size:15px;font-weight:bold;">${escapeHtml(p.label)}</a></td></tr>`;
    }
    case 'divider': {
      const p = block.props;
      return `<tr><td style="padding:${p.spacing}px 24px;"><hr style="border:none;border-top:${p.thickness}px solid ${p.color};margin:0;" /></td></tr>`;
    }
    case 'spacer': {
      return `<tr><td style="font-size:0;line-height:0;padding:0;height:${block.props.height}px;">&nbsp;</td></tr>`;
    }
    case 'columns': {
      const p = block.props;
      const cell = (c: {
        text: string;
        imageSrc: string;
        imageAlt: string;
        buttonLabel: string;
        buttonHref: string;
      }): string => {
        let inner = '';
        if (c.imageSrc) {
          inner += `<img src="${escapeHtml(c.imageSrc)}" alt="${escapeHtml(c.imageAlt || 'Email image')}" width="100%" style="display:block;max-width:100%;height:auto;border:0;margin-bottom:8px;" />`;
        }
        if (c.text)
          inner += `<div style="font-family:${escapeHtml(fontFamily)};font-size:15px;color:#1e293b;line-height:1.6;word-break:break-word;">${withVariablesPreserved(renderTextContent(c.text))}</div>`;
        if (c.buttonLabel && c.buttonHref && isSafeLink(c.buttonHref)) {
          inner += `<div style="margin-top:12px;"><a href="${escapeHtml(c.buttonHref)}" target="_blank" style="display:inline-block;padding:10px 22px;background-color:${brandColor};color:#ffffff;text-decoration:none;border-radius:6px;font-family:${escapeHtml(fontFamily)};font-size:14px;font-weight:bold;">${escapeHtml(c.buttonLabel)}</a></div>`;
        }
        return inner || '<div style="color:#94a3b8;font-size:13px;">Empty column</div>';
      };
      if (p.columns === '1') {
        return `<tr><td style="padding:8px 24px;">${cell(p.left)}</td></tr>`;
      }
      // Two-column via table cells; stacks on narrow clients through the
      // .crm-col media query below (progressive enhancement only).
      return `<tr><td style="padding:8px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="crm-col" width="50%" valign="top" style="padding:8px;">${cell(p.left)}</td><td width="${p.gap}" style="font-size:0;line-height:0;">&nbsp;</td><td class="crm-col" width="50%" valign="top" style="padding:8px;">${cell(p.right)}</td></tr></table></td></tr>`;
    }
    case 'header': {
      const p = block.props;
      const logo = p.logoSrc
        ? `<img src="${escapeHtml(p.logoSrc)}" alt="${escapeHtml(p.logoAlt)}" height="40" style="display:block;max-height:40px;width:auto;border:0;" />`
        : '';
      const title = p.title
        ? `<div style="font-family:${escapeHtml(fontFamily)};font-size:20px;font-weight:bold;color:${p.textColor};margin-top:${logo ? '8px' : '0'};">${escapeHtml(p.title)}</div>`
        : '';
      return `<tr><td align="center" bgcolor="${p.backgroundColor}" style="background-color:${p.backgroundColor};padding:24px;">${logo}${title}</td></tr>`;
    }
    case 'footer': {
      const p = block.props;
      const unsub =
        p.unsubscribeHref &&
        isSafeLink(substituteVariables(p.unsubscribeHref, {}, false) || 'https://example.com')
          ? `<div style="margin-top:8px;"><a href="${escapeHtml(p.unsubscribeHref)}" style="color:${p.textColor};text-decoration:underline;">Unsubscribe</a></div>`
          : '';
      return `<tr><td align="center" bgcolor="${p.backgroundColor}" style="background-color:${p.backgroundColor};font-family:${escapeHtml(fontFamily)};font-size:12px;color:${p.textColor};line-height:1.6;padding:20px 24px;">${withVariablesPreserved(renderTextContent(p.text))}${unsub}</td></tr>`;
    }
    case 'social': {
      const p = block.props;
      if (p.links.length === 0) {
        return `<tr><td align="${p.align}" style="padding:8px 24px;font-size:12px;color:#94a3b8;">Social links placeholder</td></tr>`;
      }
      const items = p.links
        .filter((l) => l.href && isSafeLink(l.href))
        .map(
          (l) =>
            `<a href="${escapeHtml(l.href)}" target="_blank" style="color:${p.color};text-decoration:underline;font-family:${escapeHtml(fontFamily)};font-size:13px;margin:0 8px;">${escapeHtml(l.network)}</a>`,
        )
        .join('');
      return `<tr><td align="${p.align}" style="padding:12px 24px;">${items}</td></tr>`;
    }
    default: {
      const _exhaustive: never = block;
      return `<!-- unknown block ${(_exhaustive as { type?: string }).type ?? '?'} -->`;
    }
  }
}

export interface RenderedEmail {
  html: string;
  text: string;
}

/** Deterministic render of a validated design doc to email HTML + plain text. */
export function renderDesignToHtml(design: TemplateDesign): RenderedEmail {
  const g = design.global;
  const rows = design.blocks.map((b) => renderBlock(b, g.fontFamily, g.brandColor)).join('\n');
  const preheader = g.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(g.preheader)}</div>`
    : '';
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><style>@media only screen and (max-width:480px){.crm-col{display:block !important;width:100% !important;}}</style></head><body style="margin:0;padding:0;background-color:${g.backgroundColor};"><div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(g.preheader)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${g.backgroundColor};margin:0;padding:0;"><tr><td align="center" style="padding:24px 12px;"><table role="presentation" width="${g.contentWidth}" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${g.contentWidth}px;background-color:#ffffff;border-radius:8px;overflow:hidden;"><tbody>${rows}</tbody></table></td></tr></table>${preheader}</body></html>`;
  return { html, text: emailHtmlToText(html) };
}

/** Plain-text alternative preserving link destinations (matches emailContent.ts). */
export function emailHtmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(
      /<a\b[^>]*\shref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
      (_match, href: string, label: string) =>
        `${label} (${href.replace(/&amp;/g, '&').replace(/&quot;/g, '"')})`,
    )
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h1|h2|h3|h4|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Send-time resolution ─────────────────────────────────────────────────────

export interface MinimalLeadForVariables {
  business_name: string;
  contact_name: string;
  industry: string;
  location: string;
  country?: string | null;
  google_rating?: string | number | null;
  source_platform: string;
  classification?: string | null;
}

/**
 * Map a lead-like record to variable values for deterministic (non-AI)
 * substitution. Mirrors the fallback vocabulary in `outreach.prompt.ts`.
 */
export function leadToVariableValues(lead: MinimalLeadForVariables): Record<string, string> {
  const firstName = lead.contact_name?.split(' ')[0] || lead.contact_name;
  return {
    business_name: lead.business_name,
    company_name: lead.business_name,
    contact_name: lead.contact_name,
    client_name: lead.contact_name,
    first_name: firstName,
    industry: lead.industry,
    location: lead.location,
    country: lead.country ?? '',
    rating:
      lead.google_rating === null || lead.google_rating === undefined
        ? ''
        : String(lead.google_rating),
    source_platform: lead.source_platform,
    classification: lead.classification ?? '',
    unsubscribe_link: '',
  };
}

export interface SendableTemplate {
  editor_mode?: string | null;
  body: string;
  html_body?: string | null;
  text_body?: string | null;
  subject?: string | null;
}

/**
 * Resolve the send-time email payload for a template: the saved rendered HTML
 * (visual/html modes) with context-escaped substitution, plus the plain-text
 * fallback. Simple templates fall back to the raw body (legacy behavior).
 */
export function resolveEmailPayload(
  template: SendableTemplate,
  values: Record<string, string>,
): { html: string; text: string; subject: string | null } {
  const subject = template.subject
    ? substituteVariables(template.subject, values, false)
    : (template.subject ?? null);
  if (template.editor_mode !== 'simple' && template.html_body) {
    return {
      html: substituteVariables(template.html_body, values, true),
      text: substituteVariables(
        template.text_body ?? emailHtmlToText(template.html_body),
        values,
        false,
      ),
      subject,
    };
  }
  const text = substituteVariables(template.body, values, false);
  return { html: text, text, subject };
}

// ── SMS segments ─────────────────────────────────────────────────────────────

// GSM-7 basic + extension tables (characters needing an escape count double).
const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXTENDED = '^{}\\[~]|€';

export interface SmsEstimate {
  encoding: 'GSM-7' | 'UCS-2';
  characters: number;
  segments: number;
  remainingInSegment: number;
}

/** Segment estimate for the SMS plain-text editor (no message is sent). */
export function estimateSmsSegments(body: string): SmsEstimate {
  let extended = 0;
  let ucs2 = false;
  for (const ch of body) {
    if (GSM7_BASIC.includes(ch)) continue;
    if (GSM7_EXTENDED.includes(ch)) {
      extended += 1;
      continue;
    }
    ucs2 = true;
    break;
  }
  const characters = ucs2 ? Array.from(body).length : body.length + extended;
  if (characters === 0)
    return { encoding: 'GSM-7', characters: 0, segments: 0, remainingInSegment: 160 };
  if (!ucs2) {
    if (characters <= 160)
      return { encoding: 'GSM-7', characters, segments: 1, remainingInSegment: 160 - characters };
    const segments = Math.ceil(characters / 153);
    return {
      encoding: 'GSM-7',
      characters,
      segments,
      remainingInSegment: segments * 153 - characters,
    };
  }
  if (characters <= 70)
    return { encoding: 'UCS-2', characters, segments: 1, remainingInSegment: 70 - characters };
  const segments = Math.ceil(characters / 67);
  return {
    encoding: 'UCS-2',
    characters,
    segments,
    remainingInSegment: segments * 67 - characters,
  };
}

// ── WhatsApp validation ──────────────────────────────────────────────────────
// Against the actual connector (`whatsapp.connector.ts`): free-text messages
// go out as `type: text` (Cloud API limit 4096 chars); one optional
// image/document attachment becomes the message media with `body` as caption.

export const WHATSAPP_TEXT_LIMIT = 4096;

export interface WhatsappValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/** Validate a WhatsApp template body against provider capabilities. */
export function validateWhatsappBody(body: string, attachmentCount: number): WhatsappValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!body.trim()) errors.push('WhatsApp message text is required');
  if (body.length > WHATSAPP_TEXT_LIMIT) {
    errors.push(
      `WhatsApp text is ${body.length} characters — the Cloud API text limit is ${WHATSAPP_TEXT_LIMIT}`,
    );
  }
  if (attachmentCount > 1) {
    warnings.push(
      'Only the first attachment is sent as WhatsApp media (the Cloud API accepts one media item per message)',
    );
  }
  const invalid = findInvalidVariables(body);
  if (invalid.length > 0)
    warnings.push(`Unknown variables: ${invalid.map((v) => `{{${v}}}`).join(', ')}`);
  return { ok: errors.length === 0, errors, warnings };
}

// ── Email compliance ─────────────────────────────────────────────────────────

export interface ComplianceCheck {
  /** Hard blockers (missing footer in visual designs is enforced by schema). */
  errors: string[];
  /** Non-blocking warnings surfaced in preview/test-send. */
  warnings: string[];
}

/**
 * Compliance check for outgoing email content. Existing simple templates are
 * never force-failed: a missing unsubscribe reference is a warning, not an
 * error, so legacy templates keep working.
 */
export function checkEmailCompliance(htmlOrBody: string): ComplianceCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const lower = htmlOrBody.toLowerCase();
  if (!lower.includes('unsubscribe')) {
    warnings.push(
      'No unsubscribe reference found — marketing emails should include an unsubscribe link (the footer block adds one automatically)',
    );
  }
  return { errors, warnings };
}

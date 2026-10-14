/**
 * Email design system — client-side companion to
 * `backend/src/modules/templates/templateDesign.ts`.
 *
 * The backend remains the source of truth for validation, sanitization, and
 * send-time rendering. This module mirrors just enough logic for an instant,
 * offline-capable editing canvas:
 *
 *   - Block/document types + factories (ids, defaults, reusable sections).
 *   - 8 polished starter designs (editable placeholders only — no company
 *     claims, testimonials, or business metrics).
 *   - A preview renderer with the same structure as the backend deterministic
 *     renderer (table-based, inline styles). Server preview is authoritative.
 *   - SMS segment estimator + WhatsApp validation mirrors for live feedback.
 *   - Variable catalog + fictional sample values (never real lead PII).
 */

export type EmailBlockType =
  | 'text'
  | 'image'
  | 'button'
  | 'divider'
  | 'spacer'
  | 'columns'
  | 'header'
  | 'footer'
  | 'social';

export interface TextBlock { id: string; type: 'text'; props: { text: string; fontSize: number; color: string; align: 'left' | 'center' | 'right'; bold: boolean; italic: boolean } }
export interface ImageBlock { id: string; type: 'image'; props: { src: string; alt: string; href: string; width: number; align: 'left' | 'center' | 'right' } }
export interface ButtonBlock { id: string; type: 'button'; props: { label: string; href: string; backgroundColor: string; textColor: string; shape: 'square' | 'rounded' | 'pill'; align: 'left' | 'center' | 'right' } }
export interface DividerBlock { id: string; type: 'divider'; props: { color: string; thickness: number; spacing: number } }
export interface SpacerBlock { id: string; type: 'spacer'; props: { height: number } }
export interface ColumnCell { text: string; imageSrc: string; imageAlt: string; buttonLabel: string; buttonHref: string }
export interface ColumnsBlock { id: string; type: 'columns'; props: { columns: '1' | '2'; left: ColumnCell; right: ColumnCell; gap: number } }
export interface HeaderBlock { id: string; type: 'header'; props: { logoSrc: string; logoAlt: string; title: string; backgroundColor: string; textColor: string } }
export interface FooterBlock { id: string; type: 'footer'; props: { text: string; backgroundColor: string; textColor: string; unsubscribeHref: string } }
export interface SocialBlock { id: string; type: 'social'; props: { links: Array<{ network: string; href: string }>; align: 'left' | 'center' | 'right'; color: string } }

export type EmailBlock =
  | TextBlock | ImageBlock | ButtonBlock | DividerBlock | SpacerBlock
  | ColumnsBlock | HeaderBlock | FooterBlock | SocialBlock;

export interface EmailDesign {
  version: 1;
  global: {
    backgroundColor: string;
    contentWidth: number;
    brandColor: string;
    fontFamily: string;
    preheader: string;
  };
  blocks: EmailBlock[];
}

export const VARIABLE_CATALOG = [
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

/** Fictional sample values for preview only — never real lead PII. */
export const SAMPLE_VALUES: Record<string, string> = {
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

export function escapeHtmlClient(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Substitute {{variables}} with sample values (preview/canvas only). */
export function substituteSamples(text: string, overrides?: Record<string, string>): string {
  const values = { ...SAMPLE_VALUES, ...(overrides ?? {}) };
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name: string) => escapeHtmlClient(values[name] ?? ''));
}

export function collectDesignVariables(design: EmailDesign): string[] {  const sources: string[] = [design.global.preheader];
  for (const b of design.blocks) {
    switch (b.type) {
      case 'text': sources.push(b.props.text); break;
      case 'button': sources.push(b.props.label, b.props.href); break;
      case 'image': sources.push(b.props.href); break;
      case 'header': sources.push(b.props.title); break;
      case 'footer': sources.push(b.props.text, b.props.unsubscribeHref); break;
      case 'columns':
        sources.push(b.props.left.text, b.props.left.buttonHref, b.props.right.text, b.props.right.buttonHref);
        break;
      case 'social': for (const l of b.props.links) sources.push(l.href); break;
      default: break;
    }
  }
  const found = new Set<string>();
  for (const s of sources) {
    for (const m of s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) found.add(m[1]);
  }
  return Array.from(found);
}

// ── Factories ────────────────────────────────────────────────────────────────

let blockCounter = 0;
export function newBlockId(): string {
  blockCounter += 1;
  return `b${Date.now().toString(36)}${blockCounter}`;
}

const emptyCell = (): ColumnCell => ({ text: '', imageSrc: '', imageAlt: '', buttonLabel: '', buttonHref: '' });

export function createBlock(type: EmailBlockType): EmailBlock {
  const id = newBlockId();
  switch (type) {
    case 'text': return { id, type, props: { text: 'Add your text here. Use {{first_name}} to personalize.', fontSize: 16, color: '#1e293b', align: 'left', bold: false, italic: false } };
    case 'image': return { id, type, props: { src: '', alt: '', href: '', width: 600, align: 'center' } };
    case 'button': return { id, type, props: { label: 'Learn more', href: 'https://example.com', backgroundColor: '#4338ca', textColor: '#ffffff', shape: 'rounded', align: 'center' } };
    case 'divider': return { id, type, props: { color: '#e2e8f0', thickness: 1, spacing: 16 } };
    case 'spacer': return { id, type, props: { height: 24 } };
    case 'columns': return { id, type, props: { columns: '2', left: emptyCell(), right: emptyCell(), gap: 16 } };
    case 'header': return { id, type, props: { logoSrc: '', logoAlt: 'Company logo', title: '', backgroundColor: '#ffffff', textColor: '#0f172a' } };
    case 'footer': return { id, type, props: { text: '[Your company name]\n[Street address, City]', backgroundColor: '#f8fafc', textColor: '#64748b', unsubscribeHref: '{{unsubscribe_link}}' } };
    case 'social': return { id, type, props: { links: [], align: 'center', color: '#4338ca' } };
  }
}

export function defaultDesign(): EmailDesign {
  return {
    version: 1,
    global: {
      backgroundColor: '#f1f5f9',
      contentWidth: 600,
      brandColor: '#4338ca',
      fontFamily: 'Arial, Helvetica, sans-serif',
      preheader: '',
    },
    blocks: [
      { id: newBlockId(), type: 'header', props: { logoSrc: '', logoAlt: 'Company logo', title: '', backgroundColor: '#ffffff', textColor: '#0f172a' } },
      { id: newBlockId(), type: 'text', props: { text: 'Hi {{first_name}},', fontSize: 16, color: '#1e293b', align: 'left', bold: false, italic: false } },
      { id: newBlockId(), type: 'footer', props: { text: '[Your company name]\n[Street address, City]', backgroundColor: '#f8fafc', textColor: '#64748b', unsubscribeHref: '{{unsubscribe_link}}' } },
    ],
  };
}

export interface ReusableSection {
  key: string;
  name: string;
  description: string;
  blocks: EmailBlock[];
}

/** Reusable multi-block sections for the palette. */
export function reusableSections(): ReusableSection[] {
  return [
    {
      key: 'hero',
      name: 'Hero',
      description: 'Image, headline text, and a call-to-action button.',
      blocks: [
        { id: newBlockId(), type: 'image', props: { src: '', alt: 'Hero image', href: '', width: 600, align: 'center' } },
        { id: newBlockId(), type: 'text', props: { text: '[Headline — describe the main idea in one line]', fontSize: 24, color: '#0f172a', align: 'center', bold: true, italic: false } },
        { id: newBlockId(), type: 'button', props: { label: 'Learn more', href: 'https://example.com', backgroundColor: '#4338ca', textColor: '#ffffff', shape: 'rounded', align: 'center' } },
      ],
    },
    {
      key: 'two-column',
      name: 'Two-column feature',
      description: 'Side-by-side content that stacks on mobile.',
      blocks: [
        { id: newBlockId(), type: 'columns', props: { columns: '2', left: { ...emptyCell(), text: '[Left column — key point one]' }, right: { ...emptyCell(), text: '[Right column — key point two]' }, gap: 16 } },
      ],
    },
    {
      key: 'cta-band',
      name: 'CTA band',
      description: 'Divider, centered message, and a button.',
      blocks: [
        { id: newBlockId(), type: 'divider', props: { color: '#e2e8f0', thickness: 1, spacing: 16 } },
        { id: newBlockId(), type: 'text', props: { text: '[One clear next step for the reader]', fontSize: 16, color: '#1e293b', align: 'center', bold: false, italic: false } },
        { id: newBlockId(), type: 'button', props: { label: 'Get started', href: 'https://example.com', backgroundColor: '#4338ca', textColor: '#ffffff', shape: 'pill', align: 'center' } },
      ],
    },
  ];
}

export const BLOCK_DEFS: Array<{ type: EmailBlockType; label: string; hint: string }> = [
  { type: 'text', label: 'Text', hint: 'Paragraph with personalization' },
  { type: 'image', label: 'Image / logo', hint: 'From the media library' },
  { type: 'button', label: 'Button', hint: 'Label, link, color, shape' },
  { type: 'divider', label: 'Divider', hint: 'Horizontal rule' },
  { type: 'spacer', label: 'Spacer', hint: 'Vertical whitespace' },
  { type: 'columns', label: 'Columns', hint: 'One or two columns' },
  { type: 'header', label: 'Header', hint: 'Logo + title band' },
  { type: 'footer', label: 'Footer', hint: 'Required: keeps unsubscribe' },
  { type: 'social', label: 'Social links', hint: 'Website + social profiles' },
];

// ── Starters ─────────────────────────────────────────────────────────────────
// Editable placeholders only ([bracketed] for sender content, {{variables}}
// for lead data). No company claims, testimonials, or business metrics.

export interface StarterTemplate {
  key: string;
  name: string;
  description: string;
  subject: string;
  preheader: string;
  design: EmailDesign;
}

function footerBlock(text = '[Your company name]\n[Street address, City]'): FooterBlock {
  return { id: newBlockId(), type: 'footer', props: { text, backgroundColor: '#f8fafc', textColor: '#64748b', unsubscribeHref: '{{unsubscribe_link}}' } };
}

function textBlock(text: string, fontSize = 16, align: 'left' | 'center' | 'right' = 'left', bold = false): TextBlock {
  return { id: newBlockId(), type: 'text', props: { text, fontSize, color: '#1e293b', align, bold, italic: false } };
}

function buttonBlock(label: string, href = 'https://example.com'): ButtonBlock {
  return { id: newBlockId(), type: 'button', props: { label, href, backgroundColor: '#4338ca', textColor: '#ffffff', shape: 'rounded', align: 'center' } };
}

export function starterTemplates(): StarterTemplate[] {
  return [
    {
      key: 'personal-outreach',
      name: 'Personal outreach',
      description: 'A short, personal first touch for one-to-one outreach.',
      subject: 'Quick idea for {{business_name}}',
      preheader: 'A short note — happy to share details if useful.',
      design: {
        version: 1,
        global: { backgroundColor: '#f1f5f9', contentWidth: 600, brandColor: '#4338ca', fontFamily: 'Arial, Helvetica, sans-serif', preheader: 'A short note — happy to share details if useful.' },
        blocks: [
          textBlock('Hi {{first_name}},'),
          textBlock('I came across {{business_name}} and noticed your work in {{industry}} around {{location}}. I help businesses like yours with [describe your service in one line].'),
          textBlock('Would you be open to a brief chat next week to see if this could be useful?'),
          buttonBlock('View our work'),
          footerBlock(),
        ],
      },
    },
    {
      key: 'follow-up',
      name: 'Follow-up',
      description: 'A polite nudge referencing your earlier message.',
      subject: 'Following up, {{first_name}}',
      preheader: 'Circling back on my earlier note.',
      design: {
        version: 1,
        global: { backgroundColor: '#f1f5f9', contentWidth: 600, brandColor: '#4338ca', fontFamily: 'Arial, Helvetica, sans-serif', preheader: 'Circling back on my earlier note.' },
        blocks: [
          textBlock('Hi {{first_name}},'),
          textBlock('Just circling back on my note about [your service] for {{business_name}}. I know inboxes get busy, so here is the short version: [one-sentence recap].'),
          textBlock('If now is not the right time, just let me know and I will close the loop.'),
          buttonBlock('Reply to this email', 'mailto:you@example.com'),
          footerBlock(),
        ],
      },
    },
    {
      key: 're-engagement',
      name: 'Re-engagement',
      description: 'Reconnect with a contact who went quiet.',
      subject: 'Still interested, {{first_name}}?',
      preheader: 'Wanted to check back in before I close the loop.',
      design: {
        version: 1,
        global: { backgroundColor: '#f1f5f9', contentWidth: 600, brandColor: '#4338ca', fontFamily: 'Arial, Helvetica, sans-serif', preheader: 'Wanted to check back in before I close the loop.' },
        blocks: [
          textBlock('Hi {{first_name}},'),
          textBlock('We connected a while ago about [topic] and I wanted to check whether it is still on your radar at {{business_name}}.'),
          { id: newBlockId(), type: 'columns', props: { columns: '2', left: { ...emptyCell(), text: '[Option one — e.g. pick the conversation back up]' }, right: { ...emptyCell(), text: '[Option two — e.g. point me to the right person]' }, gap: 16 } },
          buttonBlock('Let me know'),
          footerBlock(),
        ],
      },
    },
    {
      key: 'welcome',
      name: 'Welcome',
      description: 'Greet a new contact and set expectations.',
      subject: 'Welcome, {{first_name}}!',
      preheader: 'Thanks for connecting — here is what to expect.',
      design: {
        version: 1,
        global: { backgroundColor: '#f1f5f9', contentWidth: 600, brandColor: '#4338ca', fontFamily: 'Arial, Helvetica, sans-serif', preheader: 'Thanks for connecting — here is what to expect.' },
        blocks: [
          { id: newBlockId(), type: 'header', props: { logoSrc: '', logoAlt: 'Company logo', title: 'Welcome!', backgroundColor: '#4338ca', textColor: '#ffffff' } },
          textBlock('Hi {{first_name}}, thanks for connecting with [your company name].'),
          textBlock('Here is what you can expect from us: [describe what happens next in one or two lines].'),
          buttonBlock('Get started'),
          footerBlock(),
        ],
      },
    },
    {
      key: 'newsletter',
      name: 'Newsletter',
      description: 'Two-story update layout with a header and footer.',
      subject: '[Newsletter name] — [Month] edition',
      preheader: 'Inside: [story one] and [story two].',
      design: {
        version: 1,
        global: { backgroundColor: '#f1f5f9', contentWidth: 600, brandColor: '#4338ca', fontFamily: 'Arial, Helvetica, sans-serif', preheader: 'Inside: [story one] and [story two].' },
        blocks: [
          { id: newBlockId(), type: 'header', props: { logoSrc: '', logoAlt: 'Company logo', title: '[Newsletter name]', backgroundColor: '#0f172a', textColor: '#ffffff' } },
          textBlock('Hi {{first_name}}, here is what is new this month.'),
          { id: newBlockId(), type: 'columns', props: { columns: '2', left: { ...emptyCell(), text: '[Story one — headline and one-line summary]', buttonLabel: 'Read more', buttonHref: 'https://example.com/story-one' }, right: { ...emptyCell(), text: '[Story two — headline and one-line summary]', buttonLabel: 'Read more', buttonHref: 'https://example.com/story-two' }, gap: 16 } },
          { id: newBlockId(), type: 'divider', props: { color: '#e2e8f0', thickness: 1, spacing: 16 } },
          textBlock('You are receiving this because you subscribed to [newsletter name].', 13, 'center'),
          footerBlock(),
        ],
      },
    },
    {
      key: 'promotion',
      name: 'Product / service promotion',
      description: 'Introduce an offering with an image and a clear CTA.',
      subject: 'An update from [your company name]',
      preheader: 'A quick look at [your offering].',
      design: {
        version: 1,
        global: { backgroundColor: '#f1f5f9', contentWidth: 600, brandColor: '#4338ca', fontFamily: 'Arial, Helvetica, sans-serif', preheader: 'A quick look at [your offering].' },
        blocks: [
          { id: newBlockId(), type: 'image', props: { src: '', alt: '[Describe the offering image]', href: '', width: 600, align: 'center' } },
          textBlock('[Offering headline — what it is, in plain words]', 24, 'center', true),
          textBlock('Hi {{first_name}}, I wanted to share a quick look at [your offering] and how businesses in {{industry}} use it to [describe the outcome in your own words].'),
          buttonBlock('Learn more'),
          footerBlock(),
        ],
      },
    },
    {
      key: 'event-invitation',
      name: 'Event invitation',
      description: 'Invite a contact with date, place, and RSVP button.',
      subject: 'You are invited: [Event name]',
      preheader: '[Date] · [Venue or online] — save your spot.',
      design: {
        version: 1,
        global: { backgroundColor: '#f1f5f9', contentWidth: 600, brandColor: '#4338ca', fontFamily: 'Arial, Helvetica, sans-serif', preheader: '[Date] · [Venue or online] — save your spot.' },
        blocks: [
          { id: newBlockId(), type: 'header', props: { logoSrc: '', logoAlt: 'Company logo', title: '[Event name]', backgroundColor: '#4338ca', textColor: '#ffffff' } },
          textBlock('Hi {{first_name}}, we would love to see you there.'),
          { id: newBlockId(), type: 'columns', props: { columns: '2', left: { ...emptyCell(), text: '[Date and time]\n[Venue or online link]' }, right: { ...emptyCell(), text: '[What to expect — agenda in one or two lines]' }, gap: 16 } },
          buttonBlock('RSVP'),
          footerBlock(),
        ],
      },
    },
    {
      key: 'thank-you',
      name: 'Thank-you',
      description: 'Thank a contact after a meeting, purchase, or referral.',
      subject: 'Thank you, {{first_name}}',
      preheader: 'A quick thank-you from our team.',
      design: {
        version: 1,
        global: { backgroundColor: '#f1f5f9', contentWidth: 600, brandColor: '#4338ca', fontFamily: 'Arial, Helvetica, sans-serif', preheader: 'A quick thank-you from our team.' },
        blocks: [
          textBlock('Thank you, {{first_name}}!', 24, 'center', true),
          textBlock('Thanks for [describe what you are thankful for — your time, your order, the referral]. It means a lot to our team at [your company name].'),
          textBlock('If there is anything else we can do for {{business_name}}, just reply to this email.'),
          footerBlock(),
        ],
      },
    },
  ];
}

/** Plain-text fallback persisted in `body` so legacy consumers keep working. */
export function designFallbackText(design: EmailDesign): string {
  const parts: string[] = [];
  for (const b of design.blocks) {
    if (b.type === 'text') parts.push(b.props.text);
    else if (b.type === 'header' && b.props.title) parts.push(b.props.title);
    else if (b.type === 'columns') {
      if (b.props.left.text) parts.push(b.props.left.text);
      if (b.props.right.text) parts.push(b.props.right.text);
    } else if (b.type === 'button') parts.push(b.props.label);
  }
  return parts.join('\n\n').trim() || '(visual email — see designed version)';
}

// ── Client preview renderer ──────────────────────────────────────────────────
// Same structure as the backend deterministic renderer (table-based, inline
// styles). The server preview remains authoritative for delivery.

function renderTextPreview(text: string): string {
  return escapeHtmlClient(text)
    .replace(/\r?\n/g, '<br />')
    .replace(/(https?:\/\/[^\s<"]+)/g, '<a href="$1" style="color:#4338ca;text-decoration:underline;">$1</a>');
}

function renderBlockPreview(block: EmailBlock, fontFamily: string, brandColor: string): string {
  switch (block.type) {
    case 'text': {
      const p = block.props;
      return `<tr><td align="${p.align}" style="font-family:${escapeHtmlClient(fontFamily)};font-size:${p.fontSize}px;color:${p.color};${p.bold ? 'font-weight:bold;' : ''}${p.italic ? 'font-style:italic;' : ''}line-height:1.6;padding:8px 24px;word-break:break-word;">${renderTextPreview(substituteSamples(p.text))}</td></tr>`;
    }
    case 'image': {
      const p = block.props;
      const img = p.src
        ? `<img src="${escapeHtmlClient(p.src)}" alt="${escapeHtmlClient(p.alt || 'Email image')}" style="display:block;max-width:100%;height:auto;border:0;" />`
        : `<div style="background-color:#e2e8f0;color:#64748b;font-family:${escapeHtmlClient(fontFamily)};font-size:13px;padding:32px 16px;text-align:center;">Image placeholder — choose an image from the media library</div>`;
      return `<tr><td align="${p.align}" style="padding:8px 24px;">${img}</td></tr>`;
    }
    case 'button': {
      const p = block.props;
      const radius = p.shape === 'pill' ? '999px' : p.shape === 'rounded' ? '6px' : '0px';
      return `<tr><td align="${p.align}" style="padding:12px 24px;"><span style="display:inline-block;padding:12px 28px;background-color:${p.backgroundColor};color:${p.textColor};border-radius:${radius};font-family:${escapeHtmlClient(fontFamily)};font-size:15px;font-weight:bold;">${escapeHtmlClient(p.label)}</span></td></tr>`;
    }
    case 'divider': {
      const p = block.props;
      return `<tr><td style="padding:${p.spacing}px 24px;"><hr style="border:none;border-top:${p.thickness}px solid ${p.color};margin:0;" /></td></tr>`;
    }
    case 'spacer':
      return `<tr><td style="font-size:0;line-height:0;padding:0;height:${block.props.height}px;">&nbsp;</td></tr>`;
    case 'columns': {
      const p = block.props;
      const cell = (c: ColumnCell): string => {
        let inner = '';
        if (c.imageSrc) inner += `<img src="${escapeHtmlClient(c.imageSrc)}" alt="${escapeHtmlClient(c.imageAlt || 'Email image')}" style="display:block;max-width:100%;height:auto;border:0;margin-bottom:8px;" />`;
        if (c.text) inner += `<div style="font-family:${escapeHtmlClient(fontFamily)};font-size:15px;color:#1e293b;line-height:1.6;">${renderTextPreview(substituteSamples(c.text))}</div>`;
        if (c.buttonLabel) inner += `<div style="margin-top:12px;"><span style="display:inline-block;padding:10px 22px;background-color:${brandColor};color:#ffffff;border-radius:6px;font-family:${escapeHtmlClient(fontFamily)};font-size:14px;font-weight:bold;">${escapeHtmlClient(c.buttonLabel)}</span></div>`;
        return inner || '<div style="color:#94a3b8;font-size:13px;">Empty column</div>';
      };
      if (p.columns === '1') return `<tr><td style="padding:8px 24px;">${cell(p.left)}</td></tr>`;
      return `<tr><td style="padding:8px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="50%" valign="top" style="padding:8px;">${cell(p.left)}</td><td width="50%" valign="top" style="padding:8px;">${cell(p.right)}</td></tr></table></td></tr>`;
    }
    case 'header': {
      const p = block.props;
      const title = p.title ? `<div style="font-family:${escapeHtmlClient(fontFamily)};font-size:20px;font-weight:bold;color:${p.textColor};margin-top:8px;">${escapeHtmlClient(substituteSamples(p.title))}</div>` : '';
      return `<tr><td align="center" style="background-color:${p.backgroundColor};padding:24px;">${title}</td></tr>`;
    }
    case 'footer': {
      const p = block.props;
      return `<tr><td align="center" style="background-color:${p.backgroundColor};font-family:${escapeHtmlClient(fontFamily)};font-size:12px;color:${p.textColor};line-height:1.6;padding:20px 24px;">${renderTextPreview(substituteSamples(p.text))}<div style="margin-top:8px;"><span style="text-decoration:underline;">Unsubscribe</span></div></td></tr>`;
    }
    case 'social': {
      const p = block.props;
      if (p.links.length === 0) return `<tr><td align="${p.align}" style="padding:8px 24px;font-size:12px;color:#94a3b8;">Social links placeholder</td></tr>`;
      const items = p.links.map((l) => `<span style="color:${p.color};font-size:13px;margin:0 8px;">${escapeHtmlClient(l.network)}</span>`).join('');
      return `<tr><td align="${p.align}" style="padding:12px 24px;">${items}</td></tr>`;
    }
  }
}

/** Instant canvas/preview HTML (sample values substituted, links inert). */
export function renderDesignPreview(design: EmailDesign): string {
  const g = design.global;
  const rows = design.blocks.map((b) => renderBlockPreview(b, g.fontFamily, g.brandColor)).join('');
  return `<div style="background-color:${g.backgroundColor};padding:16px;"><div style="max-width:${g.contentWidth}px;margin:0 auto;background-color:#ffffff;border-radius:8px;overflow:hidden;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tbody>${rows}</tbody></table></div></div>`;
}

// ── SMS + WhatsApp mirrors ───────────────────────────────────────────────────

const GSM7_BASIC = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXTENDED = "^{}\\[~]|€";

export interface SmsEstimate { encoding: 'GSM-7' | 'UCS-2'; characters: number; segments: number; remainingInSegment: number }

export function estimateSmsSegmentsClient(body: string): SmsEstimate {
  let extended = 0;
  let ucs2 = false;
  for (const ch of body) {
    if (GSM7_BASIC.includes(ch)) continue;
    if (GSM7_EXTENDED.includes(ch)) { extended += 1; continue; }
    ucs2 = true;
    break;
  }
  const characters = ucs2 ? body.length : body.length + extended;
  if (characters === 0) return { encoding: 'GSM-7', characters: 0, segments: 0, remainingInSegment: 160 };
  if (!ucs2) {
    if (characters <= 160) return { encoding: 'GSM-7', characters, segments: 1, remainingInSegment: 160 - characters };
    const segments = Math.ceil(characters / 153);
    return { encoding: 'GSM-7', characters, segments, remainingInSegment: segments * 153 - characters };
  }
  if (characters <= 70) return { encoding: 'UCS-2', characters, segments: 1, remainingInSegment: 70 - characters };
  const segments = Math.ceil(characters / 67);
  return { encoding: 'UCS-2', characters, segments, remainingInSegment: segments * 67 - characters };
}

export const WHATSAPP_TEXT_LIMIT = 4096;

export function validateWhatsappClient(body: string, attachmentCount: number): { ok: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!body.trim()) errors.push('WhatsApp message text is required');
  if (body.length > WHATSAPP_TEXT_LIMIT) errors.push(`WhatsApp text is ${body.length} characters — the Cloud API text limit is ${WHATSAPP_TEXT_LIMIT}`);
  if (attachmentCount > 1) warnings.push('Only the first attachment is sent as WhatsApp media (the Cloud API accepts one media item per message)');
  return { ok: errors.length === 0, errors, warnings };
}

import { describe, it, expect } from 'vitest';
import {
  collectDesignVariables,
  createBlock,
  defaultDesign,
  estimateSmsSegmentsClient,
  renderDesignPreview,
  starterTemplates,
  substituteSamples,
  validateWhatsappClient,
} from '../emailDesign';

describe('starterTemplates', () => {
  it('provides eight polished starters', () => {
    const starters = starterTemplates();
    expect(starters.map((s) => s.key)).toEqual([
      'personal-outreach',
      'follow-up',
      're-engagement',
      'welcome',
      'newsletter',
      'promotion',
      'event-invitation',
      'thank-you',
    ]);
  });

  it('every starter has a subject, preheader, footer, and unique block ids', () => {
    for (const s of starterTemplates()) {
      expect(s.subject.trim()).toBeTruthy();
      expect(s.preheader.trim()).toBeTruthy();
      expect(s.design.blocks.length).toBeGreaterThan(0);
      expect(s.design.blocks.some((b) => b.type === 'footer')).toBe(true);
      const ids = s.design.blocks.map((b) => b.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('starters contain no fabricated company claims, testimonials, or metrics', () => {
    const banned = [/testimonial/i, /5-star/i, /%\s*off/i, /\bROI\b/, /best-selling/i, /#1 rated/i];
    for (const s of starterTemplates()) {
      const text = JSON.stringify(s.design);
      for (const pattern of banned) expect(text).not.toMatch(pattern);
    }
  });

  it('default blank design starts with header, text, and footer', () => {
    const design = defaultDesign();
    expect(design.blocks.map((b) => b.type)).toEqual(['header', 'text', 'footer']);
  });
});

describe('createBlock', () => {
  it('creates every supported block type with unique ids', () => {
    const types = ['text', 'image', 'button', 'divider', 'spacer', 'columns', 'header', 'footer', 'social'] as const;
    const blocks = types.map((t) => createBlock(t));
    expect(blocks.map((b) => b.type)).toEqual([...types]);
    expect(new Set(blocks.map((b) => b.id)).size).toBe(blocks.length);
  });
});

describe('renderDesignPreview', () => {
  it('renders starter content with sample values substituted', () => {
    const [first] = starterTemplates();
    const html = renderDesignPreview(first.design);
    expect(html).toContain('Jordan');
    expect(html).toContain('Harbor Dental Studio');
    expect(html).not.toContain('{{first_name}}');
  });
});

describe('collectDesignVariables', () => {
  it('collects variables across blocks, subject-adjacent fields, and footer', () => {
    const [first] = starterTemplates();
    const vars = collectDesignVariables(first.design);
    expect(vars).toEqual(expect.arrayContaining(['first_name', 'business_name', 'unsubscribe_link']));
  });
});

describe('substituteSamples', () => {
  it('escapes substituted values', () => {
    expect(substituteSamples('Hi {{first_name}}', { first_name: '<b>x</b>' })).toBe('Hi &lt;b&gt;x&lt;/b&gt;');
  });
});

describe('estimateSmsSegmentsClient', () => {
  it('matches the backend estimator semantics', () => {
    expect(estimateSmsSegmentsClient('Hello').segments).toBe(1);
    expect(estimateSmsSegmentsClient('a'.repeat(200)).segments).toBe(2);
    expect(estimateSmsSegmentsClient('Hello 👋').encoding).toBe('UCS-2');
  });
});

describe('validateWhatsappClient', () => {
  it('enforces the Cloud API text limit', () => {
    expect(validateWhatsappClient('', 0).ok).toBe(false);
    expect(validateWhatsappClient('Hi', 0).ok).toBe(true);
    expect(validateWhatsappClient('x'.repeat(4097), 0).ok).toBe(false);
    expect(validateWhatsappClient('Hi', 2).warnings.length).toBeGreaterThan(0);
  });
});

it('counts emoji as two UTF-16 units in SMS estimates', () => {
  expect(estimateSmsSegmentsClient('😀'.repeat(60))).toMatchObject({ encoding: 'UCS-2', characters: 120, segments: 2 });
});

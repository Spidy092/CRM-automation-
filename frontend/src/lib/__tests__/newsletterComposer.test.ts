import { describe, it, expect } from 'vitest';
import {
  compileBlocksToHtml,
  blocksToText,
  blocksAreEmpty,
  createBlock,
  type NewsletterBlock,
} from '../newsletterComposer';

const block = (overrides: Partial<NewsletterBlock> & { type: NewsletterBlock['type'] }): NewsletterBlock => ({
  id: 'b1',
  text: '',
  items: [],
  url: '',
  ...overrides,
});

describe('newsletterComposer block compiler', () => {
  it('compiles heading, paragraph, bullets, and button blocks in order', () => {
    const html = compileBlocksToHtml([
      block({ id: 'h', type: 'heading', text: 'October update' }),
      block({ id: 'p', type: 'paragraph', text: 'Hello all.' }),
      block({ id: 'l', type: 'bullets', items: ['One', 'Two'] }),
      block({ id: 'c', type: 'button', text: 'Read more', url: 'https://example.com/post' }),
    ]);
    expect(html.indexOf('<h2')).toBeLessThan(html.indexOf('<p'));
    expect(html).toContain('October update');
    expect(html).toContain('<li>One</li>');
    expect(html).toContain('href="https://example.com/post"');
  });

  it('escapes user content so markup cannot break out', () => {
    const html = compileBlocksToHtml([
      block({ type: 'paragraph', text: '<script>alert(1)</script>' }),
      block({ type: 'button', text: 'x"y', url: 'https://example.com/?a="b"' }),
    ]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;');
  });

  it('drops empty blocks and non-http button URLs', () => {
    const html = compileBlocksToHtml([
      block({ type: 'heading', text: '   ' }),
      block({ type: 'bullets', items: ['  ', ''] }),
      block({ type: 'button', text: 'Click', url: 'javascript:alert(1)' }),
    ]);
    expect(html).not.toContain('<ul>');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('Click');
  });

  it('reports emptiness for the send guard and builds plain text', () => {
    expect(blocksAreEmpty([block({ type: 'paragraph', text: '  ' })])).toBe(true);
    expect(blocksAreEmpty([block({ type: 'paragraph', text: 'Hi' })])).toBe(false);
    const text = blocksToText([
      block({ type: 'heading', text: 'Title' }),
      block({ type: 'bullets', items: ['A', 'B'] }),
      block({ type: 'button', text: 'Go', url: 'https://example.com' }),
    ]);
    expect(text).toContain('Title');
    expect(text).toContain('- A');
    expect(text).toContain('Go (https://example.com)');
  });

  it('creates distinct blocks with usable defaults', () => {
    const a = createBlock('bullets');
    const b = createBlock('bullets');
    expect(a.id).not.toBe(b.id);
    expect(a.items).toEqual(['']);
  });
});

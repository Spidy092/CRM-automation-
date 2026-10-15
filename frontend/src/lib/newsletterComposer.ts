/**
 * Block-based newsletter composer. No new dependencies: blocks are plain
 * data edited with installed shadcn inputs and compiled to email HTML here.
 * HTML remains available as an advanced tab; this path is the default so
 * non-technical users never need to hand-write markup.
 */

export type NewsletterBlockType = 'heading' | 'paragraph' | 'bullets' | 'button';

export interface NewsletterBlock {
  id: string;
  type: NewsletterBlockType;
  /** heading/paragraph/button text; bullets use `items`. */
  text: string;
  items: string[];
  /** button destination URL. */
  url: string;
}

export function createBlock(type: NewsletterBlockType): NewsletterBlock {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return { id, type, text: '', items: type === 'bullets' ? [''] : [], url: '' };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

/** Compile blocks to email-safe HTML. All user content is escaped. */
export function compileBlocksToHtml(blocks: NewsletterBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
        if (block.text.trim()) parts.push(`<h2 style="margin:0 0 12px;">${escapeHtml(block.text)}</h2>`);
        break;
      case 'paragraph':
        if (block.text.trim()) {
          const paras = block.text
            .split(/\n{2,}/)
            .map((p) => `<p style="margin:0 0 12px;">${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`);
          parts.push(paras.join(''));
        }
        break;
      case 'bullets': {
        const items = block.items.filter((i) => i.trim());
        if (items.length > 0) {
          parts.push(`<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`);
        }
        break;
      }
      case 'button':
        if (block.text.trim() && /^https?:\/\//i.test(block.url.trim())) {
          parts.push(
            `<p><a href="${escapeAttr(block.url.trim())}" style="display:inline-block;padding:10px 20px;background:#0f172a;color:#fff;border-radius:8px;text-decoration:none;">${escapeHtml(block.text)}</a></p>`,
          );
        } else if (block.text.trim()) {
          parts.push(`<p><strong>${escapeHtml(block.text)}</strong></p>`);
        }
        break;
    }
  }
  return parts.join('\n');
}

/** Plain-text companion for block content (preview + fallback). */
export function blocksToText(blocks: NewsletterBlock[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.type === 'heading' && block.text.trim()) lines.push(block.text.trim(), '');
    else if (block.type === 'paragraph' && block.text.trim()) lines.push(block.text.trim(), '');
    else if (block.type === 'bullets') {
      for (const item of block.items.filter((i) => i.trim())) lines.push(`- ${item.trim()}`);
      if (block.items.some((i) => i.trim())) lines.push('');
    } else if (block.type === 'button' && block.text.trim()) {
      lines.push(`${block.text.trim()}${/^https?:\/\//i.test(block.url.trim()) ? ` (${block.url.trim()})` : ''}`, '');
    }
  }
  return lines.join('\n').trim();
}

/** True when the blocks carry no renderable content (send guard). */
export function blocksAreEmpty(blocks: NewsletterBlock[]): boolean {
  return compileBlocksToHtml(blocks).trim().length === 0;
}

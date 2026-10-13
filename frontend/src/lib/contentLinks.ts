import type { LibraryFile } from '@/api/files';
import type { LandingPage } from '@/api/pages';
import type { MessageChannel } from '@/types';

/** Verified against backend/src/modules/templates/templates.service.ts */
export const ATTACHMENT_LIMITS = {
  maxCount: 3,
  maxBytes: 10 * 1024 * 1024,
  allowedTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'],
} as const;

export type ContentPlacement = 'link' | 'attach' | 'image' | 'page-link';

export function isImageFile(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

export function isAllowedAttachmentType(mimeType: string): boolean {
  return (ATTACHMENT_LIMITS.allowedTypes as readonly string[]).includes(mimeType);
}

export function formatBytes(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return '0 KB';
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  return `${(sizeBytes / 1024).toFixed(0)} KB`;
}

export function fileExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx >= 0 ? filename.slice(idx + 1).toUpperCase() : '';
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * Resolve a stored upload URL for display in this browser.
 *
 * Stored file URLs bake in the backend origin at upload time. When the backend
 * ran without APP_BASE_URL, that origin is `http://localhost:3000` — which
 * breaks for any browser client on another host (the reported broken
 * thumbnails). The API is same-origin (`/api/v1`) in every supported
 * deployment, so when the stored host is loopback but this page is not served
 * from loopback, the file is reachable at the page's own origin instead.
 * Anything else (including genuinely remote backends) is returned untouched.
 */
export function resolveAssetUrl(
  url: string,
  pageHostname: string = window.location.hostname,
  pageOrigin: string = window.location.origin,
): string {
  try {
    const parsed = new URL(url);
    if (LOOPBACK_HOSTNAMES.has(parsed.hostname) && !LOOPBACK_HOSTNAMES.has(pageHostname)) {
      return `${pageOrigin}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    // Not an absolute URL (or unparseable) — render as stored.
  }
  return url;
}

/** Channels where the send engine actually dispatches attachments. */
export function channelSupportsAttachments(channel: MessageChannel): boolean {
  return channel === 'email' || channel === 'whatsapp';
}

/** Inline images serialize correctly only in the visual email editor. */
export function channelSupportsInlineImage(channel: MessageChannel, editorMode: string): boolean {
  return channel === 'email' && editorMode === 'visual';
}

export function pagePublicUrl(slug: string): string {
  return `${window.location.origin}/p/${slug}`;
}

export function buildFileDownloadLine(file: LibraryFile): string {
  return `${file.filename}: ${file.url}`;
}

export function buildPageLinkLine(page: LandingPage): string {
  return `View ${page.title}: ${pagePublicUrl(page.slug)}`;
}

/**
 * Actual recipient result preview. Kept honest per channel:
 * - email: attachments ride along; inline images render in the designed HTML.
 * - whatsapp: only the first attachment is sent as media (Cloud API).
 * - sms/phone_call: attachments are ignored by the sender — use a link.
 */
export function describeRecipientResult(
  channel: MessageChannel,
  placement: ContentPlacement,
  file?: LibraryFile | null,
  page?: LandingPage | null,
): string {
  if (placement === 'page-link' && page) {
    if (channel === 'sms' || channel === 'phone_call') {
      return `Recipient sees plain text with the page URL: ${pagePublicUrl(page.slug)}`;
    }
    return `Recipient sees “View ${page.title}” linking to ${pagePublicUrl(page.slug)}`;
  }
  if (placement === 'attach' && file) {
    if (channel === 'email') return `Recipient receives “${file.filename}” as an email attachment.`;
    if (channel === 'whatsapp')
      return `Recipient receives “${file.filename}” as WhatsApp media (only the first attachment is sent as media).`;
    return `Attachments are not sent on this channel — use “Add download link” instead.`;
  }
  if (placement === 'image' && file) {
    return `Recipient sees the image inline in the designed email (alt: “${file.filename}”).`;
  }
  if (file) {
    if (channel === 'sms' || channel === 'phone_call') {
      return `Recipient sees plain text with the file URL: ${file.url}`;
    }
    return `Recipient sees a download link for “${file.filename}”.`;
  }
  return '';
}

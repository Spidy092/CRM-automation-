import { describe, it, expect } from 'vitest';
import {
  channelSupportsAttachments,
  channelSupportsInlineImage,
  describeRecipientResult,
  resolveAssetUrl,
} from '../contentLinks';

const img = { id: 'f1', filename: 'photo.png', mime_type: 'image/png', size_bytes: 100, url: 'http://x/photo.png', tags: [], created_by: 'u1', created_at: '', updated_at: '' } as never;
const page = { id: 'p1', title: 'Pricing', slug: 'pricing' } as never;

describe('contentLinks channel behavior', () => {
  it('supports attachments only on email and whatsapp', () => {
    expect(channelSupportsAttachments('email')).toBe(true);
    expect(channelSupportsAttachments('whatsapp')).toBe(true);
    expect(channelSupportsAttachments('sms')).toBe(false);
    expect(channelSupportsAttachments('phone_call')).toBe(false);
  });

  it('supports inline images only in the visual email editor', () => {
    expect(channelSupportsInlineImage('email', 'visual')).toBe(true);
    expect(channelSupportsInlineImage('email', 'simple')).toBe(false);
    expect(channelSupportsInlineImage('email', 'html')).toBe(false);
    expect(channelSupportsInlineImage('whatsapp', 'visual')).toBe(false);
  });

  it('describes the actual whatsapp first-attachment media behavior', () => {
    expect(describeRecipientResult('whatsapp', 'attach', img, null)).toMatch(/only the first attachment/i);
  });

  it('is honest that sms ignores attachments', () => {
    expect(describeRecipientResult('sms', 'attach', img, null)).toMatch(/not sent on this channel/i);
  });

  it('previews sms page inserts as plain text with the URL', () => {
    expect(describeRecipientResult('sms', 'page-link', null, page)).toMatch(/plain text with the page URL/i);
  });
});

describe('resolveAssetUrl', () => {
  it('rewrites loopback-hosted upload URLs when the page is served from another host', () => {
    expect(
      resolveAssetUrl('http://localhost:3000/uploads/files/a.png', 'app.example.com', 'https://app.example.com'),
    ).toBe('https://app.example.com/uploads/files/a.png');
  });

  it('keeps loopback URLs when developing on localhost', () => {
    expect(
      resolveAssetUrl('http://localhost:3000/uploads/files/a.png', 'localhost', 'http://localhost:5173'),
    ).toBe('http://localhost:3000/uploads/files/a.png');
  });

  it('leaves genuinely remote URLs untouched', () => {
    expect(
      resolveAssetUrl('https://cdn.example.com/a.png', 'app.example.com', 'https://app.example.com'),
    ).toBe('https://cdn.example.com/a.png');
  });

  it('returns unparseable values as stored', () => {
    expect(resolveAssetUrl('not-a-url', 'app.example.com', 'https://app.example.com')).toBe('not-a-url');
  });
});

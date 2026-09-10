import { describe, expect, it } from '@jest/globals';
import { quickSendSchema } from './outreach.schema';

const templateId = '550e8400-e29b-41d4-a716-446655440000';

describe('quickSendSchema custom messages', () => {
  it('accepts the existing approved-template shape', () => {
    expect(quickSendSchema.safeParse({ channel: 'email', templateId }).success).toBe(true);
  });

  it('accepts custom SMS and WhatsApp bodies', () => {
    expect(quickSendSchema.safeParse({ channel: 'sms', body: 'Hello' }).success).toBe(true);
    expect(quickSendSchema.safeParse({ channel: 'whatsapp', body: 'Hello' }).success).toBe(true);
  });

  it('requires both a subject and body for a custom email', () => {
    expect(quickSendSchema.safeParse({ channel: 'email', body: 'Hello' }).success).toBe(false);
    expect(quickSendSchema.safeParse({ channel: 'email', subject: 'Hello' }).success).toBe(false);
    expect(quickSendSchema.safeParse({ channel: 'email', body: 'Hello', subject: 'Welcome' }).success).toBe(true);
  });

  it('rejects an empty custom body and oversized custom body', () => {
    expect(quickSendSchema.safeParse({ channel: 'sms', body: '   ' }).success).toBe(false);
    expect(quickSendSchema.safeParse({ channel: 'sms', body: 'x'.repeat(10_001) }).success).toBe(false);
  });
});

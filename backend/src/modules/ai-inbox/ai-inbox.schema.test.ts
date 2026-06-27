import { listInboxSchema, actionInboxSchema } from './ai-inbox.schema';

describe('ai-inbox schema', () => {
  describe('listInboxSchema', () => {
    it('accepts an empty object and applies defaults', () => {
      const result = listInboxSchema.parse({});
      expect(result).toEqual({ status: undefined, item_type: undefined, limit: 50, offset: 0 });
    });

    it.each(['pending', 'actioned', 'snoozed', 'auto_resolved'] as const)(
      'accepts valid status "%s"',
      (status) => {
        const result = listInboxSchema.parse({ status });
        expect(result.status).toBe(status);
      }
    );

    it('rejects an invalid status value', () => {
      expect(() => listInboxSchema.parse({ status: 'invalid_status' })).toThrow();
    });

    it.each([
      'approve_response',
      'urgent_reply',
      'pricing_inquiry',
      'campaign_review',
      'lead_handoff',
      'objection_review',
    ] as const)('accepts valid item_type "%s"', (item_type) => {
      const result = listInboxSchema.parse({ item_type });
      expect(result.item_type).toBe(item_type);
    });

    it('rejects an invalid item_type value', () => {
      expect(() => listInboxSchema.parse({ item_type: 'invalid_type' })).toThrow();
    });

    it('coerces string limit to number', () => {
      const result = listInboxSchema.parse({ limit: '25' });
      expect(result.limit).toBe(25);
    });

    it('rejects limit less than 1', () => {
      expect(() => listInboxSchema.parse({ limit: 0 })).toThrow();
      expect(() => listInboxSchema.parse({ limit: -1 })).toThrow();
    });

    it('rejects limit greater than 100', () => {
      expect(() => listInboxSchema.parse({ limit: 101 })).toThrow();
    });

    it('rejects non-integer limit', () => {
      expect(() => listInboxSchema.parse({ limit: 10.5 })).toThrow();
    });

    it('applies default limit = 50 when omitted', () => {
      const result = listInboxSchema.parse({});
      expect(result.limit).toBe(50);
    });

    it('coerces string offset to number', () => {
      const result = listInboxSchema.parse({ offset: '10' });
      expect(result.offset).toBe(10);
    });

    it('rejects negative offset', () => {
      expect(() => listInboxSchema.parse({ offset: -1 })).toThrow();
    });

    it('applies default offset = 0 when omitted', () => {
      const result = listInboxSchema.parse({});
      expect(result.offset).toBe(0);
    });
  });

  describe('actionInboxSchema', () => {
    it.each(['approve', 'reject', 'snooze'] as const)(
      'accepts valid action "%s"',
      (action) => {
        const result = actionInboxSchema.parse({ action });
        expect(result.action).toBe(action);
      }
    );

    it('rejects an invalid action value', () => {
      expect(() => actionInboxSchema.parse({ action: 'invalid_action' })).toThrow();
    });

    it('accepts a valid ISO datetime snoozed_until', () => {
      const iso = '2025-01-01T00:00:00Z';
      const result = actionInboxSchema.parse({ action: 'snooze', snoozed_until: iso });
      expect(result.snoozed_until).toBe(iso);
    });

    it('rejects an invalid datetime string', () => {
      expect(() =>
        actionInboxSchema.parse({ action: 'snooze', snoozed_until: 'not-a-datetime' })
      ).toThrow();
    });

    it('allows omitting snoozed_until', () => {
      const result = actionInboxSchema.parse({ action: 'approve' });
      expect(result.snoozed_until).toBeUndefined();
    });
  });
});

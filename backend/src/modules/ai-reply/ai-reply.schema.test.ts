import { classifyReplySchema, replyHistoryQuerySchema } from './ai-reply.schema';

const validUuid = '019f079c-f429-762a-89ab-d143218efd4e';

describe('ai-reply schema', () => {
  describe('classifyReplySchema', () => {
    it('accepts a valid classify payload', () => {
      const result = classifyReplySchema.parse({
        lead_id: validUuid,
        message: 'I am interested in your offer.',
        campaign_id: validUuid,
        channel: 'email',
        metadata: { source: 'test' },
      });
      expect(result).toEqual({
        lead_id: validUuid,
        message: 'I am interested in your offer.',
        campaign_id: validUuid,
        channel: 'email',
        metadata: { source: 'test' },
      });
    });

    it.each(['email', 'sms', 'whatsapp'] as const)(
      'accepts valid channel "%s"',
      (channel) => {
        const result = classifyReplySchema.parse({
          lead_id: validUuid,
          message: 'Hello',
          channel,
        });
        expect(result.channel).toBe(channel);
      }
    );

    it('rejects an invalid channel', () => {
      expect(() =>
        classifyReplySchema.parse({
          lead_id: validUuid,
          message: 'Hello',
          channel: 'fax',
        })
      ).toThrow();
    });

    it('rejects an invalid lead_id', () => {
      expect(() =>
        classifyReplySchema.parse({
          lead_id: 'not-a-uuid',
          message: 'Hello',
          channel: 'email',
        })
      ).toThrow();
    });

    it('rejects an empty message', () => {
      expect(() =>
        classifyReplySchema.parse({
          lead_id: validUuid,
          message: '',
          channel: 'email',
        })
      ).toThrow();
    });

    it('rejects a message longer than 4000 characters', () => {
      expect(() =>
        classifyReplySchema.parse({
          lead_id: validUuid,
          message: 'a'.repeat(4001),
          channel: 'email',
        })
      ).toThrow();
    });

    it('allows omitting optional fields', () => {
      const result = classifyReplySchema.parse({
        lead_id: validUuid,
        message: 'Hello',
        channel: 'sms',
      });
      expect(result.campaign_id).toBeUndefined();
      expect(result.metadata).toBeUndefined();
    });

    it('allows metadata with arbitrary values', () => {
      const result = classifyReplySchema.parse({
        lead_id: validUuid,
        message: 'Hello',
        channel: 'whatsapp',
        metadata: { count: 1, nested: { flag: true }, list: [1, 2, 3] },
      });
      expect(result.metadata).toEqual({
        count: 1,
        nested: { flag: true },
        list: [1, 2, 3],
      });
    });
  });

  describe('replyHistoryQuerySchema', () => {
    it('accepts an empty query and applies defaults', () => {
      const result = replyHistoryQuerySchema.parse({});
      expect(result).toEqual({
        lead_id: undefined,
        campaign_id: undefined,
        classification: undefined,
        limit: 20,
        offset: 0,
      });
    });

    it('accepts a fully populated query', () => {
      const result = replyHistoryQuerySchema.parse({
        lead_id: validUuid,
        campaign_id: validUuid,
        classification: 'interested',
        limit: 50,
        offset: 10,
      });
      expect(result).toEqual({
        lead_id: validUuid,
        campaign_id: validUuid,
        classification: 'interested',
        limit: 50,
        offset: 10,
      });
    });

    it('rejects an invalid lead_id', () => {
      expect(() =>
        replyHistoryQuerySchema.parse({ lead_id: 'not-a-uuid' })
      ).toThrow();
    });

    it('rejects an invalid campaign_id', () => {
      expect(() =>
        replyHistoryQuerySchema.parse({ campaign_id: 'not-a-uuid' })
      ).toThrow();
    });

    it('coerces string limit to number', () => {
      const result = replyHistoryQuerySchema.parse({ limit: '25' });
      expect(result.limit).toBe(25);
    });

    it('coerces string offset to number', () => {
      const result = replyHistoryQuerySchema.parse({ offset: '5' });
      expect(result.offset).toBe(5);
    });

    it('rejects limit less than 1', () => {
      expect(() => replyHistoryQuerySchema.parse({ limit: 0 })).toThrow();
      expect(() => replyHistoryQuerySchema.parse({ limit: -1 })).toThrow();
    });

    it('rejects limit greater than 100', () => {
      expect(() => replyHistoryQuerySchema.parse({ limit: 101 })).toThrow();
    });

    it('rejects non-integer limit', () => {
      expect(() => replyHistoryQuerySchema.parse({ limit: 10.5 })).toThrow();
    });

    it('rejects negative offset', () => {
      expect(() => replyHistoryQuerySchema.parse({ offset: -1 })).toThrow();
    });

    it('applies default limit = 20 and offset = 0', () => {
      const result = replyHistoryQuerySchema.parse({});
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
    });
  });
});

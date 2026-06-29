import { chatHistoryParamsSchema, sendChatMessageSchema } from './chat.schema';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

describe('chat.schema', () => {
  describe('sendChatMessageSchema', () => {
    describe('conversationId', () => {
      it('accepts a valid conversationId', () => {
        const result = sendChatMessageSchema.parse({
          conversationId: 'conv-1',
          message: 'hello',
        });
        expect(result.conversationId).toBe('conv-1');
        expect(result.message).toBe('hello');
      });

      it('rejects an empty conversationId', () => {
        expect(() =>
          sendChatMessageSchema.parse({ conversationId: '', message: 'hello' }),
        ).toThrow();
      });

      it('rejects conversationId longer than 120 chars', () => {
        expect(() =>
          sendChatMessageSchema.parse({ conversationId: 'a'.repeat(121), message: 'hello' }),
        ).toThrow();
      });

      it('accepts conversationId at exactly 120 chars', () => {
        const result = sendChatMessageSchema.parse({
          conversationId: 'a'.repeat(120),
          message: 'hello',
        });
        expect(result.conversationId).toHaveLength(120);
      });
    });

    describe('message', () => {
      it('rejects an empty message', () => {
        expect(() =>
          sendChatMessageSchema.parse({ conversationId: 'conv-1', message: '' }),
        ).toThrow();
      });

      it('rejects message longer than 4000 chars', () => {
        expect(() =>
          sendChatMessageSchema.parse({
            conversationId: 'conv-1',
            message: 'a'.repeat(4001),
          }),
        ).toThrow();
      });

      it('accepts message at exactly 4000 chars', () => {
        const result = sendChatMessageSchema.parse({
          conversationId: 'conv-1',
          message: 'a'.repeat(4000),
        });
        expect(result.message).toHaveLength(4000);
      });

      it('rejects when message field is missing', () => {
        expect(() =>
          sendChatMessageSchema.parse({ conversationId: 'conv-1' }),
        ).toThrow();
      });
    });

    describe('pageContext', () => {
      it('accepts a valid pageContext with route', () => {
        const result = sendChatMessageSchema.parse({
          conversationId: 'conv-1',
          message: 'hi',
          pageContext: { route: '/leads' },
        });
        expect(result.pageContext?.route).toBe('/leads');
      });

      it('rejects pageContext with empty route', () => {
        expect(() =>
          sendChatMessageSchema.parse({
            conversationId: 'conv-1',
            message: 'hi',
            pageContext: { route: '' },
          }),
        ).toThrow();
      });

      it('rejects pageContext with route longer than 200 chars', () => {
        expect(() =>
          sendChatMessageSchema.parse({
            conversationId: 'conv-1',
            message: 'hi',
            pageContext: { route: '/'.padEnd(201, 'a') },
          }),
        ).toThrow();
      });

      it('accepts pageContext with valid pageTitle', () => {
        const result = sendChatMessageSchema.parse({
          conversationId: 'conv-1',
          message: 'hi',
          pageContext: { route: '/leads', pageTitle: 'Leads' },
        });
        expect(result.pageContext?.pageTitle).toBe('Leads');
      });

      it('rejects pageContext with empty pageTitle', () => {
        expect(() =>
          sendChatMessageSchema.parse({
            conversationId: 'conv-1',
            message: 'hi',
            pageContext: { route: '/leads', pageTitle: '' },
          }),
        ).toThrow();
      });

      it('accepts pageContext with up to 25 visibleRecords', () => {
        const records = Array.from({ length: 25 }, (_, i) => ({
          type: 'lead' as const,
          id: VALID_UUID,
          name: `Lead ${i}`,
        }));
        const result = sendChatMessageSchema.parse({
          conversationId: 'conv-1',
          message: 'hi',
          pageContext: { route: '/leads', visibleRecords: records },
        });
        expect(result.pageContext?.visibleRecords).toHaveLength(25);
      });

      it('rejects pageContext with more than 25 visibleRecords', () => {
        const records = Array.from({ length: 26 }, (_, i) => ({
          type: 'lead' as const,
          id: VALID_UUID,
          name: `Lead ${i}`,
        }));
        expect(() =>
          sendChatMessageSchema.parse({
            conversationId: 'conv-1',
            message: 'hi',
            pageContext: { route: '/leads', visibleRecords: records },
          }),
        ).toThrow();
      });

      it('rejects visibleRecord with non-uuid id', () => {
        expect(() =>
          sendChatMessageSchema.parse({
            conversationId: 'conv-1',
            message: 'hi',
            pageContext: {
              route: '/leads',
              visibleRecords: [{ type: 'lead', id: 'not-a-uuid', name: 'Lead A' }],
            },
          }),
        ).toThrow();
      });

      it.each([
        'lead',
        'campaign',
        'scraper',
        'pipeline',
        'pipeline_stage',
        'template',
        'sequence',
        'outreach_task',
        'ai_inbox_item',
        'ai_decision',
        'integration',
        'user',
        'scoring_rule',
        'custom_field',
        'assignment_user',
      ] as const)('accepts visibleRecord type "%s"', (type) => {
        const result = sendChatMessageSchema.parse({
          conversationId: 'conv-1',
          message: 'hi',
          pageContext: {
            route: '/',
            visibleRecords: [{ type, id: VALID_UUID, name: 'Item' }],
          },
        });
        expect(result.pageContext?.visibleRecords?.[0].type).toBe(type);
      });

      it('rejects visibleRecord with invalid type', () => {
        expect(() =>
          sendChatMessageSchema.parse({
            conversationId: 'conv-1',
            message: 'hi',
            pageContext: {
              route: '/',
              visibleRecords: [
                { type: 'not_a_valid_type', id: VALID_UUID, name: 'Item' },
              ],
            },
          }),
        ).toThrow();
      });

      it('accepts pageContext with availableActions and pageCapabilities', () => {
        const result = sendChatMessageSchema.parse({
          conversationId: 'conv-1',
          message: 'hi',
          pageContext: {
            route: '/leads',
            availableActions: ['lead.list'],
            pageCapabilities: ['view leads'],
          },
        });
        expect(result.pageContext?.availableActions).toEqual(['lead.list']);
        expect(result.pageContext?.pageCapabilities).toEqual(['view leads']);
      });

      it('rejects more than 20 availableActions', () => {
        const actions = Array.from({ length: 21 }, (_, i) => `action_${i}`);
        expect(() =>
          sendChatMessageSchema.parse({
            conversationId: 'conv-1',
            message: 'hi',
            pageContext: { route: '/', availableActions: actions },
          }),
        ).toThrow();
      });

      it('accepts pageContext with pageMetrics record', () => {
        const result = sendChatMessageSchema.parse({
          conversationId: 'conv-1',
          message: 'hi',
          pageContext: {
            route: '/',
            pageMetrics: { totalLeads: 10, qualified: 5 },
          },
        });
        expect(result.pageContext?.pageMetrics).toEqual({ totalLeads: 10, qualified: 5 });
      });
    });
  });

  describe('chatHistoryParamsSchema', () => {
    it('accepts a valid conversationId', () => {
      const result = chatHistoryParamsSchema.parse({ conversationId: 'conv-1' });
      expect(result.conversationId).toBe('conv-1');
    });

    it('rejects an empty conversationId', () => {
      expect(() => chatHistoryParamsSchema.parse({ conversationId: '' })).toThrow();
    });

    it('rejects missing conversationId', () => {
      expect(() => chatHistoryParamsSchema.parse({})).toThrow();
    });

    it('rejects conversationId longer than 120 chars', () => {
      expect(() =>
        chatHistoryParamsSchema.parse({ conversationId: 'a'.repeat(121) }),
      ).toThrow();
    });

    it('accepts conversationId at exactly 120 chars', () => {
      const result = chatHistoryParamsSchema.parse({ conversationId: 'a'.repeat(120) });
      expect(result.conversationId).toHaveLength(120);
    });
  });
});

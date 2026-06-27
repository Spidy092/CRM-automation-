import { isAIDomainEvent, aiEventIdempotencyKey, type AIDomainEvent } from './ai.events';

describe('ai.events', () => {
  describe('isAIDomainEvent', () => {
    const validEvents: AIDomainEvent[] = [
      { type: 'lead.scraped', payload: { lead_id: 'lead-1' } },
      { type: 'lead.imported', payload: { lead_id: 'lead-2' } },
      {
        type: 'lead.reply.received',
        payload: {
          lead_id: 'lead-3',
          channel: 'email',
          message_id: 'msg-1',
          message_text: 'hello',
          received_at: '2024-01-01T00:00:00Z',
        },
      },
      { type: 'lead.stage.changed', payload: { lead_id: 'lead-4', from_stage: 'new', to_stage: 'qualified' } },
      { type: 'outreach.bounced', payload: { lead_id: 'lead-5', channel: 'email' } },
      { type: 'outreach.opened', payload: { lead_id: 'lead-6', campaign_id: 'camp-1' } },
      { type: 'outreach.clicked', payload: { lead_id: 'lead-7', campaign_id: 'camp-2', link: 'https://example.com' } },
      { type: 'campaign.pre_launch', payload: { campaign_id: 'camp-3' } },
      { type: 'lead.score.updated', payload: { lead_id: 'lead-8', new_score: 42 } },
    ];

    it.each(validEvents)('returns true for valid event %s', (event) => {
      expect(isAIDomainEvent(event)).toBe(true);
    });

    it('returns false for non-objects', () => {
      expect(isAIDomainEvent(null)).toBe(false);
      expect(isAIDomainEvent(undefined)).toBe(false);
      expect(isAIDomainEvent('string')).toBe(false);
      expect(isAIDomainEvent(123)).toBe(false);
      expect(isAIDomainEvent(true)).toBe(false);
      expect(isAIDomainEvent(() => undefined)).toBe(false);
    });

    it('returns false when type is missing or not a string', () => {
      expect(isAIDomainEvent({})).toBe(false);
      expect(isAIDomainEvent({ payload: { lead_id: 'x' } })).toBe(false);
      expect(isAIDomainEvent({ type: 123, payload: { lead_id: 'x' } })).toBe(false);
    });

    it('returns false when type is not a recognized AI event type', () => {
      expect(isAIDomainEvent({ type: 'unknown.event', payload: { lead_id: 'x' } })).toBe(false);
      expect(isAIDomainEvent({ type: 'lead.scraped.extra', payload: { lead_id: 'x' } })).toBe(false);
    });

    it('returns false when payload is missing or not an object', () => {
      expect(isAIDomainEvent({ type: 'lead.scraped' })).toBe(false);
      expect(isAIDomainEvent({ type: 'lead.scraped', payload: null })).toBe(false);
      expect(isAIDomainEvent({ type: 'lead.scraped', payload: 'string' })).toBe(false);
      expect(isAIDomainEvent({ type: 'lead.scraped', payload: 123 })).toBe(false);
    });
  });

  describe('aiEventIdempotencyKey', () => {
    it('uses lead_id when present in payload', () => {
      const event: AIDomainEvent = { type: 'lead.scraped', payload: { lead_id: 'lead-1' } };
      expect(aiEventIdempotencyKey(event)).toBe('lead.scraped:lead-1');
    });

    it('falls back to campaign_id when lead_id is absent', () => {
      const event: AIDomainEvent = { type: 'campaign.pre_launch', payload: { campaign_id: 'camp-1' } };
      expect(aiEventIdempotencyKey(event)).toBe('campaign.pre_launch:camp-1');
    });

    it('returns empty id when neither lead_id nor campaign_id is present', () => {
      const event = { type: 'lead.score.updated', payload: { new_score: 42 } } as unknown as AIDomainEvent;
      expect(aiEventIdempotencyKey(event)).toBe('lead.score.updated:');
    });
  });
});

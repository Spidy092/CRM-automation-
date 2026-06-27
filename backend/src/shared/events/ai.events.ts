/**
 * Domain events consumed by the AI Sales Operator (Phase 2).
 *
 * These events are produced by core CRM/outreach workflows and enqueued on the
 * `ai-events` BullMQ queue so that AI workers can react to lead/campaign
 * lifecycle changes in a typed, idempotent way.
 */

export type AIDomainEvent =
  | { type: 'lead.scraped'; payload: { lead_id: string } }
  | { type: 'lead.imported'; payload: { lead_id: string } }
  | { type: 'lead.reply.received'; payload: { lead_id: string; channel: string; message_id: string } }
  | { type: 'lead.stage.changed'; payload: { lead_id: string; from_stage: string; to_stage: string } }
  | { type: 'outreach.bounced'; payload: { lead_id: string; channel: string } }
  | { type: 'outreach.opened'; payload: { lead_id: string; campaign_id: string } }
  | { type: 'outreach.clicked'; payload: { lead_id: string; campaign_id: string; link: string } }
  | { type: 'campaign.pre_launch'; payload: { campaign_id: string } }
  | { type: 'lead.score.updated'; payload: { lead_id: string; new_score: number } };

const AI_EVENT_TYPES: readonly string[] = [
  'lead.scraped',
  'lead.imported',
  'lead.reply.received',
  'lead.stage.changed',
  'outreach.bounced',
  'outreach.opened',
  'outreach.clicked',
  'campaign.pre_launch',
  'lead.score.updated',
];

/**
 * Narrow an unknown value to an {@link AIDomainEvent}.
 *
 * Performs a structural check on the `type` and `payload` fields; it does not
 * validate that every payload property is present at runtime.
 */
export function isAIDomainEvent(x: unknown): x is AIDomainEvent {
  if (typeof x !== 'object' || x === null) return false;

  const candidate = x as { type?: unknown; payload?: unknown };
  if (typeof candidate.type !== 'string') return false;
  if (!AI_EVENT_TYPES.includes(candidate.type)) return false;
  if (typeof candidate.payload !== 'object' || candidate.payload === null) return false;

  return true;
}

/**
 * Build a deterministic idempotency key for an AI domain event.
 *
 * Uses `lead_id` when available; otherwise falls back to `campaign_id`.
 */
export function aiEventIdempotencyKey(event: AIDomainEvent): string {
  const id =
    'lead_id' in event.payload
      ? event.payload.lead_id
      : 'campaign_id' in event.payload
        ? event.payload.campaign_id
        : '';

  return `${event.type}:${id}`;
}

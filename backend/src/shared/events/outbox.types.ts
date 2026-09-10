/** JSON-compatible values accepted by the durable event outbox. */
export type OutboxJsonValue =
  | string
  | number
  | boolean
  | null
  | OutboxJsonObject
  | OutboxJsonValue[];

export interface OutboxJsonObject {
  [key: string]: OutboxJsonValue;
}

export type OutboxEventStatus = 'pending' | 'publishing' | 'published' | 'failed';

export interface OutboxEventInput {
  eventType: string;
  aggregateType?: string | null;
  aggregateId?: string | null;
  idempotencyKey: string;
  payload: OutboxJsonObject;
}

export interface OutboxEventRow {
  id: string;
  event_type: string;
  aggregate_type: string | null;
  aggregate_id: string | null;
  idempotency_key: string;
  payload: OutboxJsonObject;
  status: OutboxEventStatus;
  attempts: number;
  next_attempt_at: string;
  locked_at: string | null;
  locked_by: string | null;
  published_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface OutboxAppendResult {
  event: OutboxEventRow;
  created: boolean;
}

export interface OutboxClaimInput {
  limit: number;
  workerId: string;
  now?: string;
  leaseSeconds?: number;
}

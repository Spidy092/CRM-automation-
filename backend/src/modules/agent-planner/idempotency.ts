import crypto from 'crypto';
import type { PlanSource } from './plan.types';

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Build a deterministic idempotency key for a plan request.
 *
 * PII fields (actorId, goal, sourceMessage) are hashed individually before
 * being combined, so the outer SHA-256 pre-image never contains raw PII.
 * The intermediate digests and final key are stored only as opaque hashes.
 */
export function buildPlanIdempotencyKey(input: {
  source: PlanSource;
  actorId?: string | null;
  goal: string;
  sourceMessage?: string | null;
}): string {
  const actorDigest = sha256Hex(input.actorId ?? 'system');
  const goalDigest = sha256Hex(input.goal);
  const sourceMessageDigest = sha256Hex(input.sourceMessage ?? '');
  const hash = crypto
    .createHash('sha256')
    .update(`${input.source}:${actorDigest}:${goalDigest}:${sourceMessageDigest}`)
    .digest('hex');
  return `plan:${hash}`;
}

export function buildApproveIdempotencyKey(input: {
  planId: string;
  actorId: string;
  stepIndexes: number[];
}): string {
  const hash = crypto
    .createHash('sha256')
    .update(`${input.planId}:${input.actorId}:${[...input.stepIndexes].sort((a, b) => a - b).join(',')}`)
    .digest('hex');
  return `approve:${hash}`;
}

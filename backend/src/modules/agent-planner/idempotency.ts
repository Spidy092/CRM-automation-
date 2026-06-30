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

export function buildPlanIdempotencyKey(input: {
  source: PlanSource;
  actorId?: string | null;
  goal: string;
  sourceMessage?: string | null;
}): string {
  const hash = crypto
    .createHash('sha256')
    .update(
      `${input.source}:${input.actorId ?? 'system'}:${input.goal}:${input.sourceMessage ?? ''}`,
    )
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

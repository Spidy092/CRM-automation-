import { z } from 'zod';

export const listInboxSchema = z.object({
  status: z.enum(['pending', 'actioned', 'snoozed', 'auto_resolved']).optional(),
  item_type: z
    .enum([
      'approve_response',
      'urgent_reply',
      'pricing_inquiry',
      'campaign_review',
      'lead_handoff',
      'objection_review',
    ])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const actionInboxSchema = z.object({
  action: z.enum(['approve', 'reject', 'snooze']),
  snoozed_until: z.string().datetime().optional(),
  idempotency_key: z.string().min(1).max(120).optional(),
});

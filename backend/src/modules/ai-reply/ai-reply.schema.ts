import { z } from 'zod';

export const classifyReplySchema = z.object({
  lead_id: z.string().uuid(),
  message: z.string().min(1).max(4000),
  campaign_id: z.string().uuid().optional(),
  channel: z.enum(['email', 'sms', 'whatsapp']),
  metadata: z.record(z.unknown()).optional(),
});

export const replyHistoryQuerySchema = z.object({
  lead_id: z.string().uuid().optional(),
  campaign_id: z.string().uuid().optional(),
  classification: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

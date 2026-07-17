import { z } from 'zod';

/** :leadId route param */
export const leadIdParamSchema = z.object({
  leadId: z.string().uuid(),
});

/** Pagination for a lead's decision log */
export const leadDecisionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

/** Admin decision-log list filters */
export const decisionLogQuerySchema = z.object({
  decision_type: z.enum(['research', 'next_action', 'reply_classify', 'campaign_brief']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

/** Body for manually (re-)triggering AI research on a lead */
export const leadResearchTriggerBodySchema = z.object({
  force: z.boolean().optional().default(true),
});

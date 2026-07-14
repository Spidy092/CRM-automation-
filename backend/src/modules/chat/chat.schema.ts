import { z } from 'zod';

const visibleRecordTypeSchema = z.enum([
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
]);

const visibleRecordMetaSchema = z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]));

const pageMetricsSchema = z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]));

const pageContextSchema = z.object({
  route: z.string().min(1).max(200),
  pageTitle: z.string().min(1).max(120).optional(),
  visibleRecords: z
    .array(
      z.object({
        type: visibleRecordTypeSchema,
        id: z.string().uuid(),
        name: z.string().min(1).max(160),
        status: z.string().max(80).optional(),
        subtitle: z.string().max(200).optional(),
        meta: visibleRecordMetaSchema.optional(),
      }),
    )
    .max(25)
    .optional(),
  availableActions: z.array(z.string().min(1).max(80)).max(20).optional(),
  pageCapabilities: z.array(z.string().min(1).max(160)).max(20).optional(),
  pageMetrics: pageMetricsSchema.optional(),
});

export const sendChatMessageSchema = z.object({
  conversationId: z.string().min(1).max(120),
  message: z.string().min(1).max(4000),
  pageContext: pageContextSchema.optional(),
});

export const chatHistoryParamsSchema = z.object({
  conversationId: z.string().min(1).max(120),
});

import { z } from 'zod';

export const NEWSLETTER_TOPICS = ['product_updates', 'promotions', 'company_news'] as const;
export const NEWSLETTER_FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;
export const NEWSLETTER_SUBSCRIBER_STATUSES = ['pending', 'confirmed', 'unsubscribed'] as const;

export const subscribeSchema = z.object({
  email: z.string().email('email must be a valid email address').max(255),
  topics: z.array(z.enum(NEWSLETTER_TOPICS)).optional(),
  frequency: z.enum(NEWSLETTER_FREQUENCIES).optional(),
});

export const confirmQuerySchema = z.object({
  token: z.string().min(1, 'token is required'),
});

export const unsubscribeQuerySchema = z.object({
  token: z.string().min(1, 'token is required'),
});

export const publicUnsubscribeSchema = z.object({
  email: z.string().email('email must be a valid email address').max(255),
});

export const preferencesQuerySchema = z.object({
  token: z.string().min(1, 'token is required'),
});

export const updatePreferencesBodySchema = z
  .object({
    topics: z.array(z.enum(NEWSLETTER_TOPICS)).optional(),
    frequency: z.enum(NEWSLETTER_FREQUENCIES).optional(),
  })
  .refine((data) => data.topics !== undefined || data.frequency !== undefined, {
    message: 'At least one of topics or frequency must be provided',
  });

export const listSubscribersQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  status: z.enum(NEWSLETTER_SUBSCRIBER_STATUSES).optional(),
  search: z.string().max(255).optional(),
  topic: z.enum(NEWSLETTER_TOPICS).optional(),
  source: z.string().max(50).optional(),
  frequency: z.enum(NEWSLETTER_FREQUENCIES).optional(),
});

export const subscriberIdParamSchema = z.object({
  id: z.string().uuid(),
});

/** Broadcast ids are DB uuids once durable, BullMQ job ids on the Redis path. */
export const broadcastIdParamSchema = z.object({
  id: z.string().min(1, 'broadcast id is required').max(128),
});

/**
 * Operator opt-in for retrying UNKNOWN outcomes. Uncertain sends are never
 * retried automatically: the operator reviews them first (via the
 * uncertain-recipients endpoint) and accepts the possible-duplicate risk
 * explicitly by setting this flag.
 */
export const retryBroadcastBodySchema = z.object({
  includeUncertain: z.boolean().optional().default(false),
});

export const broadcastBodySchema = z.object({
  subject: z.string().min(1, 'subject is required').max(255),
  htmlBody: z.string().min(1, 'htmlBody is required'),
  // Optional creation-workflow fields. All optional so existing callers
  // sending only { subject, htmlBody } keep working unchanged.
  previewText: z.string().max(300).optional(),
  topics: z.array(z.enum(NEWSLETTER_TOPICS)).optional(),
  frequency: z.enum(NEWSLETTER_FREQUENCIES).optional(),
  scheduledAt: z.string().datetime({ offset: true }).optional(),
  // Wall-clock time from `<input type="datetime-local">` plus IANA zone.
  // The backend converts this pair to the correct UTC instant (see
  // newsletter.timezone.ts); the zone affects scheduling, not just display.
  scheduledAtLocal: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, 'scheduledAtLocal must be YYYY-MM-DDTHH:mm')
    .optional(),
  timezone: z.string().max(64).optional(),
  idempotencyKey: z.string().max(128).optional(),
  templateId: z.string().uuid().optional(),
});

export const eligibleCountQuerySchema = z.object({
  topics: z
    .union([z.enum(NEWSLETTER_TOPICS), z.array(z.enum(NEWSLETTER_TOPICS))])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  frequency: z.enum(NEWSLETTER_FREQUENCIES).optional(),
});

export const testSendSchema = z.object({
  to: z.string().email('to must be a valid email address'),
  subject: z.string().min(1, 'subject is required').max(255),
  htmlBody: z.string().min(1, 'htmlBody is required'),
  previewText: z.string().max(300).optional(),
});

export const digestDraftSchema = z.object({
  subject: z.string().min(1, 'subject is required').max(255),
  htmlBody: z.string().min(1, 'htmlBody is required'),
});

export const digestAutoSendSchema = z.object({
  autoSend: z.boolean(),
});

export const automatedDigestToggleSchema = z.object({
  enabled: z.boolean(),
});

export const updateDigestConfigSchema = z.object({
  topic: z.string().min(1, 'topic is required').max(200),
  tone: z.enum(['professional', 'casual', 'motivational', 'technical']),
  customPrompt: z.string().max(1000).optional().default(''),
  targetAudience: z.string().max(200).optional().default(''),
});

export type SubscribeBody = z.infer<typeof subscribeSchema>;
export type PublicUnsubscribeBody = z.infer<typeof publicUnsubscribeSchema>;
export type UpdatePreferencesBody = z.infer<typeof updatePreferencesBodySchema>;
export type ListSubscribersQuery = z.infer<typeof listSubscribersQuerySchema>;
export type BroadcastBody = z.infer<typeof broadcastBodySchema>;
export type AutomatedDigestToggleBody = z.infer<typeof automatedDigestToggleSchema>;
export type UpdateDigestConfigBody = z.infer<typeof updateDigestConfigSchema>;

/** Admin-only direct enrollment; public signups retain double opt-in. */
export const addNewsletterContactsSchema = z.object({
  leadIds: z.array(z.string().uuid()).min(1).max(100),
  topics: z.array(z.enum(NEWSLETTER_TOPICS)).default([...NEWSLETTER_TOPICS]),
  frequency: z.enum(NEWSLETTER_FREQUENCIES).default('weekly'),
});
export type AddNewsletterContactsInput = z.infer<typeof addNewsletterContactsSchema>;

export const newsletterDraftContentSchema = broadcastBodySchema
  .omit({ idempotencyKey: true })
  .partial()
  .extend({
    subject: z.string().max(255).default(''),
    htmlBody: z.string().max(500000).default(''),
    editMode: z.enum(['blocks', 'html']).optional(),
    blocks: z
      .array(
        z.object({
          id: z.string().max(128),
          type: z.enum(['heading', 'paragraph', 'bullets', 'button']),
          text: z.string().max(100000),
          items: z.array(z.string().max(10000)).max(1000),
          url: z.string().max(2048),
        }),
      )
      .max(100)
      .optional(),
  });
export const saveNewsletterDraftSchema = z.object({
  content: newsletterDraftContentSchema,
  revision: z.number().int().positive().optional(),
});
export const draftRevisionSchema = z.object({ revision: z.number().int().positive() });
export const draftIdParamSchema = z.object({ id: z.string().uuid() });
export const listNewsletterDraftsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});
export type NewsletterDraftContent = z.infer<typeof newsletterDraftContentSchema>;

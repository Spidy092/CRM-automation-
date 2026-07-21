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
});

export const subscriberIdParamSchema = z.object({
  id: z.string().uuid(),
});

export type SubscribeBody = z.infer<typeof subscribeSchema>;
export type UpdatePreferencesBody = z.infer<typeof updatePreferencesBodySchema>;
export type ListSubscribersQuery = z.infer<typeof listSubscribersQuerySchema>;

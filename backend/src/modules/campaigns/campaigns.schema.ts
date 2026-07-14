import { z } from 'zod';

export const createCampaignSchema = z.object({
  name: z.string().min(1).max(255),
  tone: z.enum(['formal', 'professional', 'conversational']).optional().default('professional'),
  target_industries: z.array(z.string()).optional().default([]),
  target_countries: z.array(z.string()).optional().default([]),
  sequence_id: z.string().uuid().optional(),
  pipeline_id: z.string().uuid().optional(),
  ai_personalization_enabled: z.boolean().optional().default(false),
  ab_test_enabled: z.boolean().optional().default(false),
  ab_test_metric: z.enum(['open_rate', 'click_rate', 'reply_rate']).optional().default('open_rate'),
  ab_test_min_samples: z.number().int().min(10).max(10000).optional().default(100),
  ab_test_confidence: z.number().min(80).max(99.99).optional().default(95),
  ab_test_auto_promote: z.boolean().optional().default(true),
});

export const updateCampaignSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  tone: z.enum(['formal', 'professional', 'conversational']).optional(),
  target_industries: z.array(z.string()).optional(),
  target_countries: z.array(z.string()).optional(),
  sequence_id: z.string().uuid().optional(),
  pipeline_id: z.string().uuid().optional(),
  ai_personalization_enabled: z.boolean().optional(),
  ab_test_enabled: z.boolean().optional(),
  ab_test_metric: z.enum(['open_rate', 'click_rate', 'reply_rate']).optional(),
  ab_test_min_samples: z.number().int().min(10).max(10000).optional(),
  ab_test_confidence: z.number().min(80).max(99.99).optional(),
  ab_test_auto_promote: z.boolean().optional(),
});

export const addLeadsSchema = z.object({
  lead_ids: z.array(z.string().uuid()).min(1),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;
export type AddLeadsInput = z.infer<typeof addLeadsSchema>;

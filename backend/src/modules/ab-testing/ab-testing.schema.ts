import { z } from 'zod';

export const variantKeyEnum = z.enum(['A', 'B', 'C', 'D']);

export const createVariantSchema = z.object({
  name: z.string().min(1, 'name is required').max(100),
  variantKey: variantKeyEnum,
  templateId: z.string().uuid(),
  splitPct: z.number().int().min(1).max(100),
});

export const updateVariantSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  templateId: z.string().uuid().optional(),
  splitPct: z.number().int().min(1).max(100).optional(),
});

export const campaignIdParamSchema = z.object({
  campaignId: z.string().uuid(),
});

export const variantIdParamSchema = z.object({
  variantId: z.string().uuid(),
});

export const updateABTestConfigSchema = z.object({
  ab_test_enabled: z.boolean().optional(),
  ab_test_metric: z.enum(['open_rate', 'click_rate', 'reply_rate']).optional(),
  ab_test_min_samples: z.number().int().min(10).max(10000).optional(),
  ab_test_confidence: z.number().min(80).max(99.99).optional(),
  ab_test_auto_promote: z.boolean().optional(),
});

export type CreateVariantBody = z.infer<typeof createVariantSchema>;
export type UpdateVariantBody = z.infer<typeof updateVariantSchema>;
export type UpdateABTestConfigBody = z.infer<typeof updateABTestConfigSchema>;

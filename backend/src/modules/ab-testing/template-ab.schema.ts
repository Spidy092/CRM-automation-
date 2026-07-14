import { z } from 'zod';

export const createTemplateVariantSchema = z.object({
  name: z.string().min(1, 'name is required').max(100),
  variantKey: z.enum(['A', 'B', 'C', 'D']),
  subject: z.string().max(200).optional(),
  body: z.string().min(1, 'body is required'),
  splitPct: z.number().int().min(1).max(100),
});

export const updateTemplateVariantSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  subject: z.string().max(200).optional(),
  body: z.string().min(1).optional(),
  splitPct: z.number().int().min(1).max(100).optional(),
});

export const templateIdParamSchema = z.object({
  templateId: z.string().uuid(),
});

export const templateVariantIdParamSchema = z.object({
  variantId: z.string().uuid(),
});

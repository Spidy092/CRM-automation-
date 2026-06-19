import { z } from 'zod';

export const createScoringRuleSchema = z.object({
  factor: z.string().min(1).max(100),
  weight: z.number().int().min(0).max(100),
  condition: z.record(z.unknown()),
  score_value: z.number().int().min(0).max(100),
  is_active: z.boolean().optional().default(true),
});

export const updateScoringRuleSchema = z.object({
  factor: z.string().min(1).max(100).optional(),
  weight: z.number().int().min(0).max(100).optional(),
  condition: z.record(z.unknown()).optional(),
  score_value: z.number().int().min(0).max(100).optional(),
  is_active: z.boolean().optional(),
});

export const updateScoringConfigSchema = z.object({
  hot_min_score: z.number().int().min(0).max(100).optional(),
  warm_min_score: z.number().int().min(0).max(100).optional(),
  assignment_threshold: z.number().int().min(0).max(100).optional(),
});

export type CreateScoringRuleInput = z.infer<typeof createScoringRuleSchema>;
export type UpdateScoringRuleInput = z.infer<typeof updateScoringRuleSchema>;
export type UpdateScoringConfigInput = z.infer<typeof updateScoringConfigSchema>;

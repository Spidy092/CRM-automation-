import { z } from 'zod';

export const updateAiSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  base_url: z.string().url('base_url must be a valid URL').nullable().optional(),
  api_key: z.string().min(1).nullable().optional(),
  model: z.string().min(1).max(255).optional(),
  max_tokens: z.number().int().min(1).max(500).optional(),
  temperature: z.number().min(0).max(2).optional(),
  system_prompt_override: z.string().max(4000).nullable().optional(),
  cache_ttl_seconds: z
    .number()
    .int()
    .min(60)
    .max(86400 * 30)
    .optional(),
});

export type UpdateAiSettingsInput = z.infer<typeof updateAiSettingsSchema>;

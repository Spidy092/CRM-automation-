import { z } from 'zod';

export const createStageSchema = z.object({
  name: z.string().min(1).max(255),
  position: z.number().int().min(0),
  is_terminal_won: z.boolean().optional().default(false),
  is_terminal_lost: z.boolean().optional().default(false),
});

export const createPipelineSchema = z.object({
  name: z.string().min(1).max(255),
  is_default: z.boolean().optional().default(false),
  stages: z.array(createStageSchema).min(1),
});

export const updatePipelineSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  is_default: z.boolean().optional(),
});

export const updateStageSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  position: z.number().int().min(0).optional(),
  is_terminal_won: z.boolean().optional(),
  is_terminal_lost: z.boolean().optional(),
});

export const moveLeadSchema = z.object({
  lead_id: z.string().uuid(),
  stage_id: z.string().uuid(),
});

export type CreatePipelineInput = z.infer<typeof createPipelineSchema>;
export type UpdatePipelineInput = z.infer<typeof updatePipelineSchema>;
export type CreateStageInput = z.infer<typeof createStageSchema>;
export type UpdateStageInput = z.infer<typeof updateStageSchema>;
export type MoveLeadInput = z.infer<typeof moveLeadSchema>;

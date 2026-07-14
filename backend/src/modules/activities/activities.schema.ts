import { z } from 'zod';

export const activityTypeSchema = z.enum([
  'call',
  'whatsapp',
  'email',
  'note',
  'status_change',
  'assignment_change',
]);

export const createActivitySchema = z.object({
  type: activityTypeSchema,
  metadata: z.record(z.unknown()).optional(),
});

export const listActivitiesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
  type: activityTypeSchema.optional(),
});

export type CreateActivityBody = z.infer<typeof createActivitySchema>;
export type ListActivitiesQuery = z.infer<typeof listActivitiesQuerySchema>;

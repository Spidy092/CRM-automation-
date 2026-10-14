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
  /**
   * Keyset cursor (base64url `{ ts, id }`, see shared/utils/pagination).
   * When present, paging uses `(created_at, id)` instead of `offset` so newly
   * inserted activities cannot shift rows between pages or produce duplicates.
   */
  cursor: z.string().optional(),
  /** Full-text-ish match against the note body, outcome label, or author name. */
  search: z.string().max(255).optional(),
  /** Only activities created by this user. */
  author: z.string().uuid().optional(),
  /** ISO-8601 bounds applied to `created_at`. */
  date_from: z.string().datetime({ offset: true }).optional(),
  date_to: z.string().datetime({ offset: true }).optional(),
  /** When "true", only pinned notes are returned (used for the pinned strip). */
  pinned_only: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
});

export type CreateActivityBody = z.infer<typeof createActivitySchema>;
export type ListActivitiesQuery = z.infer<typeof listActivitiesQuerySchema>;

/** PATCH /leads/:leadId/activities/:activityId/pin — pin or unpin a note. */
export const updateActivityPinSchema = z.object({
  pinned: z.boolean(),
});

export type UpdateActivityPinBody = z.infer<typeof updateActivityPinSchema>;

export const activityAuthorsParamsSchema = z.object({ leadId: z.string().uuid() });
export const activityAuthorSchema = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
});
export type ActivityAuthor = z.infer<typeof activityAuthorSchema>;

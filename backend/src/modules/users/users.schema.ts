import { z } from 'zod';

export const updateProfileSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be 100 characters or fewer'),
});

export type UpdateProfileSchemaInput = z.infer<typeof updateProfileSchema>;

import { z } from 'zod';

export const fileIdParamSchema = z.object({
  id: z.string().uuid('File id must be a valid UUID'),
});

export const updateFileSchema = z.object({
  filename: z.string().min(1).max(255).optional(),
  tags: z.array(z.string()).optional(),
});

export const listFilesQuerySchema = z.object({
  tag: z.string().max(255).optional(),
  search: z.string().max(255).optional(),
});

export type UpdateFileInput = z.infer<typeof updateFileSchema>;
export type ListFilesQuery = z.infer<typeof listFilesQuerySchema>;

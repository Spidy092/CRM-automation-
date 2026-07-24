import { z } from 'zod';

const slugSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug must be lowercase letters, numbers, and hyphens only');

export const pageIdParamSchema = z.object({
  id: z.string().uuid('Page id must be a valid UUID'),
});

export const pageSlugParamSchema = z.object({
  slug: z.string().min(1).max(255),
});

export const publicPageQuerySchema = z.object({
  lead: z.string().uuid().optional(),
});

const pageBlockSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('gallery'),
    fileIds: z.array(z.string().uuid()).min(1).max(20),
  }),
  z.object({
    type: z.literal('link'),
    label: z.string().min(1).max(255),
    url: z.string().url(),
  }),
  z.object({
    type: z.literal('attachment'),
    fileId: z.string().uuid(),
    label: z.string().max(255).optional(),
  }),
  z.object({
    type: z.literal('video'),
    youtubeUrl: z
      .string()
      .url()
      .refine(
        (url) => /^https:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)/.test(url),
        'Must be a YouTube watch or share URL',
      ),
  }),
  z.object({
    type: z.literal('map'),
    address: z.string().min(1).max(500),
  }),
]);

const basePageSchema = z.object({
  title: z.string().min(1, 'title is required').max(255),
  slug: slugSchema,
  description: z.string().max(2000).optional().nullable(),
  blocks: z.array(pageBlockSchema).max(30).optional(),
});

export const createPageSchema = basePageSchema;

export const updatePageSchema = basePageSchema.partial();

export type CreatePageInput = z.infer<typeof createPageSchema>;
export type UpdatePageInput = z.infer<typeof updatePageSchema>;
export type PageBlockInput = z.infer<typeof pageBlockSchema>;

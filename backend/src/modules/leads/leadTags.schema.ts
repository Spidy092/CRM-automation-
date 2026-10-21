import { z } from 'zod';

export const leadTagsQuerySchema = z.object({ apiKey: z.string().min(1).optional() }).strict();

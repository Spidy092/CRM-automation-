import { z } from 'zod';

const defaultFrom = (): string => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

const defaultTo = (): string => new Date().toISOString();

export const teamMetricsQuerySchema = z.object({
  from: z.string().datetime().optional().default(defaultFrom),
  to: z.string().datetime().optional().default(defaultTo),
  stage: z.string().uuid().optional(),
});

export type TeamMetricsQuery = z.infer<typeof teamMetricsQuerySchema>;

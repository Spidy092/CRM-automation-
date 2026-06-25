import { z } from 'zod';

export const listReportsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional().default(25),
  offset: z.coerce.number().int().nonnegative().optional().default(0),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export const exportReportSchema = z.object({
  reportType: z.string().min(1).max(100),
  format: z.enum(['csv', 'xlsx', 'pdf']).default('csv'),
  filters: z.record(z.unknown()).optional(),
});

export type ListReportsQuery = z.infer<typeof listReportsQuerySchema>;
export type ExportReportInput = z.infer<typeof exportReportSchema>;

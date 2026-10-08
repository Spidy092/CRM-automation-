import { z } from 'zod';

export const leadEnrollmentOptionsSchema = z.object({
  sources: z.array(z.string()),
  tags: z.array(z.string()),
});

export type LeadEnrollmentOptions = z.infer<typeof leadEnrollmentOptionsSchema>;

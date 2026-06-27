import { z } from 'zod';

/** :campaignId route param */
export const campaignIdParamSchema = z.object({
  campaignId: z.string().uuid(),
});

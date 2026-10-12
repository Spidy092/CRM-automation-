import { z } from 'zod';

export const googleAgentCandidateSchema = z.object({
  placeId: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
  address: z.string().max(500),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  rating: z.number().min(0).max(5).nullable(),
  reviewCount: z.number().int().nonnegative().nullable(),
  phone: z.string().max(50).optional(),
  website: z.string().url().optional(),
  email: z.string().email().optional(),
  emailSource: z.string().url().optional(),
  evidence: z.string().max(3000).optional(),
  detailsFetched: z.boolean().default(false),
});
export type GoogleAgentCandidate = z.infer<typeof googleAgentCandidateSchema>;

export const googleAgentToolSchemas = {
  search_places: z.object({ query: z.string().trim().min(1).max(250) }).strict(),
  get_place_details: z.object({ placeId: z.string().min(1).max(255) }).strict(),
  inspect_website: z.object({ placeId: z.string().min(1).max(255) }).strict(),
  select_candidates: z
    .object({
      placeIds: z.array(z.string().min(1).max(255)).min(1).max(10),
      reason: z.string().trim().min(1).max(300),
    })
    .strict(),
  finish: z.object({ summary: z.string().trim().min(1).max(500) }).strict(),
};

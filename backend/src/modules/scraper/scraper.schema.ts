import { z } from 'zod';

export const sourceTypeEnum = z.enum(['google_places', 'facebook', 'youtube', 'web_scrape']);

export const googlePlacesConfigSchema = z.object({
  query: z.string().min(1, 'Search query is required'),
  location: z.string().optional(),
  radius: z.number().int().positive().max(50000).optional(),
  maxResults: z.number().int().positive().max(50).optional().default(20),
  apiKeyRef: z.string().min(1, 'API key reference is required'),
});

export const facebookConfigSchema = z.object({
  pageId: z.string().min(1, 'Page ID is required'),
  accessTokenRef: z.string().min(1, 'Access token reference is required'),
  fields: z.array(z.string()).optional(),
  maxPosts: z.number().int().positive().max(100).optional().default(25),
});

export const youtubeConfigSchema = z.object({
  query: z.string().min(1, 'Search query is required'),
  channelId: z.string().optional(),
  maxResults: z.number().int().positive().max(50).optional().default(10),
  apiKeyRef: z.string().min(1, 'API key reference is required'),
});

export const webScrapeConfigSchema = z.object({
  url: z.string().url('Must be a valid URL'),
  selectors: z.record(z.string(), z.string()),
  paginationSelector: z.string().optional(),
  maxPages: z.number().int().positive().max(10).optional().default(1),
  headers: z.record(z.string(), z.string()).optional(),
});

export const createScraperConfigSchema = z.object({
  name: z.string().min(1).max(255),
  source_type: sourceTypeEnum,
  is_active: z.boolean().optional().default(true),
  config: z.record(z.unknown()),
  schedule_cron: z.string().nullable().optional(),
});

export const updateScraperConfigSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  is_active: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
  schedule_cron: z.string().nullable().optional(),
});

export const triggerScrapeSchema = z.object({
  configId: z.string().uuid(),
});

export const listLogsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type CreateScraperConfigInput = z.infer<typeof createScraperConfigSchema>;
export type UpdateScraperConfigInput = z.infer<typeof updateScraperConfigSchema>;

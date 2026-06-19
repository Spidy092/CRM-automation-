import { z } from 'zod';
import { LeadClassification, LeadStatus } from '../../shared/types';

const statusEnum = z.enum(['active', 'paused', 'won', 'lost', 'opted_out']) as z.ZodEnum<
  [LeadStatus, ...LeadStatus[]]
>;
const classificationEnum = z.enum(['hot', 'warm', 'cold']) as z.ZodEnum<
  [LeadClassification, ...LeadClassification[]]
>;

const baseLeadSchema = z.object({
  business_name: z.string().min(1, 'business_name is required').max(255),
  contact_name: z.string().min(1, 'contact_name is required').max(255),
  phone: z.string().min(1, 'phone is required').max(50),
  email: z.string().email('email must be a valid email address').max(255),
  website: z.string().max(500).optional().nullable(),
  industry: z.string().min(1, 'industry is required').max(100),
  location: z.string().min(1, 'location is required').max(255),
  country: z.string().max(100).optional().nullable(),
  google_rating: z.number().min(0).max(5).optional().nullable(),
  review_count: z.number().int().min(0).optional().nullable(),
  social_links: z.record(z.string(), z.unknown()).optional().nullable(),
  source_platform: z.string().min(1, 'source_platform is required').max(100),
  assigned_to: z.string().uuid().optional().nullable(),
  pipeline_stage_id: z.string().uuid().optional().nullable(),
  custom_fields: z.record(z.string(), z.unknown()).optional().nullable(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional().nullable(),
});

export const createLeadSchema = baseLeadSchema;

export const updateLeadSchema = baseLeadSchema.partial();

export const listLeadsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().optional(),
  status: statusEnum.optional(),
  classification: classificationEnum.optional(),
  source_platform: z.string().max(100).optional(),
  industry: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  assigned_to: z.string().uuid().optional(),
  search: z.string().max(255).optional(),
  tags: z.string().max(255).optional(), // comma-separated
});

export const pauseLeadSchema = z.object({
  paused: z.boolean().optional(), // default true; set false to resume
});

import { z } from 'zod';
import { LeadClassification, LeadStatus } from '../../shared/types';
import { normalizePhone } from '../../shared/utils/phone';

const statusEnum = z.enum(['active', 'paused', 'won', 'lost', 'opted_out']) as z.ZodEnum<
  [LeadStatus, ...LeadStatus[]]
>;
const classificationEnum = z.enum(['hot', 'warm', 'cold']) as z.ZodEnum<
  [LeadClassification, ...LeadClassification[]]
>;

/** Internal scraper metadata; deliberately excluded from public write schemas. */
export const googleContactProvenanceSchema = z.object({
  email: z.enum(['placeholder', 'website']),
  phone: z.enum(['google_places', 'placeholder']),
});
export type GoogleContactProvenance = z.infer<typeof googleContactProvenanceSchema>;

const baseLeadSchema = z.object({
  business_name: z.string().min(1, 'business_name is required').max(255),
  contact_name: z.string().min(1, 'contact_name is required').max(255),
  phone: z.string().min(1, 'phone is required').max(50),
  email: z.string().email('email must be a valid email address').max(255),
  additional_emails: z.array(z.string().email().max(255)).optional(),
  additional_phones: z
    .array(
      z.string().trim().min(1).max(50).transform(normalizePhone).pipe(z.string().min(1).max(50)),
    )
    .optional(),
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
  deal_value: z.number().min(0).optional().nullable(),
  next_follow_up_at: z.string().datetime({ offset: true }).optional().nullable(),
});

export const createLeadSchema = baseLeadSchema;

export const updateLeadSchema = baseLeadSchema.partial();

const sortByEnum = z.enum([
  'created_at',
  'updated_at',
  'business_name',
  'contact_name',
  'email',
  'industry',
  'location',
  'lead_score',
  'deal_value',
  'status',
  'classification',
  'next_follow_up_at',
]);

export const listLeadsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(1000).optional(),
  cursor: z.string().optional(),
  /** Offset paging — mutually exclusive with `cursor`; used by the leads table pager. */
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
  sort_by: sortByEnum.optional(),
  sort_dir: z.enum(['asc', 'desc']).optional(),
  /** When "true", meta includes the total row count for the current filters. */
  count_total: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  status: statusEnum.optional(),
  classification: classificationEnum.optional(),
  source_platform: z.string().max(100).optional(),
  industry: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  assigned_to: z.string().uuid().optional(),
  pipeline_id: z.string().uuid().optional(),
  search: z.string().max(255).optional(),
  exact_tag: z.string().min(1).optional(), // Preserve literal commas and spaces.
  tags: z.string().max(255).optional(), // comma-separated
  exclude_tags: z.string().max(255).optional(), // comma-separated
  /** ISO-8601 datetime string — returns leads created on or after this point */
  created_after: z.string().datetime({ offset: true }).optional(),
  /** When "true", returns only leads where classification IS NULL (unscored) */
  unclassified: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
});

export const pauseLeadSchema = z.object({
  paused: z.boolean().optional(), // default true; set false to resume
});

/**
 * GET /leads/:id/timeline — unified lead history (notes, manual touchpoints,
 * sent messages, system events) with a single keyset cursor so the "All
 * activity" tab pages across both sources without loading full history.
 */
export const leadTimelineKindEnum = z.enum(['all', 'notes', 'messages', 'system']);

export const leadTimelineChannelEnum = z.enum(['call', 'whatsapp', 'email', 'sms', 'phone_call']);

export const leadTimelineQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  cursor: z.string().optional(),
  kind: leadTimelineKindEnum.optional().default('all'),
  /** Matches note bodies, outcome labels, author names, message bodies, errors. */
  search: z.string().max(255).optional(),
  /** Message channel; `call` and `phone_call` are treated as the same channel. */
  channel: leadTimelineChannelEnum.optional(),
  /** Only activity rows created by this user (sent messages have no author). */
  author: z.string().uuid().optional(),
  /** ISO-8601 bounds applied to `created_at`. */
  date_from: z.string().datetime({ offset: true }).optional(),
  date_to: z.string().datetime({ offset: true }).optional(),
  /** When "true", only pinned notes are returned (the pinned strip). */
  pinned_only: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
});

export type LeadTimelineQuery = z.infer<typeof leadTimelineQuerySchema>;

/** POST /leads/bulk-classify — set classification on a batch of lead IDs */
export const bulkClassifySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  classification: classificationEnum,
});

/** POST /leads/bulk-update — update fields on a batch of lead IDs */
export const bulkUpdateSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(500),
    patch: updateLeadSchema,
    tag_mode: z.enum(['replace', 'append']).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.tag_mode !== 'append') return;
    if (
      Object.keys(value.patch).some((key) => key !== 'tags') ||
      !value.patch.tags?.length ||
      value.patch.tags.some((tag) => !tag.trim() || tag.trim().length > 100 || tag.includes(','))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['patch', 'tags'],
        message:
          'Add tags requires only non-empty tags, up to 100 characters each, without commas.',
      });
    }
  });

export type BulkTagMode = NonNullable<z.infer<typeof bulkUpdateSchema>['tag_mode']>;

/** POST /leads/bulk-pause — pause or resume outreach on a batch of lead IDs */
export const bulkPauseSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  paused: z.boolean(),
});

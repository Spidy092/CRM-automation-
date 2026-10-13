import type { GoogleContactProvenance } from './leads.schema';
import { LeadClassification, LeadStatus } from '../../shared/types';

/** Raw row shape as returned by node-postgres for the `leads` table. */
export interface LeadRow {
  id: string;
  google_place_id?: string | null;
  google_contact_provenance?: GoogleContactProvenance | null;
  business_name: string;
  contact_name: string;
  phone: string;
  email: string;
  website: string | null;
  industry: string;
  location: string;
  country: string | null;
  // decimal(2,1) comes back from pg as a string
  google_rating: string | null;
  review_count: number | null;
  social_links: Record<string, unknown> | null;
  source_platform: string;
  lead_score: number;
  classification: LeadClassification | null;
  status: LeadStatus;
  assigned_to: string | null;
  pipeline_stage_id: string | null;
  custom_fields: Record<string, unknown>;
  tags: string[];
  notes: string | null;
  deal_value: string | null;
  /** Set when the lead's stage moves into an is_terminal_won pipeline stage. */
  won_at: string | null;
  /** Set when the lead's stage moves into an is_terminal_lost pipeline stage. */
  lost_at: string | null;
  /** Rep-set reminder date ("Quick Response"-adjacent follow-up picker). Not tied to any task/sequence. */
  next_follow_up_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /** The scraper run that created this lead, if any. Null for manual/other sources. */
  scraper_log_id: string | null;
}

/** Lead as returned in API responses (google_rating coerced to number). */
export interface LeadResponse {
  id: string;
  google_place_id?: string | null;
  google_contact_provenance?: GoogleContactProvenance | null;
  business_name: string;
  contact_name: string;
  phone: string;
  email: string;
  website: string | null;
  industry: string;
  location: string;
  country: string | null;
  google_rating: number | null;
  review_count: number | null;
  social_links: Record<string, unknown> | null;
  source_platform: string;
  lead_score: number;
  classification: LeadClassification | null;
  status: LeadStatus;
  assigned_to: string | null;
  pipeline_stage_id: string | null;
  custom_fields: Record<string, unknown>;
  tags: string[];
  notes: string | null;
  deal_value: number | null;
  won_at: string | null;
  lost_at: string | null;
  next_follow_up_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadInput {
  google_place_id?: string | null;
  google_contact_provenance?: GoogleContactProvenance | null;
  business_name: string;
  contact_name: string;
  phone: string;
  email: string;
  website?: string | null;
  industry: string;
  location: string;
  country?: string | null;
  google_rating?: number | null;
  review_count?: number | null;
  social_links?: Record<string, unknown> | null;
  source_platform: string;
  assigned_to?: string | null;
  pipeline_stage_id?: string | null;
  custom_fields?: Record<string, unknown> | null;
  tags?: string[];
  notes?: string | null;
  deal_value?: number | null;
  scraper_log_id?: string | null;
  next_follow_up_at?: string | null;
}

/** Columns the list endpoint is allowed to sort by. */
export type LeadSortBy =
  | 'created_at'
  | 'updated_at'
  | 'business_name'
  | 'contact_name'
  | 'email'
  | 'industry'
  | 'location'
  | 'lead_score'
  | 'deal_value'
  | 'status'
  | 'classification'
  | 'next_follow_up_at';

export type LeadSortDir = 'asc' | 'desc';

export interface LeadListFilters {
  limit: number;
  cursorTs?: string;
  cursorId?: string;
  /** Offset paging — used by the customizable table when a page number or sort is chosen. */
  offset?: number;
  /** When true the result meta carries the total row count for the same filter set. */
  countTotal?: boolean;
  sortBy?: LeadSortBy;
  sortDir?: LeadSortDir;
  status?: LeadStatus;
  classification?: LeadClassification;
  source_platform?: string;
  industry?: string;
  country?: string;
  assigned_to?: string;
  pipeline_id?: string;
  search?: string;
  tags?: string[];
  exclude_tags?: string[];
  /** ISO-8601 string — only return leads with created_at >= this value */
  created_after?: string;
  /** When true, only return leads where classification IS NULL */
  unclassified?: boolean;
}

export interface LeadListResult {
  items: LeadResponse[];
  meta: {
    limit: number;
    hasMore: boolean;
    nextCursor?: string;
    /** Present only when the caller asked for a count (`count_total=true`). */
    total?: number;
    /** Echoed back when offset paging was used, so the client can render page numbers. */
    offset?: number;
  };
}

export interface ImportSummary {
  total: number;
  created: number;
  updated: number;
  failed: number;
  errors: { row: number; message: string }[];
}

/** One row of the unified lead timeline (`GET /leads/:id/timeline`). */
export interface LeadTimelineEntry {
  id: string;
  /** `activity` = notes/manual touchpoints/system events; `message` = sent outreach. */
  source: 'activity' | 'message';
  /** Activity type for `activity` rows; null for sent messages. */
  activity_type: import('../activities/activities.types').ActivityType | null;
  /** Outreach channel for `message` rows; null for activity rows. */
  channel: string | null;
  /** Delivery status for `message` rows; null for activity rows. */
  status: string | null;
  /** Raw activity metadata (note body, outcome, direction, …); null for messages. */
  metadata: Record<string, unknown> | null;
  /** Full message body for `message` rows; null for activity rows. */
  message_body: string | null;
  /** Sequence step for `message` rows; null for activity rows. */
  step_number: number | null;
  /** Delivery error for failed `message` rows; null otherwise. */
  error_message: string | null;
  author_id: string | null;
  author_name: string | null;
  is_pinned: boolean;
  created_at: string;
}

export type LeadTimelineKind = 'all' | 'notes' | 'messages' | 'system';

export type LeadTimelineChannel = 'call' | 'whatsapp' | 'email' | 'sms' | 'phone_call';

export interface LeadTimelineFilters {
  leadId: string;
  limit: number;
  cursorTs?: string;
  cursorId?: string;
  kind: LeadTimelineKind;
  search?: string;
  channel?: LeadTimelineChannel;
  authorId?: string;
  dateFrom?: string;
  dateTo?: string;
  pinnedOnly?: boolean;
}

export interface LeadTimelineResult {
  items: LeadTimelineEntry[];
  meta: {
    limit: number;
    hasMore: boolean;
    nextCursor?: string;
  };
}

export function toLeadResponse(row: LeadRow): LeadResponse {
  return {
    id: row.id,
    google_place_id: row.google_place_id ?? null,
    google_contact_provenance: row.google_contact_provenance ?? null,
    business_name: row.business_name,
    contact_name: row.contact_name,
    phone: row.phone,
    email: row.email,
    website: row.website,
    industry: row.industry,
    location: row.location,
    country: row.country,
    google_rating: row.google_rating === null ? null : Number(row.google_rating),
    review_count: row.review_count,
    social_links: row.social_links,
    source_platform: row.source_platform,
    lead_score: row.lead_score,
    classification: row.classification,
    status: row.status,
    assigned_to: row.assigned_to,
    pipeline_stage_id: row.pipeline_stage_id,
    custom_fields: row.custom_fields ?? {},
    tags: row.tags ?? [],
    notes: row.notes,
    deal_value: row.deal_value === null ? null : Number(row.deal_value),
    won_at: row.won_at,
    lost_at: row.lost_at,
    next_follow_up_at: row.next_follow_up_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

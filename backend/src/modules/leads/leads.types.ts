import { LeadClassification, LeadStatus } from '../../shared/types';

/** Raw row shape as returned by node-postgres for the `leads` table. */
export interface LeadRow {
  id: string;
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
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Lead as returned in API responses (google_rating coerced to number). */
export interface LeadResponse {
  id: string;
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
  created_at: string;
  updated_at: string;
}

export interface LeadInput {
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
}

export interface LeadListFilters {
  limit: number;
  cursorTs?: string;
  cursorId?: string;
  status?: LeadStatus;
  classification?: LeadClassification;
  source_platform?: string;
  industry?: string;
  country?: string;
  assigned_to?: string;
  pipeline_id?: string;
  search?: string;
  tags?: string[];
}

export interface LeadListResult {
  items: LeadResponse[];
  meta: {
    limit: number;
    hasMore: boolean;
    nextCursor?: string;
  };
}

export interface ImportSummary {
  total: number;
  created: number;
  updated: number;
  failed: number;
  errors: { row: number; message: string }[];
}

export function toLeadResponse(row: LeadRow): LeadResponse {
  return {
    id: row.id,
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
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

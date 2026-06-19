export type UserRole = 'admin' | 'manager' | 'sales' | 'marketing' | 'viewer';

export type LeadClassification = 'hot' | 'warm' | 'cold';

export type LeadStatus = 'active' | 'paused' | 'won' | 'lost' | 'opted_out';

export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed' | 'archived';

export type OutreachTone = 'formal' | 'professional' | 'conversational';

export type MessageChannel = 'whatsapp' | 'email' | 'sms' | 'phone_call';

export type OutreachStatus = 'queued' | 'sent' | 'delivered' | 'opened' | 'replied' | 'failed' | 'bounced';

export type TemplateApprovalStatus = 'pending' | 'approved' | 'rejected';

export type CustomFieldType = 'text' | 'number' | 'date' | 'dropdown' | 'checkbox';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  is_available: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Lead {
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
  social_links: Record<string, string> | null;
  source_platform: string;
  lead_score: number;
  classification: LeadClassification | null;
  status: LeadStatus;
  assigned_to: string | null;
  pipeline_stage_id: string | null;
  custom_fields: Record<string, unknown>;
  tags: string[];
  notes: string | null;
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
  social_links?: Record<string, string> | null;
  source_platform: string;
  assigned_to?: string | null;
  pipeline_stage_id?: string | null;
  custom_fields?: Record<string, unknown>;
  tags?: string[];
  notes?: string | null;
}

export interface Pipeline {
  id: string;
  name: string;
  is_default: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface PipelineStage {
  id: string;
  pipeline_id: string;
  name: string;
  position: number;
  is_terminal_won: boolean;
  is_terminal_lost: boolean;
  created_at: string;
  updated_at: string;
}

export interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  tone: OutreachTone;
  target_industries: string[];
  target_countries: string[];
  sequence_id: string | null;
  pipeline_id: string | null;
  created_by: string;
  launched_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Template {
  id: string;
  name: string;
  channel: MessageChannel;
  subject: string | null;
  body: string;
  variables: string[];
  approval_status: TemplateApprovalStatus;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CustomFieldDefinition {
  id: string;
  label: string;
  field_key: string;
  field_type: CustomFieldType;
  options: Record<string, unknown> | null;
  is_required: boolean;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ImportSummary {
  total: number;
  created: number;
  updated: number;
  failed: number;
  errors: Array<{ row: number; message: string }>;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
  };
}

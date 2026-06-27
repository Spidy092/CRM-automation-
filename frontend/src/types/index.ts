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

/* ─── Reports Types ─── */

export interface DashboardMetrics {
  totalLeads: number;
  qualifiedLeads: number;
  totalCampaigns: number;
  activeOutreach: number;
  pipelineConversion: number;
  recentActivity: Array<{
    date: string;
    leads: number;
    outreach: number;
  }>;
}

export interface LeadGenerationRow {
  date: string;
  source: string;
  count: number;
}

export interface OutreachPerformanceRow {
  date: string;
  channel: string;
  sent: number;
  delivered: number;
  opened: number;
  replied: number;
  failed: number;
}

export interface PipelineConversionRow {
  stageName: string;
  leadCount: number;
  conversionRate: number;
  avgDays: number;
}

export interface SalesRepPerformanceRow {
  repId: string;
  repName: string;
  leadsAssigned: number;
  leadsConverted: number;
  conversionRate: number;
  avgResponseTime: number;
}

export interface ReportListFilters {
  limit?: number;
  offset?: number;
  startDate?: string;
  endDate?: string;
}

export interface ExportJobInput {
  reportType: string;
  format: 'csv' | 'xlsx' | 'pdf';
  filters?: Record<string, unknown>;
}

export interface ExportJobResult {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
}

/* ─── Scraper Types ─── */

export type ScraperSourceType = 'google_places' | 'facebook' | 'youtube' | 'web_scrape';

export type ScraperLogStatus = 'running' | 'completed' | 'failed' | 'partially_completed';

export interface ScraperConfig {
  id: string;
  name: string;
  source_type: ScraperSourceType;
  is_active: boolean;
  config: Record<string, unknown>;
  schedule_cron: string | null;
  last_run_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ScraperLog {
  id: string;
  config_id: string;
  status: ScraperLogStatus;
  started_at: string;
  completed_at: string | null;
  records_found: number;
  records_imported: number;
  records_failed: number;
  error_message: string | null;
  raw_response: Record<string, unknown> | null;
  created_at: string;
}

export interface ScraperRunResult {
  logId: string;
  recordsFound: number;
  recordsImported: number;
  recordsFailed: number;
  status: ScraperLogStatus;
  /** Human-readable reason when status === 'failed'; null otherwise. */
  errorMessage?: string | null;
}

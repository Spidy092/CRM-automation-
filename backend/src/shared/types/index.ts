export type UserRole = 'admin' | 'manager' | 'sales' | 'marketing' | 'viewer';

export type LeadClassification = 'hot' | 'warm' | 'cold';
export type LeadStatus = 'active' | 'paused' | 'won' | 'lost' | 'opted_out';
export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed' | 'archived';
export type OutreachTone = 'formal' | 'professional' | 'conversational';
export type MessageChannel = 'whatsapp' | 'email' | 'sms' | 'phone_call';
export type OutreachStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'opened'
  | 'replied'
  | 'failed'
  | 'bounced';
export type TemplateApprovalStatus = 'pending' | 'approved' | 'rejected';
export type CustomFieldType = 'text' | 'number' | 'date' | 'dropdown' | 'checkbox';
export type TaskType = 'phone_call' | 'follow_up' | 'meeting_prep' | 'other';
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    cursor?: string;
    nextCursor?: string;
    automation?: unknown;
    [key: string]: unknown;
  };
}

export interface PaginationQuery {
  limit?: number;
  cursor?: string;
  page?: number;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  name: string;
}

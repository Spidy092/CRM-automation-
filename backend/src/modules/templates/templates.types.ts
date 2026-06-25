import { MessageChannel, TemplateApprovalStatus } from '../../shared/types';

/** Raw row shape from the `templates` table. */
export interface TemplateRow {
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

/** Template API response shape. */
export interface TemplateResponse {
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

export interface TemplateInput {
  name: string;
  channel: MessageChannel;
  subject?: string | null;
  body: string;
  variables?: string[];
}

export interface TemplateListFilters {
  limit: number;
  cursorTs?: string;
  cursorId?: string;
  channel?: MessageChannel;
  approval_status?: TemplateApprovalStatus;
  search?: string;
}

export interface TemplateApprovalInput {
  approved: boolean;
  rejection_reason?: string | null;
}

export interface TemplateActor {
  id: string;
  role: string;
  ipAddress?: string | null;
}

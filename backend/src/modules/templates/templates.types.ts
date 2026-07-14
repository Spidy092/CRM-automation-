import { MessageChannel, TemplateApprovalStatus } from '../../shared/types';

/** A file attached to a template — sent as an email attachment or WhatsApp media. */
export interface TemplateAttachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** Public URL the frontend/connectors use to reference the file. */
  url: string;
  /** Absolute path on disk — server-only, stripped before the API response. */
  storagePath: string;
}

/** `TemplateAttachment` shape sent to the frontend — no server-only fields. */
export type TemplateAttachmentResponse = Omit<TemplateAttachment, 'storagePath'>;

/** Raw row shape from the `templates` table. */
export interface TemplateRow {
  id: string;
  name: string;
  channel: MessageChannel;
  subject: string | null;
  body: string;
  variables: string[];
  attachments: TemplateAttachment[];
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
  attachments: TemplateAttachmentResponse[];
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

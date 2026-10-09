import { MessageChannel, TemplateApprovalStatus } from '../../shared/types';

/** A file attached to a template — sent as an email attachment or WhatsApp media. */
export interface TemplateAttachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** Public URL the frontend/connectors use to reference the file. */
  url: string;
  /**
   * Absolute path on disk — server-only, stripped before the API response.
   * Always populated (SMTP/SendGrid dispatch reads the file directly), even
   * for attachments referencing a shared Files-library entry.
   */
  storagePath: string;
  /**
   * Set when this attachment references a Files-library entry instead of a
   * direct upload — the template does not own that file's disk copy, so
   * template/attachment deletion must never unlink it (only the library
   * entry's own deletion may).
   */
  libraryFileId?: string;
}

/** `TemplateAttachment` shape sent to the frontend — no server-only fields. */
export type TemplateAttachmentResponse = Omit<TemplateAttachment, 'storagePath'>;

/** Authoring mode for email templates. Non-email channels always use 'simple'. */
export type TemplateEditorMode = 'simple' | 'visual' | 'html';

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
  editor_mode: TemplateEditorMode;
  /** Versioned visual-design document (visual mode only) — the editable source of truth. */
  design: unknown;
  /** Deterministic rendered email HTML (visual mode) or sanitized HTML (html mode). */
  html_body: string | null;
  /** Plain-text alternative generated alongside `html_body`. */
  text_body: string | null;
  preheader: string | null;
  archived_at: string | null;
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
  editor_mode: TemplateEditorMode;
  design: unknown;
  html_body: string | null;
  text_body: string | null;
  preheader: string | null;
  archived_at: string | null;
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
  editor_mode?: TemplateEditorMode;
  design?: unknown;
  preheader?: string | null;
  archived?: boolean;
}

export interface TemplateListFilters {
  limit: number;
  cursorTs?: string;
  cursorId?: string;
  channel?: MessageChannel;
  approval_status?: TemplateApprovalStatus;
  search?: string;
  /** When true, include archived templates; otherwise they are hidden. */
  includeArchived?: boolean;
  /** When true, only archived templates are returned. */
  archivedOnly?: boolean;
  /** Filter to templates created by a specific user ("mine"). */
  createdBy?: string;
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

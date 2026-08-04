// ── Form Field Definition ─────────────────────────────────────────────────

export interface FormFieldDef {
  name: string;
  label: string;
  type: 'text' | 'email' | 'phone' | 'number' | 'textarea' | 'select' | 'checkbox' | 'hidden';
  required: boolean;
  placeholder?: string;
  options?: string[]; // for 'select' type
  defaultValue?: string;
  /** Maps to a lead column name. If set, the field value is stored in the lead. */
  leadField?: string;
}

// ── Form Email Settings ───────────────────────────────────────────────────

export interface EmailSettings {
  autoReply?: {
    enabled: boolean;
    fromName: string;
    fromEmail: string;
    subject: string;
    body: string;
  };
  teamNotification?: {
    enabled: boolean;
    emails: string;
    subject: string;
    body: string;
  };
  partnerNotification?: {
    enabled: boolean;
    emails: string;
    subject: string;
    body: string;
  };
}

// ── Form Row ──────────────────────────────────────────────────────────────

export interface FormRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  fields: FormFieldDef[];
  submit_action: string;
  submit_message: string;
  redirect_url: string | null;
  is_active: boolean;
  theme: Record<string, unknown>;
  email_settings: EmailSettings;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface FormEmailStatus {
  success: boolean;
  sentCount: number;
  failedCount: number;
  errors?: string[];
}

// ── Form Submission Row ───────────────────────────────────────────────────

export interface FormSubmissionRow {
  id: string;
  form_id: string;
  lead_id: string | null;
  data: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  referrer: string | null;
  status: string;
  created_at: string;
}

// ── Input Types ───────────────────────────────────────────────────────────

export interface CreateFormInput {
  name: string;
  slug?: string;
  description?: string | null;
  fields: FormFieldDef[];
  submit_action?: string;
  submit_message?: string;
  redirect_url?: string | null;
  is_active?: boolean;
  theme?: Record<string, unknown>;
  email_settings?: EmailSettings;
}

export interface UpdateFormInput {
  name?: string;
  slug?: string;
  description?: string | null;
  fields?: FormFieldDef[];
  submit_action?: string;
  submit_message?: string;
  redirect_url?: string | null;
  is_active?: boolean;
  theme?: Record<string, unknown>;
  email_settings?: EmailSettings;
}

export interface FormAnalytics {
  formId: string;
  formName: string;
  totalSubmissions: number;
  uniqueLeads: number;
  conversionRate: number;
  submissionsByDay: { date: string; count: number }[];
  topReferrers: { referrer: string; count: number }[];
}

// ── Actor ─────────────────────────────────────────────────────────────────

export interface FormActor {
  id: string;
  role: string;
  ipAddress?: string | null;
}

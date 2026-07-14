export interface TemplateVariant {
  id: string;
  template_id: string;
  name: string;
  variant_key: string;
  subject?: string;
  body: string;
  split_pct: number;
  is_winner: boolean;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface TemplateVariantAssignment {
  id: string;
  variant_id: string;
  lead_id: string;
  assigned_at: string;
}

export interface TemplateVariantResult {
  variant: TemplateVariant;
  metrics: {
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    replied: number;
    openRate: number;
    clickRate: number;
    replyRate: number;
  };
}

export interface TemplateABTestReport {
  templateId: string;
  variants: TemplateVariantResult[];
  winner: TemplateVariantResult | null;
  isSignificant: boolean;
  pValue: number | null;
  totalSent: number;
}

export interface CreateTemplateVariantInput {
  name: string;
  variantKey: string;
  subject?: string;
  body: string;
  splitPct: number;
}

export interface UpdateTemplateVariantInput {
  name?: string;
  subject?: string;
  body?: string;
  splitPct?: number;
}

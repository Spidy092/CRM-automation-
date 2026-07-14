// ── Variant Types ─────────────────────────────────────────────────────────

export interface CampaignVariant {
  id: string;
  campaign_id: string;
  name: string;
  variant_key: string;
  template_id: string | null;
  split_pct: number;
  is_winner: boolean;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface VariantAssignment {
  id: string;
  variant_id: string;
  lead_id: string;
  assigned_at: string;
}

export interface VariantSnapshot {
  id: string;
  variant_id: string;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  replied: number;
  failed: number;
  open_rate: number;
  click_rate: number;
  reply_rate: number;
  snapshot_at: string;
}

// ── Input Types ───────────────────────────────────────────────────────────

export interface CreateVariantInput {
  name: string;
  variantKey: string;
  templateId: string;
  splitPct: number;
}

export interface UpdateVariantInput {
  name?: string;
  templateId?: string;
  splitPct?: number;
}

export interface ABTestConfig {
  enabled: boolean;
  metric: 'open_rate' | 'click_rate' | 'reply_rate';
  minSamples: number;
  confidence: number;
  autoPromote: boolean;
}

export interface VariantResult {
  variant: CampaignVariant;
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

export interface ABTestReport {
  campaignId: string;
  config: ABTestConfig;
  variants: VariantResult[];
  winner: VariantResult | null;
  isSignificant: boolean;
  pValue: number | null;
  confidenceLevel: number;
  totalSent: number;
}

// ── Statistical Significance ──────────────────────────────────────────────

export interface SignificanceResult {
  isSignificant: boolean;
  pValue: number;
  zScore: number;
  confidenceLevel: number;
  winnerIndex: number | null;
}

// ── Actor ─────────────────────────────────────────────────────────────────

export interface ABTestActor {
  id: string;
  role: string;
  ipAddress?: string | null;
}

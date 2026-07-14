export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed' | 'archived';
export type OutreachTone = 'formal' | 'professional' | 'conversational';
export type AutonomyLevel = 'supervised' | 'guarded' | 'autopilot';

export interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  tone: OutreachTone;
  target_industries: string[];
  target_countries: string[];
  sequence_id: string | null;
  pipeline_id: string | null;
  /** When set, auto-enrollment only fires when a lead moves TO this specific stage.
   *  When null (but pipeline_id is set), enrollment fires on any stage move. */
  trigger_stage_id: string | null;
  ai_personalization_enabled: boolean;
  autonomy_level: AutonomyLevel;
  ai_min_confidence: number;
  ab_test_enabled: boolean;
  ab_test_metric: string;
  ab_test_min_samples: number;
  ab_test_confidence: number;
  ab_test_auto_promote: boolean;
  created_by: string;
  launched_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignLead {
  id: string;
  campaign_id: string;
  lead_id: string;
  added_at: string;
}

export interface CreateCampaignInput {
  name: string;
  tone?: OutreachTone;
  target_industries?: string[];
  target_countries?: string[];
  sequence_id?: string;
  pipeline_id?: string;
  trigger_stage_id?: string | null;
  ai_personalization_enabled?: boolean;
  autonomy_level?: AutonomyLevel;
  ai_min_confidence?: number;
  ab_test_enabled?: boolean;
  ab_test_metric?: string;
  ab_test_min_samples?: number;
  ab_test_confidence?: number;
  ab_test_auto_promote?: boolean;
}

export interface UpdateCampaignInput {
  name?: string;
  tone?: OutreachTone;
  target_industries?: string[];
  target_countries?: string[];
  sequence_id?: string;
  pipeline_id?: string;
  trigger_stage_id?: string | null;
  ai_personalization_enabled?: boolean;
  autonomy_level?: AutonomyLevel;
  ai_min_confidence?: number;
  ab_test_enabled?: boolean;
  ab_test_metric?: string;
  ab_test_min_samples?: number;
  ab_test_confidence?: number;
  ab_test_auto_promote?: boolean;
}

export interface AddLeadsInput {
  lead_ids: string[];
}

export interface CampaignStats {
  total_leads: number;
  sent: number;
  delivered: number;
  opened: number;
  replied: number;
  failed: number;
}

export interface AutomationSkippedLead {
  leadId: string;
  businessName: string;
  reasons: string[];
}

export interface AutomationEligibleLead {
  leadId: string;
  businessName: string;
  destination: string;
}

export interface AutomationPreview {
  campaignId: string;
  sequenceId: string | null;
  firstStep: {
    stepNumber: number;
    channel: 'whatsapp' | 'email' | 'sms' | 'phone_call';
    templateId: string;
    delayHours: number;
  } | null;
  eligibleLeads: AutomationEligibleLead[];
  skippedLeads: AutomationSkippedLead[];
  templateIssues: string[];
  connectorIssues: string[];
  expectedJobs: number;
  mockMode: boolean;
}

export interface AutomationLaunchMeta {
  enqueued: number;
  skipped: number;
  mockMode: boolean;
}

export interface LaunchCampaignResult {
  campaign: Campaign;
  automation: AutomationLaunchMeta;
}

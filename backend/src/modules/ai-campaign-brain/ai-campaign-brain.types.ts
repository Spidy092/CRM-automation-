export type BriefStatus = 'draft' | 'approved' | 'rejected';

export interface SequenceStepSuggestion {
  step_number: number;
  channel: 'whatsapp' | 'email' | 'sms';
  delay_hours: number;
  goal: string;
}

export interface TemplateSuggestion {
  channel: 'whatsapp' | 'email' | 'sms';
  subject: string | null;
  body_preview: string;
}

export interface CampaignBrief {
  id: string;
  campaign_id: string;
  total_leads_evaluated: number;
  eligible_leads: number;
  high_fit_leads: number;
  segment_summary: string;
  recommended_offer_angle: string;
  expected_objections: string[];
  risk_warnings: string[];
  recommended_sequence: SequenceStepSuggestion[];
  template_suggestions: TemplateSuggestion[];
  recommended_autonomy_level: 'supervised' | 'guarded' | 'autopilot';
  confidence_score: number;
  status: BriefStatus;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

/** Shape OpenAI must return — validated with Zod at runtime. */
export interface AiCampaignBriefOutput {
  segment_summary: string;
  recommended_offer_angle: string;
  expected_objections: string[];
  risk_warnings: string[];
  recommended_sequence: SequenceStepSuggestion[];
  template_suggestions: TemplateSuggestion[];
  recommended_autonomy_level: 'supervised' | 'guarded' | 'autopilot';
  confidence_score: number;
  chain_of_thought: string;
}

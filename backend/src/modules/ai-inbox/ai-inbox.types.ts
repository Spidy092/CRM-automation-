export type AiInboxItemType =
  | 'approve_response'
  | 'urgent_reply'
  | 'pricing_inquiry'
  | 'campaign_review'
  | 'lead_handoff'
  | 'objection_review';

export type AiInboxItemStatus = 'pending' | 'actioned' | 'snoozed' | 'auto_resolved';

export interface AiInboxItem {
  id: string;
  assigned_to: string;
  lead_id: string | null;
  campaign_id: string | null;
  item_type: AiInboxItemType;
  title: string;
  summary: string | null;
  urgency_score: number;
  ai_draft_response: string | null;
  ai_draft_confidence: number | null;
  expires_at: string | null;
  status: AiInboxItemStatus;
  snoozed_until: string | null;
  actioned_by: string | null;
  actioned_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateInboxItemInput {
  assigned_to: string;
  lead_id?: string;
  campaign_id?: string;
  item_type: AiInboxItemType;
  title: string;
  summary?: string;
  urgency_score: number;
  ai_draft_response?: string;
  ai_draft_confidence?: number;
  expires_at?: string;
}

export interface ActionInboxItemInput {
  status: 'actioned' | 'snoozed' | 'auto_resolved';
  actioned_by?: string;
  snoozed_until?: string;
}

export interface ListInboxItemsOptions {
  assigned_to: string;
  status?: AiInboxItemStatus;
  item_type?: AiInboxItemType;
  limit?: number;
  offset?: number;
}

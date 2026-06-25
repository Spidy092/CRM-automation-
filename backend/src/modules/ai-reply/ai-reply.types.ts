export type IntentClass =
  | 'interested'
  | 'objection'
  | 'not_now'
  | 'meeting_request'
  | 'pricing_question'
  | 'wrong_contact'
  | 'opt_out'
  | 'neutral';

export type IntentSubtype =
  | 'high'
  | 'medium'
  | 'soft'
  | 'hard'
  | 'price'
  | 'timing'
  | 'trust'
  | 'competitor'
  | 'not_relevant'
  | 'angry'
  | 'unsubscribe'
  | null;

export interface ReplyClassification {
  intent_class: IntentClass;
  intent_subtype: IntentSubtype;
  confidence: number;
  draft_response: string | null;
  next_best_action: string;
  update_stage_to: string | null;
  objection_type: string | null;
  buying_signal: string | null;
  chain_of_thought: string;
  should_stop_sequence: boolean;
  requires_human_review: boolean;
}

/** Shape OpenAI must return — validated with Zod at runtime. */
export interface AiReplyOutput {
  intent_class: IntentClass;
  intent_subtype: IntentSubtype;
  confidence: number;
  draft_response: string | null;
  next_best_action: string;
  update_stage_to: string | null;
  objection_type: string | null;
  buying_signal: string | null;
  chain_of_thought: string;
  should_stop_sequence: boolean;
}

export interface ClassifyReplyInput {
  leadId: string;
  channel: 'whatsapp' | 'email' | 'sms';
  messageText: string;
  externalMessageId?: string;
}

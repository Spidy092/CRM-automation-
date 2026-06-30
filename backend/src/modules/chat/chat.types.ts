import type { AgentActionName, AgentActionRow, AgentPolicyDecision } from '../agent/agent.types';

export type ChatVisibleRecordType =
  | 'lead'
  | 'campaign'
  | 'scraper'
  | 'pipeline'
  | 'pipeline_stage'
  | 'template'
  | 'sequence'
  | 'outreach_task'
  | 'ai_inbox_item'
  | 'ai_decision'
  | 'integration'
  | 'user'
  | 'scoring_rule'
  | 'custom_field'
  | 'assignment_user';

export interface ChatVisibleRecord {
  type: ChatVisibleRecordType;
  id: string;
  name: string;
  status?: string;
  subtitle?: string;
  meta?: Record<string, string | number | boolean | null>;
}

export interface ChatPageContext {
  route: string;
  pageTitle?: string;
  visibleRecords?: ChatVisibleRecord[];
  availableActions?: string[];
  pageCapabilities?: string[];
  pageMetrics?: Record<string, string | number | boolean | null>;
}

export interface ChatMessageInput {
  conversationId: string;
  message: string;
  pageContext?: ChatPageContext;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface ChatResponse {
  conversationId: string;
  reply: string;
  action?: {
    name: AgentActionName;
    policy: AgentPolicyDecision;
    agentAction?: AgentActionRow | null;
    result?: unknown;
  };
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient as api } from './client';

export interface AgentPolicyDecision {
  outcome: 'execute_now' | 'require_approval' | 'reject';
  reason: string;
  assignTo?: string;
}

export interface AgentActionRow {
  id: string;
  source: string;
  action_name: string;
  risk_tier: string;
  status: string;
  lead_id: string | null;
  campaign_id: string | null;
  result: Record<string, unknown> | null;
  error_message: string | null;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

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

export interface ChatResponse {
  conversationId: string;
  reply: string;
  action?: {
    name: string;
    policy: AgentPolicyDecision;
    agentAction?: AgentActionRow | null;
    /** Pending AI Inbox item linked to this action — lets the widget approve/reject in chat. */
    inboxItemId?: string | null;
    result?: unknown;
  };
}

export const useChatHistory = (conversationId: string) => {
  return useQuery({
    queryKey: ['chat-history', conversationId],
    queryFn: async (): Promise<ChatTurn[]> => {
      const { data } = await api.get<{ data: ChatTurn[] }>(`/chat/history/${conversationId}`);
      return data.data;
    },
    enabled: Boolean(conversationId),
  });
};

export const useSendChatMessage = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { conversationId: string; message: string; pageContext?: ChatPageContext }): Promise<ChatResponse> => {
      const { data } = await api.post<{ data: ChatResponse }>('/chat', input);
      return data.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['chat-history', variables.conversationId] });
      queryClient.invalidateQueries({ queryKey: ['ai-inbox'] });
    },
  });
};

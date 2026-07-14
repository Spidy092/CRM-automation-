import { useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { FormEvent, ReactNode } from 'react';
import { Bot, Check, Loader2, MessageSquare, Send, X, XCircle } from 'lucide-react';
import {
  useChatHistory,
  useSendChatMessage,
  type ChatPageContext,
  type ChatResponse,
  type ChatTurn,
  type ChatVisibleRecord,
} from '@/api/chat';
import { usePlan, useApprovePlan, useCancelPlan } from '@/api/agentPlans';
import { useActionInboxItem } from '@/api/aiInbox';
import { PlanPreview } from './PlanPreview';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { Campaign } from '@/api/campaigns';
import type { Pipeline, PipelineWithStages } from '@/api/pipelines';
import type { Sequence, OutreachTask } from '@/api/outreach';
import type { AiInboxItem } from '@/api/aiInbox';
import type { AiDecisionLogEntry } from '@/api/aiIntelligence';
import type { Integration } from '@/api/integrations';
import type { ScoringConfig, ScoringRule } from '@/api/scoring';
import type { AssignmentConfig, EligibleUser } from '@/api/assignments';
import type { DashboardMetrics, Lead, ScraperConfig, Template, User, CustomFieldDefinition } from '@/types';

type QueryClient = ReturnType<typeof useQueryClient>;
type LeadsPageData = { items?: Lead[]; pages?: Array<{ items?: Lead[] }> };
type SequencesData = { items?: Sequence[] };
type InboxData = { items?: AiInboxItem[] };
type DecisionsData = { items?: AiDecisionLogEntry[] };
type PageMetrics = Record<string, string | number | boolean | null>;

const CONTEXT_RECORD_LIMIT = 25;

function addVisibleRecord(records: ChatVisibleRecord[], record: ChatVisibleRecord): void {
  if (records.length >= CONTEXT_RECORD_LIMIT) return;
  if (records.some((existing) => existing.type === record.type && existing.id === record.id)) return;
  // Backend validation rejects empty strings — omit blank optional fields entirely.
  records.push({
    ...record,
    name: record.name?.trim() ? record.name : 'Untitled',
    status: record.status?.trim() ? record.status : undefined,
    subtitle: record.subtitle?.trim() ? record.subtitle : undefined,
  });
}

function addLead(records: ChatVisibleRecord[], lead: Lead): void {
  addVisibleRecord(records, {
    type: 'lead',
    id: lead.id,
    name: lead.business_name,
    status: lead.status,
    subtitle: [lead.contact_name, lead.industry, lead.location].filter(Boolean).join(' · '),
    meta: {
      score: lead.lead_score,
      classification: lead.classification,
      source: lead.source_platform,
      pipeline_stage_id: lead.pipeline_stage_id,
    },
  });
}

function addCampaign(records: ChatVisibleRecord[], campaign: Campaign): void {
  addVisibleRecord(records, {
    type: 'campaign',
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    subtitle: campaign.target_industries.length > 0 ? campaign.target_industries.join(', ') : 'No industry targeting',
    meta: { tone: campaign.tone, launched: Boolean(campaign.launched_at) },
  });
}

function addScraper(records: ChatVisibleRecord[], config: ScraperConfig): void {
  addVisibleRecord(records, {
    type: 'scraper',
    id: config.id,
    name: config.name,
    status: config.is_active ? 'active' : 'inactive',
    subtitle: config.source_type.replace(/_/g, ' '),
    meta: { source_type: config.source_type, is_active: config.is_active, last_run_at: config.last_run_at },
  });
}

function addPipeline(records: ChatVisibleRecord[], pipeline: Pipeline | PipelineWithStages): void {
  addVisibleRecord(records, {
    type: 'pipeline',
    id: pipeline.id,
    name: pipeline.name,
    status: pipeline.is_default ? 'default' : undefined,
    meta: { is_default: pipeline.is_default },
  });

  if ('stages' in pipeline) {
    pipeline.stages.forEach((stage) => {
      addVisibleRecord(records, {
        type: 'pipeline_stage',
        id: stage.id,
        name: stage.name,
        status: stage.is_terminal_won ? 'won' : stage.is_terminal_lost ? 'lost' : undefined,
        subtitle: pipeline.name,
        meta: { pipeline_id: pipeline.id, position: stage.position },
      });
    });
  }
}

function addTemplate(records: ChatVisibleRecord[], template: Template): void {
  addVisibleRecord(records, {
    type: 'template',
    id: template.id,
    name: template.name,
    status: template.approval_status,
    subtitle: template.channel,
  });
}

function addSequence(records: ChatVisibleRecord[], sequence: Sequence): void {
  addVisibleRecord(records, {
    type: 'sequence',
    id: sequence.id,
    name: sequence.name,
    subtitle: `${sequence.steps.length} steps`,
    meta: { steps: sequence.steps.length },
  });
}

function addOutreachTask(records: ChatVisibleRecord[], task: OutreachTask): void {
  addVisibleRecord(records, {
    type: 'outreach_task',
    id: task.id,
    name: task.title,
    status: task.status,
    subtitle: task.type.replace(/_/g, ' '),
    meta: { lead_id: task.lead_id, campaign_id: task.campaign_id },
  });
}

function addInboxItem(records: ChatVisibleRecord[], item: AiInboxItem): void {
  addVisibleRecord(records, {
    type: 'ai_inbox_item',
    id: item.id,
    name: item.title,
    status: item.status,
    subtitle: item.item_type.replace(/_/g, ' '),
    meta: { lead_id: item.lead_id, campaign_id: item.campaign_id, urgency_score: item.urgency_score },
  });
}

function addAiDecision(records: ChatVisibleRecord[], decision: AiDecisionLogEntry): void {
  addVisibleRecord(records, {
    type: 'ai_decision',
    id: decision.id,
    name: decision.decision,
    status: decision.decision_type,
    subtitle: decision.model_used ?? undefined,
    meta: {
      lead_id: decision.lead_id,
      campaign_id: decision.campaign_id,
      confidence: decision.confidence,
      human_approval_required: decision.human_approval_required,
    },
  });
}

function addIntegration(records: ChatVisibleRecord[], integration: Integration): void {
  addVisibleRecord(records, {
    type: 'integration',
    id: integration.id,
    name: integration.display_name || integration.name,
    status: integration.is_enabled ? 'enabled' : 'disabled',
    subtitle: integration.last_test_status ?? undefined,
    meta: { is_enabled: integration.is_enabled, last_test_status: integration.last_test_status },
  });
}

function addUser(records: ChatVisibleRecord[], user: User): void {
  addVisibleRecord(records, {
    type: 'user',
    id: user.id,
    name: user.name,
    status: user.is_active ? 'active' : 'inactive',
    subtitle: user.role,
    meta: { is_available: user.is_available, email: user.email },
  });
}

function addScoringRule(records: ChatVisibleRecord[], rule: ScoringRule): void {
  addVisibleRecord(records, {
    type: 'scoring_rule',
    id: rule.id,
    name: rule.factor,
    status: rule.is_active ? 'active' : 'inactive',
    subtitle: `score ${rule.score_value}, weight ${rule.weight}`,
    meta: { score_value: rule.score_value, weight: rule.weight },
  });
}

function addCustomField(records: ChatVisibleRecord[], field: CustomFieldDefinition): void {
  addVisibleRecord(records, {
    type: 'custom_field',
    id: field.id,
    name: field.label,
    status: field.is_active ? 'active' : 'inactive',
    subtitle: field.field_type,
    meta: { field_key: field.field_key, is_required: field.is_required },
  });
}

function addAssignmentUser(records: ChatVisibleRecord[], user: EligibleUser): void {
  addVisibleRecord(records, {
    type: 'assignment_user',
    id: user.id,
    name: `${user.first_name} ${user.last_name}`.trim() || user.email,
    status: user.role,
    subtitle: user.email,
  });
}

function collectLeadRecords(queryClient: QueryClient, records: ChatVisibleRecord[]): void {
  queryClient.getQueriesData<Lead>({ queryKey: ['leads'] }).forEach(([queryKey, lead]) => {
    if (queryKey.length === 2 && typeof queryKey[1] === 'string' && lead?.id) addLead(records, lead);
  });

  queryClient.getQueriesData<LeadsPageData>({ queryKey: ['leads'] }).forEach(([, data]) => {
    data?.items?.forEach((lead) => addLead(records, lead));
    data?.pages?.forEach((page) => page.items?.forEach((lead) => addLead(records, lead)));
  });
}

function titleForRoute(route: string): string {
  if (route === '/') return 'Dashboard';
  if (route.startsWith('/leads/import')) return 'Import Leads';
  if (route.startsWith('/leads/new')) return 'Create Lead';
  if (route.startsWith('/leads')) return 'Leads';
  if (route.startsWith('/campaigns/new')) return 'Create Campaign';
  if (route.startsWith('/campaigns') && route.endsWith('/brief')) return 'Campaign Brief';
  if (route.startsWith('/campaigns')) return 'Campaigns';
  if (route.startsWith('/admin/ai-decisions')) return 'AI Decisions';
  if (route.startsWith('/ai-inbox')) return 'AI Inbox';
  if (route.startsWith('/pipelines')) return 'Pipeline';
  if (route.startsWith('/reports')) return 'Reports';
  if (route.startsWith('/scraper')) return 'Scraper';
  if (route.startsWith('/settings/integrations')) return 'Integrations';
  if (route.startsWith('/settings/users')) return 'Users';
  if (route.startsWith('/settings/ai')) return 'AI Settings';
  if (route.startsWith('/settings/scoring')) return 'Scoring';
  if (route.startsWith('/settings/assignments')) return 'Assignments';
  if (route.startsWith('/settings/custom-fields')) return 'Custom Fields';
  if (route.startsWith('/settings')) return 'Settings';
  if (route.startsWith('/automation/rules')) return 'Automation Rules';
  if (route.startsWith('/outreach/sequences')) return 'Sequences';
  if (route.startsWith('/templates/new')) return 'Create Template';
  if (route.startsWith('/templates')) return 'Templates';
  return 'CRM';
}

export function buildPageContext(route: string, queryClient: QueryClient): ChatPageContext {
  const records: ChatVisibleRecord[] = [];
  const availableActions: string[] = [];
  const pageCapabilities: string[] = [];
  const pageMetrics: PageMetrics = {};
  let pageTitle = titleForRoute(route);

  const addCapabilities = (...items: string[]) => {
    items.forEach((item) => {
      if (!pageCapabilities.includes(item)) pageCapabilities.push(item);
    });
  };

  if (route.startsWith('/scraper')) {
    pageTitle = 'Scraper';
    availableActions.push('scraper.run');
    addCapabilities('Configure scraper sources', 'Run a scraper source after approval', 'Inspect source status and last run');
    (queryClient.getQueryData<ScraperConfig[]>(['scraper', 'configs']) ?? []).forEach((config) => addScraper(records, config));
    queryClient.getQueriesData<ScraperConfig>({ queryKey: ['scraper', 'configs'] }).forEach(([queryKey, config]) => {
      if (queryKey.length === 3 && config?.id) addScraper(records, config);
    });
  }

  if (route.startsWith('/campaigns')) {
    pageTitle = 'Campaigns';
    availableActions.push('campaign.list', 'campaign.launch', 'campaign.pause', 'campaign.resume', 'campaign.stats');
    addCapabilities('List campaigns', 'Launch, pause, or resume campaigns', 'Show campaign stats');
    (queryClient.getQueryData<Campaign[]>(['campaigns']) ?? []).forEach((campaign) => addCampaign(records, campaign));
    queryClient.getQueriesData<Campaign>({ queryKey: ['campaigns'] }).forEach(([queryKey, campaign]) => {
      if (queryKey.length === 2 && campaign?.id) addCampaign(records, campaign);
    });
  }

  if (route.startsWith('/leads')) {
    pageTitle = 'Leads';
    availableActions.push('lead.list', 'lead.get', 'lead.pause', 'ai.decision.recompute');
    addCapabilities('List and inspect leads', 'Pause or resume a lead after approval', 'Recompute AI next action for a lead');
    collectLeadRecords(queryClient, records);
  }

  if (route.startsWith('/pipelines')) {
    pageTitle = 'Pipeline';
    availableActions.push('pipeline.move_lead', 'lead.list');
    addCapabilities('Inspect pipelines and stages', 'Move a visible lead to a visible stage after approval');
    (queryClient.getQueryData<Pipeline[]>(['pipelines']) ?? []).forEach((pipeline) => addPipeline(records, pipeline));
    queryClient.getQueriesData<PipelineWithStages>({ queryKey: ['pipelines'] }).forEach(([queryKey, pipeline]) => {
      if (queryKey.length === 2 && pipeline?.id) addPipeline(records, pipeline);
    });
    collectLeadRecords(queryClient, records);
  }

  if (route.startsWith('/templates')) {
    pageTitle = 'Templates';
    addCapabilities('Review message templates', 'See approval status by template', 'Use approved templates for outreach');
    queryClient.getQueriesData<Template[]>({ queryKey: ['templates'] }).forEach(([, templates]) => {
      templates?.forEach((template) => addTemplate(records, template));
    });
  }

  if (route.startsWith('/outreach')) {
    pageTitle = 'Outreach';
    availableActions.push('outreach.send_manual');
    addCapabilities('Review outreach sequences', 'Inspect tasks', 'Prepare manual outreach through approved templates');
    const sequences = queryClient.getQueryData<SequencesData>(['sequences']);
    sequences?.items?.forEach((sequence) => addSequence(records, sequence));
    queryClient.getQueriesData<OutreachTask[]>({ queryKey: ['outreach', 'tasks'] }).forEach(([, tasks]) => {
      tasks?.forEach((task) => addOutreachTask(records, task));
    });
  }


  if (route.startsWith('/ai-inbox')) {
    pageTitle = 'AI Inbox';
    availableActions.push('ai.inbox.action', 'ai.decision.recompute');
    addCapabilities('Approve AI-proposed actions', 'Reject or snooze inbox items', 'Inspect linked agent action results');
    queryClient.getQueriesData<InboxData>({ queryKey: ['ai-inbox'] }).forEach(([, data]) => {
      data?.items?.forEach((item) => addInboxItem(records, item));
    });
  }

  if (route.startsWith('/admin/ai-decisions')) {
    pageTitle = 'AI Decisions';
    addCapabilities('Audit AI decisions', 'Filter by decision type', 'Inspect model, confidence, and approval requirement');
    queryClient.getQueriesData<DecisionsData>({ queryKey: ['ai-decisions'] }).forEach(([, data]) => {
      data?.items?.forEach((decision) => addAiDecision(records, decision));
    });
  }


  if (route === '/') {
    pageTitle = 'Dashboard';
    availableActions.push('report.dashboard', 'lead.list', 'campaign.list');
    addCapabilities('Show dashboard metrics', 'Summarize lead and campaign health', 'Open high-level CRM status');
    const metrics = queryClient.getQueryData<DashboardMetrics>(['reports', 'dashboard']);
    if (metrics) {
      pageMetrics.totalLeads = metrics.totalLeads;
      pageMetrics.qualifiedLeads = metrics.qualifiedLeads;
      pageMetrics.totalCampaigns = metrics.totalCampaigns;
      pageMetrics.activeOutreach = metrics.activeOutreach;
      pageMetrics.pipelineConversion = metrics.pipelineConversion;
    }
  }

  if (route.startsWith('/reports')) {
    pageTitle = 'Reports';
    availableActions.push('report.dashboard');
    addCapabilities('Show dashboard metrics', 'Review lead generation, outreach, pipeline, and sales rep reports', 'Export reports');
    const metrics = queryClient.getQueryData<DashboardMetrics>(['reports', 'dashboard']);
    if (metrics) {
      pageMetrics.totalLeads = metrics.totalLeads;
      pageMetrics.qualifiedLeads = metrics.qualifiedLeads;
      pageMetrics.totalCampaigns = metrics.totalCampaigns;
      pageMetrics.activeOutreach = metrics.activeOutreach;
    }
  }

  if (route.startsWith('/settings/integrations')) {
    pageTitle = 'Integrations';
    addCapabilities('Review integration status', 'Test integrations', 'Enable or disable configured connectors');
    (queryClient.getQueryData<Integration[]>(['integrations']) ?? []).forEach((integration) => addIntegration(records, integration));
  }

  if (route.startsWith('/settings/users')) {
    pageTitle = 'Users';
    addCapabilities('Review CRM users', 'Create users through the UI', 'Check roles and active status');
    (queryClient.getQueryData<User[]>(['users']) ?? []).forEach((user) => addUser(records, user));
  }

  if (route.startsWith('/settings/ai')) {
    pageTitle = 'AI Settings';
    addCapabilities('Configure AI provider settings', 'Check whether an API key is stored', 'Adjust model, max tokens, temperature, and cache TTL');
    const settings = queryClient.getQueryData<{ enabled: boolean; has_api_key: boolean; model: string; base_url: string | null; max_tokens: number; temperature: number }>(['ai-settings']);
    if (settings) {
      pageMetrics.aiEnabled = settings.enabled;
      pageMetrics.hasApiKey = settings.has_api_key;
      pageMetrics.model = settings.model;
      pageMetrics.usesCustomBaseUrl = Boolean(settings.base_url);
      pageMetrics.maxTokens = settings.max_tokens;
      pageMetrics.temperature = settings.temperature;
    }
  }

  if (route.startsWith('/settings/scoring')) {
    pageTitle = 'Scoring';
    addCapabilities('Review scoring configuration', 'Inspect active scoring rules', 'Recalculate lead scores');
    const config = queryClient.getQueryData<ScoringConfig>(['scoring-config']);
    if (config) {
      pageMetrics.hotMinScore = config.hot_min_score;
      pageMetrics.warmMinScore = config.warm_min_score;
      pageMetrics.assignmentThreshold = config.assignment_threshold;
    }
    (queryClient.getQueryData<ScoringRule[]>(['scoring-rules']) ?? []).forEach((rule) => addScoringRule(records, rule));
  }

  if (route.startsWith('/settings/assignments')) {
    pageTitle = 'Assignments';
    addCapabilities('Review round-robin assignment settings', 'Inspect eligible assignees', 'Override lead assignment after approval');
    const config = queryClient.getQueryData<AssignmentConfig>(['assignments-config']);
    if (config) {
      pageMetrics.assignmentEnabled = config.is_enabled;
      pageMetrics.thresholdScore = config.threshold_score;
      pageMetrics.eligibleRoleCount = config.eligible_roles.length;
    }
    (queryClient.getQueryData<EligibleUser[]>(['assignments-eligible-users']) ?? []).forEach((user) => addAssignmentUser(records, user));
  }

  if (route.startsWith('/settings/custom-fields')) {
    pageTitle = 'Custom Fields';
    addCapabilities('Review custom lead fields', 'Create and update field definitions', 'Use active fields during lead import and forms');
    (queryClient.getQueryData<CustomFieldDefinition[]>(['custom-fields']) ?? []).forEach((field) => addCustomField(records, field));
  }

  if (route.startsWith('/automation/rules')) {
    pageTitle = 'Automation Rules';
    addCapabilities('Review automation behavior', 'Coordinate scoring, assignment, outreach, and AI worker rules');
  }

  if (route.startsWith('/settings') && pageTitle === 'CRM') {
    pageTitle = 'Settings';
    addCapabilities('Navigate CRM settings', 'Configure users, AI, scoring, assignments, integrations, and custom fields');
  }

  return {
    route,
    pageTitle,
    visibleRecords: records,
    availableActions,
    pageCapabilities,
    pageMetrics,
  };
}


function extractLastPlanId(history: ChatTurn[]): string | null {
  for (const turn of [...history].reverse()) {
    if (turn.role !== 'assistant') continue;
    const match = turn.content.match(/^plan:([0-9a-f-]{36})/);
    if (match) return match[1];
  }
  return null;
}

function getConversationId(): string {
  const key = 'crm-chat-conversation-id';
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const created = `conv-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.sessionStorage.setItem(key, created);
  return created;
}


function isTableSeparatorRow(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-');
}

/** Defensive fallback: the model is told never to emit markdown tables, but if
 * one slips through, render it as readable "cell · cell · cell" lines instead
 * of raw pipe characters. */
function normalizeTableRows(lines: string[]): string[] {
  return lines
    .filter((line) => !isTableSeparatorRow(line))
    .map((line) => {
      if (!line.trim().startsWith('|')) return line;
      const cells = line
        .split('|')
        .map((cell) => cell.trim())
        .filter(Boolean);
      return cells.join(' · ');
    });
}

function renderInlineBold(text: string, keyPrefix: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part, index) => {
      const bold = part.startsWith('**') && part.endsWith('**');
      const inner = bold ? part.slice(2, -2) : part;
      return bold ? (
        <strong key={`${keyPrefix}-${index}`} className="font-semibold text-slate-900">
          {inner}
        </strong>
      ) : (
        <span key={`${keyPrefix}-${index}`}>{inner}</span>
      );
    });
}

function renderCopilotText(content: string): ReactNode[] {
  const cleaned = content.replace(/👋|✨|🚀|✅|❌|⚠️|📌/gu, '').trim();
  const rawLines = cleaned.split(/\n+/).filter((line) => line.trim().length > 0);
  const lines = normalizeTableRows(rawLines);

  return lines.map((line, lineIndex) => {
    const listMatch = line.match(/^\s*(\d+[.)]|[-*])\s+(.*)$/);
    const marker = listMatch ? listMatch[1].replace(/[.)]$/, '.') : null;
    const text = listMatch ? listMatch[2] : line;

    return (
      <div
        key={lineIndex}
        className={cn('leading-snug', lineIndex > 0 && 'mt-1', listMatch && 'flex gap-1.5')}
      >
        {marker && <span className="shrink-0 text-slate-400">{marker}</span>}
        <span>{renderInlineBold(text, `${lineIndex}`)}</span>
      </div>
    );
  });
}

const ACTION_QUERY_KEYS: Array<{ prefix: string; keys: string[][] }> = [
  { prefix: 'lead.', keys: [['leads']] },
  { prefix: 'pipeline.', keys: [['pipelines'], ['leads']] },
  { prefix: 'campaign.', keys: [['campaigns']] },
  { prefix: 'scraper.', keys: [['scraper', 'configs']] },
  { prefix: 'assignment.', keys: [['assignments-config'], ['assignments-eligible-users']] },
  { prefix: 'outreach.', keys: [['sequences'], ['outreach', 'tasks']] },
  { prefix: 'ai.decision.', keys: [['ai-decisions']] },
];

function invalidateQueriesForAction(queryClient: QueryClient, actionName: string): void {
  queryClient.invalidateQueries({ queryKey: ['ai-inbox'] });
  const match = ACTION_QUERY_KEYS.find(({ prefix }) => actionName.startsWith(prefix));
  match?.keys.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
}

function ChatApprovalCard({
  actionName,
  inboxItemId,
  onResolved,
}: {
  actionName: string;
  inboxItemId: string | null;
  onResolved: () => void;
}) {
  const actionInboxItem = useActionInboxItem();
  const [resolution, setResolution] = useState<'approved' | 'rejected' | null>(null);

  if (!inboxItemId) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        <span className="font-medium">{actionName}</span> needs approval. Open the AI Inbox to
        review it.
      </div>
    );
  }

  if (resolution) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
          resolution === 'approved'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : 'border-slate-200 bg-slate-50 text-slate-600',
        )}
      >
        {resolution === 'approved' ? (
          <Check className="h-4 w-4 shrink-0" />
        ) : (
          <XCircle className="h-4 w-4 shrink-0" />
        )}
        <span>
          {actionName} {resolution === 'approved' ? 'approved and running.' : 'rejected.'}
        </span>
      </div>
    );
  }

  const act = (action: 'approve' | 'reject') => {
    actionInboxItem.mutate(
      { id: inboxItemId, action },
      {
        onSuccess: () => {
          setResolution(action === 'approve' ? 'approved' : 'rejected');
          onResolved();
        },
      },
    );
  };

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      <p>
        <span className="font-medium">{actionName}</span> needs your approval.
      </p>
      <div className="mt-2 flex gap-2">
        <Button
          type="button"
          size="sm"
          className="h-7 gap-1 bg-emerald-600 px-2 text-xs hover:bg-emerald-700"
          disabled={actionInboxItem.isPending}
          onClick={() => act('approve')}
        >
          {actionInboxItem.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          Approve
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2 text-xs"
          disabled={actionInboxItem.isPending}
          onClick={() => act('reject')}
        >
          <XCircle className="h-3.5 w-3.5" />
          Reject
        </Button>
      </div>
      {actionInboxItem.isError && (
        <p className="mt-1 text-xs text-red-700">Could not update the approval. Try again.</p>
      )}
    </div>
  );
}

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [lastResponse, setLastResponse] = useState<ChatResponse | null>(null);
  const location = useLocation();
  const queryClient = useQueryClient();
  const conversationId = useMemo(getConversationId, []);
  const history = useChatHistory(conversationId);
  const sendMessage = useSendChatMessage();
  const turns = history.data ?? [];

  const responsePlanId = (lastResponse?.action?.result as { planId?: string } | undefined)?.planId;
  const historyPlanId = extractLastPlanId(turns);
  const planId = responsePlanId ?? historyPlanId;
  const planQuery = usePlan(planId ?? '');
  const approvePlan = useApprovePlan();
  const cancelPlan = useCancelPlan();

  const visibleContent = (content: string): string => {
    const match = content.match(/^plan:[0-9a-f-]{36}:(.*)$/s);
    return match ? match[1] : content;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) return;
    setMessage('');
    const response = await sendMessage.mutateAsync({
      conversationId,
      message: trimmed,
      pageContext: buildPageContext(location.pathname, queryClient),
    });
    setLastResponse(response);
  };

  return (
    <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3">
      {open && (
        <section className="flex h-[32rem] w-[min(calc(100vw-2rem),25rem)] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl" aria-label="Copilot chat">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <span className="grid h-8 w-8 place-items-center rounded-md bg-slate-950 text-white">
                  <Bot className="h-4 w-4" />
                </span>
                <span>Copilot</span>
              </div>
              <button
                type="button"
                className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                onClick={() => setOpen(false)}
                aria-label="Close copilot"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 px-4 py-3">
              {turns.length === 0 && !lastResponse && (
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                  Ask about leads, templates, campaigns, pipelines, or reports. When Copilot needs permission, you can approve it here.
                </div>
              )}
              {turns.map((turn, index) => (
                <div
                  key={`${turn.createdAt}-${index}`}
                  className={cn(
                    'max-w-[85%] rounded-md px-3 py-2 text-sm',
                    turn.role === 'user'
                      ? 'ml-auto bg-slate-950 text-white'
                      : 'mr-auto border border-slate-200 bg-white text-slate-700 shadow-sm',
                  )}
                >
                  {turn.role === 'assistant' ? renderCopilotText(visibleContent(turn.content)) : turn.content}
                </div>
              ))}
              {lastResponse?.action?.policy.outcome === 'require_approval' && !planId && (
                <ChatApprovalCard
                  key={
                    lastResponse.action.inboxItemId ??
                    lastResponse.action.agentAction?.id ??
                    lastResponse.action.name
                  }
                  actionName={lastResponse.action.name}
                  inboxItemId={lastResponse.action.inboxItemId ?? null}
                  onResolved={() => invalidateQueriesForAction(queryClient, lastResponse.action!.name)}
                />
              )}
              {planId && planQuery.data && (
                <PlanPreview
                  preview={planQuery.data}
                  onApprove={async () => { await approvePlan.mutateAsync(planId); }}
                  onCancel={async () => { await cancelPlan.mutateAsync(planId); }}
                />
              )}
              {sendMessage.isPending && (
                <div className="mr-auto flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500 shadow-sm">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Working...
                </div>
              )}
              {sendMessage.isError && (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  Copilot request failed.
                </p>
              )}
            </div>

            <form onSubmit={submit} className="flex shrink-0 gap-2 border-t border-slate-200 bg-white p-3">
              <Input
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Ask Copilot or approve an action"
                disabled={sendMessage.isPending}
              />
              <Button type="submit" size="icon" disabled={sendMessage.isPending || !message.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </form>
        </section>
      )}

      <Button
        type="button"
        className="h-12 w-12 rounded-full bg-slate-950 shadow-lg hover:bg-slate-800"
        size="icon"
        onClick={() => setOpen((value) => !value)}
        aria-label="Open copilot"
      >
        <MessageSquare className="h-5 w-5" />
      </Button>
    </div>
  );
}

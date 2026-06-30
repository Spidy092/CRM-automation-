import OpenAI from 'openai';
import { redis } from '../../shared/utils/redis';
import { logger } from '../../shared/utils/logger';
import { incAiTokens } from '../../shared/utils/metrics';
import { getAiConfig } from '../ai-settings/ai-settings.service';
import { insertDecisionLog } from '../ai-intelligence/ai-intelligence.repository';
import { getAgentActionDefinition } from '../agent/agent.actions';
import { proposeAgentAction } from '../agent/agent.service';
import type { AgentActionName, AgentActor } from '../agent/agent.types';
import type { AuthenticatedUser } from '../../shared/types';
import { buildChatTools, toolNameToActionName } from './chat.actions';
import { buildChatSystemPrompt } from './chat.prompt';
import type { ChatPageContext, ChatResponse, ChatTurn, ChatVisibleRecord, ChatVisibleRecordType } from './chat.types';

const CHAT_HISTORY_TTL_SECONDS = 60 * 60 * 2;
const CHAT_HISTORY_LIMIT = 20;
const CHAT_MAX_TOKENS = 500;
const LEAD_LIST_STATE_PREFIX = '[crm:lead-list-state:';
const LEAD_LIST_STATE_SUFFIX = ']';

function historyKey(conversationId: string): string {
  return `chat:history:${conversationId}`;
}

async function loadHistory(conversationId: string): Promise<ChatTurn[]> {
  const raw = await redis.get(historyKey(conversationId)).catch(() => null);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as ChatTurn[];
    return Array.isArray(parsed) ? parsed.slice(-CHAT_HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

async function saveHistory(conversationId: string, turns: ChatTurn[]): Promise<void> {
  await redis
    .setex(historyKey(conversationId), CHAT_HISTORY_TTL_SECONDS, JSON.stringify(turns.slice(-CHAT_HISTORY_LIMIT)))
    .catch(() => null);
}

export async function getChatHistory(conversationId: string): Promise<ChatTurn[]> {
  const turns = await loadHistory(conversationId);
  return turns.map((turn) => turn.role === 'assistant' ? { ...turn, content: cleanInternalMarkers(turn.content) } : turn);
}

export async function sendChatMessage(input: {
  conversationId: string;
  message: string;
  actor: AgentActor;
  user: AuthenticatedUser;
  pageContext?: ChatPageContext;
}): Promise<ChatResponse> {
  const history = await loadHistory(input.conversationId);
  const contextual = await handleContextualCommand(input.message, input.actor, input.conversationId, input.pageContext, history);
  if (contextual) {
    await persistTurn(input.conversationId, history, input.message, contextual.reply);
    return { ...contextual, reply: cleanInternalMarkers(contextual.reply) };
  }

  const aiConfig = await getAiConfig();

  if (!aiConfig) {
    const fallback = await deterministicFallback(input.message, input.actor, input.conversationId, history);
    await persistTurn(input.conversationId, history, input.message, fallback.reply);
    return { ...fallback, reply: cleanInternalMarkers(fallback.reply) };
  }

  const client = new OpenAI({
    apiKey: aiConfig.apiKey || process.env.OPENAI_API_KEY,
    baseURL: aiConfig.baseUrl || undefined,
  });

  try {
    const completion = await client.chat.completions.create({
      model: aiConfig.model,
      max_tokens: CHAT_MAX_TOKENS,
      temperature: 0.2,
      tools: buildChatTools(),
      tool_choice: 'auto',
      messages: [
        { role: 'system', content: buildChatSystemPrompt(input.user, new Date().toISOString()) },
        ...pageContextMessage(input.pageContext),
        ...history.map((turn) => ({ role: turn.role, content: turn.role === 'assistant' ? cleanInternalMarkers(turn.content) : turn.content }) as const),
        { role: 'user', content: input.message },
      ],
    });

    incAiTokens('chat', completion.usage?.total_tokens ?? 0);
    const message = completion.choices[0]?.message;
    const toolCall = message?.tool_calls?.[0];

    if (toolCall?.type === 'function') {
      const actionName = toolNameToActionName(toolCall.function.name);
      const rawArgs = JSON.parse(toolCall.function.arguments || '{}') as Record<string, unknown>;
      const args = resolveToolArgsFromContext(actionName, rawArgs, input.message, input.pageContext);
      const actionResult = await proposeAgentAction({
        source: 'chat',
        actionName,
        args,
        actor: input.actor,
        sourceMessage: input.message,
        forceApproval: getAgentActionDefinition(actionName).riskTier !== 'read',
      });
      const reply = replyForAction(actionName, actionResult.policy.outcome, actionResult.result);
      await persistTurn(input.conversationId, history, input.message, reply);
      return {
        conversationId: input.conversationId,
        reply: cleanInternalMarkers(reply),
        action: {
          name: actionName,
          policy: actionResult.policy,
          agentAction: actionResult.action,
          result: actionResult.result,
        },
      };
    }

    const reply = message?.content?.trim() || 'I could not determine a safe CRM action for that request.';
    await persistTurn(input.conversationId, history, input.message, reply);
    return { conversationId: input.conversationId, reply };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('chat: OpenAI/tool orchestration failed', {
      conversationId: input.conversationId,
      error: message,
    });
    await insertDecisionLog({
      lead_id: null,
      campaign_id: null,
      decision_type: 'chat',
      input_context: {
        conversationId: input.conversationId,
        actorId: input.actor.id,
        actorRole: input.actor.role,
        messageLength: input.message.length,
      },
      chain_of_thought: message,
      decision: 'failed',
      model_used: aiConfig.model,
      human_approval_required: false,
    }).catch((logErr: unknown) => {
      logger.warn('chat: failed decision log write failed', {
        conversationId: input.conversationId,
        error: logErr instanceof Error ? logErr.message : String(logErr),
      });
    });
    const fallback = await deterministicFallback(input.message, input.actor, input.conversationId, history);
    await persistTurn(input.conversationId, history, input.message, fallback.reply);
    return { ...fallback, reply: cleanInternalMarkers(fallback.reply) };
  }
}

async function persistTurn(
  conversationId: string,
  history: ChatTurn[],
  userMessage: string,
  assistantMessage: string,
): Promise<void> {
  const now = new Date().toISOString();
  await saveHistory(conversationId, [
    ...history,
    { role: 'user', content: userMessage, createdAt: now },
    { role: 'assistant', content: assistantMessage, createdAt: now },
  ]);
}

function replyForAction(actionName: AgentActionName, outcome: string, result: unknown): string {
  if (outcome === 'require_approval') return `I prepared ${humanActionName(actionName)} for human approval in AI Inbox.`;
  if (outcome === 'reject') return `I could not run ${humanActionName(actionName)} because policy rejected the request.`;
  return summarizeActionResult(actionName, result);
}

function humanActionName(actionName: AgentActionName): string {
  return actionName.replace(/\./g, ' ').replace(/_/g, ' ');
}

function summarizeActionResult(actionName: AgentActionName, result: unknown): string {
  const record = result && typeof result === 'object' ? (result as Record<string, unknown>) : null;
  if (actionName === 'lead.list') {
    return summarizeLeadList(result);
  }
  if (actionName === 'campaign.list') {
    const campaigns = Array.isArray(result) ? result : Array.isArray(record?.items) ? (record.items as unknown[]) : [];
    const names = campaigns
      .slice(0, 5)
      .map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>).name : null))
      .filter(Boolean)
      .join(', ');
    return names ? `I found ${campaigns.length} campaigns: ${names}.` : `I found ${campaigns.length} campaigns.`;
  }
  if (actionName === 'report.dashboard' && record) {
    const totalLeads = readNumber(record, 'totalLeads', 'total_leads');
    const qualifiedLeads = readNumber(record, 'qualifiedLeads', 'qualified_leads');
    const totalCampaigns = readNumber(record, 'totalCampaigns', 'total_campaigns');
    const activeOutreach = readNumber(record, 'activeOutreach', 'active_outreach');
    const parts = [
      totalLeads !== null ? `${totalLeads} leads` : null,
      qualifiedLeads !== null ? `${qualifiedLeads} qualified` : null,
      totalCampaigns !== null ? `${totalCampaigns} campaigns` : null,
      activeOutreach !== null ? `${activeOutreach} active outreach` : null,
    ].filter(Boolean);
    return parts.length > 0 ? `Dashboard summary: ${parts.join(', ')}.` : 'I pulled the dashboard metrics.';
  }
  if (actionName === 'campaign.stats' && record) {
    const parts = ['total_leads', 'sent', 'delivered', 'opened', 'replied', 'failed']
      .filter((key) => typeof record[key] === 'number')
      .map((key) => `${key.replace(/_/g, ' ')}: ${record[key]}`);
    return parts.length > 0 ? `Campaign stats: ${parts.join(', ')}.` : 'I pulled the campaign stats.';
  }
  if (actionName === 'lead.get' && record) {
    const name = typeof record.business_name === 'string' ? record.business_name : 'the lead';
    const status = typeof record.status === 'string' ? ` Status: ${record.status}.` : '';
    const score = typeof record.lead_score === 'number' ? ` Score: ${record.lead_score}.` : '';
    return `Here is ${name}.${status}${score}`;
  }
  if (actionName === 'ai.inbox.action' && record) {
    const title = typeof record.title === 'string' ? record.title : 'the AI Inbox item';
    const status = typeof record.status === 'string' ? record.status.replace(/_/g, ' ') : 'updated';
    const actionResult = record.action_result && typeof record.action_result === 'object'
      ? (record.action_result as Record<string, unknown>)
      : null;
    const linkedStatus = typeof actionResult?.status === 'string' ? ` Linked action: ${actionResult.status}.` : '';
    return `AI Inbox item ${title} is now ${status}.${linkedStatus}`;
  }
  if (result) return `I ran ${humanActionName(actionName)} successfully.`;
  return `I processed ${humanActionName(actionName)}.`;
}

function summarizeLeadList(result: unknown): string {
  const record = result && typeof result === 'object' && !Array.isArray(result) ? (result as Record<string, unknown>) : null;
  const items = Array.isArray(result)
    ? result
    : Array.isArray(record?.items)
      ? (record.items as unknown[])
      : Array.isArray(record?.data)
        ? (record.data as unknown[])
        : [];
  const meta = record?.meta && typeof record.meta === 'object' ? (record.meta as Record<string, unknown>) : null;
  const returnedCount = items.length;
  const requestedLimit = typeof meta?.limit === 'number' ? meta.limit : returnedCount;
  const hasMore = meta?.hasMore === true;
  const nextCursor = typeof meta?.nextCursor === 'string' ? meta.nextCursor : undefined;
  const total = typeof record?.total === 'number' ? record.total : null;
  const countText = total !== null
    ? `${total} leads total`
    : hasMore
      ? `${returnedCount} leads in this page, with more available`
      : `${returnedCount} leads`;

  const names = items
    .map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>).business_name : null))
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0);

  const marker = hasMore && nextCursor ? buildLeadListStateMarker({ limit: requestedLimit || returnedCount || 25, cursor: nextCursor }) : '';
  if (names.length === 0) return `I found ${countText}.${marker}`;

  const listedCount = Math.min(names.length, requestedLimit || names.length);
  const list = names.slice(0, listedCount).map((name, index) => `${index + 1}. ${name}`).join('\n');
  const moreText = hasMore
    ? '\nThere are more leads after this page. Say "next page" to continue.'
    : names.length > listedCount
      ? `\n${names.length - listedCount} more returned leads are hidden.`
      : '';
  return `I found ${countText}. Showing ${listedCount}:\n${list}${moreText}${marker}`;
}

function buildLeadListStateMarker(state: { limit: number; cursor: string }): string {
  return `${LEAD_LIST_STATE_PREFIX}${Buffer.from(JSON.stringify(state), 'utf8').toString('base64')}${LEAD_LIST_STATE_SUFFIX}`;
}

function extractLeadListState(history: ChatTurn[]): { limit: number; cursor: string } | null {
  for (const turn of [...history].reverse()) {
    if (turn.role !== 'assistant') continue;
    const start = turn.content.lastIndexOf(LEAD_LIST_STATE_PREFIX);
    if (start === -1) continue;
    const end = turn.content.indexOf(LEAD_LIST_STATE_SUFFIX, start + LEAD_LIST_STATE_PREFIX.length);
    if (end === -1) continue;
    const encoded = turn.content.slice(start + LEAD_LIST_STATE_PREFIX.length, end);
    try {
      const parsed = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as { limit?: unknown; cursor?: unknown };
      if (typeof parsed.limit === 'number' && typeof parsed.cursor === 'string') {
        return { limit: Math.min(Math.max(parsed.limit, 1), 100), cursor: parsed.cursor };
      }
    } catch {
      continue;
    }
  }
  return null;
}

function cleanInternalMarkers(content: string): string {
  const start = content.lastIndexOf(LEAD_LIST_STATE_PREFIX);
  if (start === -1) return content;
  const end = content.indexOf(LEAD_LIST_STATE_SUFFIX, start + LEAD_LIST_STATE_PREFIX.length);
  if (end === -1) return content;
  return `${content.slice(0, start)}${content.slice(end + LEAD_LIST_STATE_SUFFIX.length)}`.trimEnd();
}

function isLeadListContinuation(lowerMessage: string): boolean {
  return /\b(next|continue|more|next page|show more|keep going)\b/.test(lowerMessage) && !/\b(campaign|scraper|inbox|report)\b/.test(lowerMessage);
}

function readNumber(record: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    if (typeof record[key] === 'number') return record[key] as number;
  }
  return null;
}

function pageContextMessage(pageContext?: ChatPageContext): Array<{ role: 'system'; content: string }> {
  if (!pageContext) return [];
  const records = (pageContext.visibleRecords ?? [])
    .slice(0, 12)
    .map((record) => `${record.type}: ${record.name} (${record.id})${record.status ? ` status=${record.status}` : ''}`)
    .join('\n');
  const actions = (pageContext.availableActions ?? []).slice(0, 10).join(', ');
  const capabilities = (pageContext.pageCapabilities ?? []).slice(0, 10).join('; ');
  const metrics = pageContext.pageMetrics
    ? Object.entries(pageContext.pageMetrics).slice(0, 12).map(([key, value]) => `${key}=${String(value)}`).join(', ')
    : '';
  const content = [
    `Current CRM page: ${pageContext.pageTitle ?? pageContext.route} (${pageContext.route}).`,
    capabilities ? `Page capabilities: ${capabilities}.` : null,
    metrics ? `Page metrics: ${metrics}.` : null,
    records ? `Visible CRM records:\n${records}` : 'No visible CRM records were provided.',
    actions ? `Likely page actions: ${actions}.` : null,
    'When a visible record name identifies the target, use its ID internally. Never ask the user for raw IDs.',
  ].filter(Boolean).join('\n');
  return [{ role: 'system', content }];
}

async function handleContextualCommand(
  message: string,
  actor: AgentActor,
  conversationId: string,
  pageContext?: ChatPageContext,
  history: ChatTurn[] = [],
): Promise<ChatResponse | null> {
  const normalized = normalizeText(message);

  const continuation = await handleLeadListContinuation(normalized, message, actor, conversationId, history);
  if (continuation) return continuation;
  if (!pageContext) return null;

  const awareness = handlePageAwarenessQuestion(normalized, conversationId, pageContext);
  if (awareness) return awareness;

  const scraper = await handleScraperCommand(normalized, message, actor, conversationId, pageContext);
  if (scraper) return scraper;

  const campaign = await handleCampaignCommand(normalized, message, actor, conversationId, pageContext);
  if (campaign) return campaign;

  const lead = await handleLeadCommand(normalized, message, actor, conversationId, pageContext);
  if (lead) return lead;

  const pipeline = await handlePipelineCommand(normalized, message, actor, conversationId, pageContext);
  if (pipeline) return pipeline;

  const inbox = await handleInboxCommand(normalized, message, actor, conversationId, pageContext);
  if (inbox) return inbox;

  return null;
}

async function handleLeadListContinuation(
  normalized: string,
  originalMessage: string,
  actor: AgentActor,
  conversationId: string,
  history: ChatTurn[],
): Promise<ChatResponse | null> {
  if (!isLeadListContinuation(normalized)) return null;
  const state = extractLeadListState(history);
  if (!state) return null;
  const actionResult = await proposeAgentAction({
    source: 'chat',
    actionName: 'lead.list',
    args: { limit: state.limit, cursor: state.cursor },
    actor,
    sourceMessage: originalMessage,
  });
  return {
    conversationId,
    reply: summarizeActionResult('lead.list', actionResult.result),
    action: {
      name: 'lead.list',
      policy: actionResult.policy,
      agentAction: actionResult.action,
      result: actionResult.result,
    },
  };
}

function handlePageAwarenessQuestion(
  normalized: string,
  conversationId: string,
  pageContext: ChatPageContext,
): ChatResponse | null {
  const asksPage = /\b(where am i|what page|which page|current screen|this screen|this page)\b/.test(normalized);
  const asksCapabilities = /\b(what can you do|what can i do|help here|on this page|on this screen|available actions|what actions)\b/.test(normalized);
  if (!asksPage && !asksCapabilities) return null;

  const title = pageContext.pageTitle ?? pageContext.route;
  const capabilities = pageContext.pageCapabilities ?? [];
  const records = pageContext.visibleRecords ?? [];
  const metrics = pageContext.pageMetrics ? summarizeMetrics(pageContext.pageMetrics) : '';

  const parts = [`You are on ${title}.`];
  if (metrics) parts.push(metrics);
  if (capabilities.length > 0) parts.push(`I can help here with: ${capabilities.slice(0, 5).join('; ')}.`);
  if (records.length > 0) {
    const grouped = summarizeVisibleRecords(records);
    if (grouped) parts.push(grouped);
  }
  if ((pageContext.availableActions ?? []).length > 0) {
    parts.push(`Available agent actions: ${(pageContext.availableActions ?? []).slice(0, 6).join(', ')}.`);
  }

  return { conversationId, reply: parts.join(' ') };
}

function summarizeMetrics(metrics: Record<string, string | number | boolean | null>): string {
  const entries = Object.entries(metrics).filter(([, value]) => value !== null && value !== '');
  if (entries.length === 0) return '';
  const text = entries.slice(0, 6).map(([key, value]) => `${humanizeKey(key)}: ${String(value)}`).join(', ');
  return `Current metrics: ${text}.`;
}

function summarizeVisibleRecords(records: ChatVisibleRecord[]): string {
  const counts = records.reduce<Record<string, number>>((acc, record) => {
    acc[record.type] = (acc[record.type] ?? 0) + 1;
    return acc;
  }, {});
  const countText = Object.entries(counts)
    .slice(0, 5)
    .map(([type, count]) => `${count} ${type.replace(/_/g, ' ')}${count === 1 ? '' : 's'}`)
    .join(', ');
  const names = records.slice(0, 5).map((record) => record.name).join(', ');
  return countText ? `I can see ${countText}${names ? `, including ${names}` : ''}.` : '';
}

function humanizeKey(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').toLowerCase();
}

async function handleScraperCommand(
  normalized: string,
  originalMessage: string,
  actor: AgentActor,
  conversationId: string,
  pageContext: ChatPageContext,
): Promise<ChatResponse | null> {
  const onScraperPage = pageContext.route.startsWith('/scraper');
  if (!onScraperPage && !normalized.includes('scrap')) return null;
  if (!hasRunIntent(normalized) && !normalized.includes('scrap')) return null;

  const candidates = recordsByType(pageContext, 'scraper').filter((record) => record.status !== 'inactive');
  const records = candidates.length > 0 ? candidates : recordsByType(pageContext, 'scraper');
  if (records.length === 0) {
    return {
      conversationId,
      reply: 'I can run a scraper, but I do not see any scraper sources on this page yet. Add a source first, then ask me to run it by name.',
    };
  }

  const selected = selectRecord(records, normalized);
  if (selected.kind === 'single') {
    return proposeContextAction({
      conversationId,
      actor,
      sourceMessage: originalMessage,
      actionName: 'scraper.run',
      args: { configId: selected.record.id },
      reply: `I prepared scraper run for ${selected.record.name} for approval in AI Inbox.`,
      forceApproval: true,
    });
  }

  return askWhich(conversationId, 'scraper', records, `run ${records[0]?.name ?? 'the source'}`);
}

async function handleCampaignCommand(
  normalized: string,
  originalMessage: string,
  actor: AgentActor,
  conversationId: string,
  pageContext: ChatPageContext,
): Promise<ChatResponse | null> {
  const records = recordsByType(pageContext, 'campaign');
  if (records.length === 0) return null;

  const actionName = campaignActionForMessage(normalized);
  if (!actionName) return null;

  const selected = selectRecord(records, normalized);
  if (selected.kind !== 'single') return askWhich(conversationId, 'campaign', records, `${humanActionName(actionName)} ${records[0]?.name ?? 'campaign'}`);

  return proposeContextAction({
    conversationId,
    actor,
    sourceMessage: originalMessage,
    actionName,
    args: { id: selected.record.id },
    reply: actionName === 'campaign.stats'
      ? undefined
      : `I prepared ${humanActionName(actionName)} for ${selected.record.name} for approval in AI Inbox.`,
    forceApproval: getAgentActionDefinition(actionName).riskTier !== 'read',
  });
}

async function handleLeadCommand(
  normalized: string,
  originalMessage: string,
  actor: AgentActor,
  conversationId: string,
  pageContext: ChatPageContext,
): Promise<ChatResponse | null> {
  const records = recordsByType(pageContext, 'lead');
  if (records.length === 0) return null;

  let actionName: AgentActionName | null = null;
  let argsFor = (record: ChatVisibleRecord): Record<string, unknown> => ({ id: record.id });
  let replyFor: ((record: ChatVisibleRecord) => string | undefined) | null = null;

  if (/\b(pause|stop|hold)\b/.test(normalized) && normalized.includes('lead')) {
    actionName = 'lead.pause';
    argsFor = (record) => ({ id: record.id, paused: true });
    replyFor = (record) => `I prepared pause lead for ${record.name} for approval in AI Inbox.`;
  } else if (/\b(resume|activate|unpause)\b/.test(normalized) && normalized.includes('lead')) {
    actionName = 'lead.pause';
    argsFor = (record) => ({ id: record.id, paused: false });
    replyFor = (record) => `I prepared resume lead for ${record.name} for approval in AI Inbox.`;
  } else if ((normalized.includes('recompute') || normalized.includes('next action')) && normalized.includes('lead')) {
    actionName = 'ai.decision.recompute';
    argsFor = (record) => ({ leadId: record.id, force: true, context: { source: 'chat' } });
    replyFor = (record) => `I queued AI next action recompute for ${record.name}.`;
  } else if (/\b(show|get|open|details?)\b/.test(normalized) && normalized.includes('lead')) {
    actionName = 'lead.get';
  }

  if (!actionName) return null;

  const selected = selectRecord(records, normalized);
  if (selected.kind !== 'single') return askWhich(conversationId, 'lead', records, `${humanActionName(actionName)} ${records[0]?.name ?? 'lead'}`);

  return proposeContextAction({
    conversationId,
    actor,
    sourceMessage: originalMessage,
    actionName,
    args: argsFor(selected.record),
    reply: replyFor?.(selected.record),
    forceApproval: getAgentActionDefinition(actionName).riskTier !== 'read',
  });
}

async function handlePipelineCommand(
  normalized: string,
  originalMessage: string,
  actor: AgentActor,
  conversationId: string,
  pageContext: ChatPageContext,
): Promise<ChatResponse | null> {
  if (!/\b(move|stage|pipeline)\b/.test(normalized) || !normalized.includes('lead')) return null;
  const lead = selectRecord(recordsByType(pageContext, 'lead'), normalized);
  const stage = selectRecord(recordsByType(pageContext, 'pipeline_stage'), normalized);
  if (lead.kind !== 'single') return askWhich(conversationId, 'lead', recordsByType(pageContext, 'lead'), 'move lead');
  if (stage.kind !== 'single') return askWhich(conversationId, 'pipeline stage', recordsByType(pageContext, 'pipeline_stage'), 'move to Qualified');

  return proposeContextAction({
    conversationId,
    actor,
    sourceMessage: originalMessage,
    actionName: 'pipeline.move_lead',
    args: { leadId: lead.record.id, stageId: stage.record.id },
    reply: `I prepared moving ${lead.record.name} to ${stage.record.name} for approval in AI Inbox.`,
    forceApproval: true,
  });
}

async function handleInboxCommand(
  normalized: string,
  originalMessage: string,
  actor: AgentActor,
  conversationId: string,
  pageContext: ChatPageContext,
): Promise<ChatResponse | null> {
  const inboxAction = inboxActionForMessage(normalized);
  if (!inboxAction) return null;

  const records = recordsByType(pageContext, 'ai_inbox_item').filter((record) => record.status !== 'actioned' && record.status !== 'auto_resolved');
  if (records.length === 0) return null;

  const selected = selectRecord(records, normalized);
  if (selected.kind !== 'single') return askWhich(conversationId, 'AI Inbox item', records, `${inboxAction} ${records[0]?.name ?? 'this item'}`);

  const snoozedUntil = inboxAction === 'snooze' ? new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString() : undefined;
  return proposeContextAction({
    conversationId,
    actor,
    sourceMessage: originalMessage,
    actionName: 'ai.inbox.action',
    args: {
      id: selected.record.id,
      action: inboxAction,
      ...(snoozedUntil ? { snoozed_until: snoozedUntil } : {}),
    },
    reply: undefined,
    forceApproval: false,
  });
}

function inboxActionForMessage(normalized: string): 'approve' | 'reject' | 'snooze' | null {
  if (/\b(approve|accept|confirm)\b/.test(normalized)) return 'approve';
  if (/\b(reject|decline|deny|dismiss)\b/.test(normalized)) return 'reject';
  if (/\b(snooze|remind later|later)\b/.test(normalized)) return 'snooze';
  return null;
}

function campaignActionForMessage(normalized: string): AgentActionName | null {
  if (/\b(launch|start|send)\b/.test(normalized) && normalized.includes('campaign')) return 'campaign.launch';
  if (/\b(pause|stop|hold)\b/.test(normalized) && normalized.includes('campaign')) return 'campaign.pause';
  if (/\b(resume|activate|unpause)\b/.test(normalized) && normalized.includes('campaign')) return 'campaign.resume';
  if (/\b(stats|statistics|performance|metrics)\b/.test(normalized) && normalized.includes('campaign')) return 'campaign.stats';
  return null;
}

async function proposeContextAction(input: {
  conversationId: string;
  actor: AgentActor;
  sourceMessage: string;
  actionName: AgentActionName;
  args: Record<string, unknown>;
  reply?: string;
  forceApproval: boolean;
}): Promise<ChatResponse> {
  const actionResult = await proposeAgentAction({
    source: 'chat',
    actionName: input.actionName,
    args: input.args,
    actor: input.actor,
    sourceMessage: input.sourceMessage,
    forceApproval: input.forceApproval,
  });
  return {
    conversationId: input.conversationId,
    reply: input.reply ?? replyForAction(input.actionName, actionResult.policy.outcome, actionResult.result),
    action: {
      name: input.actionName,
      policy: actionResult.policy,
      agentAction: actionResult.action,
      result: actionResult.result,
    },
  };
}

function askWhich(conversationId: string, label: string, records: ChatVisibleRecord[], example: string): ChatResponse {
  const options = records.slice(0, 8).map((record) => `${record.name}${record.subtitle ? ` (${record.subtitle})` : ''}`).join(', ');
  const verb = label === 'scraper' ? 'run' : 'use';
  return {
    conversationId,
    reply: records.length > 0
      ? `Which ${label} should I ${verb}? I can see: ${options}. Reply with the name, for example: ${example}.`
      : `I need a ${label} from this page, but I do not see any visible options right now.`,
  };
}

function recordsByType(pageContext: ChatPageContext, type: ChatVisibleRecordType): ChatVisibleRecord[] {
  return (pageContext.visibleRecords ?? []).filter((record) => record.type === type);
}

function selectRecord(records: ChatVisibleRecord[], normalizedMessage: string):
  | { kind: 'single'; record: ChatVisibleRecord }
  | { kind: 'multiple' }
  | { kind: 'none' } {
  if (records.length === 0) return { kind: 'none' };
  const explicitMatches = records.filter((record) => normalizedMessage.includes(normalizeText(record.name)));
  if (explicitMatches.length === 1) return { kind: 'single', record: explicitMatches[0] };
  if (explicitMatches.length > 1) return { kind: 'multiple' };

  const genericTokens = new Set(['lead', 'leads', 'campaign', 'campaigns', 'scraper', 'scrapers', 'pipeline', 'stage', 'stages']);
  const tokenMatches = records.filter((record) => {
    const tokens = normalizeText(record.name)
      .split(' ')
      .filter((token) => token.length >= 4 && !genericTokens.has(token));
    return tokens.some((token) => normalizedMessage.includes(token));
  });
  if (tokenMatches.length === 1) return { kind: 'single', record: tokenMatches[0] };
  if (tokenMatches.length > 1) return { kind: 'multiple' };

  if (records.length === 1 && /\b(this|current|selected|it|that)\b/.test(normalizedMessage)) return { kind: 'single', record: records[0] };
  return records.length === 1 && !/\b(which|list|show all)\b/.test(normalizedMessage) ? { kind: 'single', record: records[0] } : { kind: 'multiple' };
}

function resolveToolArgsFromContext(
  actionName: AgentActionName,
  args: Record<string, unknown>,
  message: string,
  pageContext?: ChatPageContext,
): Record<string, unknown> {
  if (!pageContext) return args;
  const normalized = normalizeText(message);
  if ((actionName === 'scraper.run') && typeof args.configId !== 'string') {
    const selected = selectRecord(recordsByType(pageContext, 'scraper'), normalized);
    if (selected.kind === 'single') return { ...args, configId: selected.record.id };
  }
  if ((actionName === 'campaign.pause' || actionName === 'campaign.resume' || actionName === 'campaign.launch' || actionName === 'campaign.stats') && typeof args.id !== 'string') {
    const selected = selectRecord(recordsByType(pageContext, 'campaign'), normalized);
    if (selected.kind === 'single') return { ...args, id: selected.record.id };
  }
  if ((actionName === 'lead.get' || actionName === 'lead.pause' || actionName === 'lead.update') && typeof args.id !== 'string') {
    const selected = selectRecord(recordsByType(pageContext, 'lead'), normalized);
    if (selected.kind === 'single') return { ...args, id: selected.record.id };
  }
  if (actionName === 'ai.decision.recompute' && typeof args.leadId !== 'string') {
    const selected = selectRecord(recordsByType(pageContext, 'lead'), normalized);
    if (selected.kind === 'single') return { ...args, leadId: selected.record.id };
  }
  if (actionName === 'ai.inbox.action' && typeof args.id !== 'string') {
    const selected = selectRecord(recordsByType(pageContext, 'ai_inbox_item'), normalized);
    if (selected.kind === 'single') return { ...args, id: selected.record.id };
  }
  if (actionName === 'pipeline.move_lead') {
    const lead = typeof args.leadId === 'string' ? null : selectRecord(recordsByType(pageContext, 'lead'), normalized);
    const stage = typeof args.stageId === 'string' ? null : selectRecord(recordsByType(pageContext, 'pipeline_stage'), normalized);
    return {
      ...args,
      ...(lead?.kind === 'single' ? { leadId: lead.record.id } : {}),
      ...(stage?.kind === 'single' ? { stageId: stage.record.id } : {}),
    };
  }
  return args;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/scrappers?/g, 'scraper')
    .replace(/scrapping/g, 'scraping')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function hasRunIntent(normalized: string): boolean {
  return /\b(run|ran|start|trigger|scrape|scraping|execute|kick off)\b/.test(normalized);
}

function requestedLeadLimit(lowerMessage: string): number {
  const explicit = lowerMessage.match(/\b(?:list|show|give|get|want|all)?\s*(\d{1,3})\s+leads?\b/) ?? lowerMessage.match(/\bleads?\s*(\d{1,3})\b/);
  if (explicit?.[1]) {
    const requested = Number(explicit[1]);
    if (Number.isFinite(requested)) return Math.min(Math.max(requested, 1), 100);
  }
  if (/\ball\b/.test(lowerMessage)) return 100;
  return 25;
}

function leadSearchFromMessage(message: string): string | undefined {
  const lower = message.toLowerCase();
  if (/\b(how many|count|total|list|show|give|get|all|leads?)\b/.test(lower)) return undefined;
  return message.length < 120 ? message : undefined;
}

async function deterministicFallback(
  message: string,
  actor: AgentActor,
  conversationId: string,
  history: ChatTurn[] = [],
): Promise<ChatResponse> {
  const lower = message.toLowerCase();
  let actionName: AgentActionName | null = null;
  let args: Record<string, unknown> = {};

  const continuation = extractLeadListState(history);
  if (continuation && isLeadListContinuation(lower)) {
    actionName = 'lead.list';
    args = { limit: continuation.limit, cursor: continuation.cursor };
  } else if (lower.includes('dashboard') || lower.includes('metrics')) {
    actionName = 'report.dashboard';
  } else if (lower.includes('campaign')) {
    actionName = 'campaign.list';
  } else if (lower.includes('lead')) {
    actionName = 'lead.list';
    const requestedLimit = requestedLeadLimit(lower);
    const isCountOnly = /\b(how many|count|total)\b/.test(lower) && !/\b(list|show|give|get)\b/.test(lower);
    args = isCountOnly
      ? { limit: requestedLimit }
      : { limit: requestedLimit, search: leadSearchFromMessage(message) };
  }

  if (!actionName) {
    return {
      conversationId,
      reply: 'Copilot AI is unavailable. I can still help with simple lead, campaign, or dashboard requests.',
    };
  }

  const actionResult = await proposeAgentAction({
    source: 'chat',
    actionName,
    args,
    actor,
    sourceMessage: message,
  });
  return {
    conversationId,
    reply: replyForAction(actionName, actionResult.policy.outcome, actionResult.result),
    action: {
      name: actionName,
      policy: actionResult.policy,
      agentAction: actionResult.action,
      result: actionResult.result,
    },
  };
}

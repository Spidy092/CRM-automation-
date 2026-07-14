import OpenAI from 'openai';
import { redis } from '../../shared/utils/redis';
import { logger } from '../../shared/utils/logger';
import { getAiConfig } from '../ai-settings/ai-settings.service';
import { proposeAgentAction } from '../agent/agent.service';
import type { AgentActionName, AgentActor } from '../agent/agent.types';
import type { AuthenticatedUser } from '../../shared/types';
import { createPlanFromGoal, getPlanForPreview } from '../agent-planner/planner.service';
import { PlannerError } from '../agent-planner/errors';
import { isAgentPlannerEnabled } from './featureFlag';
import { summarizeReadResult } from './chat.summarize';
import { buildChatSystemPrompt } from './chat.prompt';
import { buildChatTools, toolNameToActionName } from './chat.actions';
import type { ChatPageContext, ChatResponse, ChatTurn } from './chat.types';

const CHAT_HISTORY_TTL_SECONDS = 60 * 60 * 2;
const CHAT_HISTORY_LIMIT = 20;
const MAX_TOOL_ROUNDS = 4;
const CHAT_MAX_TOKENS = 700;
const TOOL_RESULT_CHAR_LIMIT = 4000;
const PLAN_MARKER_PATTERN = /^plan:[0-9a-f-]{36}:/;

interface SendChatMessageInput {
  conversationId: string;
  message: string;
  actor: AgentActor;
  user: AuthenticatedUser;
  pageContext?: ChatPageContext;
}

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
    .setex(
      historyKey(conversationId),
      CHAT_HISTORY_TTL_SECONDS,
      JSON.stringify(turns.slice(-CHAT_HISTORY_LIMIT)),
    )
    .catch(() => null);
}

export async function getChatHistory(conversationId: string): Promise<ChatTurn[]> {
  const turns = await loadHistory(conversationId);
  // The plan:<id>: prefix is an internal marker for continuation lookups — never show it.
  return turns.map((turn) =>
    turn.role === 'assistant'
      ? { ...turn, content: turn.content.replace(PLAN_MARKER_PATTERN, '') }
      : turn,
  );
}

function isGreeting(message: string): boolean {
  const trimmed = message
    .trim()
    .toLowerCase()
    .replace(/[\s!,.?]+$/, '');
  return /^(hi|hello|hey|yo|howdy|good (morning|afternoon|evening)|thanks|thank you)$/.test(
    trimmed,
  );
}

function isPlanContinuation(message: string): boolean {
  // Only a standalone continuation phrase counts — a longer message that merely
  // contains "more" or "next" is a new request, not a continuation.
  const trimmed = message
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/, '');
  return [
    'next',
    'continue',
    'more',
    'show more',
    'next page',
    'yes do it',
    'yes, do it',
    'approve that',
    'do it',
    'go ahead',
  ].includes(trimmed);
}

export async function sendChatMessage(input: SendChatMessageInput): Promise<ChatResponse> {
  const history = await loadHistory(input.conversationId);

  // 0. Greeting / small talk — reply conversationally, never run an action
  if (isGreeting(input.message)) {
    const reply = [
      'Hi! I am your CRM copilot.',
      'Ask me about leads, campaigns, templates, pipelines, scrapers, or dashboard metrics — or ask me to run an action and I will prepare it for your approval.',
    ].join('\n');
    await persistTurn(input.conversationId, history, input.message, reply);
    return { conversationId: input.conversationId, reply };
  }

  // 1. Plan continuation
  if (isPlanContinuation(input.message)) {
    const lastPlanId = extractLastPlanId(history);
    if (lastPlanId) {
      const preview = await getPlanForPreview(lastPlanId);
      if (preview) {
        const reply = `Continuing with plan ${lastPlanId}. Approve when ready.`;
        await persistTurn(input.conversationId, history, input.message, reply);
        return {
          conversationId: input.conversationId,
          reply,
          action: {
            name: 'plan.resume' as unknown as AgentActionName,
            policy: { outcome: 'execute_now', reason: 'continuation' },
          },
        };
      }
    }
  }

  // 2. Agent conversation — the LLM routes the request itself: it answers page
  // questions from context, calls read tools for data, proposes writes for
  // approval, and delegates multi-step goals to the planner.
  try {
    return await runAgentConversation(input, history);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('chat: agent conversation failed, falling back to planner', {
      error: msg,
      message: input.message,
    });
    return delegateToPlanner(input, history, input.message);
  }
}

function buildPlanCreateTool(): OpenAI.Chat.ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: 'plan__create',
      description:
        'Create a multi-step agent plan for goals that need several dependent actions chained together. The plan is shown to the user for approval before it runs.',
      parameters: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: 'The multi-step goal in one sentence' },
        },
        required: ['goal'],
      },
    },
  };
}

function historyAsMessages(history: ChatTurn[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  return history.slice(-10).map((turn) => ({
    role: turn.role,
    content: turn.content.replace(PLAN_MARKER_PATTERN, ''),
  }));
}

function truncateForModel(value: unknown): string {
  const json = JSON.stringify(value ?? null);
  return json.length > TOOL_RESULT_CHAR_LIMIT
    ? `${json.slice(0, TOOL_RESULT_CHAR_LIMIT)}…(truncated)`
    : json;
}

async function runAgentConversation(
  input: SendChatMessageInput,
  history: ChatTurn[],
): Promise<ChatResponse> {
  const aiConfig = await getAiConfig();
  const apiKey = aiConfig?.apiKey || process.env.OPENAI_API_KEY;
  if (!aiConfig || !apiKey) {
    throw new Error('AI settings not configured for chat');
  }

  const client = new OpenAI({ apiKey, baseURL: aiConfig.baseUrl || undefined });
  const tools = [...buildChatTools(), buildPlanCreateTool()];
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: buildChatSystemPrompt(
        input.user,
        new Date().toISOString().slice(0, 10),
        input.pageContext,
      ),
    },
    ...historyAsMessages(history),
    { role: 'user', content: input.message },
  ];

  let approvalAction: ChatResponse['action'];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const startedAt = Date.now();
    const completion = await client.chat.completions.create({
      model: aiConfig.model,
      temperature: aiConfig.temperature,
      max_tokens: CHAT_MAX_TOKENS,
      tools,
      messages,
    });
    logger.info('chat: OpenAI call', {
      model: aiConfig.model,
      round,
      latencyMs: Date.now() - startedAt,
      tokensUsed: completion.usage?.total_tokens ?? null,
    });

    const assistantMessage = completion.choices[0]?.message;
    if (!assistantMessage) break;

    const toolCalls = assistantMessage.tool_calls ?? [];
    if (toolCalls.length === 0) {
      const reply =
        assistantMessage.content?.trim() ||
        'I could not produce a reply for that. Please try rephrasing.';
      await persistTurn(input.conversationId, history, input.message, reply);
      return { conversationId: input.conversationId, reply, action: approvalAction };
    }

    messages.push(assistantMessage);
    for (const toolCall of toolCalls) {
      if (toolCall.type !== 'function') continue;

      if (toolCall.function.name === 'plan__create') {
        const goal = parseToolArgs(toolCall.function.arguments).goal;
        return delegateToPlanner(
          input,
          history,
          typeof goal === 'string' && goal.trim() ? goal.trim() : input.message,
        );
      }

      const outcome = await runAgentTool(toolCall.function, input);
      if (outcome.approval) approvalAction = outcome.approval;
      messages.push({ role: 'tool', tool_call_id: toolCall.id, content: outcome.content });
    }
  }

  const reply = approvalAction
    ? 'I prepared the requested action — use Approve or Reject below.'
    : 'I could not finish that within my step budget. Please try a more specific request.';
  await persistTurn(input.conversationId, history, input.message, reply);
  return { conversationId: input.conversationId, reply, action: approvalAction };
}

function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}') as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function runAgentTool(
  fn: { name: string; arguments: string },
  input: SendChatMessageInput,
): Promise<{ content: string; approval?: ChatResponse['action'] }> {
  const actionName = toolNameToActionName(fn.name);
  const args = parseToolArgs(fn.arguments);

  try {
    const result = await proposeAgentAction({
      source: 'chat',
      actionName,
      args,
      actor: input.actor,
      sourceMessage: input.message,
    });

    if (result.policy.outcome === 'execute_now') {
      return { content: truncateForModel(result.result) };
    }
    if (result.policy.outcome === 'require_approval') {
      const { findPendingItemForAgentAction } = await import('../ai-inbox/ai-inbox.service');
      const inboxItem = result.action
        ? await findPendingItemForAgentAction(result.action.id).catch(() => null)
        : null;
      return {
        content: JSON.stringify({
          status: 'approval_created',
          detail:
            'The action was created and needs user approval. Approve and Reject buttons are shown right below this chat message — tell the user to use them (do not send them to the AI Inbox).',
        }),
        approval: {
          name: actionName,
          policy: result.policy,
          agentAction: result.action,
          inboxItemId: inboxItem?.id ?? null,
        },
      };
    }
    return { content: JSON.stringify({ status: 'rejected', reason: result.policy.reason }) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('chat: agent tool failed', { actionName, error: msg });
    return { content: JSON.stringify({ error: msg }) };
  }
}

async function delegateToPlanner(
  input: SendChatMessageInput,
  history: ChatTurn[],
  goal: string,
): Promise<ChatResponse> {
  if (!isAgentPlannerEnabled()) {
    const reply = 'AI Copilot planner is currently disabled. Try a single-action request.';
    await persistTurn(input.conversationId, history, input.message, reply);
    return { conversationId: input.conversationId, reply };
  }

  let planResult: Awaited<ReturnType<typeof createPlanFromGoal>>;
  try {
    planResult = await createPlanFromGoal({
      goal,
      actor: input.actor,
      autonomyLevel: ((input.user as unknown as { autonomyLevel?: string }).autonomyLevel ??
        'supervised') as 'supervised' | 'guarded' | 'autopilot',
      source: 'chat',
      sourceMessage: input.message,
      conversationId: input.conversationId,
      pageContext: input.pageContext,
    });
  } catch (err) {
    if (err instanceof PlannerError && err.code === 'unsupported_goal') {
      const reply = `I can't do that yet — ${err.message}`;
      await persistTurn(input.conversationId, history, input.message, reply);
      return { conversationId: input.conversationId, reply };
    }
    const msg = err instanceof Error ? err.message : 'Unknown planner error';
    logger.warn('planner: failed to create plan', { error: msg, message: input.message });
    const reply = [
      'I could not turn that into a valid action plan.',
      'Try asking for one specific action, like:',
      '- "show my leads"',
      '- "list campaigns"',
      '- "show dashboard"',
      '- "run scraper"',
    ].join('\n');
    await persistTurn(input.conversationId, history, input.message, reply);
    return { conversationId: input.conversationId, reply };
  }

  // Check if all steps are read-only — if so, auto-execute without approval
  const allReads = planResult.steps.every((s) => s.risk_tier === 'read');
  if (allReads) {
    const { executePlan } = await import('../agent-planner/runner.service');
    await executePlan(planResult.plan.id, input.actor);

    // Fetch the step results to show actual data
    const { findPlanStepsByPlan } = await import('../agent-planner/plan.repository');
    const steps = await findPlanStepsByPlan(planResult.plan.id);
    const results = steps.filter((s) => s.result).map((s) => s.result);

    const resultSummary =
      results.length > 0 ? summarizeReadResult(results[0]) : 'No data returned.';

    const reply = `Done. ${resultSummary}`;
    await persistTurn(input.conversationId, history, input.message, reply);
    return { conversationId: input.conversationId, reply };
  }

  // Write actions require approval
  const reply = `I planned: "${planResult.plan.goal}". ${planResult.steps.length} steps. Approve to run.`;
  await persistTurn(
    input.conversationId,
    history,
    input.message,
    `plan:${planResult.plan.id}:${reply}`,
  );
  return {
    conversationId: input.conversationId,
    reply,
    action: {
      name: 'plan.create' as unknown as AgentActionName,
      policy: {
        outcome: 'require_approval',
        reason: 'plan requires approval',
        assignTo: input.actor.id,
      },
      result: { planId: planResult.plan.id, steps: planResult.steps },
    },
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

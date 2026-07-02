import { redis } from '../../shared/utils/redis';
import { getAgentActionDefinition } from '../agent/agent.actions';
import { proposeAgentAction } from '../agent/agent.service';
import type { AgentActionName, AgentActor } from '../agent/agent.types';
import type { AuthenticatedUser } from '../../shared/types';
import { createPlanFromGoal, getPlanForPreview } from '../agent-planner/planner.service';
import { isAgentPlannerEnabled } from './featureFlag';
import type { ChatPageContext, ChatResponse, ChatTurn } from './chat.types';

const CHAT_HISTORY_TTL_SECONDS = 60 * 60 * 2;
const CHAT_HISTORY_LIMIT = 20;

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
  return loadHistory(conversationId);
}

function isPageAwarenessQuestion(message: string): boolean {
  const lower = message.toLowerCase();
  return /\b(where am i|what page|which page|current screen|this screen|this page|what can you do|what can i do|help here|on this page|on this screen|available actions|what actions)\b/.test(
    lower,
  );
}

function isPlanContinuation(message: string): boolean {
  const lower = message.toLowerCase();
  return /\b(next|continue|more|show more|next page|yes do it|approve that|do it)\b/.test(lower);
}

// eslint-disable-next-line @typescript-eslint/require-await
async function answerPageAwareness(input: {
  message: string;
  conversationId: string;
  pageContext?: ChatPageContext;
}): Promise<ChatResponse> {
  if (!input.pageContext) {
    return {
      conversationId: input.conversationId,
      reply: 'I can see what page you are on if you give me page context.',
    };
  }
  const title = input.pageContext.pageTitle ?? input.pageContext.route;
  const capabilities = input.pageContext.pageCapabilities ?? [];
  const records = input.pageContext.visibleRecords ?? [];
  const parts = [`You are on ${title}.`];
  if (capabilities.length > 0)
    parts.push(`I can help here with: ${capabilities.slice(0, 5).join('; ')}.`);
  if (records.length > 0) {
    const names = records
      .slice(0, 5)
      .map((r) => r.name)
      .join(', ');
    parts.push(`I can see ${records.length} records, including ${names}.`);
  }
  return { conversationId: input.conversationId, reply: parts.join(' ') };
}

async function handleTrivialLookup(input: {
  message: string;
  conversationId: string;
  actor: AgentActor;
}): Promise<ChatResponse | null> {
  const lower = input.message.toLowerCase();
  let actionName: AgentActionName | null = null;
  if (/dashboard/.test(lower)) actionName = 'report.dashboard';
  else if (/campaign/.test(lower)) actionName = 'campaign.list';

  if (!actionName) return null;

  const result = await proposeAgentAction({
    source: 'chat',
    actionName,
    args: {},
    actor: input.actor,
    sourceMessage: input.message,
    forceApproval: getAgentActionDefinition(actionName).riskTier !== 'read',
  });

  return {
    conversationId: input.conversationId,
    reply:
      result.policy.outcome === 'require_approval'
        ? `I prepared ${actionName} for approval.`
        : `Done. Result: ${JSON.stringify(result.result)}`,
  };
}

export async function sendChatMessage(input: {
  conversationId: string;
  message: string;
  actor: AgentActor;
  user: AuthenticatedUser;
  pageContext?: ChatPageContext;
}): Promise<ChatResponse> {
  const history = await loadHistory(input.conversationId);

  // 1. Page-awareness fast path
  if (isPageAwarenessQuestion(input.message)) {
    const result = await answerPageAwareness(input);
    await persistTurn(input.conversationId, history, input.message, result.reply);
    return result;
  }

  // 2. Plan continuation
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

  // 3. Trivial lookup
  const trivial = await handleTrivialLookup({
    message: input.message,
    conversationId: input.conversationId,
    actor: input.actor,
  });
  if (trivial) {
    await persistTurn(input.conversationId, history, input.message, trivial.reply);
    return trivial;
  }

  // 4. Delegate to planner (only if feature flag is enabled)
  if (!isAgentPlannerEnabled()) {
    const reply = 'AI Copilot planner is currently disabled. Try a single-action request.';
    await persistTurn(input.conversationId, history, input.message, reply);
    return { conversationId: input.conversationId, reply };
  }

  let planResult: Awaited<ReturnType<typeof createPlanFromGoal>>;
  try {
    planResult = await createPlanFromGoal({
      goal: input.message,
      actor: input.actor,
      autonomyLevel: ((input.user as unknown as { autonomyLevel?: string }).autonomyLevel ??
        'supervised') as 'supervised' | 'guarded' | 'autopilot',
      source: 'chat',
      sourceMessage: input.message,
      conversationId: input.conversationId,
      pageContext: input.pageContext,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown planner error';
    const reply = `Planner error: ${msg}`;
    await persistTurn(input.conversationId, history, input.message, reply);
    return { conversationId: input.conversationId, reply };
  }

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

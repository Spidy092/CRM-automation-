import OpenAI from 'openai';
import { logger } from '../../shared/utils/logger';
import { getAiConfig } from '../ai-settings/ai-settings.service';
import { insertDecisionLog } from '../ai-intelligence/ai-intelligence.repository';
import { logDecisionLogFailure } from '../ai-intelligence/ai-intelligence.service';
import { AgentActor } from '../agent/agent.types';
import {
  createPlan,
  createPlanStep,
  findPlanById,
  findPlanByIdempotencyKey,
  findPlanStepsByPlan,
} from './plan.repository';
import { planSchema } from './plan.schema';
import { PlannerError } from './errors';
import { buildPlanIdempotencyKey } from './idempotency';
import { buildPlannerSystemPrompt, planJsonSchema } from './planner.prompt';
import { incPlanCreated, incPlanError } from './metrics';
import { COST_BY_RISK_TIER } from './plan.types';
import type { AutonomyLevel, PlanRow, PlanSource, PlanStepRow } from './plan.types';

export async function createPlanFromGoal(input: {
  goal: string;
  actor: AgentActor | null;
  autonomyLevel: AutonomyLevel;
  source: PlanSource;
  sourceMessage?: string | null;
  conversationId?: string | null;
  pageContext?: unknown;
}): Promise<{ plan: PlanRow; steps: PlanStepRow[] }> {
  let idempotencyKey = buildPlanIdempotencyKey({
    source: input.source,
    actorId: input.actor?.id,
    goal: input.goal,
    sourceMessage: input.sourceMessage ?? null,
  });

  const existing = await findPlanByIdempotencyKey(idempotencyKey);
  if (existing) {
    if (existing.status !== 'failed' && existing.status !== 'cancelled') {
      const steps = await findPlanStepsByPlan(existing.id);
      return { plan: existing, steps };
    }
    // A dead plan must not satisfy idempotency — the user retrying the same
    // goal gets a fresh plan. Suffix the key so the unique constraint holds.
    idempotencyKey = `${idempotencyKey}:retry:${Date.now()}`;
  }

  const aiConfig = await getAiConfig();
  if (!aiConfig) {
    throw new PlannerError('planner_malformed', 'AI settings not configured');
  }

  const client = new OpenAI({
    apiKey: aiConfig.apiKey || process.env.OPENAI_API_KEY,
    baseURL: aiConfig.baseUrl || undefined,
  });

  const systemPrompt = buildPlannerSystemPrompt({
    actor: input.actor ?? { id: 'system', role: 'admin', ipAddress: null },
    autonomyLevel: input.autonomyLevel,
    today: new Date().toISOString().slice(0, 10),
  });

  let parsedJson: unknown = null;
  let lastParseError: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      logger.info('planner: calling OpenAI', { model: aiConfig.model, maxTokens: 16_000, attempt });
      const completion = await client.chat.completions.create({
        model: aiConfig.model,
        max_tokens: 16_000,
        temperature: aiConfig.temperature,
        response_format: planJsonSchema,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: JSON.stringify({ goal: input.goal, pageContext: input.pageContext ?? null }),
          },
        ],
      });
      const rawContent = completion.choices[0]?.message?.content ?? null;
      logger.info('planner: OpenAI response', {
        hasContent: Boolean(rawContent),
        contentLength: rawContent?.length ?? 0,
        finishReason: completion.choices[0]?.finish_reason,
        usage: completion.usage,
      });
      if (!rawContent) {
        lastParseError = 'OpenAI returned empty content';
        continue;
      }

      try {
        parsedJson = JSON.parse(rawContent);
      } catch {
        lastParseError = `OpenAI returned malformed JSON: ${rawContent.slice(0, 200)}`;
        logger.warn('planner: JSON parse failed', { rawContent: rawContent.slice(0, 500) });
        continue;
      }

      break;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error('planner: OpenAI call failed', {
        attempt,
        error: errMsg,
        stack: (err as Error).stack,
      });
      lastParseError = `OpenAI call failed: ${errMsg}`;
      if (attempt === 1) {
        incPlanError({ code: 'planner_malformed' });
        throw new PlannerError('planner_malformed', `OpenAI call failed after retry: ${errMsg}`);
      }
    }
  }

  if (!parsedJson) {
    incPlanError({ code: 'planner_malformed' });
    throw new PlannerError('planner_malformed', lastParseError ?? 'OpenAI returned malformed JSON');
  }

  // The planner may decline goals that no catalog action can accomplish.
  const draft = parsedJson as { steps?: unknown; unsupported_reason?: unknown };
  if (Array.isArray(draft.steps) && draft.steps.length === 0) {
    const reason =
      typeof draft.unsupported_reason === 'string' && draft.unsupported_reason.trim()
        ? draft.unsupported_reason.trim()
        : 'This goal is not supported by the available agent actions.';
    incPlanError({ code: 'unsupported_goal' });
    logger.info('planner: goal declined as unsupported', { goal: input.goal, reason });
    throw new PlannerError('unsupported_goal', reason, parsedJson);
  }

  const validated = planSchema.safeParse(parsedJson);
  if (!validated.success) {
    incPlanError({ code: 'invalid_plan' });
    await insertDecisionLog({
      lead_id: null,
      campaign_id: null,
      decision_type: 'agent_action',
      input_context: {
        goal: input.goal,
        source: input.source,
        actorRole: input.actor?.role ?? null,
      },
      chain_of_thought: validated.error.message,
      decision: 'invalid_plan',
      model_used: aiConfig.model,
      human_approval_required: false,
    }).catch((err) =>
      logDecisionLogFailure({
        decisionType: 'agent_action',
        phase: 'failure',
        err,
      }),
    );
    throw new PlannerError('invalid_plan', validated.error.message, parsedJson);
  }

  const plan = await createPlan({
    conversationId: input.conversationId ?? null,
    goal: validated.data.goal,
    autonomyLevel: input.autonomyLevel,
    confidence: null,
    source: input.source,
    requestedBy: input.actor?.id ?? null,
    sourceMessage: input.sourceMessage ?? null,
    steps: validated.data.steps,
    idempotencyKey,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  });

  const steps: PlanStepRow[] = [];
  for (const s of validated.data.steps) {
    const row = await createPlanStep({
      planId: plan.id,
      stepIndex: s.step_index,
      actionName: s.action_name,
      actionArgs: s.action_args,
      riskTier: s.risk_tier,
      dependsOn: s.depends_on,
      rationale: s.rationale,
    });
    steps.push(row);
  }

  incPlanCreated({ source: input.source, autonomyLevel: input.autonomyLevel });

  await insertDecisionLog({
    lead_id: null,
    campaign_id: null,
    decision_type: 'agent_action',
    input_context: {
      planId: plan.id,
      goal: plan.goal,
      source: input.source,
      actorRole: input.actor?.role ?? null,
      stepCount: steps.length,
    },
    chain_of_thought: validated.data.steps
      .map((s) => `[${s.step_index}] ${s.action_name}: ${s.rationale}`)
      .join('\n'),
    decision: 'proposed',
    model_used: aiConfig.model,
    human_approval_required: false,
  }).catch((err) =>
    logDecisionLogFailure({
      decisionType: 'agent_action',
      phase: 'success',
      err,
    }),
  );

  return { plan, steps };
}

export async function getPlanForPreview(planId: string): Promise<{
  plan: PlanRow;
  steps: PlanStepRow[];
  estimatedCostCents: number;
  requiresApproval: boolean;
} | null> {
  const plan = await findPlanById(planId);
  if (!plan) return null;
  const steps = await findPlanStepsByPlan(plan.id);
  const estimatedCostCents = steps.reduce(
    (sum, s) => sum + (COST_BY_RISK_TIER[s.risk_tier] ?? 0),
    0,
  );
  const hasRiskyStep = steps.some(
    (s) => s.risk_tier === 'sensitive_write' || s.risk_tier === 'customer_facing_write',
  );
  const requiresApproval = plan.autonomy_level === 'supervised' || hasRiskyStep;
  return { plan, steps, estimatedCostCents, requiresApproval };
}

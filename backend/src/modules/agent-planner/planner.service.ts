import OpenAI from 'openai';
import { logger } from '../../shared/utils/logger';
import { getAiConfig } from '../ai-settings/ai-settings.service';
import { insertDecisionLog } from '../ai-intelligence/ai-intelligence.repository';
import { AgentActor } from '../agent/agent.types';
import { createPlan, createPlanStep, findPlanByIdempotencyKey, findPlanStepsByPlan } from './plan.repository';
import { planSchema } from './plan.schema';
import { PlannerError } from './errors';
import { buildPlanIdempotencyKey } from './idempotency';
import { buildPlannerSystemPrompt, planJsonSchema } from './planner.prompt';
import { incPlanCreated, incPlanError } from './metrics';
import type { AutonomyLevel, PlanRow, PlanSource, PlanStep, PlanStepRow } from './plan.types';

export async function createPlanFromGoal(input: {
  goal: string;
  actor: AgentActor | null;
  autonomyLevel: AutonomyLevel;
  source: PlanSource;
  sourceMessage?: string | null;
  conversationId?: string | null;
  pageContext?: unknown;
}): Promise<{ plan: PlanRow; steps: PlanStepRow[] }> {
  const idempotencyKey = buildPlanIdempotencyKey({
    source: input.source,
    actorId: input.actor?.id,
    goal: input.goal,
    sourceMessage: input.sourceMessage ?? null,
  });

  const existing = await findPlanByIdempotencyKey(idempotencyKey);
  if (existing) {
    const steps = await findPlanStepsByPlan(existing.id);
    return { plan: existing, steps };
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

  let parsedJson: unknown | null = null;
  let lastParseError: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model: aiConfig.model,
        max_tokens: aiConfig.maxTokens,
        temperature: aiConfig.temperature,
        response_format: planJsonSchema as any,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: JSON.stringify({ goal: input.goal, pageContext: input.pageContext ?? null }),
          },
        ],
      });
      const rawContent = completion.choices[0]?.message?.content ?? null;
      if (!rawContent) {
        lastParseError = 'OpenAI returned empty content';
        continue;
      }

      try {
        parsedJson = JSON.parse(rawContent);
      } catch {
        lastParseError = 'OpenAI returned malformed JSON';
        continue;
      }

      break;
    } catch (err) {
      logger.error('planner: OpenAI call failed', { attempt, error: (err as Error).message });
      lastParseError = 'OpenAI call failed';
      if (attempt === 1) {
        incPlanError({ code: 'planner_malformed' });
        throw new PlannerError('planner_malformed', 'OpenAI call failed after retry');
      }
    }
  }

  if (!parsedJson) {
    incPlanError({ code: 'planner_malformed' });
    throw new PlannerError('planner_malformed', lastParseError ?? 'OpenAI returned malformed JSON');
  }

  const validated = planSchema.safeParse(parsedJson);
  if (!validated.success) {
    incPlanError({ code: 'invalid_plan' });
    await insertDecisionLog({
      lead_id: null,
      campaign_id: null,
      decision_type: 'agent_action',
      input_context: { goal: input.goal, source: input.source, actorRole: input.actor?.role ?? null },
      chain_of_thought: validated.error.message,
      decision: 'invalid_plan',
      model_used: aiConfig.model,
      human_approval_required: false,
    }).catch(() => null);
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
    steps: validated.data.steps as PlanStep[],
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
    chain_of_thought: validated.data.steps.map((s) => `[${s.step_index}] ${s.action_name}: ${s.rationale}`).join('\n'),
    decision: 'proposed',
    model_used: aiConfig.model,
    human_approval_required: false,
  }).catch(() => null);

  return { plan, steps };
}

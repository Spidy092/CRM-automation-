import { z } from 'zod';
import { agentActionNameSchema } from '../agent/agent.schema';
import { getAgentActionDefinition } from '../agent/agent.actions';
import type { AgentRiskTier } from '../agent/agent.types';

// The `agent/` module exposes `AgentRiskTier` as a TS union in `agent.types.ts`
// but does not export a Zod schema for it. We define one locally so plan steps
// can be validated at parse time without modifying the agent module.
const RISK_TIER_VALUES = [
  'read',
  'low_risk_write',
  'customer_facing_write',
  'sensitive_write',
  'compliance_critical',
  'unsupported',
] as const satisfies readonly AgentRiskTier[];

export const agentRiskTierSchema = z.enum(RISK_TIER_VALUES);

export const planStepSchema = z.object({
  step_index: z.number().int().min(0).max(50),
  action_name: agentActionNameSchema,
  action_args: z.record(z.unknown()),
  risk_tier: agentRiskTierSchema,
  depends_on: z.array(z.number().int().min(0)).default([]),
  rationale: z.string().min(1).max(500),
});

export const planSchema = z.object({
  goal: z.string().min(1).max(2000),
  steps: z.array(planStepSchema).min(1).max(8),
}).superRefine((plan, ctx) => {
  const indexes = plan.steps.map((s) => s.step_index).sort((a, b) => a - b);
  for (let i = 0; i < indexes.length; i++) {
    if (indexes[i] !== i) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `step_indexes must be contiguous starting at 0; got ${indexes.join(',')}`,
      });
      return;
    }
  }

  for (const step of plan.steps) {
    for (const dep of step.depends_on) {
      if (dep < 0 || dep >= plan.steps.length || dep === step.step_index) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `step ${step.step_index} has invalid depends_on=${dep}`,
        });
        return;
      }
    }
  }

  const indegree = new Array(plan.steps.length).fill(0);
  const adj: number[][] = plan.steps.map(() => []);
  for (const step of plan.steps) {
    for (const dep of step.depends_on) {
      adj[dep].push(step.step_index);
      indegree[step.step_index]++;
    }
  }
  const queue: number[] = [];
  for (let i = 0; i < indegree.length; i++) if (indegree[i] === 0) queue.push(i);
  let visited = 0;
  while (queue.length) {
    const n = queue.shift()!;
    visited++;
    for (const m of adj[n]) {
      if (--indegree[m] === 0) queue.push(m);
    }
  }
  if (visited !== plan.steps.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `plan contains a cycle`,
    });
    return;
  }

  for (const step of plan.steps) {
    const definition = getAgentActionDefinition(step.action_name);

    if (definition.riskTier === 'compliance_critical') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `step ${step.step_index}: compliance_critical actions (${step.action_name}) are forbidden in plans`,
      });
      return;
    }

    if (step.risk_tier !== definition.riskTier) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `step ${step.step_index}: risk_tier ${step.risk_tier} does not match action definition ${definition.riskTier}`,
      });
      return;
    }

    const parsed = (definition.schema as unknown as z.ZodTypeAny).safeParse(step.action_args);
    if (!parsed.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `step ${step.step_index}: action_args failed schema validation: ${parsed.error.message}`,
      });
      return;
    }
  }
});

import type { AgentActor } from '../agent/agent.types';
import { AGENT_ACTIONS } from '../agent/agent.actions';
import { planSchema } from './plan.schema';
import type { AutonomyLevel } from './plan.types';
import { zodToJsonSchema } from 'zod-to-json-schema';

export function listActionsForPrompt(): string {
  return Object.values(AGENT_ACTIONS)
    .map((d) => `- ${d.name} [${d.riskTier}] (roles: ${d.allowedRoles.join('|')}): ${d.description}`)
    .join('\n');
}


export function buildPlannerSystemPrompt(ctx: {
  actor: AgentActor;
  autonomyLevel: AutonomyLevel;
  today: string;
}): string {
  return `
You are a CRM planning agent. Convert the user's goal into a typed plan of agent actions.

Available actions (use ONLY these — never invent API routes or table names):
${listActionsForPrompt()}

Current context:
- Actor role: ${ctx.actor.role}
- Autonomy level: ${ctx.autonomyLevel}
- Date: ${ctx.today}
- Step cap: 8 steps max. Cost cap: ~$0.50. Wall-clock cap: 5 min.

Rules:
1. Every step must have a one-sentence rationale explaining WHY this step is needed.
2. Never put a destructive write in the middle of a chain — put all reads first, then low-risk writes,
   then sensitive/customer-facing writes last (so the user can stop the plan after any step).
3. If a step's output feeds into a later step's args, declare depends_on explicitly.
4. If you cannot accomplish the goal safely within the step cap, return FEWER steps and explain in the goal
   field what was not achievable — do not silently drop steps.
5. Never claim an action will succeed; the runner reports actual results.
6. NEVER include compliance_critical actions (ai.inbox.action) in plans; these require direct API calls.
  `.trim();
}

export const planJsonSchema = {
  type: 'json_schema' as const,
  strict: true,
  name: 'agent_plan',
  schema: zodToJsonSchema(planSchema, { target: 'openApi3' }),
};

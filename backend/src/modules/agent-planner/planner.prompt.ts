import type { AgentActor } from '../agent/agent.types';
import { AGENT_ACTIONS } from '../agent/agent.actions';
import { actionParameters } from '../chat/chat.actions';
import type { AutonomyLevel } from './plan.types';

export function listActionsForPrompt(): string {
  return Object.values(AGENT_ACTIONS)
    .map(
      (d) =>
        `- ${d.name} [${d.riskTier}] (roles: ${d.allowedRoles.join('|')}): ${d.description}\n  args schema: ${JSON.stringify(actionParameters[d.name])}`,
    )
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
1. If the goal can be accomplished with the available actions, return at least 1 step. If the goal
   requires an action that is NOT in the catalog (for example deleting records, sending bulk email
   outside a campaign, changing settings), do NOT substitute an unrelated action — instead return
   {"goal": "<the goal>", "steps": [], "unsupported_reason": "one sentence: what you cannot do and the closest supported alternative"}.
   Only for genuinely vague requests ("how are things going") pick the most relevant read action.
2. Every step must have a one-sentence rationale explaining WHY this step is needed.
3. Never put a destructive write in the middle of a chain — put all reads first, then low-risk writes,
   then sensitive/customer-facing writes last (so the user can stop the plan after any step).
4. If a step's output feeds into a later step's args, declare depends_on explicitly.
5. If you cannot accomplish the goal safely within the step cap, return FEWER steps and explain in the goal
   field what was not achievable — do not silently drop steps.
6. Never claim an action will succeed; the runner reports actual results.
7. NEVER include compliance_critical actions (ai.inbox.action) in plans; these require direct API calls.
8. Step-output references: when a later step needs a value produced by an earlier step (an id you
   cannot know yet), use the string "$steps.<index>.<path>" as the arg value and declare that index
   in depends_on. Use ".*." to map over arrays. Examples:
   - "$steps.0.id" → the id of the record created in step 0
   - "$steps.1.items.*.id" → the array of ids from step 1's lead.list result
   Never invent UUIDs. Every id must either come from the user's message, pageContext, a read action
   earlier in the plan, or a $steps reference.

Common request mappings:
- "show/list leads" or "what leads do I have" → lead.list
- "show dashboard" or "how are things going" → report.dashboard
- "show campaigns" or "list campaigns" → campaign.list
- "run scraper" or "scrape leads" → scraper.run
- "move lead X to stage Y" → pipeline.move_lead
- "pause lead X" → lead.pause

Example — "find SaaS leads and start an email campaign" (chained creates using $steps refs):
{
  "goal": "Find SaaS leads and start an email campaign",
  "steps": [
    {"step_index": 0, "action_name": "lead.list", "action_args": {"limit": 50, "industry": "SaaS"}, "risk_tier": "read", "depends_on": [], "rationale": "Find the target leads."},
    {"step_index": 1, "action_name": "template.create", "action_args": {"name": "SaaS intro email", "channel": "email", "subject": "Quick question", "body": "Hi {{contact_name}}, ..."}, "risk_tier": "sensitive_write", "depends_on": [], "rationale": "An email template is needed for the sequence."},
    {"step_index": 2, "action_name": "sequence.create", "action_args": {"name": "SaaS outreach", "steps": [{"stepNumber": 1, "channel": "email", "delayHours": 0, "templateId": "$steps.1.id"}]}, "risk_tier": "sensitive_write", "depends_on": [1], "rationale": "The campaign needs a sequence referencing the new template."},
    {"step_index": 3, "action_name": "campaign.create", "action_args": {"name": "SaaS email campaign", "target_industries": ["SaaS"], "sequence_id": "$steps.2.id"}, "risk_tier": "sensitive_write", "depends_on": [2], "rationale": "Create the campaign in draft with the new sequence."},
    {"step_index": 4, "action_name": "campaign.add_leads", "action_args": {"id": "$steps.3.id", "lead_ids": "$steps.0.items.*.id"}, "risk_tier": "sensitive_write", "depends_on": [0, 3], "rationale": "Enroll the found leads in the campaign."},
    {"step_index": 5, "action_name": "campaign.launch", "action_args": {"id": "$steps.3.id"}, "risk_tier": "customer_facing_write", "depends_on": [3, 4], "rationale": "Start outreach once leads are enrolled."}
  ]
}

You MUST respond with valid JSON in this exact format:
{
  "goal": "string - the goal being achieved",
  "steps": [
    {
      "step_index": 0,
      "action_name": "one of the available action names",
      "action_args": {},
      "risk_tier": "read|low_risk_write|sensitive_write|customer_facing_write",
      "depends_on": [],
      "rationale": "one sentence explaining why this step is needed"
    }
  ]
}
  `.trim();
}

export const planJsonSchema = {
  type: 'json_object' as const,
};

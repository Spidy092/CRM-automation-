import type { z } from 'zod';
import { AppError } from '../../shared/middleware/errorHandler';
import { enqueueAiDecision } from '../../workers/queue';
import { listLeads, getLeadById, createLead, updateLeadFields, setLeadPaused } from '../leads/leads.service';
import { moveLead } from '../pipeline/pipeline.service';
import {
  getAllCampaigns,
  pauseCampaignById,
  resumeCampaignById,
  launchCampaignById,
  getStats,
} from '../campaigns/campaigns.service';
import { overrideAssignment } from '../assignments/assignments.service';
import { getDashboardMetrics } from '../reports/reports.service';
import { runScrape } from '../scraper/scraper.service';
import { sendManualOutreach } from '../outreach/outreach.service';
import type { AgentActionDefinition, AgentActionName, AgentActor } from './agent.types';
import {
  aiDecisionRecomputeArgsSchema,
  aiInboxActionArgsSchema,
  assignmentOverrideArgsSchema,
  campaignIdArgsSchema,
  emptyArgsSchema,
  leadCreateArgsSchema,
  leadGetArgsSchema,
  leadListArgsSchema,
  leadPauseArgsSchema,
  leadUpdateArgsSchema,
  moveLeadArgsSchema,
  outreachSendManualArgsSchema,
  scraperRunArgsSchema,
} from './agent.schema';

function requireActor(actor: AgentActor | null): AgentActor {
  if (!actor) throw new AppError('Agent action requires an authenticated actor', 401);
  return actor;
}

export const AGENT_ACTIONS: Record<AgentActionName, AgentActionDefinition> = {
  'lead.list': {
    name: 'lead.list',
    description: 'List leads with filters.',
    riskTier: 'read',
    allowedRoles: ['admin', 'manager', 'sales', 'marketing', 'viewer'],
    schema: leadListArgsSchema as AgentActionDefinition['schema'],
    entity: () => ({}),
    execute: async (args, actor) => listLeads(args as z.infer<typeof leadListArgsSchema>, requireActor(actor)),
  },
  'lead.get': {
    name: 'lead.get',
    description: 'Get one lead by id.',
    riskTier: 'read',
    allowedRoles: ['admin', 'manager', 'sales', 'marketing', 'viewer'],
    schema: leadGetArgsSchema as AgentActionDefinition['schema'],
    entity: (args) => ({ leadId: args.id as string }),
    execute: async (args, actor) => getLeadById(args.id as string, requireActor(actor)),
  },
  'lead.create': {
    name: 'lead.create',
    description: 'Create a lead.',
    riskTier: 'sensitive_write',
    allowedRoles: ['admin', 'manager', 'sales', 'marketing'],
    schema: leadCreateArgsSchema as AgentActionDefinition['schema'],
    entity: () => ({}),
    execute: async (args, actor) => createLead(args as z.infer<typeof leadCreateArgsSchema>, requireActor(actor)),
  },
  'lead.update': {
    name: 'lead.update',
    description: 'Update lead fields.',
    riskTier: 'sensitive_write',
    allowedRoles: ['admin', 'manager', 'sales'],
    schema: leadUpdateArgsSchema as AgentActionDefinition['schema'],
    entity: (args) => ({ leadId: args.id as string }),
    execute: async (args, actor) => {
      const parsed = args as z.infer<typeof leadUpdateArgsSchema>;
      return updateLeadFields(parsed.id, parsed.input, requireActor(actor));
    },
  },
  'lead.pause': {
    name: 'lead.pause',
    description: 'Pause or resume a lead.',
    riskTier: 'sensitive_write',
    allowedRoles: ['admin', 'manager', 'sales'],
    schema: leadPauseArgsSchema as AgentActionDefinition['schema'],
    entity: (args) => ({ leadId: args.id as string }),
    execute: async (args, actor) => {
      const parsed = args as z.infer<typeof leadPauseArgsSchema>;
      return setLeadPaused(parsed.id, parsed.paused, requireActor(actor));
    },
  },
  'pipeline.move_lead': {
    name: 'pipeline.move_lead',
    description: 'Move a lead to a pipeline stage.',
    riskTier: 'sensitive_write',
    allowedRoles: ['admin', 'manager', 'sales'],
    schema: moveLeadArgsSchema as AgentActionDefinition['schema'],
    entity: (args) => ({ leadId: args.leadId as string }),
    execute: async (args, actor) => {
      const parsed = args as z.infer<typeof moveLeadArgsSchema>;
      await moveLead(parsed.leadId, parsed.stageId, requireActor(actor));
      return { moved: true, leadId: parsed.leadId, stageId: parsed.stageId };
    },
  },
  'campaign.list': {
    name: 'campaign.list',
    description: 'List campaigns.',
    riskTier: 'read',
    allowedRoles: ['admin', 'manager', 'sales', 'marketing', 'viewer'],
    schema: emptyArgsSchema as AgentActionDefinition['schema'],
    entity: () => ({}),
    execute: async () => getAllCampaigns(),
  },
  'campaign.pause': {
    name: 'campaign.pause',
    description: 'Pause an active campaign.',
    riskTier: 'customer_facing_write',
    allowedRoles: ['admin', 'manager', 'marketing'],
    schema: campaignIdArgsSchema as AgentActionDefinition['schema'],
    entity: (args) => ({ campaignId: args.id as string }),
    execute: async (args, actor) => pauseCampaignById(args.id as string, requireActor(actor)),
  },
  'campaign.resume': {
    name: 'campaign.resume',
    description: 'Resume a paused campaign.',
    riskTier: 'customer_facing_write',
    allowedRoles: ['admin', 'manager', 'marketing'],
    schema: campaignIdArgsSchema as AgentActionDefinition['schema'],
    entity: (args) => ({ campaignId: args.id as string }),
    execute: async (args, actor) => resumeCampaignById(args.id as string, requireActor(actor)),
  },
  'campaign.launch': {
    name: 'campaign.launch',
    description: 'Launch a draft or paused campaign.',
    riskTier: 'customer_facing_write',
    allowedRoles: ['admin', 'manager', 'marketing'],
    schema: campaignIdArgsSchema as AgentActionDefinition['schema'],
    entity: (args) => ({ campaignId: args.id as string }),
    execute: async (args, actor) => launchCampaignById(args.id as string, requireActor(actor)),
  },
  'campaign.stats': {
    name: 'campaign.stats',
    description: 'Get campaign statistics.',
    riskTier: 'read',
    allowedRoles: ['admin', 'manager', 'sales', 'marketing', 'viewer'],
    schema: campaignIdArgsSchema as AgentActionDefinition['schema'],
    entity: (args) => ({ campaignId: args.id as string }),
    execute: async (args) => getStats(args.id as string),
  },
  'assignment.override': {
    name: 'assignment.override',
    description: 'Override lead assignment.',
    riskTier: 'sensitive_write',
    allowedRoles: ['admin', 'manager'],
    schema: assignmentOverrideArgsSchema as AgentActionDefinition['schema'],
    entity: (args) => ({ leadId: args.leadId as string }),
    execute: async (args, actor) => {
      const parsed = args as z.infer<typeof assignmentOverrideArgsSchema>;
      return overrideAssignment(parsed.leadId, parsed.newUserId, parsed.reason, requireActor(actor));
    },
  },
  'report.dashboard': {
    name: 'report.dashboard',
    description: 'Get dashboard metrics.',
    riskTier: 'read',
    allowedRoles: ['admin', 'manager', 'sales', 'marketing', 'viewer'],
    schema: emptyArgsSchema as AgentActionDefinition['schema'],
    entity: () => ({}),
    execute: async (_args, actor) => getDashboardMetrics(requireActor(actor)),
  },
  'scraper.run': {
    name: 'scraper.run',
    description: 'Run a scraper config.',
    riskTier: 'sensitive_write',
    allowedRoles: ['admin'],
    schema: scraperRunArgsSchema as AgentActionDefinition['schema'],
    entity: () => ({}),
    execute: async (args, actor) => runScrape(args.configId as string, requireActor(actor)),
  },
  'outreach.send_manual': {
    name: 'outreach.send_manual',
    description: 'Enqueue manual outreach to one lead.',
    riskTier: 'customer_facing_write',
    allowedRoles: ['admin', 'manager', 'sales', 'marketing'],
    schema: outreachSendManualArgsSchema as AgentActionDefinition['schema'],
    entity: (args) => ({ leadId: args.leadId as string, campaignId: args.campaignId as string }),
    execute: async (args, actor) => sendManualOutreach(args as z.infer<typeof outreachSendManualArgsSchema>, requireActor(actor)),
  },
  'ai.decision.recompute': {
    name: 'ai.decision.recompute',
    description: 'Recompute next best action for a lead.',
    riskTier: 'low_risk_write',
    allowedRoles: ['admin', 'manager', 'sales', 'marketing'],
    schema: aiDecisionRecomputeArgsSchema as AgentActionDefinition['schema'],
    entity: (args) => ({ leadId: args.leadId as string }),
    execute: async (args) => {
      const parsed = args as z.infer<typeof aiDecisionRecomputeArgsSchema>;
      await enqueueAiDecision({ leadId: parsed.leadId, force: parsed.force, context: parsed.context });
      return { enqueued: true, leadId: parsed.leadId };
    },
  },
  'ai.inbox.action': {
    name: 'ai.inbox.action',
    description: 'Approve, reject, or snooze a visible AI Inbox item.',
    riskTier: 'compliance_critical',
    allowedRoles: ['admin', 'manager', 'sales', 'marketing'],
    schema: aiInboxActionArgsSchema as AgentActionDefinition['schema'],
    entity: () => ({}),
    execute: async (args, actor) => {
      const parsed = args as z.infer<typeof aiInboxActionArgsSchema>;
      const { actionItem } = await import('../ai-inbox/ai-inbox.service');
      return actionItem(
        parsed.id,
        requireActor(actor),
        parsed.action,
        parsed.snoozed_until,
        parsed.idempotency_key,
      );
    },
  },
};

export function getAgentActionDefinition(name: AgentActionName): AgentActionDefinition {
  const definition = AGENT_ACTIONS[name];
  if (!definition) throw new AppError(`Unsupported agent action: ${name}`, 400);
  return definition;
}

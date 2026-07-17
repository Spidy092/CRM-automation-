import type { z } from 'zod';
import { AppError } from '../../shared/middleware/errorHandler';
import { enqueueAiDecision, enqueueAiCampaignBrief, enqueueAiResearch } from '../../workers/queue';
import {
  listLeads,
  getLeadById,
  createLead,
  updateLeadFields,
  setLeadPaused,
} from '../leads/leads.service';
import { moveLead } from '../pipeline/pipeline.service';
import {
  getAllCampaigns,
  createCampaign,
  addLeads,
  pauseCampaignById,
  resumeCampaignById,
  launchCampaignById,
  getStats,
} from '../campaigns/campaigns.service';
import { overrideAssignment, getEligibleUsers } from '../assignments/assignments.service';
import {
  getDashboardMetrics,
  getLeadGenerationReport,
  getOutreachReport,
  getPipelineReport,
  getSalesRepReport,
  getCampaignAnalyticsReport,
  getIntegrationHealthReport,
  enqueueExportJob,
} from '../reports/reports.service';
import { listConfigs, runScrape } from '../scraper/scraper.service';
import {
  listSequences,
  createSequence,
  sendManualOutreach,
  listTasks,
} from '../outreach/outreach.service';
import {
  listTemplates,
  createTemplate,
  getTemplate,
  approveTemplate,
} from '../templates/templates.service';
import { getAllPipelines, getPipelineById } from '../pipeline/pipeline.service';
import { listActivities, createManualActivity } from '../activities/activities.service';
import { getTeamMetrics } from '../team-metrics/teamMetrics.service';
import { triggerClassification, getReplyHistory } from '../ai-reply/ai-reply.service';
import {
  getCampaignBrief,
  approveCampaignBrief,
  rejectCampaignBrief,
} from '../ai-campaign-brain/ai-campaign-brain.service';
import { getAiProfile, getDecisions } from '../ai-intelligence/ai-intelligence.service';
import { getAiSettingsPublic } from '../ai-settings/ai-settings.service';
import { getAllRules, calculateLeadScore, recalculateAllScores } from '../scoring/scoring.service';
import { listIntegrations, testIntegration } from '../integrations/integrations.service';
import { listDefinitions, createDefinition } from '../custom-fields/customFields.service';
import { listUsers } from '../users/users.service';
import { listTemplateVariants, getTemplateABTestReport } from '../ab-testing/template-ab.service';
import { listForms, getFormAnalyticsById } from '../forms/forms.service';
import { listBookings, getAvailableSlots } from '../scheduling/scheduling.service';
import type { AgentActionDefinition, AgentActionName, AgentActor } from './agent.types';
import {
  aiDecisionRecomputeArgsSchema,
  aiInboxActionArgsSchema,
  assignmentOverrideArgsSchema,
  campaignAddLeadsArgsSchema,
  campaignCreateArgsSchema,
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
  sequenceCreateArgsSchema,
  sequenceListArgsSchema,
  templateCreateArgsSchema,
  templateListArgsSchema,
  activityListArgsSchema,
  activityLogArgsSchema,
  teamMetricsArgsSchema,
  aiReplyClassifyArgsSchema,
  aiReplyHistoryArgsSchema,
  campaignBriefGetArgsSchema,
  campaignBriefGenerateArgsSchema,
  campaignBriefApproveArgsSchema,
  leadAiProfileGetArgsSchema,
  leadResearchTriggerArgsSchema,
  aiDecisionLogListArgsSchema,
  leadRescoreArgsSchema,
  templateGetArgsSchema,
  templateApproveArgsSchema,
  reportGetArgsSchema,
  reportExportArgsSchema,
  integrationIdArgsSchema,
  customFieldListArgsSchema,
  customFieldCreateArgsSchema,
  abTestTemplateArgsSchema,
  formListArgsSchema,
  formAnalyticsArgsSchema,
  schedulingSlotsArgsSchema,
  outreachTasksListArgsSchema,
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
    execute: async (args, actor) =>
      listLeads(args as z.infer<typeof leadListArgsSchema>, requireActor(actor)),
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
    execute: async (args, actor) =>
      createLead(args as z.infer<typeof leadCreateArgsSchema>, requireActor(actor)),
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
      return overrideAssignment(
        parsed.leadId,
        parsed.newUserId,
        parsed.reason,
        requireActor(actor),
      );
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
  'template.list': {
    name: 'template.list',
    description: 'List message templates with optional channel/approval-status/search filters.',
    riskTier: 'read',
    allowedRoles: ['admin', 'manager', 'sales', 'marketing', 'viewer'],
    schema: templateListArgsSchema as AgentActionDefinition['schema'],
    entity: () => ({}),
    execute: async (args) => listTemplates(args as z.infer<typeof templateListArgsSchema>),
  },
  'template.create': {
    name: 'template.create',
    description:
      'Create a message template (starts in the pending approval-workflow state; a manager must approve it before it can be sent).',
    riskTier: 'sensitive_write',
    allowedRoles: ['admin', 'manager', 'marketing'],
    schema: templateCreateArgsSchema as AgentActionDefinition['schema'],
    entity: () => ({}),
    execute: async (args, actor) =>
      createTemplate(args as z.infer<typeof templateCreateArgsSchema>, requireActor(actor)),
  },
  'sequence.create': {
    name: 'sequence.create',
    description:
      'Create an outreach sequence with ordered steps (each step needs an existing approved templateId — use template.list first).',
    riskTier: 'sensitive_write',
    allowedRoles: ['admin', 'manager', 'marketing'],
    schema: sequenceCreateArgsSchema as AgentActionDefinition['schema'],
    entity: () => ({}),
    execute: async (args, actor) =>
      createSequence(args as z.infer<typeof sequenceCreateArgsSchema>, requireActor(actor)),
  },
  'campaign.create': {
    name: 'campaign.create',
    description:
      'Create a campaign in draft status (does not launch it; use campaign.launch separately). sequence_id/pipeline_id must reference existing records.',
    riskTier: 'sensitive_write',
    allowedRoles: ['admin', 'manager', 'marketing'],
    schema: campaignCreateArgsSchema as AgentActionDefinition['schema'],
    entity: () => ({}),
    execute: async (args, actor) =>
      createCampaign(args as z.infer<typeof campaignCreateArgsSchema>, requireActor(actor)),
  },
  'campaign.add_leads': {
    name: 'campaign.add_leads',
    description: 'Add existing leads (by UUID) to a campaign.',
    riskTier: 'sensitive_write',
    allowedRoles: ['admin', 'manager', 'marketing'],
    schema: campaignAddLeadsArgsSchema as AgentActionDefinition['schema'],
    entity: (args) => ({ campaignId: args.id as string }),
    execute: async (args, actor) => {
      const parsed = args as z.infer<typeof campaignAddLeadsArgsSchema>;
      return addLeads(parsed.id, parsed.lead_ids, requireActor(actor));
    },
  },
  'pipeline.list': {
    name: 'pipeline.list',
    description: 'List pipelines including the stages of the default pipeline.',
    riskTier: 'read',
    allowedRoles: ['admin', 'manager', 'sales', 'marketing', 'viewer'],
    schema: emptyArgsSchema as AgentActionDefinition['schema'],
    entity: () => ({}),
    execute: async () => {
      const pipelines = await getAllPipelines();
      const withStages = await Promise.all(pipelines.map((p) => getPipelineById(p.id)));
      return { items: withStages };
    },
  },
  'sequence.list': {
    name: 'sequence.list',
    description: 'List outreach sequences with their steps.',
    riskTier: 'read',
    allowedRoles: ['admin', 'manager', 'sales', 'marketing', 'viewer'],
    schema: sequenceListArgsSchema as AgentActionDefinition['schema'],
    entity: () => ({}),
    execute: async (args) => {
      const parsed = args as z.infer<typeof sequenceListArgsSchema>;
      return listSequences(parsed.limit, parsed.offset);
    },
  },
  'scraper.list': {
    name: 'scraper.list',
    description: 'List scraper source configs (id, name, source type, active flag, last run).',
    riskTier: 'read',
    allowedRoles: ['admin', 'manager', 'sales', 'marketing', 'viewer'],
    schema: emptyArgsSchema as AgentActionDefinition['schema'],
    entity: () => ({}),
    execute: async () => ({ items: await listConfigs() }),
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
    execute: async (args, actor) =>
      sendManualOutreach(args as z.infer<typeof outreachSendManualArgsSchema>, requireActor(actor)),
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
      await enqueueAiDecision({
        leadId: parsed.leadId,
        force: parsed.force,
        context: parsed.context,
      });
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
  'activity.list': {
    name: 'activity.list',
    description: 'List the activity timeline entries for a lead.',
    riskTier: 'read',
    allowedRoles: ['admin', 'manager', 'sales', 'viewer'],
    schema: activityListArgsSchema as AgentActionDefinition['schema'],
    entity: (args) => ({ leadId: args.leadId as string }),
    execute: async (args, actor) => {
      const parsed = args as z.infer<typeof activityListArgsSchema>;
      return listActivities(parsed.leadId, requireActor(actor), {
        limit: parsed.limit,
        offset: parsed.offset,
        type: parsed.type,
      });
    },
  },
  'activity.log': {
    name: 'activity.log',
    description: 'Log a manual activity (call, whatsapp, email, or note) on a lead.',
    riskTier: 'low_risk_write',
    allowedRoles: ['admin', 'manager', 'sales'],
    schema: activityLogArgsSchema as AgentActionDefinition['schema'],
    entity: (args) => ({ leadId: args.leadId as string }),
    execute: async (args, actor) => {
      const parsed = args as z.infer<typeof activityLogArgsSchema>;
      const act = requireActor(actor);
      return createManualActivity(parsed.leadId, act.id, parsed.type, parsed.metadata);
    },
  },
  'team.metrics': {
    name: 'team.metrics',
    description:
      'Get per-rep team performance metrics (response times, conversions) for a date range.',
    riskTier: 'read',
    allowedRoles: ['admin', 'manager', 'sales', 'marketing', 'viewer'],
    schema: teamMetricsArgsSchema as AgentActionDefinition['schema'],
    entity: () => ({}),
    execute: async (args, actor) => {
      const parsed = args as z.infer<typeof teamMetricsArgsSchema>;
      const result = await getTeamMetrics(parsed, requireActor(actor));
      if (!result.ok) throw result.error;
      return { items: result.value };
    },
  },
  'ai.reply.classify': {
    name: 'ai.reply.classify',
    description: 'Enqueue AI classification of an inbound reply message for a lead.',
    riskTier: 'low_risk_write',
    allowedRoles: ['admin', 'manager', 'sales', 'marketing'],
    schema: aiReplyClassifyArgsSchema as AgentActionDefinition['schema'],
    entity: (args) => ({ leadId: args.leadId as string }),
    execute: async (args) => {
      const parsed = args as z.infer<typeof aiReplyClassifyArgsSchema>;
      await triggerClassification(parsed);
      return { enqueued: true, leadId: parsed.leadId };
    },
  },
  'ai.reply.history': {
    name: 'ai.reply.history',
    description:
      'List past AI reply classification decisions, optionally filtered by lead or campaign.',
    riskTier: 'read',
    allowedRoles: ['admin', 'manager', 'sales', 'viewer'],
    schema: aiReplyHistoryArgsSchema as AgentActionDefinition['schema'],
    entity: (args) => ({
      leadId: (args.leadId as string) ?? null,
      campaignId: (args.campaignId as string) ?? null,
    }),
    execute: async (args) => getReplyHistory(args as z.infer<typeof aiReplyHistoryArgsSchema>),
  },
  'campaign.brief.get': {
    name: 'campaign.brief.get',
    description:
      'Read the AI-generated pre-launch strategy brief for a campaign (null if none generated yet).',
    riskTier: 'read',
    allowedRoles: ['admin', 'manager', 'marketing', 'sales', 'viewer'],
    schema: campaignBriefGetArgsSchema as AgentActionDefinition['schema'],
    entity: (args) => ({ campaignId: args.campaignId as string }),
    execute: async (args) => getCampaignBrief((args as { campaignId: string }).campaignId),
  },
  'campaign.brief.generate': {
    name: 'campaign.brief.generate',
    description: 'Enqueue generation of an AI pre-launch strategy brief for a campaign.',
    riskTier: 'low_risk_write',
    allowedRoles: ['admin', 'manager'],
    schema: campaignBriefGenerateArgsSchema as AgentActionDefinition['schema'],
    entity: (args) => ({ campaignId: args.campaignId as string }),
    execute: async (args, actor) => {
      const parsed = args as z.infer<typeof campaignBriefGenerateArgsSchema>;
      await enqueueAiCampaignBrief({
        campaignId: parsed.campaignId,
        triggeredBy: requireActor(actor).id,
      });
      return { enqueued: true, campaignId: parsed.campaignId };
    },
  },
  'campaign.brief.approve': {
    name: 'campaign.brief.approve',
    description: 'Approve or reject a generated campaign AI brief.',
    riskTier: 'compliance_critical',
    allowedRoles: ['admin', 'manager'],
    schema: campaignBriefApproveArgsSchema as AgentActionDefinition['schema'],
    entity: (args) => ({ campaignId: args.campaignId as string }),
    execute: async (args, actor) => {
      const parsed = args as z.infer<typeof campaignBriefApproveArgsSchema>;
      const act = requireActor(actor);
      return parsed.decision === 'approve'
        ? approveCampaignBrief(parsed.campaignId, act.id)
        : rejectCampaignBrief(parsed.campaignId);
    },
  },
  'lead.ai_profile.get': {
    name: 'lead.ai_profile.get',
    description: "Read a lead's AI memory profile (buying signals, objections, next best action).",
    riskTier: 'read',
    allowedRoles: ['admin', 'manager', 'sales', 'marketing', 'viewer'],
    schema: leadAiProfileGetArgsSchema as AgentActionDefinition['schema'],
    entity: (args) => ({ leadId: args.leadId as string }),
    execute: async (args) => getAiProfile((args as { leadId: string }).leadId),
  },
  'lead.research.trigger': {
    name: 'lead.research.trigger',
    description:
      'Enqueue AI research for a lead (re-researches even if a profile already exists when force is set).',
    riskTier: 'low_risk_write',
    allowedRoles: ['admin', 'manager', 'sales', 'marketing'],
    schema: leadResearchTriggerArgsSchema as AgentActionDefinition['schema'],
    entity: (args) => ({ leadId: args.leadId as string }),
    execute: async (args) => {
      const parsed = args as z.infer<typeof leadResearchTriggerArgsSchema>;
      await enqueueAiResearch({ leadId: parsed.leadId, force: parsed.force });
      return { enqueued: true, leadId: parsed.leadId };
    },
  },
  'ai.decision_log.list': {
    name: 'ai.decision_log.list',
    description: 'Global AI decision-log audit trail across all leads.',
    riskTier: 'read',
    allowedRoles: ['admin'],
    schema: aiDecisionLogListArgsSchema as AgentActionDefinition['schema'],
    entity: () => ({}),
    execute: async (args) => getDecisions(args as z.infer<typeof aiDecisionLogListArgsSchema>),
  },
  'ai.settings.get': {
    name: 'ai.settings.get',
    description: 'Read the current AI provider settings (never exposes the raw API key).',
    riskTier: 'read',
    allowedRoles: ['admin', 'manager', 'sales', 'marketing', 'viewer'],
    schema: emptyArgsSchema as AgentActionDefinition['schema'],
    entity: () => ({}),
    execute: async () => getAiSettingsPublic(),
  },
  'scoring.rules.list': {
    name: 'scoring.rules.list',
    description: 'List lead scoring rules.',
    riskTier: 'read',
    allowedRoles: ['admin', 'manager', 'sales', 'marketing', 'viewer'],
    schema: emptyArgsSchema as AgentActionDefinition['schema'],
    entity: () => ({}),
    execute: async () => ({ items: await getAllRules() }),
  },
  'lead.rescore': {
    name: 'lead.rescore',
    description: 'Recalculate the score and classification (hot/warm/cold) for a single lead.',
    riskTier: 'low_risk_write',
    allowedRoles: ['admin', 'manager'],
    schema: leadRescoreArgsSchema as AgentActionDefinition['schema'],
    entity: (args) => ({ leadId: args.leadId as string }),
    execute: async (args) => calculateLeadScore((args as { leadId: string }).leadId),
  },
  'scoring.recalculate_all': {
    name: 'scoring.recalculate_all',
    description: 'Recalculate scores for every lead. Heavy batch operation — admin only.',
    riskTier: 'sensitive_write',
    allowedRoles: ['admin'],
    schema: emptyArgsSchema as AgentActionDefinition['schema'],
    entity: () => ({}),
    execute: async () => recalculateAllScores(),
  },
  'template.get': {
    name: 'template.get',
    description: 'Get a single message template by id.',
    riskTier: 'read',
    allowedRoles: ['admin', 'manager', 'sales', 'marketing', 'viewer'],
    schema: templateGetArgsSchema as AgentActionDefinition['schema'],
    entity: () => ({}),
    execute: async (args) => getTemplate((args as { id: string }).id),
  },
  'template.approve': {
    name: 'template.approve',
    description: 'Approve or reject a pending message template.',
    riskTier: 'sensitive_write',
    allowedRoles: ['admin', 'marketing'],
    schema: templateApproveArgsSchema as AgentActionDefinition['schema'],
    entity: () => ({}),
    execute: async (args, actor) => {
      const parsed = args as z.infer<typeof templateApproveArgsSchema>;
      return approveTemplate(
        parsed.id,
        { approved: parsed.approved, rejection_reason: parsed.rejection_reason },
        requireActor(actor),
      );
    },
  },
  'report.get': {
    name: 'report.get',
    description:
      'Get an analytics report (lead_generation, outreach, pipeline, sales_rep, campaign_analytics, or integration_health).',
    riskTier: 'read',
    allowedRoles: ['admin', 'manager', 'sales', 'marketing', 'viewer'],
    schema: reportGetArgsSchema as AgentActionDefinition['schema'],
    entity: () => ({}),
    execute: async (args, actor) => {
      const parsed = args as z.infer<typeof reportGetArgsSchema>;
      const act = requireActor(actor);
      const filters = {
        limit: parsed.limit,
        offset: parsed.offset,
        startDate: parsed.startDate,
        endDate: parsed.endDate,
      };
      switch (parsed.reportType) {
        case 'lead_generation':
          return getLeadGenerationReport(filters, act);
        case 'outreach':
          return getOutreachReport(filters, act);
        case 'pipeline':
          return getPipelineReport(filters, act);
        case 'sales_rep':
          return getSalesRepReport(filters, act);
        case 'campaign_analytics':
          return getCampaignAnalyticsReport(filters, act);
        case 'integration_health':
          return { items: await getIntegrationHealthReport(act) };
        default:
          throw new AppError(`Unsupported report type: ${String(parsed.reportType)}`, 400);
      }
    },
  },
  'report.export': {
    name: 'report.export',
    description: 'Enqueue an async CSV/XLSX/PDF export job for a report.',
    riskTier: 'low_risk_write',
    allowedRoles: ['admin', 'manager', 'sales', 'marketing', 'viewer'],
    schema: reportExportArgsSchema as AgentActionDefinition['schema'],
    entity: () => ({}),
    execute: async (args, actor) =>
      enqueueExportJob(args as z.infer<typeof reportExportArgsSchema>, requireActor(actor)),
  },
  'integration.list': {
    name: 'integration.list',
    description: 'List third-party integration connectors and their enabled/health status.',
    riskTier: 'read',
    allowedRoles: ['admin', 'manager', 'sales', 'marketing', 'viewer'],
    schema: emptyArgsSchema as AgentActionDefinition['schema'],
    entity: () => ({}),
    execute: async () => ({ items: await listIntegrations() }),
  },
  'integration.test': {
    name: 'integration.test',
    description: 'Test a single integration connection (never returns decrypted credentials).',
    riskTier: 'low_risk_write',
    allowedRoles: ['admin'],
    schema: integrationIdArgsSchema as AgentActionDefinition['schema'],
    entity: () => ({}),
    execute: async (args, actor) =>
      testIntegration((args as { id: string }).id, requireActor(actor)),
  },
  'custom_field.list': {
    name: 'custom_field.list',
    description: 'List custom field definitions.',
    riskTier: 'read',
    allowedRoles: ['admin', 'manager', 'sales', 'marketing', 'viewer'],
    schema: customFieldListArgsSchema as AgentActionDefinition['schema'],
    entity: () => ({}),
    execute: async (args) => ({
      items: await listDefinitions(
        Boolean((args as { includeInactive?: boolean }).includeInactive),
      ),
    }),
  },
  'custom_field.create': {
    name: 'custom_field.create',
    description: 'Create a new custom field definition.',
    riskTier: 'sensitive_write',
    allowedRoles: ['admin'],
    schema: customFieldCreateArgsSchema as AgentActionDefinition['schema'],
    entity: () => ({}),
    execute: async (args, actor) =>
      createDefinition(args as z.infer<typeof customFieldCreateArgsSchema>, requireActor(actor)),
  },
  'user.list': {
    name: 'user.list',
    description: 'List all active users (for assignment targets).',
    riskTier: 'read',
    allowedRoles: ['admin', 'manager'],
    schema: emptyArgsSchema as AgentActionDefinition['schema'],
    entity: () => ({}),
    execute: async () => ({ items: await listUsers() }),
  },
  'ab_test.list': {
    name: 'ab_test.list',
    description: 'List A/B test variants for a template.',
    riskTier: 'read',
    allowedRoles: ['admin', 'manager', 'sales', 'marketing', 'viewer'],
    schema: abTestTemplateArgsSchema as AgentActionDefinition['schema'],
    entity: () => ({}),
    execute: async (args) => ({
      items: await listTemplateVariants((args as { templateId: string }).templateId),
    }),
  },
  'ab_test.results': {
    name: 'ab_test.results',
    description: 'Get the A/B test statistical significance report for a template.',
    riskTier: 'read',
    allowedRoles: ['admin', 'manager', 'sales', 'marketing', 'viewer'],
    schema: abTestTemplateArgsSchema as AgentActionDefinition['schema'],
    entity: () => ({}),
    execute: async (args) => getTemplateABTestReport((args as { templateId: string }).templateId),
  },
  'form.list': {
    name: 'form.list',
    description: 'List lead-capture forms.',
    riskTier: 'read',
    allowedRoles: ['admin', 'manager', 'sales', 'marketing', 'viewer'],
    schema: formListArgsSchema as AgentActionDefinition['schema'],
    entity: () => ({}),
    execute: async (args) => {
      const parsed = args as z.infer<typeof formListArgsSchema>;
      return listForms(parsed.limit, parsed.offset);
    },
  },
  'form.analytics': {
    name: 'form.analytics',
    description: 'Get submission analytics (conversion rate, unique leads) for a form.',
    riskTier: 'read',
    allowedRoles: ['admin', 'manager', 'sales', 'marketing', 'viewer'],
    schema: formAnalyticsArgsSchema as AgentActionDefinition['schema'],
    entity: () => ({}),
    execute: async (args, actor) =>
      getFormAnalyticsById((args as { formId: string }).formId, requireActor(actor)),
  },
  'scheduling.bookings.list': {
    name: 'scheduling.bookings.list',
    description: "List the requesting user's own scheduled bookings.",
    riskTier: 'read',
    allowedRoles: ['admin', 'manager', 'sales', 'marketing', 'viewer'],
    schema: emptyArgsSchema as AgentActionDefinition['schema'],
    entity: () => ({}),
    execute: async (_args, actor) => ({ items: await listBookings(requireActor(actor).id) }),
  },
  'scheduling.slots': {
    name: 'scheduling.slots',
    description: 'Get available booking slots for a user on a given date.',
    riskTier: 'read',
    allowedRoles: ['admin', 'manager', 'sales', 'marketing', 'viewer'],
    schema: schedulingSlotsArgsSchema as AgentActionDefinition['schema'],
    entity: () => ({}),
    execute: async (args) => {
      const parsed = args as z.infer<typeof schedulingSlotsArgsSchema>;
      return getAvailableSlots(parsed.userId, parsed.date);
    },
  },
  'outreach.tasks.list': {
    name: 'outreach.tasks.list',
    description: 'List outreach follow-up tasks, optionally scoped to the current user.',
    riskTier: 'read',
    allowedRoles: ['admin', 'manager', 'sales'],
    schema: outreachTasksListArgsSchema as AgentActionDefinition['schema'],
    entity: () => ({}),
    execute: async (args, actor) => {
      const parsed = args as z.infer<typeof outreachTasksListArgsSchema>;
      return { items: await listTasks(parsed, requireActor(actor)) };
    },
  },
  'assignment.eligible_users': {
    name: 'assignment.eligible_users',
    description: 'List users currently eligible for round-robin lead assignment.',
    riskTier: 'read',
    allowedRoles: ['admin', 'manager'],
    schema: emptyArgsSchema as AgentActionDefinition['schema'],
    entity: () => ({}),
    execute: async () => ({ items: await getEligibleUsers() }),
  },
};

export function getAgentActionDefinition(name: AgentActionName): AgentActionDefinition {
  const definition = AGENT_ACTIONS[name];
  if (!definition) throw new AppError(`Unsupported agent action: ${name}`, 400);
  return definition;
}

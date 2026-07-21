import { z } from 'zod';
import { createTemplateSchema } from '../templates/templates.schema';
import { createSequenceSchema } from '../outreach/outreach.schema';
import { createCampaignSchema } from '../campaigns/campaigns.schema';
import { teamMetricsQuerySchema } from '../team-metrics/teamMetrics.schema';

const uuid = z.string().uuid();
const actorRole = z.enum(['admin', 'manager', 'sales', 'marketing', 'viewer']);
const messageChannel = z.enum(['whatsapp', 'email', 'sms', 'phone_call']);

export const agentActionNameSchema = z.enum([
  'lead.list',
  'lead.get',
  'lead.create',
  'lead.update',
  'lead.pause',
  'pipeline.move_lead',
  'campaign.list',
  'campaign.pause',
  'campaign.resume',
  'campaign.launch',
  'campaign.stats',
  'assignment.override',
  'report.dashboard',
  'template.list',
  'template.create',
  'sequence.create',
  'campaign.create',
  'campaign.add_leads',
  'pipeline.list',
  'sequence.list',
  'scraper.list',
  'scraper.run',
  'outreach.send_manual',
  'outreach.send_ai_reply',
  'ai.decision.recompute',
  'ai.inbox.action',
  'activity.list',
  'activity.log',
  'team.metrics',
  'ai.reply.classify',
  'ai.reply.history',
  'campaign.brief.get',
  'campaign.brief.generate',
  'campaign.brief.approve',
  'lead.ai_profile.get',
  'lead.research.trigger',
  'ai.decision_log.list',
  'ai.settings.get',
  'scoring.rules.list',
  'lead.rescore',
  'scoring.recalculate_all',
  'template.get',
  'template.approve',
  'report.get',
  'report.export',
  'integration.list',
  'integration.test',
  'custom_field.list',
  'custom_field.create',
  'user.list',
  'ab_test.list',
  'ab_test.results',
  'form.list',
  'form.analytics',
  'scheduling.bookings.list',
  'scheduling.slots',
  'outreach.tasks.list',
  'assignment.eligible_users',
]);

export const agentActionSourceSchema = z.enum([
  'chat',
  'event',
  'ai_reply',
  'ai_decision',
  'ai_campaign_brain',
  'expiry',
  'manual',
]);

export const leadListArgsSchema = z.object({
  limit: z.number().int().min(1).max(100).default(25),
  cursorTs: z.string().datetime().optional(),
  cursorId: uuid.optional(),
  status: z.enum(['active', 'paused', 'won', 'lost', 'opted_out']).optional(),
  classification: z.enum(['hot', 'warm', 'cold']).optional(),
  source_platform: z.string().max(100).optional(),
  industry: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  assigned_to: uuid.optional(),
  search: z.string().max(200).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

export const leadGetArgsSchema = z.object({ id: uuid });

const leadInputSchema = z.object({
  business_name: z.string().min(1).max(255),
  contact_name: z.string().min(1).max(255),
  phone: z.string().min(3).max(40),
  email: z.string().email().max(255),
  website: z.string().url().nullable().optional(),
  industry: z.string().min(1).max(120),
  location: z.string().min(1).max(255),
  country: z.string().max(100).nullable().optional(),
  google_rating: z.number().min(0).max(5).nullable().optional(),
  review_count: z.number().int().min(0).nullable().optional(),
  social_links: z.record(z.unknown()).nullable().optional(),
  source_platform: z.string().min(1).max(100),
  assigned_to: uuid.nullable().optional(),
  pipeline_stage_id: uuid.nullable().optional(),
  custom_fields: z.record(z.unknown()).nullable().optional(),
  tags: z.array(z.string().max(50)).max(50).optional(),
  notes: z.string().max(5000).nullable().optional(),
});

export const leadCreateArgsSchema = leadInputSchema;
export const leadUpdateArgsSchema = z.object({ id: uuid, input: leadInputSchema.partial() });
export const leadPauseArgsSchema = z.object({ id: uuid, paused: z.boolean() });
export const moveLeadArgsSchema = z.object({ leadId: uuid, stageId: uuid });
export const campaignIdArgsSchema = z.object({ id: uuid });
export const assignmentOverrideArgsSchema = z.object({
  leadId: uuid,
  newUserId: uuid,
  reason: z.string().min(1).max(500),
});
export const scraperRunArgsSchema = z.object({ configId: uuid });
export const templateListArgsSchema = z.object({
  limit: z.number().int().min(1).max(100).default(25),
  channel: messageChannel.optional(),
  approval_status: z.enum(['pending', 'approved', 'rejected']).optional(),
  search: z.string().max(200).optional(),
});
// Reuse the module create schemas so agent-proposed creates are validated
// identically to the REST endpoints (single source of truth, no drift).
export const templateCreateArgsSchema = createTemplateSchema;
export const sequenceCreateArgsSchema = createSequenceSchema;
export const campaignCreateArgsSchema = createCampaignSchema;
export const campaignAddLeadsArgsSchema = z.object({
  id: uuid,
  lead_ids: z.array(uuid).min(1).max(500),
});
export const sequenceListArgsSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});
export const outreachSendManualArgsSchema = z.object({
  leadId: uuid,
  campaignId: uuid,
  sequenceId: uuid,
  stepNumber: z.number().int().min(1).max(100),
  channel: messageChannel,
  templateId: uuid,
  mockMode: z.boolean().optional(),
});
export const outreachSendAiReplyArgsSchema = z.object({
  leadId: uuid,
  campaignId: uuid.nullable().optional(),
  channel: z.enum(['whatsapp', 'email', 'sms']),
  body: z.string().min(1).max(600),
});
export const aiDecisionRecomputeArgsSchema = z.object({
  leadId: uuid,
  force: z.boolean().optional().default(true),
  context: z.record(z.unknown()).optional(),
});
export const aiInboxActionArgsSchema = z.object({
  id: uuid,
  action: z.enum(['approve', 'reject', 'snooze']),
  snoozed_until: z.string().datetime().optional(),
  idempotency_key: z.string().min(1).max(120).optional(),
});
export const emptyArgsSchema = z.object({}).default({});

// ── Gap-closing actions (activities, team metrics, AI modules, reports, etc.) ──

export const activityListArgsSchema = z.object({
  leadId: uuid,
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).default(0),
  type: z
    .enum(['call', 'whatsapp', 'email', 'note', 'status_change', 'assignment_change'])
    .optional(),
});
export const activityLogArgsSchema = z.object({
  leadId: uuid,
  type: z.enum(['call', 'whatsapp', 'email', 'note']),
  metadata: z.record(z.unknown()).optional(),
});
export const teamMetricsArgsSchema = teamMetricsQuerySchema;
export const aiReplyClassifyArgsSchema = z.object({
  leadId: uuid,
  channel: z.enum(['whatsapp', 'email', 'sms']),
  messageText: z.string().min(1).max(4000),
  externalMessageId: z.string().max(200).optional(),
});
export const aiReplyHistoryArgsSchema = z.object({
  leadId: uuid.optional(),
  campaignId: uuid.optional(),
  classification: z.string().max(50).optional(),
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).default(0),
});
export const campaignBriefGetArgsSchema = z.object({ campaignId: uuid });
export const campaignBriefGenerateArgsSchema = z.object({ campaignId: uuid });
export const campaignBriefApproveArgsSchema = z.object({
  campaignId: uuid,
  decision: z.enum(['approve', 'reject']),
});
export const leadAiProfileGetArgsSchema = z.object({ leadId: uuid });
export const leadResearchTriggerArgsSchema = z.object({
  leadId: uuid,
  force: z.boolean().optional(),
});
export const aiDecisionLogListArgsSchema = z.object({
  decisionType: z.string().max(50).optional(),
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).default(0),
});
export const leadRescoreArgsSchema = z.object({ leadId: uuid });
export const templateGetArgsSchema = z.object({ id: uuid });
export const templateApproveArgsSchema = z.object({
  id: uuid,
  approved: z.boolean(),
  rejection_reason: z.string().max(500).nullable().optional(),
});
export const reportGetArgsSchema = z.object({
  reportType: z.enum([
    'lead_generation',
    'outreach',
    'pipeline',
    'sales_rep',
    'campaign_analytics',
    'integration_health',
  ]),
  limit: z.number().int().min(1).max(200).default(25),
  offset: z.number().int().min(0).default(0),
  startDate: z.string().max(40).optional(),
  endDate: z.string().max(40).optional(),
});
export const reportExportArgsSchema = z.object({
  reportType: z.string().min(1).max(100),
  format: z.enum(['csv', 'xlsx', 'pdf']),
  filters: z.record(z.unknown()).optional(),
});
export const integrationIdArgsSchema = z.object({ id: uuid });
export const customFieldListArgsSchema = z.object({ includeInactive: z.boolean().optional() });
export const customFieldCreateArgsSchema = z.object({
  label: z.string().min(1).max(200),
  field_key: z.string().min(1).max(100),
  field_type: z.enum(['text', 'number', 'date', 'dropdown', 'checkbox']),
  options: z.array(z.string().max(200)).nullable().optional(),
  is_required: z.boolean().optional(),
  is_active: z.boolean().optional(),
});
export const abTestTemplateArgsSchema = z.object({ templateId: uuid });
export const formListArgsSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});
export const formAnalyticsArgsSchema = z.object({ formId: uuid });
export const schedulingSlotsArgsSchema = z.object({
  userId: uuid,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
});
export const outreachTasksListArgsSchema = z.object({
  status: z.string().max(50).optional(),
  assignedTo: z.enum(['me']).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export const proposeAgentActionSchema = z.object({
  source: agentActionSourceSchema,
  actionName: agentActionNameSchema,
  args: z.record(z.unknown()),
  actor: z
    .object({
      id: uuid,
      role: actorRole,
      email: z.string().email().optional(),
      name: z.string().optional(),
      ipAddress: z.string().nullable().optional(),
    })
    .nullable(),
  sourceMessage: z.string().max(4000).nullable().optional(),
  confidence: z.number().int().min(0).max(100).nullable().optional(),
  autonomyLevel: z.enum(['supervised', 'guarded', 'autopilot']).nullable().optional(),
  aiMinConfidence: z.number().int().min(0).max(100).nullable().optional(),
  assignTo: uuid.nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  forceApproval: z.boolean().optional(),
});

export const executeAgentActionSchema = z.object({
  approvedBy: uuid.optional(),
});

import { z } from 'zod';

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
  'scraper.run',
  'outreach.send_manual',
  'ai.decision.recompute',
  'ai.inbox.action',
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
export const outreachSendManualArgsSchema = z.object({
  leadId: uuid,
  campaignId: uuid,
  sequenceId: uuid,
  stepNumber: z.number().int().min(1).max(100),
  channel: messageChannel,
  templateId: uuid,
  mockMode: z.boolean().optional(),
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

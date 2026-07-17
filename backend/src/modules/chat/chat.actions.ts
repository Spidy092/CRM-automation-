import type OpenAI from 'openai';
import { AGENT_ACTIONS } from '../agent/agent.actions';
import type { AgentActionName } from '../agent/agent.types';

export const actionParameters: Record<AgentActionName, Record<string, unknown>> = {
  'lead.list': {
    type: 'object',
    properties: {
      limit: { type: 'number' },
      search: { type: 'string' },
      classification: { type: 'string' },
      status: { type: 'string' },
    },
  },
  'lead.get': { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  'lead.create': { type: 'object', additionalProperties: true },
  'lead.update': {
    type: 'object',
    properties: { id: { type: 'string' }, input: { type: 'object' } },
    required: ['id', 'input'],
  },
  'lead.pause': {
    type: 'object',
    properties: { id: { type: 'string' }, paused: { type: 'boolean' } },
    required: ['id', 'paused'],
  },
  'pipeline.move_lead': {
    type: 'object',
    properties: { leadId: { type: 'string' }, stageId: { type: 'string' } },
    required: ['leadId', 'stageId'],
  },
  'campaign.list': { type: 'object', properties: {} },
  'campaign.pause': { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  'campaign.resume': { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  'campaign.launch': { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  'campaign.stats': { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  'assignment.override': {
    type: 'object',
    properties: {
      leadId: { type: 'string' },
      newUserId: { type: 'string' },
      reason: { type: 'string' },
    },
    required: ['leadId', 'newUserId', 'reason'],
  },
  'report.dashboard': { type: 'object', properties: {} },
  'template.list': {
    type: 'object',
    properties: {
      limit: { type: 'number' },
      channel: { type: 'string', enum: ['whatsapp', 'email', 'sms', 'phone_call'] },
      approval_status: { type: 'string', enum: ['pending', 'approved', 'rejected'] },
      search: { type: 'string' },
    },
  },
  'template.create': {
    type: 'object',
    properties: {
      name: { type: 'string' },
      channel: { type: 'string', enum: ['whatsapp', 'email', 'sms', 'phone_call'] },
      subject: { type: 'string', description: 'Email subject line (email channel only)' },
      body: { type: 'string', description: 'Message body; may include {{variable}} placeholders' },
      variables: { type: 'array', items: { type: 'string' } },
    },
    required: ['name', 'channel', 'body'],
  },
  'sequence.create': {
    type: 'object',
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
      is_active: { type: 'boolean' },
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            stepNumber: { type: 'number' },
            channel: { type: 'string', enum: ['whatsapp', 'email', 'sms', 'phone_call'] },
            delayHours: { type: 'number' },
            templateId: { type: 'string', description: 'UUID of an existing template' },
          },
          required: ['stepNumber', 'channel', 'delayHours', 'templateId'],
        },
      },
    },
    required: ['name', 'steps'],
  },
  'campaign.create': {
    type: 'object',
    properties: {
      name: { type: 'string' },
      tone: { type: 'string', enum: ['formal', 'professional', 'conversational'] },
      target_industries: { type: 'array', items: { type: 'string' } },
      target_countries: { type: 'array', items: { type: 'string' } },
      sequence_id: { type: 'string', description: 'UUID of an existing sequence' },
      pipeline_id: { type: 'string', description: 'UUID of an existing pipeline' },
      ai_personalization_enabled: { type: 'boolean' },
    },
    required: ['name'],
  },
  'campaign.add_leads': {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Campaign UUID' },
      lead_ids: { type: 'array', items: { type: 'string' }, description: 'Lead UUIDs to add' },
    },
    required: ['id', 'lead_ids'],
  },
  'pipeline.list': { type: 'object', properties: {} },
  'sequence.list': {
    type: 'object',
    properties: { limit: { type: 'number' }, offset: { type: 'number' } },
  },
  'scraper.list': { type: 'object', properties: {} },
  'scraper.run': {
    type: 'object',
    properties: { configId: { type: 'string' } },
    required: ['configId'],
  },
  'outreach.send_manual': { type: 'object', additionalProperties: true },
  'ai.decision.recompute': {
    type: 'object',
    properties: {
      leadId: { type: 'string' },
      force: { type: 'boolean' },
      context: { type: 'object' },
    },
    required: ['leadId'],
  },
  'ai.inbox.action': {
    type: 'object',
    properties: {
      id: { type: 'string' },
      action: { type: 'string', enum: ['approve', 'reject', 'snooze'] },
      snoozed_until: { type: 'string' },
      idempotency_key: { type: 'string' },
    },
    required: ['id', 'action'],
  },
  'activity.list': {
    type: 'object',
    properties: {
      leadId: { type: 'string' },
      limit: { type: 'number' },
      offset: { type: 'number' },
      type: {
        type: 'string',
        enum: ['call', 'whatsapp', 'email', 'note', 'status_change', 'assignment_change'],
      },
    },
    required: ['leadId'],
  },
  'activity.log': {
    type: 'object',
    properties: {
      leadId: { type: 'string' },
      type: { type: 'string', enum: ['call', 'whatsapp', 'email', 'note'] },
      metadata: { type: 'object' },
    },
    required: ['leadId', 'type'],
  },
  'team.metrics': {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'ISO 8601 datetime' },
      to: { type: 'string', description: 'ISO 8601 datetime' },
      stage: { type: 'string', description: 'Pipeline stage UUID' },
    },
  },
  'ai.reply.classify': {
    type: 'object',
    properties: {
      leadId: { type: 'string' },
      channel: { type: 'string', enum: ['whatsapp', 'email', 'sms'] },
      messageText: { type: 'string' },
      externalMessageId: { type: 'string' },
    },
    required: ['leadId', 'channel', 'messageText'],
  },
  'ai.reply.history': {
    type: 'object',
    properties: {
      leadId: { type: 'string' },
      campaignId: { type: 'string' },
      classification: { type: 'string' },
      limit: { type: 'number' },
      offset: { type: 'number' },
    },
  },
  'campaign.brief.get': {
    type: 'object',
    properties: { campaignId: { type: 'string' } },
    required: ['campaignId'],
  },
  'campaign.brief.generate': {
    type: 'object',
    properties: { campaignId: { type: 'string' } },
    required: ['campaignId'],
  },
  'campaign.brief.approve': {
    type: 'object',
    properties: {
      campaignId: { type: 'string' },
      decision: { type: 'string', enum: ['approve', 'reject'] },
    },
    required: ['campaignId', 'decision'],
  },
  'lead.ai_profile.get': {
    type: 'object',
    properties: { leadId: { type: 'string' } },
    required: ['leadId'],
  },
  'lead.research.trigger': {
    type: 'object',
    properties: { leadId: { type: 'string' }, force: { type: 'boolean' } },
    required: ['leadId'],
  },
  'ai.decision_log.list': {
    type: 'object',
    properties: {
      decisionType: { type: 'string' },
      limit: { type: 'number' },
      offset: { type: 'number' },
    },
  },
  'ai.settings.get': { type: 'object', properties: {} },
  'scoring.rules.list': { type: 'object', properties: {} },
  'lead.rescore': {
    type: 'object',
    properties: { leadId: { type: 'string' } },
    required: ['leadId'],
  },
  'scoring.recalculate_all': { type: 'object', properties: {} },
  'template.get': { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  'template.approve': {
    type: 'object',
    properties: {
      id: { type: 'string' },
      approved: { type: 'boolean' },
      rejection_reason: { type: 'string' },
    },
    required: ['id', 'approved'],
  },
  'report.get': {
    type: 'object',
    properties: {
      reportType: {
        type: 'string',
        enum: [
          'lead_generation',
          'outreach',
          'pipeline',
          'sales_rep',
          'campaign_analytics',
          'integration_health',
        ],
      },
      limit: { type: 'number' },
      offset: { type: 'number' },
      startDate: { type: 'string' },
      endDate: { type: 'string' },
    },
    required: ['reportType'],
  },
  'report.export': {
    type: 'object',
    properties: {
      reportType: { type: 'string' },
      format: { type: 'string', enum: ['csv', 'xlsx', 'pdf'] },
      filters: { type: 'object' },
    },
    required: ['reportType', 'format'],
  },
  'integration.list': { type: 'object', properties: {} },
  'integration.test': {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
  },
  'custom_field.list': {
    type: 'object',
    properties: { includeInactive: { type: 'boolean' } },
  },
  'custom_field.create': {
    type: 'object',
    properties: {
      label: { type: 'string' },
      field_key: { type: 'string' },
      field_type: { type: 'string', enum: ['text', 'number', 'date', 'dropdown', 'checkbox'] },
      options: { type: 'array', items: { type: 'string' } },
      is_required: { type: 'boolean' },
      is_active: { type: 'boolean' },
    },
    required: ['label', 'field_key', 'field_type'],
  },
  'user.list': { type: 'object', properties: {} },
  'ab_test.list': {
    type: 'object',
    properties: { templateId: { type: 'string' } },
    required: ['templateId'],
  },
  'ab_test.results': {
    type: 'object',
    properties: { templateId: { type: 'string' } },
    required: ['templateId'],
  },
  'form.list': {
    type: 'object',
    properties: { limit: { type: 'number' }, offset: { type: 'number' } },
  },
  'form.analytics': {
    type: 'object',
    properties: { formId: { type: 'string' } },
    required: ['formId'],
  },
  'scheduling.bookings.list': { type: 'object', properties: {} },
  'scheduling.slots': {
    type: 'object',
    properties: {
      userId: { type: 'string' },
      date: { type: 'string', description: 'YYYY-MM-DD' },
    },
    required: ['userId', 'date'],
  },
  'outreach.tasks.list': {
    type: 'object',
    properties: {
      status: { type: 'string' },
      assignedTo: { type: 'string', enum: ['me'] },
      limit: { type: 'number' },
    },
  },
  'assignment.eligible_users': { type: 'object', properties: {} },
};

// Tool names must match ^[a-zA-Z0-9_-]{1,64}$ (OpenAI and MCP), so every "."
// becomes "__". Action names never contain "__" themselves (only single
// underscores within words), so the mapping is bijective.
export function actionNameToToolName(actionName: AgentActionName): string {
  return actionName.replace(/\./g, '__');
}

export function buildChatTools(): OpenAI.Chat.ChatCompletionTool[] {
  return Object.values(AGENT_ACTIONS).map((definition) => ({
    type: 'function',
    function: {
      name: actionNameToToolName(definition.name),
      description: definition.description,
      parameters: actionParameters[definition.name],
    },
  }));
}

export function toolNameToActionName(toolName: string): AgentActionName {
  return toolName.replace(/__/g, '.') as AgentActionName;
}

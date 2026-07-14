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
};

export function buildChatTools(): OpenAI.Chat.ChatCompletionTool[] {
  return Object.values(AGENT_ACTIONS).map((definition) => ({
    type: 'function',
    function: {
      name: definition.name.replace('.', '__'),
      description: definition.description,
      parameters: actionParameters[definition.name],
    },
  }));
}

export function toolNameToActionName(toolName: string): AgentActionName {
  return toolName.replace('__', '.') as AgentActionName;
}

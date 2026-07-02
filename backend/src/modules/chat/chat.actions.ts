import type OpenAI from 'openai';
import { AGENT_ACTIONS } from '../agent/agent.actions';
import type { AgentActionName } from '../agent/agent.types';

const actionParameters: Record<AgentActionName, Record<string, unknown>> = {
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

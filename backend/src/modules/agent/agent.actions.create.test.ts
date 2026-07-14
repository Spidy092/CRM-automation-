import { AGENT_ACTIONS } from './agent.actions';
import { evaluateAgentPolicy } from './agent.policy';
import type { AgentActor } from './agent.types';

jest.mock('../templates/templates.service', () => ({
  listTemplates: jest.fn(),
  createTemplate: jest.fn().mockResolvedValue({ id: 'tpl-1', name: 'Welcome' }),
}));
jest.mock('../outreach/outreach.service', () => ({
  listSequences: jest.fn(),
  createSequence: jest.fn().mockResolvedValue({ id: 'seq-1', name: 'Onboarding' }),
  sendManualOutreach: jest.fn(),
}));
jest.mock('../campaigns/campaigns.service', () => ({
  getAllCampaigns: jest.fn(),
  createCampaign: jest.fn().mockResolvedValue({ id: 'cmp-1', name: 'Q3 Launch' }),
  pauseCampaignById: jest.fn(),
  resumeCampaignById: jest.fn(),
  launchCampaignById: jest.fn(),
  getStats: jest.fn(),
}));
jest.mock('../../workers/queue', () => ({ enqueueAiDecision: jest.fn() }));

import { createTemplate } from '../templates/templates.service';
import { createSequence } from '../outreach/outreach.service';
import { createCampaign } from '../campaigns/campaigns.service';

const marketing: AgentActor = { id: 'user-1', role: 'marketing' };
const sales: AgentActor = { id: 'user-2', role: 'sales' };

const TEMPLATE_UUID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('agent create actions — definitions', () => {
  it.each(['template.create', 'sequence.create', 'campaign.create'] as const)(
    '%s is registered as sensitive_write for admin/manager/marketing',
    (name) => {
      const definition = AGENT_ACTIONS[name];
      expect(definition).toBeDefined();
      expect(definition.riskTier).toBe('sensitive_write');
      expect(definition.allowedRoles).toEqual(['admin', 'manager', 'marketing']);
    },
  );

  it.each(['template.create', 'sequence.create', 'campaign.create'] as const)(
    '%s from chat requires approval (never executes immediately)',
    (name) => {
      const decision = evaluateAgentPolicy({
        actionName: name,
        riskTier: AGENT_ACTIONS[name].riskTier,
        actor: marketing,
        source: 'chat',
      });
      expect(decision.outcome).toBe('require_approval');
    },
  );

  it('rejects create actions for the sales role', () => {
    const decision = evaluateAgentPolicy({
      actionName: 'template.create',
      riskTier: 'sensitive_write',
      actor: sales,
      source: 'chat',
    });
    expect(decision.outcome).toBe('reject');
  });
});

describe('template.create', () => {
  const definition = AGENT_ACTIONS['template.create'];

  it('validates args and delegates to createTemplate with the actor', async () => {
    const args = definition.schema.parse({
      name: 'Welcome',
      channel: 'email',
      subject: 'Hi {{contact_name}}',
      body: 'Hello {{contact_name}}!',
      variables: ['contact_name'],
    });
    const result = await definition.execute(args, marketing);
    expect(createTemplate).toHaveBeenCalledWith(args, marketing);
    expect(result).toEqual({ id: 'tpl-1', name: 'Welcome' });
  });

  it('rejects args missing a body', () => {
    expect(() => definition.schema.parse({ name: 'X', channel: 'email' })).toThrow();
  });
});

describe('sequence.create', () => {
  const definition = AGENT_ACTIONS['sequence.create'];

  it('validates steps and delegates to createSequence', async () => {
    const args = definition.schema.parse({
      name: 'Onboarding',
      steps: [{ stepNumber: 1, channel: 'email', delayHours: 0, templateId: TEMPLATE_UUID }],
    });
    await definition.execute(args, marketing);
    expect(createSequence).toHaveBeenCalledWith(args, marketing);
  });

  it('rejects an empty steps array', () => {
    expect(() => definition.schema.parse({ name: 'Onboarding', steps: [] })).toThrow();
  });
});

describe('campaign.create', () => {
  const definition = AGENT_ACTIONS['campaign.create'];

  it('applies schema defaults and delegates to createCampaign', async () => {
    const args = definition.schema.parse({ name: 'Q3 Launch' });
    await definition.execute(args, marketing);
    expect(createCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Q3 Launch', tone: 'professional' }),
      marketing,
    );
  });

  it('rejects a non-UUID sequence_id', () => {
    expect(() => definition.schema.parse({ name: 'X', sequence_id: 'not-a-uuid' })).toThrow();
  });
});

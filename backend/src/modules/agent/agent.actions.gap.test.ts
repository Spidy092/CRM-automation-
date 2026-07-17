import { AGENT_ACTIONS } from './agent.actions';
import type { AgentActor } from './agent.types';

jest.mock('../activities/activities.service', () => ({
  listActivities: jest
    .fn()
    .mockResolvedValue({ items: [], meta: { total: 0, limit: 25, offset: 0 } }),
  createManualActivity: jest.fn().mockResolvedValue({ id: 'act-1', type: 'note' }),
}));
jest.mock('../team-metrics/teamMetrics.service', () => ({
  getTeamMetrics: jest.fn().mockResolvedValue({ ok: true, value: [{ userId: 'u1' }] }),
}));
jest.mock('../ai-reply/ai-reply.service', () => ({
  triggerClassification: jest.fn().mockResolvedValue(undefined),
  getReplyHistory: jest.fn().mockResolvedValue({ items: [], total: 0 }),
}));
jest.mock('../ai-campaign-brain/ai-campaign-brain.service', () => ({
  getCampaignBrief: jest.fn().mockResolvedValue(null),
  approveCampaignBrief: jest.fn().mockResolvedValue({ campaign_id: 'cmp-1', status: 'approved' }),
  rejectCampaignBrief: jest.fn().mockResolvedValue({ campaign_id: 'cmp-1', status: 'rejected' }),
}));
jest.mock('../ai-intelligence/ai-intelligence.service', () => ({
  getAiProfile: jest.fn().mockResolvedValue({ lead_id: 'lead-1' }),
  getDecisions: jest.fn().mockResolvedValue({ items: [], total: 0 }),
}));
jest.mock('../ai-settings/ai-settings.service', () => ({
  getAiSettingsPublic: jest.fn().mockResolvedValue({ id: 'settings-1', enabled: true }),
}));
jest.mock('../scoring/scoring.service', () => ({
  getAllRules: jest.fn().mockResolvedValue([{ id: 'rule-1' }]),
  calculateLeadScore: jest
    .fn()
    .mockResolvedValue({ lead_id: 'lead-1', score: 80, classification: 'hot' }),
  recalculateAllScores: jest.fn().mockResolvedValue({ processed: 10 }),
}));
jest.mock('../templates/templates.service', () => ({
  listTemplates: jest.fn(),
  createTemplate: jest.fn(),
  getTemplate: jest.fn().mockResolvedValue({ id: 'tpl-1', name: 'Welcome' }),
  approveTemplate: jest.fn().mockResolvedValue({ id: 'tpl-1', approval_status: 'approved' }),
}));
jest.mock('../reports/reports.service', () => ({
  getDashboardMetrics: jest.fn(),
  getLeadGenerationReport: jest.fn().mockResolvedValue({ items: [], meta: {} }),
  getOutreachReport: jest.fn().mockResolvedValue({ items: [], meta: {} }),
  getPipelineReport: jest.fn().mockResolvedValue({ items: [], meta: {} }),
  getSalesRepReport: jest.fn().mockResolvedValue({ items: [], meta: {} }),
  getCampaignAnalyticsReport: jest.fn().mockResolvedValue({ items: [], meta: {} }),
  getIntegrationHealthReport: jest.fn().mockResolvedValue([]),
  enqueueExportJob: jest.fn().mockResolvedValue({ jobId: 'job-1', status: 'queued' }),
}));
jest.mock('../integrations/integrations.service', () => ({
  listIntegrations: jest.fn().mockResolvedValue([{ id: 'int-1' }]),
  testIntegration: jest
    .fn()
    .mockResolvedValue({ ok: true, status: 'ok', tested_at: '2026-01-01T00:00:00Z' }),
}));
jest.mock('../custom-fields/customFields.service', () => ({
  listDefinitions: jest.fn().mockResolvedValue([{ id: 'cf-1' }]),
  createDefinition: jest.fn().mockResolvedValue({ id: 'cf-2' }),
}));
jest.mock('../users/users.service', () => ({
  listUsers: jest.fn().mockResolvedValue([{ id: 'user-1' }]),
}));
jest.mock('../ab-testing/template-ab.service', () => ({
  listTemplateVariants: jest.fn().mockResolvedValue([{ id: 'variant-1' }]),
  getTemplateABTestReport: jest.fn().mockResolvedValue({ templateId: 'tpl-1', variants: [] }),
}));
jest.mock('../forms/forms.service', () => ({
  listForms: jest.fn().mockResolvedValue({ items: [], meta: { limit: 25, offset: 0, total: 0 } }),
  getFormAnalyticsById: jest.fn().mockResolvedValue({ formId: 'form-1', totalSubmissions: 0 }),
}));
jest.mock('../scheduling/scheduling.service', () => ({
  listBookings: jest.fn().mockResolvedValue([{ id: 'booking-1' }]),
  getAvailableSlots: jest.fn().mockResolvedValue({ date: '2026-07-20', slots: [] }),
}));
jest.mock('../outreach/outreach.service', () => ({
  listSequences: jest.fn(),
  createSequence: jest.fn(),
  sendManualOutreach: jest.fn(),
  listTasks: jest.fn().mockResolvedValue([{ id: 'task-1' }]),
}));
jest.mock('../assignments/assignments.service', () => ({
  overrideAssignment: jest.fn(),
  getEligibleUsers: jest.fn().mockResolvedValue([{ id: 'user-1' }]),
}));
jest.mock('../../workers/queue', () => ({
  enqueueAiDecision: jest.fn(),
  enqueueAiCampaignBrief: jest.fn().mockResolvedValue(undefined),
  enqueueAiResearch: jest.fn().mockResolvedValue(undefined),
}));

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
import { getTemplate, approveTemplate } from '../templates/templates.service';
import {
  getLeadGenerationReport,
  getIntegrationHealthReport,
  enqueueExportJob,
} from '../reports/reports.service';
import { listIntegrations, testIntegration } from '../integrations/integrations.service';
import { listDefinitions, createDefinition } from '../custom-fields/customFields.service';
import { listUsers } from '../users/users.service';
import { listTemplateVariants, getTemplateABTestReport } from '../ab-testing/template-ab.service';
import { listForms, getFormAnalyticsById } from '../forms/forms.service';
import { listBookings, getAvailableSlots } from '../scheduling/scheduling.service';
import { listTasks } from '../outreach/outreach.service';
import { getEligibleUsers } from '../assignments/assignments.service';
import { enqueueAiCampaignBrief, enqueueAiResearch } from '../../workers/queue';

const admin: AgentActor = { id: 'admin-1', role: 'admin' };
const manager: AgentActor = { id: 'manager-1', role: 'manager' };
const sales: AgentActor = { id: 'sales-1', role: 'sales' };
const viewer: AgentActor = { id: 'viewer-1', role: 'viewer' };

const LEAD_UUID = '11111111-1111-4111-8111-111111111111';
const CAMPAIGN_UUID = '22222222-2222-4222-8222-222222222222';
const TEMPLATE_UUID = '33333333-3333-4333-8333-333333333333';
const INTEGRATION_UUID = '44444444-4444-4444-8444-444444444444';
const FORM_UUID = '55555555-5555-4555-8555-555555555555';
const USER_UUID = '66666666-6666-4666-8666-666666666666';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('gap-closing agent actions — registration', () => {
  const expectedNames = [
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
  ] as const;

  it.each(expectedNames)('%s is registered in the action catalog', (name) => {
    expect(AGENT_ACTIONS[name]).toBeDefined();
    expect(AGENT_ACTIONS[name].description.length).toBeGreaterThan(0);
  });

  it('read-tier gap actions never require write approval semantics beyond RBAC', () => {
    const readOnly = expectedNames.filter((n) => AGENT_ACTIONS[n].riskTier === 'read');
    expect(readOnly.length).toBeGreaterThan(10);
  });
});

describe('activity.list / activity.log', () => {
  it('activity.list delegates to listActivities with parsed filters', async () => {
    const definition = AGENT_ACTIONS['activity.list'];
    const args = definition.schema.parse({ leadId: LEAD_UUID });
    await definition.execute(args, sales);
    expect(listActivities).toHaveBeenCalledWith(LEAD_UUID, sales, {
      limit: 25,
      offset: 0,
      type: undefined,
    });
  });

  it('activity.log rejects status_change (system-only type)', () => {
    const definition = AGENT_ACTIONS['activity.log'];
    expect(() => definition.schema.parse({ leadId: LEAD_UUID, type: 'status_change' })).toThrow();
  });

  it('activity.log delegates to createManualActivity with actor id', async () => {
    const definition = AGENT_ACTIONS['activity.log'];
    const args = definition.schema.parse({
      leadId: LEAD_UUID,
      type: 'note',
      metadata: { text: 'hi' },
    });
    await definition.execute(args, sales);
    expect(createManualActivity).toHaveBeenCalledWith(LEAD_UUID, sales.id, 'note', { text: 'hi' });
  });
});

describe('team.metrics', () => {
  it('unwraps the Result<T,E> pattern on success', async () => {
    const definition = AGENT_ACTIONS['team.metrics'];
    const args = definition.schema.parse({});
    const result = await definition.execute(args, manager);
    expect(getTeamMetrics).toHaveBeenCalled();
    expect(result).toEqual({ items: [{ userId: 'u1' }] });
  });

  it('throws the underlying AppError when the service returns ok:false', async () => {
    (getTeamMetrics as jest.Mock).mockResolvedValueOnce({ ok: false, error: new Error('boom') });
    const definition = AGENT_ACTIONS['team.metrics'];
    const args = definition.schema.parse({});
    await expect(definition.execute(args, manager)).rejects.toThrow('boom');
  });
});

describe('ai.reply.classify / ai.reply.history', () => {
  it('classify enqueues via triggerClassification', async () => {
    const definition = AGENT_ACTIONS['ai.reply.classify'];
    const args = definition.schema.parse({
      leadId: LEAD_UUID,
      channel: 'whatsapp',
      messageText: 'Sounds good, send pricing',
    });
    const result = await definition.execute(args, sales);
    expect(triggerClassification).toHaveBeenCalledWith(args);
    expect(result).toEqual({ enqueued: true, leadId: LEAD_UUID });
  });

  it('history delegates to getReplyHistory', async () => {
    const definition = AGENT_ACTIONS['ai.reply.history'];
    const args = definition.schema.parse({ leadId: LEAD_UUID });
    await definition.execute(args, sales);
    expect(getReplyHistory).toHaveBeenCalledWith(args);
  });
});

describe('campaign.brief.*', () => {
  it('get reads the brief', async () => {
    const definition = AGENT_ACTIONS['campaign.brief.get'];
    const args = definition.schema.parse({ campaignId: CAMPAIGN_UUID });
    await definition.execute(args, viewer);
    expect(getCampaignBrief).toHaveBeenCalledWith(CAMPAIGN_UUID);
  });

  it('generate enqueues via enqueueAiCampaignBrief with the actor as triggeredBy', async () => {
    const definition = AGENT_ACTIONS['campaign.brief.generate'];
    const args = definition.schema.parse({ campaignId: CAMPAIGN_UUID });
    const result = await definition.execute(args, manager);
    expect(enqueueAiCampaignBrief).toHaveBeenCalledWith({
      campaignId: CAMPAIGN_UUID,
      triggeredBy: manager.id,
    });
    expect(result).toEqual({ enqueued: true, campaignId: CAMPAIGN_UUID });
  });

  it('approve dispatches to approveCampaignBrief on approve', async () => {
    const definition = AGENT_ACTIONS['campaign.brief.approve'];
    const args = definition.schema.parse({ campaignId: CAMPAIGN_UUID, decision: 'approve' });
    await definition.execute(args, manager);
    expect(approveCampaignBrief).toHaveBeenCalledWith(CAMPAIGN_UUID, manager.id);
    expect(rejectCampaignBrief).not.toHaveBeenCalled();
  });

  it('approve dispatches to rejectCampaignBrief on reject', async () => {
    const definition = AGENT_ACTIONS['campaign.brief.approve'];
    const args = definition.schema.parse({ campaignId: CAMPAIGN_UUID, decision: 'reject' });
    await definition.execute(args, manager);
    expect(rejectCampaignBrief).toHaveBeenCalledWith(CAMPAIGN_UUID);
  });

  it('is compliance_critical and restricted to admin/manager', () => {
    const definition = AGENT_ACTIONS['campaign.brief.approve'];
    expect(definition.riskTier).toBe('compliance_critical');
    expect(definition.allowedRoles).toEqual(['admin', 'manager']);
  });
});

describe('lead.ai_profile.get / lead.research.trigger', () => {
  it('profile get reads the cached/persisted profile', async () => {
    const definition = AGENT_ACTIONS['lead.ai_profile.get'];
    const args = definition.schema.parse({ leadId: LEAD_UUID });
    await definition.execute(args, sales);
    expect(getAiProfile).toHaveBeenCalledWith(LEAD_UUID);
  });

  it('research trigger enqueues via enqueueAiResearch', async () => {
    const definition = AGENT_ACTIONS['lead.research.trigger'];
    const args = definition.schema.parse({ leadId: LEAD_UUID, force: true });
    const result = await definition.execute(args, sales);
    expect(enqueueAiResearch).toHaveBeenCalledWith({ leadId: LEAD_UUID, force: true });
    expect(result).toEqual({ enqueued: true, leadId: LEAD_UUID });
  });
});

describe('ai.decision_log.list / ai.settings.get', () => {
  it('decision log is admin-only', () => {
    const definition = AGENT_ACTIONS['ai.decision_log.list'];
    expect(definition.allowedRoles).toEqual(['admin']);
  });

  it('decision log delegates to getDecisions', async () => {
    const definition = AGENT_ACTIONS['ai.decision_log.list'];
    const args = definition.schema.parse({});
    await definition.execute(args, admin);
    expect(getDecisions).toHaveBeenCalledWith(args);
  });

  it('ai.settings.get never accepts args and delegates to getAiSettingsPublic', async () => {
    const definition = AGENT_ACTIONS['ai.settings.get'];
    const args = definition.schema.parse(undefined);
    await definition.execute(args, viewer);
    expect(getAiSettingsPublic).toHaveBeenCalled();
  });
});

describe('scoring.* gap actions', () => {
  it('rules.list delegates to getAllRules', async () => {
    const definition = AGENT_ACTIONS['scoring.rules.list'];
    await definition.execute(definition.schema.parse({}), viewer);
    expect(getAllRules).toHaveBeenCalled();
  });

  it('lead.rescore delegates to calculateLeadScore', async () => {
    const definition = AGENT_ACTIONS['lead.rescore'];
    const args = definition.schema.parse({ leadId: LEAD_UUID });
    await definition.execute(args, manager);
    expect(calculateLeadScore).toHaveBeenCalledWith(LEAD_UUID);
  });

  it('recalculate_all is admin-only sensitive_write', async () => {
    const definition = AGENT_ACTIONS['scoring.recalculate_all'];
    expect(definition.riskTier).toBe('sensitive_write');
    expect(definition.allowedRoles).toEqual(['admin']);
    await definition.execute(definition.schema.parse({}), admin);
    expect(recalculateAllScores).toHaveBeenCalled();
  });
});

describe('template.get / template.approve', () => {
  it('get delegates to getTemplate', async () => {
    const definition = AGENT_ACTIONS['template.get'];
    const args = definition.schema.parse({ id: TEMPLATE_UUID });
    await definition.execute(args, viewer);
    expect(getTemplate).toHaveBeenCalledWith(TEMPLATE_UUID);
  });

  it('approve delegates to approveTemplate with the actor', async () => {
    const definition = AGENT_ACTIONS['template.approve'];
    const args = definition.schema.parse({ id: TEMPLATE_UUID, approved: true });
    await definition.execute(args, manager);
    expect(approveTemplate).toHaveBeenCalledWith(
      TEMPLATE_UUID,
      { approved: true, rejection_reason: undefined },
      manager,
    );
  });
});

describe('report.get / report.export', () => {
  it('dispatches lead_generation to getLeadGenerationReport', async () => {
    const definition = AGENT_ACTIONS['report.get'];
    const args = definition.schema.parse({ reportType: 'lead_generation' });
    await definition.execute(args, manager);
    expect(getLeadGenerationReport).toHaveBeenCalled();
  });

  it('dispatches integration_health to getIntegrationHealthReport', async () => {
    const definition = AGENT_ACTIONS['report.get'];
    const args = definition.schema.parse({ reportType: 'integration_health' });
    const result = await definition.execute(args, manager);
    expect(getIntegrationHealthReport).toHaveBeenCalled();
    expect(result).toEqual({ items: [] });
  });

  it('export delegates to enqueueExportJob', async () => {
    const definition = AGENT_ACTIONS['report.export'];
    const args = definition.schema.parse({ reportType: 'lead_generation', format: 'csv' });
    const result = await definition.execute(args, manager);
    expect(enqueueExportJob).toHaveBeenCalledWith(args, manager);
    expect(result).toEqual({ jobId: 'job-1', status: 'queued' });
  });
});

describe('integration.* / custom_field.* / user.list', () => {
  it('integration.list delegates to listIntegrations', async () => {
    const definition = AGENT_ACTIONS['integration.list'];
    await definition.execute(definition.schema.parse({}), sales);
    expect(listIntegrations).toHaveBeenCalled();
  });

  it('integration.test is admin-only and delegates to testIntegration', async () => {
    const definition = AGENT_ACTIONS['integration.test'];
    expect(definition.allowedRoles).toEqual(['admin']);
    const args = definition.schema.parse({ id: INTEGRATION_UUID });
    await definition.execute(args, admin);
    expect(testIntegration).toHaveBeenCalledWith(INTEGRATION_UUID, admin);
  });

  it('custom_field.list delegates to listDefinitions', async () => {
    const definition = AGENT_ACTIONS['custom_field.list'];
    await definition.execute(definition.schema.parse({}), sales);
    expect(listDefinitions).toHaveBeenCalledWith(false);
  });

  it('custom_field.create is admin-only and delegates to createDefinition', async () => {
    const definition = AGENT_ACTIONS['custom_field.create'];
    expect(definition.allowedRoles).toEqual(['admin']);
    const args = definition.schema.parse({
      label: 'Budget',
      field_key: 'budget',
      field_type: 'number',
    });
    await definition.execute(args, admin);
    expect(createDefinition).toHaveBeenCalledWith(args, admin);
  });

  it('user.list is admin/manager only and delegates to listUsers', async () => {
    const definition = AGENT_ACTIONS['user.list'];
    expect(definition.allowedRoles).toEqual(['admin', 'manager']);
    await definition.execute(definition.schema.parse({}), manager);
    expect(listUsers).toHaveBeenCalled();
  });
});

describe('ab_test.* / form.* / scheduling.* / outreach.tasks.list / assignment.eligible_users', () => {
  it('ab_test.list delegates to listTemplateVariants', async () => {
    const definition = AGENT_ACTIONS['ab_test.list'];
    const args = definition.schema.parse({ templateId: TEMPLATE_UUID });
    await definition.execute(args, marketingActor());
    expect(listTemplateVariants).toHaveBeenCalledWith(TEMPLATE_UUID);
  });

  it('ab_test.results delegates to getTemplateABTestReport', async () => {
    const definition = AGENT_ACTIONS['ab_test.results'];
    const args = definition.schema.parse({ templateId: TEMPLATE_UUID });
    await definition.execute(args, marketingActor());
    expect(getTemplateABTestReport).toHaveBeenCalledWith(TEMPLATE_UUID);
  });

  it('form.list delegates to listForms', async () => {
    const definition = AGENT_ACTIONS['form.list'];
    const args = definition.schema.parse({});
    await definition.execute(args, marketingActor());
    expect(listForms).toHaveBeenCalledWith(undefined, undefined);
  });

  it('form.analytics delegates to getFormAnalyticsById', async () => {
    const definition = AGENT_ACTIONS['form.analytics'];
    const args = definition.schema.parse({ formId: FORM_UUID });
    await definition.execute(args, marketingActor());
    expect(getFormAnalyticsById).toHaveBeenCalledWith(FORM_UUID, marketingActor());
  });

  it('scheduling.bookings.list scopes to the requesting actor', async () => {
    const definition = AGENT_ACTIONS['scheduling.bookings.list'];
    await definition.execute(definition.schema.parse({}), sales);
    expect(listBookings).toHaveBeenCalledWith(sales.id);
  });

  it('scheduling.slots delegates to getAvailableSlots', async () => {
    const definition = AGENT_ACTIONS['scheduling.slots'];
    const args = definition.schema.parse({ userId: USER_UUID, date: '2026-07-20' });
    await definition.execute(args, sales);
    expect(getAvailableSlots).toHaveBeenCalledWith(USER_UUID, '2026-07-20');
  });

  it('scheduling.slots rejects a non YYYY-MM-DD date', () => {
    const definition = AGENT_ACTIONS['scheduling.slots'];
    expect(() => definition.schema.parse({ userId: USER_UUID, date: '07/20/2026' })).toThrow();
  });

  it('outreach.tasks.list is scoped to admin/manager/sales and delegates to listTasks', async () => {
    const definition = AGENT_ACTIONS['outreach.tasks.list'];
    expect(definition.allowedRoles).toEqual(['admin', 'manager', 'sales']);
    const args = definition.schema.parse({ assignedTo: 'me' });
    await definition.execute(args, sales);
    expect(listTasks).toHaveBeenCalledWith(args, sales);
  });

  it('assignment.eligible_users delegates to getEligibleUsers', async () => {
    const definition = AGENT_ACTIONS['assignment.eligible_users'];
    await definition.execute(definition.schema.parse({}), manager);
    expect(getEligibleUsers).toHaveBeenCalled();
  });
});

function marketingActor(): AgentActor {
  return { id: 'marketing-1', role: 'marketing' };
}

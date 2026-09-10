jest.mock('../leads/leads.service', () => ({
  getLeadById: jest.fn(),
  updateLeadFields: jest.fn(),
}));

jest.mock('../pipeline/pipeline.service', () => ({
  moveLead: jest.fn(),
}));

import { getLeadById, updateLeadFields } from '../leads/leads.service';
import { moveLead } from '../pipeline/pipeline.service';
import type { LeadResponse } from '../leads/leads.types';
import {
  executeWorkflowAction,
  WorkflowActionError,
  type WorkflowActionActor,
} from './workflow.actions';
import type { WorkflowActionConfig, WorkflowActionType, WorkflowScalar } from './workflow.types';

const mockGetLead = getLeadById as jest.MockedFunction<typeof getLeadById>;
const mockUpdateLead = updateLeadFields as jest.MockedFunction<typeof updateLeadFields>;
const mockMoveLead = moveLead as jest.MockedFunction<typeof moveLead>;

const actor: WorkflowActionActor = { id: 'manager-1', role: 'manager' };
const context = { leadId: 'lead-1', actor, idempotencyKey: 'enrollment-1:action-1' };

function action(
  type: WorkflowActionType,
  input: Record<string, WorkflowScalar>,
): WorkflowActionConfig {
  return { type, input };
}

function lead(overrides: Partial<LeadResponse> = {}): LeadResponse {
  return {
    id: 'lead-1',
    business_name: 'Example',
    contact_name: 'Contact',
    phone: '+10000000000',
    email: 'contact@example.com',
    website: null,
    industry: 'software',
    location: 'Bengaluru',
    country: 'IN',
    google_rating: null,
    review_count: null,
    social_links: null,
    source_platform: 'manual',
    lead_score: 0,
    classification: null,
    status: 'active',
    assigned_to: null,
    pipeline_stage_id: null,
    custom_fields: {},
    tags: [],
    notes: null,
    deal_value: null,
    won_at: null,
    lost_at: null,
    next_follow_up_at: null,
    created_at: '2026-09-10T00:00:00.000Z',
    updated_at: '2026-09-10T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetLead.mockResolvedValue(lead());
  mockUpdateLead.mockResolvedValue(lead());
  mockMoveLead.mockResolvedValue(undefined);
});

describe('executeWorkflowAction', () => {
  it('updates allowlisted lead fields', async () => {
    const result = await executeWorkflowAction(
      action('lead.update', { notes: 'Call tomorrow', deal_value: 1250 }),
      context,
    );

    expect(result).toMatchObject({ actionType: 'lead.update', changed: true });
    expect(mockUpdateLead).toHaveBeenCalledWith(
      'lead-1',
      { notes: 'Call tomorrow', deal_value: 1250 },
      actor,
    );
  });

  it('treats an already-applied field update as idempotent', async () => {
    mockGetLead.mockResolvedValue(lead({ notes: 'Already done' }));

    const result = await executeWorkflowAction(
      action('lead.update', { notes: 'Already done' }),
      context,
    );

    expect(result.changed).toBe(false);
    expect(mockUpdateLead).not.toHaveBeenCalled();
  });

  it('adds and removes tags without duplicating writes', async () => {
    await executeWorkflowAction(action('lead.add_tag', { tag: 'priority' }), context);
    expect(mockUpdateLead).toHaveBeenCalledWith('lead-1', { tags: ['priority'] }, actor);

    mockGetLead.mockResolvedValue(lead({ tags: ['priority'] }));
    const noOp = await executeWorkflowAction(action('lead.add_tag', { tag: 'priority' }), context);
    expect(noOp.changed).toBe(false);

    await executeWorkflowAction(action('lead.remove_tag', { tag: 'priority' }), context);
    expect(mockUpdateLead).toHaveBeenLastCalledWith('lead-1', { tags: [] }, actor);
  });

  it('assigns a lead and moves its pipeline stage', async () => {
    const userId = '11111111-1111-4111-8111-111111111111';
    const stageId = '22222222-2222-4222-8222-222222222222';

    await executeWorkflowAction(action('lead.assign', { user_id: userId }), context);
    expect(mockUpdateLead).toHaveBeenCalledWith('lead-1', { assigned_to: userId }, actor);

    await executeWorkflowAction(action('pipeline.move', { stage_id: stageId }), context);
    expect(mockMoveLead).toHaveBeenCalledWith('lead-1', stageId, actor);
  });

  it('rejects outbound and task actions with an explicit safety code', async () => {
    await expect(
      executeWorkflowAction(action('message.send', { channel: 'email' }), context),
    ).rejects.toMatchObject<Partial<WorkflowActionError>>({
      code: 'ACTION_EXECUTION_DISABLED',
      statusCode: 503,
    });

    await expect(
      executeWorkflowAction(action('task.create', { title: 'Call lead' }), context),
    ).rejects.toMatchObject<Partial<WorkflowActionError>>({ code: 'ACTION_EXECUTION_DISABLED' });
  });

  it('rejects CRM mutations for non-managerial workflow owners', async () => {
    await expect(
      executeWorkflowAction(action('lead.add_tag', { tag: 'priority' }), {
        ...context,
        actor: { id: 'marketing-1', role: 'marketing' },
      }),
    ).rejects.toMatchObject<Partial<WorkflowActionError>>({
      code: 'ACTION_FORBIDDEN',
      statusCode: 403,
    });
  });
});

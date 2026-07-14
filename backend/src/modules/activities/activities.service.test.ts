import { AppError } from '../../shared/middleware/errorHandler';
import { Activity, ActivityWithUser, Actor } from './activities.types';
import {
  createManualActivity,
  listActivities,
  logAssignmentChangeActivity,
  logOutboundActivity,
  logStatusChangeActivity,
} from './activities.service';
import {
  createOutboundActivityAndUpdateLead,
  findActivitiesByLeadId,
  insertActivity,
} from './activities.repository';
import { findLeadById } from '../leads/leads.repository';
import { assertAccess } from '../leads/leads.service';

jest.mock('./activities.repository');
jest.mock('../leads/leads.repository');
jest.mock('../leads/leads.service');

const mockedInsertActivity = insertActivity as jest.MockedFunction<typeof insertActivity>;
const mockedCreateOutbound = createOutboundActivityAndUpdateLead as jest.MockedFunction<
  typeof createOutboundActivityAndUpdateLead
>;
const mockedFindActivities = findActivitiesByLeadId as jest.MockedFunction<typeof findActivitiesByLeadId>;
const mockedFindLead = findLeadById as jest.MockedFunction<typeof findLeadById>;
const mockedAssertAccess = assertAccess as jest.MockedFunction<typeof assertAccess>;

const actor: Actor = { id: 'user-1', role: 'admin' };

const baseActivity: Activity = {
  id: 'act-1',
  lead_id: 'lead-1',
  user_id: 'user-1',
  type: 'note',
  metadata: { note: 'hello' },
  created_at: '2026-06-19T00:00:00.000Z',
};

const baseActivityWithUser: ActivityWithUser = {
  ...baseActivity,
  user_name: 'User One',
  user_email: 'user1@example.com',
};

describe('createManualActivity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('inserts a manual note activity', async () => {
    mockedInsertActivity.mockResolvedValue(baseActivity);
    const res = await createManualActivity('lead-1', 'user-1', 'note', { note: 'hello' });
    expect(res).toEqual(baseActivity as any);
    expect(mockedInsertActivity).toHaveBeenCalledWith({
      lead_id: 'lead-1',
      user_id: 'user-1',
      type: 'note',
      metadata: { note: 'hello' },
    });
  });

  it('allows call, whatsapp, and email types', async () => {
    mockedInsertActivity.mockResolvedValue({ ...baseActivity, type: 'email' } as Activity);
    const res = await createManualActivity('lead-1', 'user-1', 'email', { subject: 'Hi' });
    expect(res.type).toBe('email');
  });

  it('rejects auto-logged types for manual creation', async () => {
    await expect(createManualActivity('lead-1', 'user-1', 'status_change', {})).rejects.toMatchObject({
      statusCode: 422,
    });
    await expect(createManualActivity('lead-1', 'user-1', 'assignment_change', {})).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(mockedInsertActivity).not.toHaveBeenCalled();
  });
});

describe('logOutboundActivity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates to createOutboundActivityAndUpdateLead', async () => {
    mockedCreateOutbound.mockResolvedValue({ ...baseActivity, type: 'call' } as Activity);
    const res = await logOutboundActivity('lead-1', 'user-1', 'call');
    expect(res.type).toBe('call');
    expect(mockedCreateOutbound).toHaveBeenCalledWith({
      lead_id: 'lead-1',
      user_id: 'user-1',
      type: 'call',
      metadata: undefined,
    });
  });
});

describe('logStatusChangeActivity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('inserts a status_change activity', async () => {
    mockedInsertActivity.mockResolvedValue({ ...baseActivity, type: 'status_change' } as Activity);
    const res = await logStatusChangeActivity('lead-1', 'user-1', 'pipeline_stage_id', 'stage-1', 'stage-2');
    expect(res.type).toBe('status_change');
    expect(mockedInsertActivity).toHaveBeenCalledWith({
      lead_id: 'lead-1',
      user_id: 'user-1',
      type: 'status_change',
      metadata: {
        field: 'pipeline_stage_id',
        from: 'stage-1',
        to: 'stage-2',
      },
    });
  });
});

describe('logAssignmentChangeActivity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('inserts an assignment_change activity', async () => {
    mockedInsertActivity.mockResolvedValue({ ...baseActivity, type: 'assignment_change' } as Activity);
    const res = await logAssignmentChangeActivity('lead-1', 'user-1', 'rep-1', 'rep-2');
    expect(res.type).toBe('assignment_change');
    expect(mockedInsertActivity).toHaveBeenCalledWith({
      lead_id: 'lead-1',
      user_id: 'user-1',
      type: 'assignment_change',
      metadata: {
        from: 'rep-1',
        to: 'rep-2',
      },
    });
  });
});

describe('listActivities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFindLead.mockResolvedValue({
      id: 'lead-1',
      assigned_to: 'user-1',
    } as any);
    mockedAssertAccess.mockReturnValue(undefined);
  });

  it('throws 404 when lead not found', async () => {
    mockedFindLead.mockResolvedValue(null);
    await expect(listActivities('lead-1', actor, { limit: 25, offset: 0 })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('delegates to repository with filters', async () => {
    mockedFindActivities.mockResolvedValue({
      items: [baseActivityWithUser],
      meta: { total: 1, limit: 25, offset: 0 },
    });
    const res = await listActivities('lead-1', actor, { type: 'note', limit: 10, offset: 0 });
    expect(res.items).toHaveLength(1);
    expect(mockedFindActivities).toHaveBeenCalledWith({
      leadId: 'lead-1',
      type: 'note',
      limit: 10,
      offset: 0,
    });
  });
});

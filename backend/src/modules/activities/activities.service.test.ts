import { AppError } from '../../shared/middleware/errorHandler';
import { Activity, ActivityWithUser, Actor } from './activities.types';
import {
  createManualActivity,
  listActivities,
  listActivityAuthors,
  logAssignmentChangeActivity,
  logOutboundActivity,
  logStatusChangeActivity,
  setNotePinned,
} from './activities.service';
import {
  createOutboundActivityAndUpdateLead,
  findActivitiesByLeadId,
  findActivityById,
  findActivityAuthors,
  insertActivity,
  setActivityPinned as repoSetActivityPinned,
} from './activities.repository';
import { findLeadById } from '../leads/leads.repository';
import { assertAccess, getLeadById } from '../leads/leads.service';

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
  is_pinned: false,
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
      cursorTs: undefined,
      cursorId: undefined,
      search: undefined,
      authorId: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      pinnedOnly: undefined,
    });
  });

  it('passes cursor and search filters through to the repository', async () => {
    mockedFindActivities.mockResolvedValue({
      items: [],
      meta: { total: 0, limit: 25, offset: 0, hasMore: false },
    });
    await listActivities('lead-1', actor, {
      limit: 25,
      offset: 0,
      cursorTs: '2026-06-20T00:00:00.000Z',
      cursorId: 'act-9',
      search: 'pricing',
      authorId: 'user-2',
      dateFrom: '2026-06-01T00:00:00.000Z',
      dateTo: '2026-06-30T00:00:00.000Z',
      pinnedOnly: true,
    });
    expect(mockedFindActivities).toHaveBeenCalledWith({
      leadId: 'lead-1',
      type: undefined,
      limit: 25,
      offset: 0,
      cursorTs: '2026-06-20T00:00:00.000Z',
      cursorId: 'act-9',
      search: 'pricing',
      authorId: 'user-2',
      dateFrom: '2026-06-01T00:00:00.000Z',
      dateTo: '2026-06-30T00:00:00.000Z',
      pinnedOnly: true,
    });
  });
});

describe('setNotePinned', () => {
  const mockedFindActivityById = findActivityById as jest.MockedFunction<typeof findActivityById>;
  const mockedRepoSetPinned = repoSetActivityPinned as jest.MockedFunction<typeof repoSetActivityPinned>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedFindLead.mockResolvedValue({ id: 'lead-1', assigned_to: 'user-1' } as never);
    mockedAssertAccess.mockReturnValue(undefined);
  });

  it('pins a note on the lead', async () => {
    mockedFindActivityById.mockResolvedValue(baseActivity);
    mockedRepoSetPinned.mockResolvedValue({ ...baseActivityWithUser, is_pinned: true });
    const res = await setNotePinned('lead-1', 'act-1', true, actor);
    expect(res.is_pinned).toBe(true);
    expect(mockedRepoSetPinned).toHaveBeenCalledWith('act-1', true, 'user-1');
  });

  it('throws 404 when the activity belongs to another lead', async () => {
    mockedFindActivityById.mockResolvedValue({ ...baseActivity, lead_id: 'lead-2' });
    await expect(setNotePinned('lead-1', 'act-1', true, actor)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mockedRepoSetPinned).not.toHaveBeenCalled();
  });

  it('throws 422 for non-note activities', async () => {
    mockedFindActivityById.mockResolvedValue({ ...baseActivity, type: 'status_change' });
    await expect(setNotePinned('lead-1', 'act-1', true, actor)).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(mockedRepoSetPinned).not.toHaveBeenCalled();
  });
});

describe('history author permissions', () => {
  it('checks lead read access before retrieving authors', async () => {
    (getLeadById as jest.Mock).mockResolvedValue({ id: 'lead-1' });
    (findActivityAuthors as jest.Mock).mockResolvedValue([{ id: 'user-1', name: 'Rep' }]);
    expect(await listActivityAuthors('lead-1', actor)).toEqual([{ id: 'user-1', name: 'Rep' }]);
    expect(getLeadById).toHaveBeenCalledWith('lead-1', actor);
  });
  it('does not expose authors when access is denied', async () => {
    (getLeadById as jest.Mock).mockRejectedValueOnce(new AppError('Forbidden', 403));
    await expect(listActivityAuthors('lead-1', actor)).rejects.toThrow('Forbidden');
  });
});

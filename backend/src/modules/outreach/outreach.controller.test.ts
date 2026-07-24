jest.mock('./outreach.service', () => ({
  listSequences: jest.fn(),
  getSequence: jest.fn(),
  createSequence: jest.fn(),
  updateSequence: jest.fn(),
  removeSequence: jest.fn(),
  getLeadTimeline: jest.fn(),
  getLeadLogs: jest.fn(),
  createTask: jest.fn(),
  getTask: jest.fn(),
  updateTask: jest.fn(),
  sendQuickMessage: jest.fn(),
}));

import * as outreachService from './outreach.service';
import {
  listSequencesHandler,
  getSequenceHandler,
  createSequenceHandler,
  updateSequenceHandler,
  deleteSequenceHandler,
  getLeadTimelineHandler,
  getLeadLogsHandler,
  createTaskHandler,
  getTaskHandler,
  updateTaskHandler,
  quickSendHandler,
} from './outreach.controller';

function mockReq(overrides: Record<string, unknown> = {}) {
  return {
    params: {},
    query: {},
    body: {},
    user: { id: 'u1', role: 'admin' },
    ip: '127.0.0.1',
    ...overrides,
  } as any;
}

function mockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const next = jest.fn();

beforeEach(() => jest.clearAllMocks());

describe('listSequencesHandler', () => {
  it('returns sequences', async () => {
    (outreachService.listSequences as jest.Mock).mockResolvedValue({
      items: [{ id: 's1' }],
      meta: { limit: 25, offset: 0 },
    });
    const res = mockRes();
    await listSequencesHandler(mockReq(), res, next);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('getSequenceHandler', () => {
  it('returns sequence by id', async () => {
    (outreachService.getSequence as jest.Mock).mockResolvedValue({ id: 's1' });
    const res = mockRes();
    await getSequenceHandler(mockReq({ params: { id: 's1' } }), res, next);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('calls next on error', async () => {
    (outreachService.getSequence as jest.Mock).mockRejectedValue(new Error('not found'));
    await getSequenceHandler(mockReq({ params: { id: 'x' } }), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });
});

describe('createSequenceHandler', () => {
  it('creates sequence', async () => {
    (outreachService.createSequence as jest.Mock).mockResolvedValue({ id: 's1' });
    const res = mockRes();
    await createSequenceHandler(
      mockReq({
        body: {
          name: 'Test',
          steps: [{ stepNumber: 1, channel: 'email', delayHours: 0, templateId: '550e8400-e29b-41d4-a716-446655440000' }],
        },
      }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('updateSequenceHandler', () => {
  it('updates sequence', async () => {
    (outreachService.updateSequence as jest.Mock).mockResolvedValue({ id: 's1', name: 'Updated' });
    const res = mockRes();
    await updateSequenceHandler(
      mockReq({ params: { id: 's1' }, body: { name: 'Updated' } }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('deleteSequenceHandler', () => {
  it('deletes sequence', async () => {
    (outreachService.removeSequence as jest.Mock).mockResolvedValue(undefined);
    const res = mockRes();
    await deleteSequenceHandler(mockReq({ params: { id: 's1' } }), res, next);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('getLeadTimelineHandler', () => {
  it('returns timeline', async () => {
    (outreachService.getLeadTimeline as jest.Mock).mockResolvedValue([]);
    const res = mockRes();
    await getLeadTimelineHandler(
      mockReq({ params: { leadId: '550e8400-e29b-41d4-a716-446655440000' } }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('getLeadLogsHandler', () => {
  it('returns logs', async () => {
    (outreachService.getLeadLogs as jest.Mock).mockResolvedValue([]);
    const res = mockRes();
    await getLeadLogsHandler(
      mockReq({ params: { leadId: '550e8400-e29b-41d4-a716-446655440000' } }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('createTaskHandler', () => {
  it('creates task', async () => {
    (outreachService.createTask as jest.Mock).mockResolvedValue({ id: 't1' });
    const res = mockRes();
    await createTaskHandler(
      mockReq({
        body: {
          leadId: '550e8400-e29b-41d4-a716-446655440000',
          type: 'phone_call',
          title: 'Call lead',
        },
      }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('getTaskHandler', () => {
  it('returns task', async () => {
    (outreachService.getTask as jest.Mock).mockResolvedValue({ id: 't1' });
    const res = mockRes();
    await getTaskHandler(
      mockReq({ params: { id: '550e8400-e29b-41d4-a716-446655440000' } }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('quickSendHandler', () => {
  it('sends and returns 201', async () => {
    (outreachService.sendQuickMessage as jest.Mock).mockResolvedValue({ id: 'log1', status: 'sent' });
    const res = mockRes();
    await quickSendHandler(
      mockReq({
        params: { leadId: '550e8400-e29b-41d4-a716-446655440000' },
        body: { channel: 'email', templateId: '660e8400-e29b-41d4-a716-446655440000' },
      }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(outreachService.sendQuickMessage).toHaveBeenCalledWith(
      '550e8400-e29b-41d4-a716-446655440000',
      { channel: 'email', templateId: '660e8400-e29b-41d4-a716-446655440000' },
      expect.objectContaining({ id: 'u1' }),
    );
  });

  it('calls next on error', async () => {
    (outreachService.sendQuickMessage as jest.Mock).mockRejectedValue(new Error('boom'));
    await quickSendHandler(
      mockReq({
        params: { leadId: '550e8400-e29b-41d4-a716-446655440000' },
        body: { channel: 'email', templateId: '660e8400-e29b-41d4-a716-446655440000' },
      }),
      mockRes(),
      next,
    );
    expect(next).toHaveBeenCalled();
  });
});

describe('updateTaskHandler', () => {
  it('updates task', async () => {
    (outreachService.updateTask as jest.Mock).mockResolvedValue({ id: 't1', status: 'completed' });
    const res = mockRes();
    await updateTaskHandler(
      mockReq({
        params: { id: '550e8400-e29b-41d4-a716-446655440000' },
        body: { status: 'completed' },
      }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

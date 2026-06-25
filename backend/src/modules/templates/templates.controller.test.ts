jest.mock('./templates.service', () => ({
  listTemplates: jest.fn(),
  getTemplate: jest.fn(),
  createTemplate: jest.fn(),
  updateTemplate: jest.fn(),
  approveTemplate: jest.fn(),
  removeTemplate: jest.fn(),
}));

import * as templatesService from './templates.service';
import {
  listTemplatesHandler,
  getTemplateHandler,
  createTemplateHandler,
  updateTemplateHandler,
  approveTemplateHandler,
  deleteTemplateHandler,
} from './templates.controller';

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

describe('listTemplatesHandler', () => {
  it('returns templates', async () => {
    (templatesService.listTemplates as jest.Mock).mockResolvedValue({
      items: [{ id: 't1' }],
      meta: { hasMore: false },
    });
    const res = mockRes();
    await listTemplatesHandler(mockReq(), res, next);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('getTemplateHandler', () => {
  it('returns template', async () => {
    (templatesService.getTemplate as jest.Mock).mockResolvedValue({ id: 't1' });
    const res = mockRes();
    await getTemplateHandler(mockReq({ params: { id: 't1' } }), res, next);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('calls next on error', async () => {
    (templatesService.getTemplate as jest.Mock).mockRejectedValue(new Error('not found'));
    await getTemplateHandler(mockReq({ params: { id: 'x' } }), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });
});

describe('createTemplateHandler', () => {
  it('creates template', async () => {
    (templatesService.createTemplate as jest.Mock).mockResolvedValue({ id: 't1' });
    const res = mockRes();
    await createTemplateHandler(
      mockReq({ body: { name: 'Test', channel: 'email', body: 'Hello' } }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('updateTemplateHandler', () => {
  it('updates template', async () => {
    (templatesService.updateTemplate as jest.Mock).mockResolvedValue({ id: 't1', name: 'Updated' });
    const res = mockRes();
    await updateTemplateHandler(
      mockReq({ params: { id: 't1' }, body: { name: 'Updated' } }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('approveTemplateHandler', () => {
  it('approves template', async () => {
    (templatesService.approveTemplate as jest.Mock).mockResolvedValue({
      id: 't1',
      approval_status: 'approved',
    });
    const res = mockRes();
    await approveTemplateHandler(
      mockReq({ params: { id: 't1' }, body: { approved: true } }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('deleteTemplateHandler', () => {
  it('deletes template', async () => {
    (templatesService.removeTemplate as jest.Mock).mockResolvedValue(undefined);
    const res = mockRes();
    await deleteTemplateHandler(mockReq({ params: { id: 't1' } }), res, next);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

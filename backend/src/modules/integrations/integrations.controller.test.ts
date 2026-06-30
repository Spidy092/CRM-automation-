jest.mock('./integrations.service', () => ({
  listIntegrations: jest.fn(),
  getIntegration: jest.fn(),
  updateIntegration: jest.fn(),
  testIntegration: jest.fn(),
}));

import * as integrationsService from './integrations.service';
import {
  listIntegrationsHandler,
  getIntegrationHandler,
  updateIntegrationHandler,
  testIntegrationHandler,
} from './integrations.controller';

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

describe('listIntegrationsHandler', () => {
  it('returns integrations', async () => {
    (integrationsService.listIntegrations as jest.Mock).mockResolvedValue([{ id: 'i1' }]);
    const res = mockRes();
    await listIntegrationsHandler(mockReq(), res, next);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('calls next on error', async () => {
    (integrationsService.listIntegrations as jest.Mock).mockRejectedValue(new Error('db error'));
    await listIntegrationsHandler(mockReq(), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });
});

describe('getIntegrationHandler', () => {
  it('returns integration', async () => {
    (integrationsService.getIntegration as jest.Mock).mockResolvedValue({ id: 'i1' });
    const res = mockRes();
    await getIntegrationHandler(mockReq({ params: { id: '123e4567-e89b-12d3-a456-426614174000' } }), res, next);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('updateIntegrationHandler', () => {
  it('updates integration', async () => {
    (integrationsService.updateIntegration as jest.Mock).mockResolvedValue({ id: 'i1' });
    const res = mockRes();
    await updateIntegrationHandler(
      mockReq({ params: { id: '123e4567-e89b-12d3-a456-426614174000' }, body: { is_enabled: true } }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('testIntegrationHandler', () => {
  it('tests integration', async () => {
    (integrationsService.testIntegration as jest.Mock).mockResolvedValue({ ok: true });
    const res = mockRes();
    await testIntegrationHandler(mockReq({ params: { id: '123e4567-e89b-12d3-a456-426614174000' } }), res, next);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

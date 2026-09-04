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
  it('tests integration without draft credentials when body is empty', async () => {
    (integrationsService.testIntegration as jest.Mock).mockResolvedValue({ ok: true, status: 'ok' });
    const res = mockRes();
    const id = '123e4567-e89b-12d3-a456-426614174000';
    await testIntegrationHandler(mockReq({ params: { id }, body: {} }), res, next);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(integrationsService.testIntegration).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ id: 'u1' }),
      undefined,
    );
  });

  it('forwards draft credentials to service when provided in body', async () => {
    (integrationsService.testIntegration as jest.Mock).mockResolvedValue({ ok: true, status: 'ok' });
    const res = mockRes();
    const id = '123e4567-e89b-12d3-a456-426614174000';
    const draft = {
      phoneNumberId: '12345678901234',
      apiToken: 'EAAG...',
      apiVersion: 'v20.0',
      appSecret: 'secret',
    };
    await testIntegrationHandler(mockReq({ params: { id }, body: { credentials: draft } }), res, next);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(integrationsService.testIntegration).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ id: 'u1' }),
      draft,
    );
  });

  it('calls next with error when body contains unrecognized properties (strict mode)', async () => {
    const res = mockRes();
    const id = '123e4567-e89b-12d3-a456-426614174000';
    await testIntegrationHandler(
      mockReq({ params: { id }, body: { credentials: { token: 'abc' }, extra: 'disallowed' } }),
      res,
      next,
    );
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(res.status).not.toHaveBeenCalled();
  });

  it('calls next with error when id param is invalid', async () => {
    const res = mockRes();
    await testIntegrationHandler(mockReq({ params: { id: 'invalid-id' } }), res, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

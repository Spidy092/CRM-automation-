jest.mock('./integrations.controller', () => ({
  listIntegrationsHandler: jest.fn(),
  getIntegrationHandler: jest.fn(),
  updateIntegrationHandler: jest.fn(),
  testIntegrationHandler: jest.fn(),
}));

jest.mock('../../shared/middleware/auth', () => ({
  authenticate: jest.fn((req: any, _res: any, next: any) => {
    req.user = { id: 'u1', role: 'admin' };
    next();
  }),
}));

jest.mock('../../shared/middleware/rbac', () => ({
  authorize: jest.fn(() => (_req: any, _res: any, next: any) => next()),
}));

import express from 'express';
import request from 'supertest';
import { integrationsRoutes } from './integrations.routes';
import * as controller from './integrations.controller';

const app = express();
app.use(express.json());
app.use('/integrations', integrationsRoutes);

beforeEach(() => jest.clearAllMocks());

describe('integrations routes', () => {
  it('GET /integrations calls listIntegrationsHandler', async () => {
    (controller.listIntegrationsHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.json({ success: true, data: [] });
    });
    await request(app).get('/integrations').expect(200);
    expect(controller.listIntegrationsHandler).toHaveBeenCalled();
  });

  it('GET /integrations/:id calls getIntegrationHandler', async () => {
    (controller.getIntegrationHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.json({ success: true, data: {} });
    });
    await request(app).get('/integrations/i1').expect(200);
    expect(controller.getIntegrationHandler).toHaveBeenCalled();
  });

  it('PUT /integrations/:id calls updateIntegrationHandler', async () => {
    (controller.updateIntegrationHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.json({ success: true, data: {} });
    });
    await request(app).put('/integrations/i1').send({}).expect(200);
    expect(controller.updateIntegrationHandler).toHaveBeenCalled();
  });

  it('POST /integrations/:id/test calls testIntegrationHandler', async () => {
    (controller.testIntegrationHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.json({ success: true, data: {} });
    });
    await request(app).post('/integrations/i1/test').expect(200);
    expect(controller.testIntegrationHandler).toHaveBeenCalled();
  });
});

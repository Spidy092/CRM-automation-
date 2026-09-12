import express from 'express';
import request from 'supertest';
import { errorHandler } from '../../shared/middleware/errorHandler';
import * as workflowService from './workflow.service';
import { workflowsRoutes } from './workflow.routes';

jest.mock('./workflow.service');
jest.mock('../../shared/middleware/rateLimiter', () => ({
  authenticatedLimiter: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => next(),
}));
jest.mock('../../shared/middleware/auth', () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { id: 'user-1', role: 'admin' } as express.Request['user'];
    next();
  },
}));
jest.mock('../../shared/middleware/rbac', () => ({
  authorize:
    (..._roles: string[]) =>
    (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next(),
}));

const app = express();
app.use(express.json());
app.use('/workflows', workflowsRoutes);
app.use(errorHandler);

const id = '550e8400-e29b-41d4-a716-446655440000';
const definition = {
  name: 'New lead',
  entryNodeId: 'trigger',
  nodes: [
    { id: 'trigger', type: 'trigger', next: ['end'], trigger: { event: 'lead.created' } },
    { id: 'end', type: 'end', next: [] },
  ],
};

describe('workflow routes', () => {
  const mockedService = workflowService as jest.Mocked<typeof workflowService>;

  beforeEach(() => jest.clearAllMocks());

  it('lists workflows through the standard success envelope', async () => {
    mockedService.listWorkflows.mockResolvedValueOnce([]);
    const response = await request(app).get('/workflows');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: [] });
  });

  it('rejects malformed workflow IDs before calling the service', async () => {
    const response = await request(app).get('/workflows/not-a-uuid');
    expect(response.status).toBe(422);
    expect(mockedService.getWorkflow).not.toHaveBeenCalled();
  });

  it('creates a workflow with the authenticated actor', async () => {
    mockedService.createWorkflow.mockResolvedValueOnce({ id } as never);
    const response = await request(app).post('/workflows').send({ name: 'New lead', definition });
    expect(response.status).toBe(201);
    expect(response.body.data.id).toBe(id);
    expect(mockedService.createWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'New lead' }),
      expect.objectContaining({ id: 'user-1' }),
    );
  });

  it('rejects malformed workflow definitions', async () => {
    const response = await request(app).post('/workflows').send({ name: 'Broken' });
    expect(response.status).toBe(422);
    expect(mockedService.createWorkflow).not.toHaveBeenCalled();
  });

  it.each([
    ['publish', 'publishWorkflow'],
    ['pause', 'pauseWorkflow'],
    ['resume', 'resumeWorkflow'],
  ] as const)('routes POST /workflows/:id/%s to the service', async (action, serviceName) => {
    mockedService[serviceName].mockResolvedValueOnce({ id } as never);
    const response = await request(app).post(`/workflows/${id}/${action}`);
    expect(response.status).toBe(200);
    expect(mockedService[serviceName]).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ id: 'user-1' }),
    );
  });

  it('replays a failed enrollment through the admin workflow route', async () => {
    mockedService.replayWorkflowEnrollment.mockResolvedValueOnce({ id } as never);

    const response = await request(app).post(`/workflows/enrollments/${id}/replay`);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(id);
    expect(mockedService.replayWorkflowEnrollment).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ id: 'user-1' }),
    );
  });
});

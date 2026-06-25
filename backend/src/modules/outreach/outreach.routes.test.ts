jest.mock('./outreach.controller', () => ({
  listSequencesHandler: jest.fn(),
  getSequenceHandler: jest.fn(),
  createSequenceHandler: jest.fn(),
  updateSequenceHandler: jest.fn(),
  deleteSequenceHandler: jest.fn(),
  getLeadTimelineHandler: jest.fn(),
  getLeadLogsHandler: jest.fn(),
  createTaskHandler: jest.fn(),
  getTaskHandler: jest.fn(),
  updateTaskHandler: jest.fn(),
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

jest.mock('../../shared/middleware/rateLimiter', () => ({
  authenticatedLimiter: jest.fn((_req: any, _res: any, next: any) => next()),
}));

import express from 'express';
import request from 'supertest';
import { outreachRoutes } from './outreach.routes';
import * as controller from './outreach.controller';

const app = express();
app.use(express.json());
app.use('/outreach', outreachRoutes);

beforeEach(() => jest.clearAllMocks());

describe('outreach routes', () => {
  it('GET /outreach/sequences calls listSequencesHandler', async () => {
    (controller.listSequencesHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.json({ success: true, data: [] });
    });
    await request(app).get('/outreach/sequences').expect(200);
    expect(controller.listSequencesHandler).toHaveBeenCalled();
  });

  it('GET /outreach/sequences/:id calls getSequenceHandler', async () => {
    (controller.getSequenceHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.json({ success: true, data: {} });
    });
    await request(app).get('/outreach/sequences/s1').expect(200);
    expect(controller.getSequenceHandler).toHaveBeenCalled();
  });

  it('POST /outreach/sequences calls createSequenceHandler', async () => {
    (controller.createSequenceHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.status(201).json({ success: true, data: {} });
    });
    await request(app).post('/outreach/sequences').send({}).expect(201);
    expect(controller.createSequenceHandler).toHaveBeenCalled();
  });

  it('PUT /outreach/sequences/:id calls updateSequenceHandler', async () => {
    (controller.updateSequenceHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.json({ success: true, data: {} });
    });
    await request(app).put('/outreach/sequences/s1').send({}).expect(200);
    expect(controller.updateSequenceHandler).toHaveBeenCalled();
  });

  it('DELETE /outreach/sequences/:id calls deleteSequenceHandler', async () => {
    (controller.deleteSequenceHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.json({ success: true, data: {} });
    });
    await request(app).delete('/outreach/sequences/s1').expect(200);
    expect(controller.deleteSequenceHandler).toHaveBeenCalled();
  });

  it('GET /outreach/leads/:leadId/timeline calls getLeadTimelineHandler', async () => {
    (controller.getLeadTimelineHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.json({ success: true, data: [] });
    });
    await request(app).get('/outreach/leads/l1/timeline').expect(200);
    expect(controller.getLeadTimelineHandler).toHaveBeenCalled();
  });

  it('GET /outreach/leads/:leadId/logs calls getLeadLogsHandler', async () => {
    (controller.getLeadLogsHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.json({ success: true, data: [] });
    });
    await request(app).get('/outreach/leads/l1/logs').expect(200);
    expect(controller.getLeadLogsHandler).toHaveBeenCalled();
  });

  it('POST /outreach/tasks calls createTaskHandler', async () => {
    (controller.createTaskHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.status(201).json({ success: true, data: {} });
    });
    await request(app).post('/outreach/tasks').send({}).expect(201);
    expect(controller.createTaskHandler).toHaveBeenCalled();
  });

  it('PUT /outreach/tasks/:id calls updateTaskHandler', async () => {
    (controller.updateTaskHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.json({ success: true, data: {} });
    });
    await request(app).put('/outreach/tasks/t1').send({}).expect(200);
    expect(controller.updateTaskHandler).toHaveBeenCalled();
  });
});

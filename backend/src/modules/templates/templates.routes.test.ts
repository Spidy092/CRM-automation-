jest.mock('./templates.controller', () => ({
  listTemplatesHandler: jest.fn(),
  getTemplateHandler: jest.fn(),
  createTemplateHandler: jest.fn(),
  updateTemplateHandler: jest.fn(),
  approveTemplateHandler: jest.fn(),
  deleteTemplateHandler: jest.fn(),
  duplicateTemplateHandler: jest.fn(),
  archiveTemplateHandler: jest.fn(),
  unarchiveTemplateHandler: jest.fn(),
  renameTemplateHandler: jest.fn(),
  previewTemplateHandler: jest.fn(),
  testSendTemplateHandler: jest.fn(),
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
import { templatesRoutes } from './templates.routes';
import * as controller from './templates.controller';

const app = express();
app.use(express.json());
app.use('/templates', templatesRoutes);

beforeEach(() => jest.clearAllMocks());

describe('templates routes', () => {
  it('GET /templates calls listTemplatesHandler', async () => {
    (controller.listTemplatesHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.json({ success: true, data: [] });
    });
    await request(app).get('/templates').expect(200);
    expect(controller.listTemplatesHandler).toHaveBeenCalled();
  });

  it('GET /templates/:id calls getTemplateHandler', async () => {
    (controller.getTemplateHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.json({ success: true, data: {} });
    });
    await request(app).get('/templates/t1').expect(200);
    expect(controller.getTemplateHandler).toHaveBeenCalled();
  });

  it('POST /templates calls createTemplateHandler', async () => {
    (controller.createTemplateHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.status(201).json({ success: true, data: {} });
    });
    await request(app).post('/templates').send({}).expect(201);
    expect(controller.createTemplateHandler).toHaveBeenCalled();
  });

  it('PUT /templates/:id calls updateTemplateHandler', async () => {
    (controller.updateTemplateHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.json({ success: true, data: {} });
    });
    await request(app).put('/templates/t1').send({}).expect(200);
    expect(controller.updateTemplateHandler).toHaveBeenCalled();
  });

  it('POST /templates/:id/approve calls approveTemplateHandler', async () => {
    (controller.approveTemplateHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.json({ success: true, data: {} });
    });
    await request(app).post('/templates/t1/approve').send({}).expect(200);
    expect(controller.approveTemplateHandler).toHaveBeenCalled();
  });

  it('DELETE /templates/:id calls deleteTemplateHandler', async () => {
    (controller.deleteTemplateHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.json({ success: true, data: {} });
    });
    await request(app).delete('/templates/t1').expect(200);
    expect(controller.deleteTemplateHandler).toHaveBeenCalled();
  });

  it('POST /templates/:id/duplicate calls duplicateTemplateHandler', async () => {
    (controller.duplicateTemplateHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.status(201).json({ success: true, data: {} });
    });
    await request(app).post('/templates/t1/duplicate').send({}).expect(201);
    expect(controller.duplicateTemplateHandler).toHaveBeenCalled();
  });

  it('POST /templates/:id/archive calls archiveTemplateHandler', async () => {
    (controller.archiveTemplateHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.json({ success: true, data: {} });
    });
    await request(app).post('/templates/t1/archive').expect(200);
    expect(controller.archiveTemplateHandler).toHaveBeenCalled();
  });

  it('POST /templates/:id/unarchive calls unarchiveTemplateHandler', async () => {
    (controller.unarchiveTemplateHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.json({ success: true, data: {} });
    });
    await request(app).post('/templates/t1/unarchive').expect(200);
    expect(controller.unarchiveTemplateHandler).toHaveBeenCalled();
  });

  it('PATCH /templates/:id/rename calls renameTemplateHandler', async () => {
    (controller.renameTemplateHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.json({ success: true, data: {} });
    });
    await request(app).patch('/templates/t1/rename').send({ name: 'New' }).expect(200);
    expect(controller.renameTemplateHandler).toHaveBeenCalled();
  });

  it('POST /templates/:id/preview calls previewTemplateHandler', async () => {
    (controller.previewTemplateHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.json({ success: true, data: {} });
    });
    await request(app).post('/templates/t1/preview').send({}).expect(200);
    expect(controller.previewTemplateHandler).toHaveBeenCalled();
  });

  it('POST /templates/:id/test-send calls testSendTemplateHandler', async () => {
    (controller.testSendTemplateHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.json({ success: true, data: {} });
    });
    await request(app).post('/templates/t1/test-send').send({ to: 'owner@example.com' }).expect(200);
    expect(controller.testSendTemplateHandler).toHaveBeenCalled();
  });
});

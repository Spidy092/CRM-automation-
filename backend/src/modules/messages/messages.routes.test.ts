jest.mock('./messages.controller', () => ({
  listMessageSnippetsHandler: jest.fn(),
  getMessageSnippetHandler: jest.fn(),
  createMessageSnippetHandler: jest.fn(),
  updateMessageSnippetHandler: jest.fn(),
  deleteMessageSnippetHandler: jest.fn(),
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
import { messagesRoutes } from './messages.routes';
import * as controller from './messages.controller';

const app = express();
app.use(express.json());
app.use('/messages', messagesRoutes);

beforeEach(() => jest.clearAllMocks());

describe('messages routes', () => {
  it('GET /messages calls listMessageSnippetsHandler', async () => {
    (controller.listMessageSnippetsHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.json({ success: true, data: [] });
    });
    await request(app).get('/messages').expect(200);
    expect(controller.listMessageSnippetsHandler).toHaveBeenCalled();
  });

  it('GET /messages/:id calls getMessageSnippetHandler', async () => {
    (controller.getMessageSnippetHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.json({ success: true, data: {} });
    });
    await request(app).get('/messages/m1').expect(200);
    expect(controller.getMessageSnippetHandler).toHaveBeenCalled();
  });

  it('POST /messages calls createMessageSnippetHandler', async () => {
    (controller.createMessageSnippetHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.status(201).json({ success: true, data: {} });
    });
    await request(app).post('/messages').send({}).expect(201);
    expect(controller.createMessageSnippetHandler).toHaveBeenCalled();
  });

  it('PUT /messages/:id calls updateMessageSnippetHandler', async () => {
    (controller.updateMessageSnippetHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.json({ success: true, data: {} });
    });
    await request(app).put('/messages/m1').send({}).expect(200);
    expect(controller.updateMessageSnippetHandler).toHaveBeenCalled();
  });

  it('DELETE /messages/:id calls deleteMessageSnippetHandler', async () => {
    (controller.deleteMessageSnippetHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.json({ success: true, data: {} });
    });
    await request(app).delete('/messages/m1').expect(200);
    expect(controller.deleteMessageSnippetHandler).toHaveBeenCalled();
  });
});

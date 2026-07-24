jest.mock('./files.controller', () => ({
  listFilesHandler: jest.fn(),
  getFileHandler: jest.fn(),
  uploadFileHandler: jest.fn(),
  updateFileHandler: jest.fn(),
  deleteFileHandler: jest.fn(),
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
import { filesRoutes } from './files.routes';
import * as controller from './files.controller';

const app = express();
app.use(express.json());
app.use('/files', filesRoutes);

beforeEach(() => jest.clearAllMocks());

describe('files routes', () => {
  it('GET /files calls listFilesHandler', async () => {
    (controller.listFilesHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.json({ success: true, data: [] });
    });
    await request(app).get('/files').expect(200);
    expect(controller.listFilesHandler).toHaveBeenCalled();
  });

  it('GET /files/:id calls getFileHandler', async () => {
    (controller.getFileHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.json({ success: true, data: {} });
    });
    await request(app).get('/files/f1').expect(200);
    expect(controller.getFileHandler).toHaveBeenCalled();
  });

  it('POST /files calls uploadFileHandler', async () => {
    (controller.uploadFileHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.status(201).json({ success: true, data: {} });
    });
    await request(app).post('/files').attach('file', Buffer.from('x'), 'a.png').expect(201);
    expect(controller.uploadFileHandler).toHaveBeenCalled();
  });

  it('PATCH /files/:id calls updateFileHandler', async () => {
    (controller.updateFileHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.json({ success: true, data: {} });
    });
    await request(app).patch('/files/f1').send({ filename: 'x.png' }).expect(200);
    expect(controller.updateFileHandler).toHaveBeenCalled();
  });

  it('DELETE /files/:id calls deleteFileHandler', async () => {
    (controller.deleteFileHandler as jest.Mock).mockImplementation((_req: any, res: any) => {
      res.json({ success: true, data: {} });
    });
    await request(app).delete('/files/f1').expect(200);
    expect(controller.deleteFileHandler).toHaveBeenCalled();
  });
});

import request from 'supertest';
import express from 'express';
import { scraperRoutes } from './scraper.routes';

jest.mock('../../shared/middleware/auth', () => ({
  authenticate: (req: any, res: any, next: any) => {
    req.user = { id: '1', role: 'admin' };
    next();
  },
}));

jest.mock('../../shared/middleware/rbac', () => ({
  authorize: () => (req: any, res: any, next: any) => next(),
}));

jest.mock('../../shared/middleware/rateLimiter', () => ({
  authenticatedLimiter: (req: any, res: any, next: any) => next(),
}));

jest.mock('./scraper.controller', () => ({
  listConfigsHandler: (req: any, res: any) => res.status(200).json({ success: true, data: [] }),
  getConfigHandler: (req: any, res: any) => res.status(200).json({ success: true, data: {} }),
  createConfigHandler: (req: any, res: any) => res.status(201).json({ success: true, data: { id: '1' } }),
  updateConfigHandler: (req: any, res: any) => res.status(200).json({ success: true, data: {} }),
  deleteConfigHandler: (req: any, res: any) => res.status(200).json({ success: true }),
  triggerScrapeHandler: (req: any, res: any) => res.status(200).json({ success: true }),
  listLogsHandler: (req: any, res: any) => res.status(200).json({ success: true, data: [] }),
}));

describe('Scraper Routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/scraper', scraperRoutes);

  it('GET /scraper', async () => {
    const res = await request(app).get('/scraper');
    expect(res.status).toBe(200);
  });

  it('POST /scraper', async () => {
    const res = await request(app)
      .post('/scraper')
      .send({ name: 'Test', source_type: 'google_places', config: { query: 't' } });
    expect(res.status).toBe(201);
  });
});

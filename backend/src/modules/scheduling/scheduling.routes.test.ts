import request from 'supertest';
import express, { NextFunction, Request, Response } from 'express';
import { schedulingRoutes } from './scheduling.routes';

jest.mock('./scheduling.controller', () => ({
  getAvailabilityHandler: jest.fn((req, res) => res.json({ ok: true })),
  setAvailabilityHandler: jest.fn((req, res) => res.json({ ok: true })),
  getAvailableSlotsHandler: jest.fn((req, res) => res.json({ ok: true })),
  listBookingUrlsHandler: jest.fn((req, res) => res.json({ ok: true })),
  getBookingUrlHandler: jest.fn((req, res) => res.json({ ok: true })),
  createBookingUrlHandler: jest.fn((req, res) => res.json({ ok: true })),
  updateBookingUrlHandler: jest.fn((req, res) => res.json({ ok: true })),
  getPublicBookingPageHandler: jest.fn((req, res) => res.json({ ok: true })),
  getPublicAvailableSlotsHandler: jest.fn((req, res) => res.json({ ok: true })),
  createPublicBookingHandler: jest.fn((req, res) => res.json({ ok: true })),
  listBookingsHandler: jest.fn((req, res) => res.json({ ok: true })),
  cancelBookingHandler: jest.fn((req, res) => res.json({ ok: true })),
  getRoundRobinUserHandler: jest.fn((req, res) => res.json({ ok: true })),
}));

jest.mock('../../shared/middleware/auth', () => ({
  authenticate: (req: Request, res: Response, next: NextFunction) => {
    req.user = { id: 'user-1', role: 'admin', email: 'a@b.com', name: 'Admin' };
    next();
  },
}));
jest.mock('../../shared/middleware/rbac', () => ({
  authorize: jest.fn(() => (req: Request, res: Response, next: NextFunction) => next()),
}));
jest.mock('../../shared/middleware/rateLimiter', () => ({
  authenticatedLimiter: (req: Request, res: Response, next: NextFunction) => next(),
  publicLimiter: (req: Request, res: Response, next: NextFunction) => next(),
}));

const app = express();
app.use(express.json());
app.use('/scheduling', schedulingRoutes);

describe('scheduling.routes', () => {
  it('GET /book/:slug is public', async () => {
    const res = await request(app).get('/scheduling/book/slug-1');
    expect(res.status).toBe(200);
  });

  it('GET /book/:slug/slots is public', async () => {
    const res = await request(app).get('/scheduling/book/slug-1/slots');
    expect(res.status).toBe(200);
  });

  it('POST /book/:slug is public', async () => {
    const res = await request(app).post('/scheduling/book/slug-1').send({});
    expect(res.status).toBe(200);
  });

  it('GET /availability requires auth', async () => {
    const res = await request(app).get('/scheduling/availability');
    expect(res.status).toBe(200);
  });

  it('PUT /availability requires auth and role', async () => {
    const res = await request(app).put('/scheduling/availability').send({});
    expect(res.status).toBe(200);
  });

  it('GET /availability/slots requires auth', async () => {
    const res = await request(app).get('/scheduling/availability/slots');
    expect(res.status).toBe(200);
  });

  it('GET /urls requires auth', async () => {
    const res = await request(app).get('/scheduling/urls');
    expect(res.status).toBe(200);
  });

  it('GET /urls/:id requires auth', async () => {
    const res = await request(app).get('/scheduling/urls/id-1');
    expect(res.status).toBe(200);
  });

  it('POST /urls requires auth and role', async () => {
    const res = await request(app).post('/scheduling/urls').send({});
    expect(res.status).toBe(200);
  });

  it('PUT /urls/:id requires auth and role', async () => {
    const res = await request(app).put('/scheduling/urls/id-1').send({});
    expect(res.status).toBe(200);
  });

  it('GET /bookings requires auth', async () => {
    const res = await request(app).get('/scheduling/bookings');
    expect(res.status).toBe(200);
  });

  it('POST /bookings/:bookingId/cancel requires auth', async () => {
    const res = await request(app).post('/scheduling/bookings/b-1/cancel').send({});
    expect(res.status).toBe(200);
  });

  it('GET /round-robin requires auth and role', async () => {
    const res = await request(app).get('/scheduling/round-robin');
    expect(res.status).toBe(200);
  });
});

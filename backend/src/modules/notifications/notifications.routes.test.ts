import request from 'supertest';
import express, { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { notificationsRoutes } from './notifications.routes';
import { consumeSseTicket } from './notifications.controller';

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn(),
}));
jest.mock('./notifications.controller', () => ({
  sseHandler: jest.fn((req: Request, res: Response) => res.status(200).json({ ok: true })),
  mintSseTicketHandler: jest.fn((req: Request, res: Response) =>
    res.status(200).json({ ok: true }),
  ),
  consumeSseTicket: jest.fn(),
}));
jest.mock('../../shared/middleware/auth', () => ({
  authenticate: (req: Request, res: Response, next: NextFunction) => {
    req.user = { id: 'user-1', role: 'admin', email: 'a@b.com', name: 'Admin' };
    next();
  },
}));
jest.mock('../../shared/middleware/rateLimiter', () => ({
  authenticatedLimiter: (req: Request, res: Response, next: NextFunction) => next(),
}));

const app = express();
app.use(express.json());
app.use('/notifications', notificationsRoutes);

const mockConsumeSseTicket = consumeSseTicket as jest.Mock;

describe('notifications.routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_PUBLIC_KEY = 'public-key';
  });

  it('POST /ticket goes through auth + rate limiter to mintSseTicketHandler', async () => {
    const res = await request(app).post('/notifications/ticket');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  describe('GET / (authenticateSSE)', () => {
    it('authenticates via a valid ticket query param', async () => {
      mockConsumeSseTicket.mockResolvedValue({
        id: 'u1',
        role: 'sales',
        email: 'x@y.com',
        name: 'X',
      });
      const res = await request(app).get('/notifications').query({ ticket: 'valid-ticket' });
      expect(res.status).toBe(200);
      expect(mockConsumeSseTicket).toHaveBeenCalledWith('valid-ticket');
    });

    it('returns 401 for an invalid or expired ticket', async () => {
      mockConsumeSseTicket.mockResolvedValue(null);
      const res = await request(app).get('/notifications').query({ ticket: 'bad-ticket' });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ success: false, error: 'Invalid or expired ticket' });
    });

    it('returns 500 when consumeSseTicket throws', async () => {
      mockConsumeSseTicket.mockRejectedValue(new Error('redis down'));
      const res = await request(app).get('/notifications').query({ ticket: 'bad-ticket' });
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ success: false, error: 'Server misconfiguration' });
    });

    it('returns 401 when no ticket and no Bearer token are present', async () => {
      const res = await request(app).get('/notifications');
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ success: false, error: 'Unauthorized' });
    });

    it('returns 500 when JWT_PUBLIC_KEY is not configured', async () => {
      delete process.env.JWT_PUBLIC_KEY;
      const res = await request(app)
        .get('/notifications')
        .set('Authorization', 'Bearer sometoken');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ success: false, error: 'Server misconfiguration' });
    });

    it('authenticates via a valid Bearer JWT', async () => {
      (jwt.verify as jest.Mock).mockReturnValue({
        id: 'u2',
        role: 'manager',
        email: 'm@y.com',
        name: 'M',
        iat: 1,
        exp: 2,
      });
      const res = await request(app)
        .get('/notifications')
        .set('Authorization', 'Bearer validtoken');
      expect(res.status).toBe(200);
    });

    it('returns 401 for an invalid Bearer JWT', async () => {
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error('bad signature');
      });
      const res = await request(app).get('/notifications').set('Authorization', 'Bearer bad');
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ success: false, error: 'Invalid or expired token' });
    });
  });
});

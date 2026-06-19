import request from 'supertest';
import express from 'express';
import { authRoutes } from './auth.routes';
import * as authService from './auth.service';

jest.mock('./auth.service');
jest.mock('../../shared/middleware/rateLimiter', () => ({
  publicLimiter: (req: any, res: any, next: any) => next(),
  authenticatedLimiter: (req: any, res: any, next: any) => next(),
}));
jest.mock('../../shared/middleware/auth', () => ({
  authenticate: jest.fn((req: any, res: any, next: any) => {
    req.user = { id: 'user-1', role: 'admin' };
    next();
  }),
}));

import { errorHandler } from '../../shared/middleware/errorHandler';
import { authenticate } from '../../shared/middleware/auth';

const app = express();
app.use(express.json());
app.use('/auth', authRoutes);
app.use(errorHandler);

describe('Auth Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /auth/login', () => {
    it('returns 200 and tokens on successful login', async () => {
      (authService.login as jest.Mock).mockResolvedValue({
        accessToken: 'access',
        refreshToken: 'refresh',
        user: { id: 'user-1', email: 'test@example.com' },
      });

      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'test@example.com', password: 'password123' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBe('access');
    });

    it('returns 422 if validation fails', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'not-an-email' });

      expect(res.status).toBe(422);
    });
  });

  describe('POST /auth/refresh', () => {
    it('returns 200 and new tokens on successful refresh', async () => {
      (authService.refresh as jest.Mock).mockResolvedValue({
        accessToken: 'new-access',
      });

      const res = await request(app)
        .post('/auth/refresh')
        .send({ refreshToken: 'valid-refresh' });

      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toBe('new-access');
    });
  });

  describe('POST /auth/logout', () => {
    it('returns 200 on successful logout', async () => {
      (authService.logout as jest.Mock).mockResolvedValue(undefined);

      const res = await request(app)
        .post('/auth/logout')
        .send({ refreshToken: 'valid-refresh' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /auth/me', () => {
    it('returns 200 and current user', async () => {
      const res = await request(app)
        .get('/auth/me');

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe('user-1');
    });

    it('returns 401 if user is not set', async () => {
      (authenticate as jest.Mock).mockImplementationOnce((req: any, res: any, next: any) => {
        req.user = undefined;
        next();
      });

      const res = await request(app).get('/auth/me');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /auth/forgot-password', () => {
    it('returns 200 on valid email', async () => {
      (authService.forgotPassword as jest.Mock).mockResolvedValue({ resetToken: 'tok' });
      const res = await request(app)
        .post('/auth/forgot-password')
        .send({ email: 'test@example.com' });
      expect(res.status).toBe(200);
    });

    it('returns 422 if email is missing', async () => {
      const res = await request(app)
        .post('/auth/forgot-password')
        .send({});
      expect(res.status).toBe(422);
    });
  });

  describe('POST /auth/reset-password', () => {
    it('returns 200 on success', async () => {
      (authService.resetPassword as jest.Mock).mockResolvedValue(undefined);
      const res = await request(app)
        .post('/auth/reset-password')
        .send({ token: 'tok', newPassword: 'NewPassword123' });
      expect(res.status).toBe(200);
    });

    it('returns 422 on validation error', async () => {
      const res = await request(app)
        .post('/auth/reset-password')
        .send({ token: 'tok' });
      expect(res.status).toBe(422);
    });
  });
});

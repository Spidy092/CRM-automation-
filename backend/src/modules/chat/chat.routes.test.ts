import request from 'supertest';
import express from 'express';
import chatRoutes from './chat.routes';
import * as service from './chat.service';
import { errorHandler } from '../../shared/middleware/errorHandler';
import type { ChatResponse, ChatTurn } from './chat.types';

jest.mock('./chat.service');
jest.mock('../../shared/middleware/rateLimiter', () => ({
  authenticatedLimiter: (req: any, res: any, next: any) => next(),
}));
jest.mock('../../shared/middleware/auth', () => ({
  authenticate: (req: any, res: any, next: any) => {
    req.user = { id: 'user-1', role: 'admin', email: 'admin@example.com' };
    next();
  },
}));
jest.mock('../../shared/middleware/rbac', () => ({
  authorize: jest.fn((...roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Forbidden: insufficient permissions' });
    }
    next();
  }),
}));

const app = express();
app.use(express.json());
app.use('/chat', chatRoutes);
app.use(errorHandler);

const mockedService = service as jest.Mocked<typeof service>;

const fakeTurn: ChatTurn = {
  role: 'assistant',
  content: 'Hello, how can I help?',
  createdAt: '2026-06-29T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Chat Routes', () => {
  describe('POST /chat', () => {
    it('returns 200 on execute_now policy', async () => {
      const response: ChatResponse = {
        conversationId: 'conv-1',
        reply: 'Here is your dashboard',
        action: {
          name: 'report.dashboard',
          policy: { outcome: 'execute_now', reason: 'low risk' },
          agentAction: null,
          result: { totalLeads: 100 },
        },
      };
      mockedService.sendChatMessage.mockResolvedValue(response);

      const res = await request(app)
        .post('/chat')
        .send({ conversationId: 'conv-1', message: 'show me the dashboard' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.reply).toBe('Here is your dashboard');
      expect(res.body.data.action.policy.outcome).toBe('execute_now');
      expect(mockedService.sendChatMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-1',
          message: 'show me the dashboard',
        }),
      );
    });

    it('returns 202 on require_approval policy', async () => {
      const response: ChatResponse = {
        conversationId: 'conv-1',
        reply: 'I prepared the action for approval',
        action: {
          name: 'campaign.launch',
          policy: {
            outcome: 'require_approval',
            reason: 'sensitive write',
            assignTo: 'manager-1',
          },
          agentAction: null,
          result: undefined,
        },
      };
      mockedService.sendChatMessage.mockResolvedValue(response);

      const res = await request(app)
        .post('/chat')
        .send({ conversationId: 'conv-1', message: 'launch the summer campaign' });

      expect(res.status).toBe(202);
      expect(res.body.success).toBe(true);
      expect(res.body.data.action.policy.outcome).toBe('require_approval');
    });

    it('returns 400 when message is missing', async () => {
      const res = await request(app)
        .post('/chat')
        .send({ conversationId: 'conv-1' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when conversationId is empty', async () => {
      const res = await request(app)
        .post('/chat')
        .send({ conversationId: '', message: 'hi' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('forwards service errors to the error handler', async () => {
      mockedService.sendChatMessage.mockRejectedValue(new Error('boom'));

      const res = await request(app)
        .post('/chat')
        .send({ conversationId: 'conv-1', message: 'show leads' });

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /chat/history/:conversationId', () => {
    it('returns 200 with history items', async () => {
      mockedService.getChatHistory.mockResolvedValue([fakeTurn]);

      const res = await request(app).get('/chat/history/conv-1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].content).toBe('Hello, how can I help?');
      expect(mockedService.getChatHistory).toHaveBeenCalledWith('conv-1');
    });

    it('returns 200 with empty array when no history', async () => {
      mockedService.getChatHistory.mockResolvedValue([]);

      const res = await request(app).get('/chat/history/conv-empty');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });
  });

  describe('RBAC enforcement', () => {
    it('returns 403 for an unauthorized role', async () => {
      jest.resetModules();
      jest.doMock('../../shared/middleware/auth', () => ({
        authenticate: (req: any, res: any, next: any) => {
          req.user = { id: 'guest-1', role: 'guest' };
          next();
        },
      }));

      const { default: routesWithGuest } = await import('./chat.routes');
      const testApp = express();
      testApp.use(express.json());
      testApp.use('/chat', routesWithGuest);
      testApp.use(errorHandler);

      mockedService.getChatHistory.mockResolvedValue([fakeTurn]);

      const res = await request(testApp).get('/chat/history/conv-1');

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Forbidden');
    });

    it('returns 401 when unauthenticated', async () => {
      jest.resetModules();
      jest.doMock('../../shared/middleware/auth', () => ({
        authenticate: (req: any, res: any, next: any) => {
          res.status(401).json({ success: false, error: 'Unauthorized' });
        },
      }));

      const { default: routesWithNoAuth } = await import('./chat.routes');
      const testApp = express();
      testApp.use(express.json());
      testApp.use('/chat', routesWithNoAuth);
      testApp.use(errorHandler);

      const res = await request(testApp).get('/chat/history/conv-1');

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Unauthorized');
    });
  });
});

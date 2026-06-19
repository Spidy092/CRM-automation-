import request from 'supertest';
import express from 'express';
import { scoringRoutes } from './scoring.routes';
import * as scoringService from './scoring.service';

jest.mock('./scoring.service');

jest.mock('../../shared/middleware/rateLimiter', () => ({
  authenticatedLimiter: (req: any, res: any, next: any) => next(),
}));
jest.mock('../../shared/middleware/auth', () => ({
  authenticate: (req: any, res: any, next: any) => {
    req.user = { id: 'admin-1', role: 'admin' };
    next();
  },
}));
jest.mock('../../shared/middleware/rbac', () => ({
  authorize: (...roles: string[]) => (req: any, res: any, next: any) => next(),
}));

import { errorHandler } from '../../shared/middleware/errorHandler';

const app = express();
app.use(express.json());
app.use('/scoring', scoringRoutes);
app.use(errorHandler);

describe('Scoring Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /scoring/config', () => {
    it('returns 200 and config', async () => {
      (scoringService.getConfig as jest.Mock).mockResolvedValue({ id: 'config-1' });

      const res = await request(app).get('/scoring/config');

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe('config-1');
    });
  });

  describe('PUT /scoring/config', () => {
    it('returns 200 on successful config update', async () => {
      (scoringService.updateConfig as jest.Mock).mockResolvedValue({
        id: 'config-1',
        hot_min_score: 80,
      });

      const res = await request(app)
        .put('/scoring/config')
        .send({ hot_min_score: 80 });

      expect(res.status).toBe(200);
      expect(res.body.data.hot_min_score).toBe(80);
    });

    it('returns 422 if validation fails', async () => {
      const res = await request(app)
        .put('/scoring/config')
        .send({ hot_min_score: 150 });

      expect(res.status).toBe(422);
    });
  });

  describe('GET /scoring/rules', () => {
    it('returns 200 and rules list', async () => {
      (scoringService.getAllRules as jest.Mock).mockResolvedValue([{ id: 'rule-1' }]);

      const res = await request(app).get('/scoring/rules');

      expect(res.status).toBe(200);
      expect(res.body.data[0].id).toBe('rule-1');
    });
  });

  describe('GET /scoring/rules/:id', () => {
    it('returns 200 and a rule', async () => {
      (scoringService.getRuleById as jest.Mock).mockResolvedValue({ id: 'rule-1' });

      const res = await request(app).get('/scoring/rules/rule-1');

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe('rule-1');
    });
  });

  describe('POST /scoring/rules', () => {
    it('returns 201 on create', async () => {
      (scoringService.createRule as jest.Mock).mockResolvedValue({ id: 'rule-1' });

      const res = await request(app)
        .post('/scoring/rules')
        .send({
          factor: 'has_website',
          weight: 10,
          condition: { eq: 'Tech' },
          score_value: 50,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe('rule-1');
    });

    it('returns 422 if validation fails', async () => {
      const res = await request(app)
        .post('/scoring/rules')
        .send({ weight: 150 });

      expect(res.status).toBe(422);
    });
  });

  describe('PUT /scoring/rules/:id', () => {
    it('returns 200 on update', async () => {
      (scoringService.updateRuleById as jest.Mock).mockResolvedValue({
        id: 'rule-1',
        weight: 20,
      });

      const res = await request(app)
        .put('/scoring/rules/rule-1')
        .send({ weight: 20 });

      expect(res.status).toBe(200);
      expect(res.body.data.weight).toBe(20);
    });
  });

  describe('DELETE /scoring/rules/:id', () => {
    it('returns 204 on delete', async () => {
      (scoringService.deleteRuleById as jest.Mock).mockResolvedValue(undefined);

      const res = await request(app).delete('/scoring/rules/rule-1');

      expect(res.status).toBe(204);
    });
  });

  describe('POST /scoring/calculate/:leadId', () => {
    it('returns 200 on calculate', async () => {
      (scoringService.calculateLeadScore as jest.Mock).mockResolvedValue({
        lead_id: 'lead-1',
        score: 85,
        classification: 'hot',
        factors: [],
      });

      const res = await request(app).post('/scoring/calculate/lead-1');

      expect(res.status).toBe(200);
      expect(res.body.data.score).toBe(85);
    });
  });

  describe('POST /scoring/recalculate-all', () => {
    it('returns 200 on recalculate all', async () => {
      (scoringService.recalculateAllScores as jest.Mock).mockResolvedValue({ processed: 100 });

      const res = await request(app).post('/scoring/recalculate-all');

      expect(res.status).toBe(200);
      expect(res.body.data.processed).toBe(100);
    });
  });
});

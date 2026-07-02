import request from 'supertest';
import express from 'express';
import router from '../plan.routes';
import * as plannerService from '../planner.service';
import * as runnerService from '../runner.service';

jest.mock('../../../shared/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-1', role: 'admin', email: 'a@b.com', name: 'A' };
    next();
  },
}));
jest.mock('../../../shared/middleware/rbac', () => ({
  authorize: (..._roles: string[]) => (_req: any, _res: any, next: any) => next(),
}));

describe('plan routes', () => {
  let app: express.Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/chat/plans', router);
  });
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GET /chat/plans/:id returns the plan with steps', async () => {
    jest.spyOn(plannerService, 'getPlanForPreview').mockResolvedValue({
      plan: {
        id: 'plan-1',
        goal: 'x',
        status: 'proposed',
        autonomy_level: 'supervised',
        confidence: null,
        source: 'chat',
        requested_by: 'user-1',
        source_message: null,
        cost_cap_cents: 50,
        step_cap: 8,
        cost_used_cents: 0,
        deadline_at: null,
        started_at: null,
        completed_at: null,
        expires_at: null,
        error_message: null,
        created_at: '',
        updated_at: '',
        idempotency_key: '',
        conversation_id: null,
      } as any,
      steps: [],
      estimatedCostCents: 5,
      requiresApproval: true,
    });

    const res = await request(app).get('/chat/plans/plan-1');
    expect(res.status).toBe(200);
    expect(res.body.data.estimatedCostCents).toBe(5);
  });

  it('GET /chat/plans/:id returns 404 when plan missing', async () => {
    jest.spyOn(plannerService, 'getPlanForPreview').mockResolvedValue(null);
    const res = await request(app).get('/chat/plans/missing');
    expect(res.status).toBe(404);
  });

  it('POST /chat/plans/:id/approve triggers executePlan', async () => {
    jest
      .spyOn(runnerService, 'executePlan')
      .mockResolvedValue({ planId: 'plan-1', status: 'running', errorMessage: null });
    const res = await request(app).post('/chat/plans/plan-1/approve').send({});
    expect(res.status).toBe(200);
    expect(runnerService.executePlan).toHaveBeenCalledWith(
      'plan-1',
      expect.objectContaining({ id: 'user-1' }),
    );
  });

  it('POST /chat/plans/:id/cancel triggers cancelPlan', async () => {
    jest
      .spyOn(runnerService, 'cancelPlan')
      .mockResolvedValue({ planId: 'plan-1', status: 'cancelled', errorMessage: null });
    const res = await request(app).post('/chat/plans/plan-1/cancel').send({});
    expect(res.status).toBe(200);
    expect(runnerService.cancelPlan).toHaveBeenCalledWith('plan-1');
  });
});

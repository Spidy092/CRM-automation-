import { AppError } from '../../../shared/middleware/errorHandler';
import { PlannerError, RunnerError, mapCodeToHttp } from '../errors';

describe('errors', () => {
  it('PlannerError extends AppError and carries the code', () => {
    const err = new PlannerError('invalid_plan', 'bad plan', { steps: [] });
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('invalid_plan');
    expect(err.statusCode).toBe(422);
  });

  it('RunnerError extends AppError and carries planId', () => {
    const err = new RunnerError('budget_exhausted', 'over cap', 'plan-1', 3);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('budget_exhausted');
    expect(err.planId).toBe('plan-1');
    expect(err.stepIndex).toBe(3);
    expect(err.statusCode).toBe(409);
  });

  it('mapCodeToHttp returns correct codes', () => {
    expect(mapCodeToHttp('invalid_plan')).toBe(422);
    expect(mapCodeToHttp('planner_timeout')).toBe(504);
    expect(mapCodeToHttp('planner_malformed')).toBe(502);
    expect(mapCodeToHttp('compliance_in_plan')).toBe(422);
    expect(mapCodeToHttp('budget_exhausted')).toBe(409);
    expect(mapCodeToHttp('step_failed')).toBe(409);
    expect(mapCodeToHttp('recovery_exhausted')).toBe(500);
    expect(mapCodeToHttp('approval_timeout')).toBe(409);
  });
});

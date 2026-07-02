jest.mock('../../../workers/queue', () => ({
  Queue: jest.fn(),
  Worker: jest.fn(),
  getBullConnection: jest.fn(),
  queues: {},
}));

import {
  incPlanCreated,
  incPlanSucceeded,
  incPlanFailed,
  incStepExecuted,
  incPlanError,
  observePlanDuration,
  observeStepDuration,
} from '../metrics';

describe('agent-planner metrics', () => {
  it('incPlanCreated does not throw', () => {
    expect(() => incPlanCreated({ source: 'chat', autonomyLevel: 'supervised' })).not.toThrow();
  });

  it('incPlanSucceeded does not throw', () => {
    expect(() => incPlanSucceeded({ autonomyLevel: 'supervised' })).not.toThrow();
  });

  it('incPlanFailed does not throw', () => {
    expect(() => incPlanFailed({ autonomyLevel: 'guarded', reason: 'step_failed' })).not.toThrow();
  });

  it('incStepExecuted does not throw', () => {
    expect(() => incStepExecuted({ action: 'lead.list', riskTier: 'read', outcome: 'succeeded' })).not.toThrow();
  });

  it('incPlanError does not throw', () => {
    expect(() => incPlanError({ code: 'invalid_plan' })).not.toThrow();
  });

  it('observePlanDuration does not throw', () => {
    expect(() => observePlanDuration({ autonomyLevel: 'supervised' }, 1.5)).not.toThrow();
  });

  it('observeStepDuration does not throw', () => {
    expect(() => observeStepDuration({ riskTier: 'read' }, 0.3)).not.toThrow();
  });
});
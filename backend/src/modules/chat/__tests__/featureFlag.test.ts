import { isAgentPlannerEnabled } from '../featureFlag';

describe('isAgentPlannerEnabled', () => {
  const original = process.env.AGENT_PLANNER_ENABLED;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (original === undefined) delete process.env.AGENT_PLANNER_ENABLED;
    else process.env.AGENT_PLANNER_ENABLED = original;
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('defaults to true in non-production', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.AGENT_PLANNER_ENABLED;
    expect(isAgentPlannerEnabled()).toBe(true);
  });

  it('defaults to false in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.AGENT_PLANNER_ENABLED;
    expect(isAgentPlannerEnabled()).toBe(false);
  });

  it('respects explicit "true" override', () => {
    process.env.AGENT_PLANNER_ENABLED = 'true';
    expect(isAgentPlannerEnabled()).toBe(true);
  });

  it('respects explicit "false" override', () => {
    process.env.NODE_ENV = 'development';
    process.env.AGENT_PLANNER_ENABLED = 'false';
    expect(isAgentPlannerEnabled()).toBe(false);
  });
});

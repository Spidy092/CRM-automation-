jest.mock('../../../workers/queue');

// @ts-ignore - JS migration has no .d.ts; we only read its exported functions
import migration from '../../../../../migrations/1750000000030_agent-plans';

describe('migration 1750000000030_agent-plans', () => {
  it('exports up and down functions', () => {
    expect(typeof migration.up).toBe('function');
    expect(typeof migration.down).toBe('function');
  });

  it('up creates agent_plans and agent_plan_steps', () => {
    const pgm = createMockPgm();
    migration.up(pgm);

    expect(pgm.createTable).toHaveBeenCalledWith('agent_plans', expect.any(Object));
    expect(pgm.createTable).toHaveBeenCalledWith('agent_plan_steps', expect.any(Object));
    expect(pgm.addColumn).toHaveBeenCalledWith('agent_actions', expect.any(Object));
    expect(pgm.addColumn).toHaveBeenCalledWith('ai_inbox_items', expect.any(Object));
  });

  it('down drops agent_plans and agent_plan_steps', () => {
    const pgm = createMockPgm();
    migration.down(pgm);

    expect(pgm.dropTable).toHaveBeenCalledWith('agent_plan_steps');
    expect(pgm.dropTable).toHaveBeenCalledWith('agent_plans');
    expect(pgm.dropColumns).toHaveBeenCalledWith('agent_actions', expect.arrayContaining(['agent_plan_id', 'agent_plan_step_id']));
    expect(pgm.dropColumns).toHaveBeenCalledWith('ai_inbox_items', expect.arrayContaining(['agent_plan_id', 'agent_plan_step_id']));
  });
});

function createMockPgm() {
  return {
    func: jest.fn((name) => name),
    createTable: jest.fn(),
    dropTable: jest.fn(),
    addColumn: jest.fn(),
    dropColumns: jest.fn(),
    createIndex: jest.fn(),
    dropIndex: jest.fn(),
    addConstraint: jest.fn(),
  };
}
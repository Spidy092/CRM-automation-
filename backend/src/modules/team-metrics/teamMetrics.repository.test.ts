import { pool } from '../../shared/utils/db';
import { findTeamMetrics } from './teamMetrics.repository';

jest.mock('../../shared/utils/db', () => ({
  pool: { query: jest.fn() },
}));

const mockPoolQuery = pool.query as unknown as jest.Mock;

function mockResult(rows: unknown[]) {
  return Promise.resolve({
    rows,
    command: 'SELECT',
    oid: 0,
    fields: [],
    rowCount: rows.length,
  } as any);
}

describe('teamMetrics.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns formatted metrics for admin with stage filter', async () => {
    mockPoolQuery.mockResolvedValue(
      mockResult([
        {
          user_id: 'u1',
          name: 'Alice',
          assigned_count: '10',
          contacted_count: '5',
          contacted_pct: '50.00',
          avg_response_time: '3600.5',
          total_activities: '8',
        },
        {
          user_id: 'u2',
          name: 'Bob',
          assigned_count: '4',
          contacted_count: '0',
          contacted_pct: null,
          avg_response_time: null,
          total_activities: '1',
        },
      ]),
    );

    const res = await findTeamMetrics(
      { from: new Date('2026-01-01'), to: new Date('2026-01-31'), stage: 'stage-1' },
      'admin-1',
      'admin',
    );

    expect(res).toHaveLength(2);
    expect(res[0]).toMatchObject({
      user_id: 'u1',
      name: 'Alice',
      assigned_count: 10,
      contacted_count: 5,
      contacted_pct: 50,
      avg_response_time: 3600.5,
      total_activities: 8,
    });
    expect(res[1]).toMatchObject({
      user_id: 'u2',
      name: 'Bob',
      assigned_count: 4,
      contacted_count: 0,
      contacted_pct: null,
      avg_response_time: null,
      total_activities: 1,
    });

    const [sql, params] = mockPoolQuery.mock.calls[0];
    expect(sql).toContain('FROM users u');
    expect(sql).toContain('l.pipeline_stage_id = $3');
    expect(params).toContain('stage-1');
  });

  it('scopes to self for sales role', async () => {
    mockPoolQuery.mockResolvedValue(mockResult([]));

    await findTeamMetrics(
      { from: new Date('2026-01-01'), to: new Date('2026-01-31') },
      'u1',
      'sales',
    );

    const [sql, params] = mockPoolQuery.mock.calls[0];
    expect(sql).toContain("u.role IN ('admin', 'manager', 'sales', 'marketing') AND u.id = $1");
    expect(params[0]).toBe('u1');
  });

  it('omits stage clause when stage filter is absent', async () => {
    mockPoolQuery.mockResolvedValue(mockResult([]));

    await findTeamMetrics(
      { from: new Date('2026-01-01'), to: new Date('2026-01-31') },
      'manager-1',
      'manager',
    );

    const [sql] = mockPoolQuery.mock.calls[0];
    expect(sql).not.toContain('pipeline_stage_id');
  });
});

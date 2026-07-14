jest.mock('./teamMetrics.repository', () => ({ findTeamMetrics: jest.fn() }));

import { findTeamMetrics } from './teamMetrics.repository';
import { getTeamMetrics } from './teamMetrics.service';

const mockedFind = findTeamMetrics as jest.Mock;

const baseRows = [
  { user_id: 'u1', name: 'Alice', assigned_count: 10, contacted_count: 5, contacted_pct: 50.0, avg_response_time: 3600, total_activities: 8 },
  { user_id: 'u2', name: 'Bob', assigned_count: 4, contacted_count: 0, contacted_pct: null, avg_response_time: null, total_activities: 1 },
];

const defaultQuery = { from: '2026-01-01T00:00:00.000Z', to: '2026-01-31T23:59:59.999Z' };

describe('teamMetrics.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns formatted metrics for admin', async () => {
    mockedFind.mockResolvedValue(baseRows);
    const res = await getTeamMetrics(defaultQuery, { id: 'admin-1', role: 'admin' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toHaveLength(2);
    expect(res.value[0]).toMatchObject({
      user_id: 'u1',
      name: 'Alice',
      assigned_count: 10,
      contacted_count: 5,
      contacted_pct: 50,
      avg_response_time: 3600,
      total_activities: 8,
    });
    expect(res.value[1]).toMatchObject({
      user_id: 'u2',
      name: 'Bob',
      assigned_count: 4,
      contacted_count: 0,
      contacted_pct: null,
      avg_response_time: null,
      total_activities: 1,
    });
    expect(mockedFind).toHaveBeenCalledWith(
      expect.objectContaining({ from: expect.any(Date), to: expect.any(Date) }),
      'admin-1',
      'admin',
    );
  });

  it('scopes to self for sales role', async () => {
    mockedFind.mockResolvedValue([baseRows[0]]);
    const res = await getTeamMetrics(defaultQuery, { id: 'u1', role: 'sales' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toHaveLength(1);
    expect(mockedFind).toHaveBeenCalledWith(expect.any(Object), 'u1', 'sales');
  });

  it('passes stage filter to repository', async () => {
    mockedFind.mockResolvedValue([]);
    await getTeamMetrics(
      { ...defaultQuery, stage: '550e8400-e29b-41d4-a716-446655440000' },
      { id: 'manager-1', role: 'manager' },
    );
    expect(mockedFind).toHaveBeenCalledWith(
      expect.objectContaining({ stage: '550e8400-e29b-41d4-a716-446655440000' }),
      'manager-1',
      'manager',
    );
  });

  it('returns error when repository fails', async () => {
    mockedFind.mockRejectedValue(new Error('DB down'));
    const res = await getTeamMetrics(defaultQuery, { id: 'admin-1', role: 'admin' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.message).toBe('DB down');
  });
});

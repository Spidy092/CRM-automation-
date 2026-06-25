import { pool } from '../../shared/utils/db';
import {
  findAssignmentConfig,
  updateAssignmentConfig,
  findEligibleUsers,
  insertAssignment,
  findAssignmentByLead,
  findAssignmentsByUser,
  updateLeadAssignment,
  getNextRoundRobinUser,
} from './assignments.repository';

jest.mock('../../shared/utils/db', () => ({
  pool: { query: jest.fn() },
}));

const mockPoolQuery = pool.query as unknown as jest.Mock;

function mockQueryResult(rows: unknown[]) {
  return Promise.resolve({
    rows,
    command: 'SELECT',
    oid: 0,
    fields: [],
    rowCount: rows.length,
  } as any);
}

describe('assignments.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('findAssignmentConfig', () => {
    it('returns config when present', async () => {
      const row = { id: 'cfg-1', is_enabled: true, threshold_score: 70 };
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([row]));
      await expect(findAssignmentConfig()).resolves.toEqual(row);
    });

    it('returns null when none', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([]));
      await expect(findAssignmentConfig()).resolves.toBeNull();
    });
  });

  describe('updateAssignmentConfig', () => {
    it('inserts when no existing config (uses defaults)', async () => {
      mockPoolQuery
        .mockResolvedValueOnce(mockQueryResult([]))
        .mockResolvedValueOnce(mockQueryResult([{ id: 'cfg-new', is_enabled: true }]));
      const result = await updateAssignmentConfig({}, 'admin-1');
      expect(result.id).toBe('cfg-new');
      expect(mockPoolQuery).toHaveBeenLastCalledWith(
        expect.stringContaining('INSERT INTO assignment_config'),
        [true, 70, ['sales'], 'admin-1'],
      );
    });

    it('updates fields when config exists', async () => {
      mockPoolQuery
        .mockResolvedValueOnce(mockQueryResult([{ id: 'cfg-1' }]))
        .mockResolvedValueOnce(mockQueryResult([{ id: 'cfg-1', is_enabled: false }]));
      const result = await updateAssignmentConfig({ is_enabled: false }, 'admin-1');
      expect(result.is_enabled).toBe(false);
    });

    it('updates eligible_roles', async () => {
      mockPoolQuery
        .mockResolvedValueOnce(mockQueryResult([{ id: 'cfg-1' }]))
        .mockResolvedValueOnce(mockQueryResult([{ id: 'cfg-1', eligible_roles: ['sales', 'manager'] }]));
      await updateAssignmentConfig({ eligible_roles: ['sales', 'manager'] }, 'admin-1');
      expect(mockPoolQuery).toHaveBeenLastCalledWith(
        expect.stringContaining('eligible_roles = $1'),
        expect.arrayContaining([['sales', 'manager'], 'admin-1', 'cfg-1']),
      );
    });
  });

  describe('findEligibleUsers', () => {
    it('returns sales users ordered by load', async () => {
      const rows = [{ id: 'u1', assignment_count: '2' }, { id: 'u2', assignment_count: '5' }];
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult(rows));
      await expect(findEligibleUsers()).resolves.toEqual(rows);
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining("WHERE u.role = 'sales'"),
      );
    });

    it('returns empty array when none eligible', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([]));
      await expect(findEligibleUsers()).resolves.toEqual([]);
    });
  });

  describe('insertAssignment', () => {
    it('inserts and returns assignment', async () => {
      const row = { id: 'a1', lead_id: 'l1', assigned_to: 'u1', assignment_type: 'round_robin' };
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([row]));
      const result = await insertAssignment('l1', 'u1', 'admin-1', 'round_robin');
      expect(result).toEqual(row);
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO assignments'),
        ['l1', 'u1', 'admin-1', 'round_robin'],
      );
    });
  });

  describe('findAssignmentByLead', () => {
    it('returns latest assignment for lead', async () => {
      const row = { id: 'a1', lead_id: 'l1' };
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([row]));
      await expect(findAssignmentByLead('l1')).resolves.toEqual(row);
    });

    it('returns null when no assignment', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([]));
      await expect(findAssignmentByLead('l1')).resolves.toBeNull();
    });
  });

  describe('findAssignmentsByUser', () => {
    it('returns all assignments for user', async () => {
      const rows = [{ id: 'a1' }, { id: 'a2' }];
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult(rows));
      await expect(findAssignmentsByUser('u1')).resolves.toEqual(rows);
    });
  });

  describe('updateLeadAssignment', () => {
    it('updates leads.assigned_to', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([]));
      await updateLeadAssignment('l1', 'u1');
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE leads SET assigned_to = $1'),
        ['u1', 'l1'],
      );
    });
  });

  describe('getNextRoundRobinUser', () => {
    it('returns first eligible user', async () => {
      const user = { id: 'u1' };
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([user, { id: 'u2' }]));
      await expect(getNextRoundRobinUser()).resolves.toEqual(user);
    });

    it('returns null when no users', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([]));
      await expect(getNextRoundRobinUser()).resolves.toBeNull();
    });
  });
});

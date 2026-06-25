jest.mock('./assignments.repository', () => ({
  findAssignmentConfig: jest.fn(),
  updateAssignmentConfig: jest.fn(),
  findEligibleUsers: jest.fn(),
  insertAssignment: jest.fn(),
  findAssignmentByLead: jest.fn(),
  findAssignmentsByUser: jest.fn(),
  updateLeadAssignment: jest.fn(),
  getNextRoundRobinUser: jest.fn(),
}));
jest.mock('../leads/leads.repository', () => ({
  findLeadById: jest.fn(),
}));
jest.mock('../../shared/utils/audit', () => ({ writeAuditLog: jest.fn() }));

import { AppError } from '../../shared/middleware/errorHandler';
import {
  findAssignmentConfig,
  updateAssignmentConfig,
  findEligibleUsers,
  insertAssignment,
  findAssignmentByLead,
  updateLeadAssignment,
  getNextRoundRobinUser,
} from './assignments.repository';
import { writeAuditLog } from '../../shared/utils/audit';
import { findLeadById } from '../leads/leads.repository';
import {
  assignManually,
  autoAssignLead,
  getConfig,
  getEligibleUsers,
  overrideAssignment,
  updateConfig,
} from './assignments.service';

const config = {
  id: 'cfg-1',
  is_enabled: true,
  threshold_score: 70,
  eligible_roles: ['sales'],
  updated_by: 'admin-1',
  updated_at: '2026-06-19T00:00:00.000Z',
};

const eligibleUser = {
  id: 'rep-1',
  name: 'Sales Rep',
  email: 'rep@crm.io',
  is_available: true,
  last_assigned_at: null,
  assignment_count: 0,
};

const actor = { id: 'admin-1', role: 'admin', ipAddress: '127.0.0.1' };

const mockLead = { id: 'lead-1', deleted_at: null };

beforeEach(() => {
  jest.clearAllMocks();
  (findLeadById as jest.Mock).mockResolvedValue(mockLead);
});

describe('getConfig / updateConfig', () => {
  it('returns null when unset', async () => {
    (findAssignmentConfig as jest.Mock).mockResolvedValue(null);
    await expect(getConfig()).resolves.toBeNull();
  });

  it('updates and audits', async () => {
    (updateAssignmentConfig as jest.Mock).mockResolvedValue({ ...config, threshold_score: 80 });
    const res = await updateConfig({ threshold_score: 80 }, actor);
    expect(res.threshold_score).toBe(80);
    expect(writeAuditLog).toHaveBeenCalled();
  });
});

describe('getEligibleUsers', () => {
  it('delegates to repository', async () => {
    (findEligibleUsers as jest.Mock).mockResolvedValue([eligibleUser]);
    const res = await getEligibleUsers();
    expect(res).toEqual([eligibleUser]);
  });
});

describe('assignManually', () => {
  it('throws 409 when an assignment exists', async () => {
    (findAssignmentByLead as jest.Mock).mockResolvedValue({ id: 'a-1' });
    await expect(assignManually('lead-1', 'rep-1', actor)).rejects.toMatchObject({ statusCode: 409 });
    expect(updateLeadAssignment).not.toHaveBeenCalled();
  });

  it('assigns and audits on success', async () => {
    (findAssignmentByLead as jest.Mock).mockResolvedValue(null);
    (updateLeadAssignment as jest.Mock).mockResolvedValue(undefined);
    (insertAssignment as jest.Mock).mockResolvedValue({ id: 'a-1', lead_id: 'lead-1', assigned_to: 'rep-1' });

    const res = await assignManually('lead-1', 'rep-1', actor);
    expect(res.id).toBe('a-1');
    expect(updateLeadAssignment).toHaveBeenCalledWith('lead-1', 'rep-1');
    expect(writeAuditLog).toHaveBeenCalled();
  });
});

describe('overrideAssignment', () => {
  it('overrides regardless of current assignment', async () => {
    (updateLeadAssignment as jest.Mock).mockResolvedValue(undefined);
    (insertAssignment as jest.Mock).mockResolvedValue({ id: 'a-2', assigned_to: 'rep-2' });

    const res = await overrideAssignment('lead-1', 'rep-2', 'reassigning', actor);
    expect(res.assigned_to).toBe('rep-2');
    expect(writeAuditLog).toHaveBeenCalled();
  });
});

describe('autoAssignLead', () => {
  it('returns null when config is disabled', async () => {
    (findAssignmentConfig as jest.Mock).mockResolvedValue({ ...config, is_enabled: false });
    await expect(autoAssignLead('lead-1')).resolves.toBeNull();
    expect(getNextRoundRobinUser).not.toHaveBeenCalled();
  });

  it('returns null when no eligible user', async () => {
    (findAssignmentConfig as jest.Mock).mockResolvedValue(config);
    (getNextRoundRobinUser as jest.Mock).mockResolvedValue(null);
    await expect(autoAssignLead('lead-1')).resolves.toBeNull();
  });

  it('picks the next user and inserts assignment', async () => {
    (findAssignmentConfig as jest.Mock).mockResolvedValue(config);
    (getNextRoundRobinUser as jest.Mock).mockResolvedValue(eligibleUser);
    (updateLeadAssignment as jest.Mock).mockResolvedValue(undefined);
    (insertAssignment as jest.Mock).mockResolvedValue({ id: 'a-3', assigned_to: 'rep-1' });

    const res = await autoAssignLead('lead-1');
    expect(res?.assigned_to).toBe('rep-1');
    expect(insertAssignment).toHaveBeenCalledWith('lead-1', 'rep-1', 'system', 'round_robin');
  });
});

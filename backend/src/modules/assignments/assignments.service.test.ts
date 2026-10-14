jest.mock('./assignments.repository', () => ({
  findAssignmentConfig: jest.fn(),
  updateAssignmentConfig: jest.fn(),
  findEligibleUsers: jest.fn(),
  insertAssignment: jest.fn(),
  findAssignmentByLead: jest.fn(),
  findAssignmentsByUser: jest.fn(),
  getNextRoundRobinUser: jest.fn(),
}));
jest.mock('../leads/leads.service', () => ({
  lockLeadForUpdate: jest.fn(),
  writeLeadOwner: jest.fn(),
  registerOwnershipApplier: jest.fn(),
  runPostCommitEffects: jest.fn(async (effects: Array<() => Promise<void>>) => {
    for (const effect of effects) await effect();
  }),
}));
jest.mock('../users/users.service', () => ({
  getEligibleRecipientForUpdate: jest.fn(),
}));
jest.mock('../../shared/utils/audit', () => ({ writeAuditLog: jest.fn() }));
jest.mock('../../shared/utils/db', () => ({
  withTransaction: jest.fn(async (cb: (client: unknown) => Promise<unknown>) => cb({})),
}));
import { AppError } from '../../shared/middleware/errorHandler';

jest.mock('../notifications/notifications.service', () => ({
  createNotification: jest.fn().mockResolvedValue({
    ok: true,
    value: { publishLiveSignal: jest.fn() },
  }),
}));

import {
  findAssignmentConfig,
  updateAssignmentConfig,
  findEligibleUsers,
  insertAssignment,
  findAssignmentByLead,
  getNextRoundRobinUser,
} from './assignments.repository';
import { lockLeadForUpdate, writeLeadOwner } from '../leads/leads.service';
import { getEligibleRecipientForUpdate } from '../users/users.service';
import { writeAuditLog } from '../../shared/utils/audit';
import { createNotification } from '../notifications/notifications.service';
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

const unownedLead = { id: 'lead-1', business_name: 'Acme Co', assigned_to: null, deleted_at: null };
const ownedLead = { ...unownedLead, assigned_to: 'rep-9' };

beforeEach(() => {
  jest.clearAllMocks();
  (lockLeadForUpdate as jest.Mock).mockResolvedValue(unownedLead);
  (writeLeadOwner as jest.Mock).mockImplementation(async (leadId: string, ownerId: string) => ({
    ...unownedLead,
    assigned_to: ownerId,
  }));
  (getEligibleRecipientForUpdate as jest.Mock).mockImplementation(async (userId: string) => ({
    id: userId,
    is_active: true,
    role: 'sales',
    is_available: true,
  }));
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

  it('rejects unknown eligible roles at the schema boundary', async () => {
    const { updateAssignmentConfigSchema } = await import('./assignments.schema');
    expect(
      updateAssignmentConfigSchema.safeParse({ eligible_roles: ['sales', 'hacker'] }).success,
    ).toBe(false);
    expect(
      updateAssignmentConfigSchema.safeParse({ eligible_roles: ['sales', 'manager'] }).success,
    ).toBe(true);
    expect(updateAssignmentConfigSchema.safeParse({ eligible_roles: [] }).success).toBe(false);
  });
});

describe('getEligibleUsers', () => {
  it('passes configured roles to selection', async () => {
    (findAssignmentConfig as jest.Mock).mockResolvedValue({
      ...config,
      eligible_roles: ['sales', 'manager'],
    });
    (findEligibleUsers as jest.Mock).mockResolvedValue([eligibleUser]);
    const res = await getEligibleUsers();
    expect(res).toEqual([eligibleUser]);
    expect(findEligibleUsers).toHaveBeenCalledWith(['sales', 'manager']);
  });

  it('sanitizes unknown configured roles back to sales', async () => {
    (findAssignmentConfig as jest.Mock).mockResolvedValue({
      ...config,
      eligible_roles: ['hacker'],
    });
    (findEligibleUsers as jest.Mock).mockResolvedValue([]);
    await getEligibleUsers();
    expect(findEligibleUsers).toHaveBeenCalledWith(['sales']);
  });
});

describe('assignManually', () => {
  it('throws 409 when the locked lead is currently owned', async () => {
    (lockLeadForUpdate as jest.Mock).mockResolvedValue(ownedLead);
    await expect(assignManually('lead-1', 'rep-1', actor)).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(writeLeadOwner).not.toHaveBeenCalled();
    expect(insertAssignment).not.toHaveBeenCalled();
  });

  it('assigns an unowned lead even when assignment history exists', async () => {
    // History rows must not permanently block an unowned lead: the guard
    // reads current ownership (lead.assigned_to), not history.
    (findAssignmentByLead as jest.Mock).mockResolvedValue({ id: 'a-0' });
    (insertAssignment as jest.Mock).mockResolvedValue({
      id: 'a-1',
      lead_id: 'lead-1',
      assigned_to: 'rep-1',
    });

    const res = await assignManually('lead-1', 'rep-1', actor);
    expect(res.id).toBe('a-1');
    expect(writeLeadOwner).toHaveBeenCalledWith(
      'lead-1',
      'rep-1',
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ previousOwnerId: null }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'assignment.manual' }),
    );
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserId: 'rep-1',
        occurrenceKey: 'assignment:a-1',
        type: 'lead_assigned',
        metadata: { leadId: 'lead-1' },
      }),
      expect.anything(),
    );
  });

  it('propagates recipient ineligibility without writing', async () => {
    (getEligibleRecipientForUpdate as jest.Mock).mockRejectedValueOnce(
      new AppError('Assignment recipient is not eligible for assignment', 409),
    );
    await expect(assignManually('lead-1', 'rep-1', actor)).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(writeLeadOwner).not.toHaveBeenCalled();
    expect(insertAssignment).not.toHaveBeenCalled();
  });

  it('throws and rolls back when notification persistence fails on manual assign', async () => {
    (insertAssignment as jest.Mock).mockResolvedValue({
      id: 'a-1',
      lead_id: 'lead-1',
      assigned_to: 'rep-1',
    });
    (createNotification as jest.Mock).mockResolvedValueOnce({
      ok: false,
      error: new AppError('Notification DB down', 500),
    });

    await expect(assignManually('lead-1', 'rep-1', actor)).rejects.toThrow('Notification DB down');
  });
});

describe('overrideAssignment', () => {
  it('overrides regardless of current assignment', async () => {
    (lockLeadForUpdate as jest.Mock).mockResolvedValue(ownedLead);
    (insertAssignment as jest.Mock).mockResolvedValue({ id: 'a-2', assigned_to: 'rep-2' });

    const res = await overrideAssignment('lead-1', 'rep-2', 'reassigning', actor);
    expect(res.assigned_to).toBe('rep-2');
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'assignment.override' }),
    );
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserId: 'rep-2',
        occurrenceKey: 'assignment:a-2',
        type: 'lead_assigned',
        metadata: { leadId: 'lead-1' },
      }),
      expect.anything(),
    );
  });

  it('throws and rolls back when notification persistence fails on override', async () => {
    (insertAssignment as jest.Mock).mockResolvedValue({ id: 'a-2', assigned_to: 'rep-2' });
    (createNotification as jest.Mock).mockResolvedValueOnce({
      ok: false,
      error: new AppError('Notification DB down', 500),
    });

    await expect(overrideAssignment('lead-1', 'rep-2', 'reassigning', actor)).rejects.toThrow(
      'Notification DB down',
    );
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

  it('returns null without writing when the lead is already owned (safe no-op)', async () => {
    (findAssignmentConfig as jest.Mock).mockResolvedValue(config);
    (getNextRoundRobinUser as jest.Mock).mockResolvedValue(eligibleUser);
    (lockLeadForUpdate as jest.Mock).mockResolvedValue(ownedLead);

    await expect(autoAssignLead('lead-1')).resolves.toBeNull();
    expect(insertAssignment).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('assigns transactionally with notification and publishes post-commit effects once', async () => {
    (findAssignmentConfig as jest.Mock).mockResolvedValue(config);
    (getNextRoundRobinUser as jest.Mock).mockResolvedValue(eligibleUser);
    (insertAssignment as jest.Mock).mockResolvedValue({ id: 'a-3', assigned_to: 'rep-1' });

    const res = await autoAssignLead('lead-1', { score: 85, classification: 'hot' });
    expect(res?.assignment.assigned_to).toBe('rep-1');
    expect(insertAssignment).toHaveBeenCalledWith('lead-1', 'rep-1', null, 'round_robin', {});
    expect(getNextRoundRobinUser).toHaveBeenCalledWith(['sales']);
    expect(getEligibleRecipientForUpdate).toHaveBeenCalledWith(
      'rep-1',
      expect.anything(),
      expect.objectContaining({ allowedRoles: ['sales'], requireAvailable: true }),
    );
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        occurrenceKey: 'assignment:a-3',
        metadata: { leadId: 'lead-1', score: 85, classification: 'hot' },
      }),
      expect.anything(),
    );
    expect(res).not.toHaveProperty('publishLiveSignal');
    const { runPostCommitEffects } = jest.requireMock('../leads/leads.service') as {
      runPostCommitEffects: jest.Mock;
    };
    expect(runPostCommitEffects).toHaveBeenCalledTimes(1);
  });

  it('rethrows recipient revalidation failures without writing', async () => {
    (findAssignmentConfig as jest.Mock).mockResolvedValue(config);
    (getNextRoundRobinUser as jest.Mock).mockResolvedValue(eligibleUser);
    (getEligibleRecipientForUpdate as jest.Mock).mockRejectedValueOnce(
      new AppError('Assignment recipient is not currently available', 409),
    );

    await expect(autoAssignLead('lead-1')).rejects.toMatchObject({ statusCode: 409 });
    expect(insertAssignment).not.toHaveBeenCalled();
  });
});

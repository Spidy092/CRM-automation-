import { jest, describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('./users.repository', () => ({
  findUserByEmail: jest.fn(),
  findAllUsers: jest.fn(),
  findUserById: jest.fn(),
  insertUser: jest.fn(),
  updateUserProfile: jest.fn(),
  updateUserPermissions: jest.fn(),
}));
jest.mock('bcrypt', () => ({ hash: jest.fn(), compare: jest.fn() }));
jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid-v4') }));
jest.mock('../../shared/utils/audit', () => ({ writeAuditLog: jest.fn() }));

import bcrypt from 'bcrypt';
import { createUser, listUsers, getUser, updateProfile, updatePermissions } from './users.service';
import {
  findUserByEmail,
  findAllUsers,
  findUserById,
  insertUser,
  updateUserProfile,
  updateUserPermissions,
} from './users.repository';
import { writeAuditLog } from '../../shared/utils/audit';
import { User } from './users.types';
import { AuthenticatedUser } from '../../shared/types';

const adminUser: AuthenticatedUser = {
  id: 'admin-1',
  name: 'Admin',
  email: 'admin@crm.com',
  role: 'admin',
};

const salesUser: AuthenticatedUser = {
  id: 'sales-1',
  name: 'Sales',
  email: 'sales@crm.com',
  role: 'sales',
};

const sampleUser: User = {
  id: 'user-1',
  name: 'Alice',
  email: 'alice@crm.com',
  role: 'sales',
  is_active: true,
  created_at: new Date('2025-01-01T00:00:00Z'),
};

beforeEach(() => {
  jest.clearAllMocks();
  (bcrypt.hash as jest.Mock<any>).mockResolvedValue('hashed-password');
});

describe('createUser', () => {
  it('rejects when email already exists (409)', async () => {
    (findUserByEmail as jest.Mock<any>).mockResolvedValue(sampleUser);
    await expect(
      createUser({
        name: 'Bob',
        email: 'alice@crm.com',
        password: 'pw12345',
        role: 'sales',
        is_active: true,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(bcrypt.hash).not.toHaveBeenCalled();
    expect(insertUser).not.toHaveBeenCalled();
  });

  it('hashes the password with bcrypt cost 12 and inserts the user', async () => {
    (findUserByEmail as jest.Mock<any>).mockResolvedValue(null);
    (insertUser as jest.Mock<any>).mockResolvedValue({ ...sampleUser, id: 'mock-uuid-v4' });

    const result = await createUser({
      name: 'Bob',
      email: 'BOB@CRM.COM',
      password: 'pw12345',
      role: 'sales',
      is_active: true,
    });

    expect(bcrypt.hash).toHaveBeenCalledWith('pw12345', 12);
    expect(insertUser).toHaveBeenCalledWith(
      'mock-uuid-v4',
      {
        name: 'Bob',
        email: 'bob@crm.com',
        password: 'pw12345',
        role: 'sales',
        is_active: true,
      },
      'hashed-password',
    );
    expect(result.id).toBe('mock-uuid-v4');
  });

  it('lowercases the email when checking for duplicates and inserting', async () => {
    (findUserByEmail as jest.Mock<any>).mockResolvedValue(null);
    (insertUser as jest.Mock<any>).mockResolvedValue(sampleUser);

    await createUser({
      name: 'Bob',
      email: 'MixedCase@CRM.com',
      password: 'pw12345',
      role: 'admin',
      is_active: false,
    });

    expect(findUserByEmail).toHaveBeenCalledWith('mixedcase@crm.com');
    expect(insertUser).toHaveBeenCalledWith(
      'mock-uuid-v4',
      expect.objectContaining({ email: 'mixedcase@crm.com', is_active: false }),
      'hashed-password',
    );
  });
});

describe('listUsers', () => {
  it('returns all users from the repository', async () => {
    (findAllUsers as jest.Mock<any>).mockResolvedValue([sampleUser]);
    const result = await listUsers();
    expect(result).toEqual([sampleUser]);
    expect(findAllUsers).toHaveBeenCalledTimes(1);
  });

  it('returns an empty array when there are no users', async () => {
    (findAllUsers as jest.Mock<any>).mockResolvedValue([]);
    const result = await listUsers();
    expect(result).toEqual([]);
  });
});

describe('getUser', () => {
  it('allows admin to retrieve any user', async () => {
    (findUserById as jest.Mock<any>).mockResolvedValue(sampleUser);
    const result = await getUser('user-1', adminUser);
    expect(result).toEqual(sampleUser);
  });

  it('allows manager to retrieve any user', async () => {
    (findUserById as jest.Mock<any>).mockResolvedValue(sampleUser);
    const manager: AuthenticatedUser = { id: 'mgr-1', name: 'Manager', email: 'mgr@crm.com', role: 'manager' };
    const result = await getUser('user-1', manager);
    expect(result).toEqual(sampleUser);
  });

  it('allows sales actor to retrieve their own profile', async () => {
    (findUserById as jest.Mock<any>).mockResolvedValue({ ...sampleUser, id: 'sales-1' });
    const result = await getUser('sales-1', salesUser);
    expect(result.id).toBe('sales-1');
  });

  it('forbids sales actor from retrieving another user (403)', async () => {
    await expect(getUser('user-1', salesUser)).rejects.toMatchObject({ statusCode: 403 });
    expect(findUserById).not.toHaveBeenCalled();
  });

  it('returns 404 when user not found (admin)', async () => {
    (findUserById as jest.Mock<any>).mockResolvedValue(null);
    await expect(getUser('missing', adminUser)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('updateProfile', () => {
  it('allows admin to update any profile', async () => {
    (updateUserProfile as jest.Mock<any>).mockResolvedValue({ ...sampleUser, name: 'Bob' });
    const result = await updateProfile('user-1', { name: 'Bob' }, adminUser);
    expect(result.name).toBe('Bob');
    expect(updateUserProfile).toHaveBeenCalledWith('user-1', { name: 'Bob' });
  });

  it('allows sales actor to update their own profile', async () => {
    (updateUserProfile as jest.Mock<any>).mockResolvedValue({ ...sampleUser, id: 'sales-1', name: 'Carl' });
    const result = await updateProfile('sales-1', { name: 'Carl' }, salesUser);
    expect(result.name).toBe('Carl');
  });

  it('forbids sales actor from updating another user (403)', async () => {
    await expect(updateProfile('user-1', { name: 'Hacked' }, salesUser)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(updateUserProfile).not.toHaveBeenCalled();
  });

  it('returns 404 when the target user does not exist', async () => {
    (updateUserProfile as jest.Mock<any>).mockResolvedValue(null);
    await expect(updateProfile('missing', { name: 'X' }, adminUser)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('updatePermissions', () => {
  it('allows admin to change another user\'s role and status', async () => {
    (findUserById as jest.Mock<any>).mockResolvedValue(sampleUser);
    (updateUserPermissions as jest.Mock<any>).mockResolvedValue({
      ...sampleUser,
      role: 'manager',
      is_active: false,
    });

    const result = await updatePermissions('user-1', { role: 'manager', is_active: false }, adminUser);

    expect(result.role).toBe('manager');
    expect(result.is_active).toBe(false);
    expect(updateUserPermissions).toHaveBeenCalledWith('user-1', { role: 'manager', is_active: false });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-1',
        action: 'user.permissions_updated',
        entityId: 'user-1',
        oldValue: { role: 'sales', is_active: true },
        newValue: { role: 'manager', is_active: false },
      }),
    );
  });

  it('updates only the field provided', async () => {
    (findUserById as jest.Mock<any>).mockResolvedValue(sampleUser);
    (updateUserPermissions as jest.Mock<any>).mockResolvedValue({ ...sampleUser, role: 'viewer' });

    const result = await updatePermissions('user-1', { role: 'viewer' }, adminUser);

    expect(result.role).toBe('viewer');
    expect(updateUserPermissions).toHaveBeenCalledWith('user-1', { role: 'viewer' });
  });

  it('blocks an admin from demoting their own role', async () => {
    await expect(
      updatePermissions('admin-1', { role: 'manager' }, adminUser),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(updateUserPermissions).not.toHaveBeenCalled();
  });

  it('blocks an admin from deactivating their own account', async () => {
    await expect(
      updatePermissions('admin-1', { is_active: false }, adminUser),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(updateUserPermissions).not.toHaveBeenCalled();
  });

  it('allows an admin to keep their own role as admin explicitly', async () => {
    (findUserById as jest.Mock<any>).mockResolvedValue({ ...sampleUser, id: 'admin-1', role: 'admin' });
    (updateUserPermissions as jest.Mock<any>).mockResolvedValue({
      ...sampleUser,
      id: 'admin-1',
      role: 'admin',
      is_active: true,
    });

    const result = await updatePermissions('admin-1', { role: 'admin' }, adminUser);
    expect(result.role).toBe('admin');
  });

  it('returns 404 when the target user does not exist', async () => {
    (findUserById as jest.Mock<any>).mockResolvedValue(null);
    await expect(
      updatePermissions('missing', { role: 'viewer' }, adminUser),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(updateUserPermissions).not.toHaveBeenCalled();
  });
});

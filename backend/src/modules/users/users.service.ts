import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { AppError } from '../../shared/middleware/errorHandler';
import { AuthenticatedUser } from '../../shared/types';
import { writeAuditLog } from '../../shared/utils/audit';
import { UpdateProfileInput, CreateUserInput, UpdatePermissionsInput, User } from './users.types';
import * as usersRepository from './users.repository';
import * as authRepository from '../auth/auth.repository';

const BCRYPT_COST_FACTOR = 12;

export async function createUser(input: CreateUserInput): Promise<User> {
  const email = input.email.toLowerCase();
  const existing = await usersRepository.findUserByEmail(email);
  if (existing) {
    throw new AppError('A user with this email already exists', 409);
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST_FACTOR);
  return usersRepository.insertUser(uuidv4(), { ...input, email }, passwordHash);
}

/**
 * Returns all active users.
 * RBAC: admin and manager only (enforced at the route level).
 */
export async function listUsers(): Promise<User[]> {
  return usersRepository.findAllUsers();
}

/**
 * Returns a single user by id.
 * RBAC: non-admin/manager actors may only retrieve their own record.
 */
export async function getUser(id: string, actor: AuthenticatedUser): Promise<User> {
  const isAdminOrManager = actor.role === 'admin' || actor.role === 'manager';

  if (!isAdminOrManager && actor.id !== id) {
    throw new AppError('Forbidden: you may only view your own profile', 403);
  }

  const user = await usersRepository.findUserById(id);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  return user;
}

/**
 * Updates the name on the actor's own profile (or any user if admin).
 * RBAC: non-admin actors may only update their own record.
 */
export async function updateProfile(
  id: string,
  input: UpdateProfileInput,
  actor: AuthenticatedUser,
): Promise<User> {
  const isAdmin = actor.role === 'admin';

  if (!isAdmin && actor.id !== id) {
    throw new AppError('Forbidden: you may only update your own profile', 403);
  }

  const updated = await usersRepository.updateUserProfile(id, input);
  if (!updated) {
    throw new AppError('User not found', 404);
  }

  return updated;
}

/**
 * Updates a user's role and/or active status.
 * RBAC: admin only (enforced at the route level).
 * An admin may not demote or deactivate their own account — that would risk
 * locking every admin out of user management.
 */
export async function updatePermissions(
  id: string,
  input: UpdatePermissionsInput,
  actor: AuthenticatedUser,
): Promise<User> {
  if (actor.id === id) {
    if (input.role !== undefined && input.role !== 'admin') {
      throw new AppError('You cannot change your own role', 400);
    }
    if (input.is_active === false) {
      throw new AppError('You cannot deactivate your own account', 400);
    }
  }

  const existing = await usersRepository.findUserById(id);
  if (!existing) {
    throw new AppError('User not found', 404);
  }

  const updated = await usersRepository.updateUserPermissions(id, input);
  if (!updated) {
    throw new AppError('User not found', 404);
  }

  await writeAuditLog({
    userId: actor.id,
    action: 'user.permissions_updated',
    entityType: 'user',
    entityId: id,
    oldValue: { role: existing.role, is_active: existing.is_active },
    newValue: { role: updated.role, is_active: updated.is_active },
  });

  return updated;
}

/**
 * Changes the authenticated user's own password after verifying their current password.
 * RBAC: any authenticated role — only allowed on their own account.
 */
export async function changePassword(
  id: string,
  currentPassword: string,
  newPassword: string,
  actor: AuthenticatedUser,
): Promise<void> {
  // Ownership check — users may only change their own password.
  if (actor.id !== id) {
    throw new AppError('Forbidden: you may only change your own password', 403);
  }

  // Fetch the full user record including password_hash.
  const record = await authRepository.findUserById(id);
  if (!record) {
    throw new AppError('User not found', 404);
  }

  // Verify current password with timing-safe bcrypt compare.
  const isMatch = await bcrypt.compare(currentPassword, record.password_hash);
  if (!isMatch) {
    throw new AppError('Current password is incorrect', 401);
  }

  if (currentPassword === newPassword) {
    throw new AppError('New password must be different from your current password', 400);
  }

  const newHash = await bcrypt.hash(newPassword, BCRYPT_COST_FACTOR);
  await authRepository.updatePasswordHash(id, newHash);
}

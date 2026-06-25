import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { AppError } from '../../shared/middleware/errorHandler';
import { AuthenticatedUser } from '../../shared/types';
import { UpdateProfileInput, CreateUserInput, User } from './users.types';
import * as usersRepository from './users.repository';

const BCRYPT_COST_FACTOR = 12;

export async function createUser(input: CreateUserInput): Promise<User> {
  const existing = await usersRepository.findUserByEmail(input.email);
  if (existing) {
    throw new AppError('A user with this email already exists', 409);
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST_FACTOR);
  return usersRepository.insertUser(uuidv4(), input, passwordHash);
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

import { query, queryOne } from '../../shared/utils/db';
import { User, UpdateProfileInput, CreateUserInput } from './users.types';

/**
 * Fetches all non-deleted users ordered by creation date (newest first).
 * Never returns password_hash.
 */
export async function findAllUsers(): Promise<User[]> {
  return query<User>(
    `SELECT id, name, email, role, is_active, created_at
     FROM users
     WHERE deleted_at IS NULL
     ORDER BY created_at DESC`,
  );
}

/**
 * Fetches a single user by UUID.
 * Returns null if not found or soft-deleted.
 */
export async function findUserById(id: string): Promise<User | null> {
  return queryOne<User>(
    `SELECT id, name, email, role, is_active, created_at
     FROM users
     WHERE id = $1
       AND deleted_at IS NULL`,
    [id],
  );
}

export async function findUserByEmail(email: string): Promise<User | null> {
  return queryOne<User>(
    `SELECT id, name, email, role, is_active, created_at
     FROM users
     WHERE email = $1
       AND deleted_at IS NULL`,
    [email.toLowerCase()],
  );
}

export async function insertUser(
  id: string,
  input: CreateUserInput,
  passwordHash: string,
): Promise<User> {
  const user = await queryOne<User>(
    `INSERT INTO users (id, name, email, password_hash, role, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, email, role, is_active, created_at`,
    [id, input.name, input.email.toLowerCase(), passwordHash, input.role, input.is_active],
  );
  if (!user) throw new Error('Insert did not return a row');
  return user;
}

/**
 * Updates the `name` field for the given user id.
 * Returns the updated user record, or null if the user was not found.
 */
export async function updateUserProfile(
  id: string,
  input: UpdateProfileInput,
): Promise<User | null> {
  return queryOne<User>(
    `UPDATE users
     SET name = $1, updated_at = NOW()
     WHERE id = $2
       AND deleted_at IS NULL
     RETURNING id, name, email, role, is_active, created_at`,
    [input.name, id],
  );
}

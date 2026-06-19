import { query, queryOne } from '../../shared/utils/db';
import { User, UpdateProfileInput } from './users.types';

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

import { query, queryOne } from '../../shared/utils/db';
import { AppError } from '../../shared/middleware/errorHandler';
import { FileRow } from './files.types';

const COLS = `id, filename, mime_type, size_bytes, storage_path, url, tags, created_by, created_at, updated_at`;

export async function findFiles(filters: { tag?: string; search?: string }): Promise<FileRow[]> {
  const conditions: string[] = ['deleted_at IS NULL'];
  const params: unknown[] = [];
  let i = 1;

  if (filters.tag) {
    conditions.push(`$${i++} = ANY(tags)`);
    params.push(filters.tag);
  }
  if (filters.search) {
    conditions.push(`filename ILIKE $${i++}`);
    params.push(`%${filters.search}%`);
  }

  const sql = `SELECT ${COLS} FROM files WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`;
  return query<FileRow>(sql, params);
}

export async function findFileById(id: string): Promise<FileRow | null> {
  return queryOne<FileRow>(`SELECT ${COLS} FROM files WHERE id = $1 AND deleted_at IS NULL`, [id]);
}

export async function insertFile(data: {
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  url: string;
  created_by: string;
}): Promise<FileRow> {
  const row = await queryOne<FileRow>(
    `INSERT INTO files (filename, mime_type, size_bytes, storage_path, url, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${COLS}`,
    [data.filename, data.mime_type, data.size_bytes, data.storage_path, data.url, data.created_by],
  );
  if (!row) throw new AppError('Failed to create file', 500);
  return row;
}

export async function updateFile(
  id: string,
  fields: { filename?: string; tags?: string[] },
): Promise<FileRow> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (fields.filename !== undefined) {
    sets.push(`filename = $${i++}`);
    params.push(fields.filename);
  }
  if (fields.tags !== undefined) {
    sets.push(`tags = $${i++}`);
    params.push(fields.tags);
  }
  sets.push(`updated_at = current_timestamp`);

  params.push(id);
  const sql = `UPDATE files SET ${sets.join(', ')} WHERE id = $${i} AND deleted_at IS NULL RETURNING ${COLS}`;
  const row = await queryOne<FileRow>(sql, params);
  if (!row) throw new AppError('File not found', 404);
  return row;
}

export async function softDeleteFile(id: string): Promise<FileRow> {
  const row = await queryOne<FileRow>(
    `UPDATE files SET deleted_at = current_timestamp WHERE id = $1 AND deleted_at IS NULL RETURNING ${COLS}`,
    [id],
  );
  if (!row) throw new AppError('File not found', 404);
  return row;
}

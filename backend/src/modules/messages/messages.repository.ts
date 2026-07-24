import { query, queryOne } from '../../shared/utils/db';
import { AppError } from '../../shared/middleware/errorHandler';
import { MessageSnippetListFilters, MessageSnippetRow } from './messages.types';

const COLS = `id, title, channel, body, variables, file_ids, created_by, created_at, updated_at`;

export async function findMessageSnippets(
  filters: MessageSnippetListFilters,
): Promise<MessageSnippetRow[]> {
  const conditions: string[] = ['deleted_at IS NULL'];
  const params: unknown[] = [];
  let i = 1;

  if (filters.channel) {
    conditions.push(`channel = $${i++}`);
    params.push(filters.channel);
  }
  if (filters.search) {
    conditions.push(`(title ILIKE $${i} OR body ILIKE $${i})`);
    params.push(`%${filters.search}%`);
    i++;
  }

  const sql = `SELECT ${COLS} FROM message_snippets WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`;
  return query<MessageSnippetRow>(sql, params);
}

export async function findMessageSnippetById(id: string): Promise<MessageSnippetRow | null> {
  return queryOne<MessageSnippetRow>(
    `SELECT ${COLS} FROM message_snippets WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
}

export async function insertMessageSnippet(data: {
  title: string;
  channel: string | null;
  body: string;
  variables: string[];
  file_ids: string[];
  created_by: string;
}): Promise<MessageSnippetRow> {
  const row = await queryOne<MessageSnippetRow>(
    `INSERT INTO message_snippets (title, channel, body, variables, file_ids, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${COLS}`,
    [data.title, data.channel, data.body, data.variables, data.file_ids, data.created_by],
  );
  if (!row) throw new AppError('Failed to create message snippet', 500);
  return row;
}

export async function updateMessageSnippet(
  id: string,
  fields: Partial<{
    title: string;
    channel: string | null;
    body: string;
    variables: string[];
    file_ids: string[];
  }>,
): Promise<MessageSnippetRow> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (fields.title !== undefined) {
    sets.push(`title = $${i++}`);
    params.push(fields.title);
  }
  if (fields.channel !== undefined) {
    sets.push(`channel = $${i++}`);
    params.push(fields.channel);
  }
  if (fields.body !== undefined) {
    sets.push(`body = $${i++}`);
    params.push(fields.body);
  }
  if (fields.variables !== undefined) {
    sets.push(`variables = $${i++}`);
    params.push(fields.variables);
  }
  if (fields.file_ids !== undefined) {
    sets.push(`file_ids = $${i++}`);
    params.push(fields.file_ids);
  }
  sets.push(`updated_at = current_timestamp`);

  params.push(id);
  const sql = `UPDATE message_snippets SET ${sets.join(', ')} WHERE id = $${i} AND deleted_at IS NULL RETURNING ${COLS}`;
  const row = await queryOne<MessageSnippetRow>(sql, params);
  if (!row) throw new AppError('Message snippet not found', 404);
  return row;
}

export async function softDeleteMessageSnippet(id: string): Promise<void> {
  const result = await queryOne<{ id: string }>(
    `UPDATE message_snippets SET deleted_at = current_timestamp WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [id],
  );
  if (!result) throw new AppError('Message snippet not found', 404);
}

import { pool, query, queryOne } from '../../shared/utils/db';
import { AppError } from '../../shared/middleware/errorHandler';
import { CustomFieldDefinition, CustomFieldInput } from './customFields.types';

const SELECT_COLS = `id, label, field_key, field_type, options, is_required, is_active, created_by, created_at, updated_at`;

export async function findActiveDefinitions(): Promise<CustomFieldDefinition[]> {
  return query<CustomFieldDefinition>(
    `SELECT ${SELECT_COLS} FROM custom_field_definitions WHERE is_active = TRUE ORDER BY label ASC`,
  );
}

export async function findAllDefinitions(
  includeInactive: boolean,
): Promise<CustomFieldDefinition[]> {
  const sql = includeInactive
    ? `SELECT ${SELECT_COLS} FROM custom_field_definitions ORDER BY label ASC`
    : `SELECT ${SELECT_COLS} FROM custom_field_definitions WHERE is_active = TRUE ORDER BY label ASC`;
  return query<CustomFieldDefinition>(sql);
}

export async function findDefinitionById(id: string): Promise<CustomFieldDefinition | null> {
  return queryOne<CustomFieldDefinition>(
    `SELECT ${SELECT_COLS} FROM custom_field_definitions WHERE id = $1`,
    [id],
  );
}

export async function findDefinitionByKey(fieldKey: string): Promise<CustomFieldDefinition | null> {
  return queryOne<CustomFieldDefinition>(
    `SELECT ${SELECT_COLS} FROM custom_field_definitions WHERE field_key = $1`,
    [fieldKey],
  );
}

export async function createDefinition(
  input: CustomFieldInput,
  userId: string,
): Promise<CustomFieldDefinition> {
  const row = await queryOne<CustomFieldDefinition>(
    `INSERT INTO custom_field_definitions (label, field_key, field_type, options, is_required, is_active, created_by)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, TRUE), $7)
     RETURNING ${SELECT_COLS}`,
    [
      input.label,
      input.field_key,
      input.field_type,
      input.options ? JSON.stringify(input.options) : null,
      input.is_required ?? false,
      input.is_active ?? null,
      userId,
    ],
  );
  if (!row) throw new AppError('Failed to create custom field definition', 500);
  return row;
}

export async function updateDefinition(
  id: string,
  input: Partial<CustomFieldInput>,
): Promise<CustomFieldDefinition> {
  const existing = await findDefinitionById(id);
  if (!existing) throw new AppError('Custom field definition not found', 404);

  const merged: CustomFieldInput = {
    label: input.label ?? existing.label,
    field_key: input.field_key ?? existing.field_key,
    field_type: input.field_type ?? existing.field_type,
    options: input.options !== undefined ? input.options : existing.options,
    is_required: input.is_required ?? existing.is_required,
    is_active: input.is_active ?? existing.is_active,
  };

  const row = await queryOne<CustomFieldDefinition>(
    `UPDATE custom_field_definitions
       SET label = $1, field_key = $2, field_type = $3, options = $4,
           is_required = $5, is_active = $6
     WHERE id = $7
     RETURNING ${SELECT_COLS}`,
    [
      merged.label,
      merged.field_key,
      merged.field_type,
      merged.options ? JSON.stringify(merged.options) : null,
      merged.is_required,
      merged.is_active,
      id,
    ],
  );
  if (!row) throw new AppError('Failed to update custom field definition', 500);
  return row;
}

/** Used by seed/tests to ensure a definition exists; harmless if already present. */
export async function definitionKeyExists(fieldKey: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM custom_field_definitions WHERE field_key = $1`,
    [fieldKey],
  );
  return row !== null;
}

// Re-export pool so callers sharing a transaction can use it if needed.
export { pool };

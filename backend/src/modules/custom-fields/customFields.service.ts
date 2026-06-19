import { AppError } from '../../shared/middleware/errorHandler';
import { writeAuditLog } from '../../shared/utils/audit';
import {
  createDefinition as createDefinitionRepo,
  findActiveDefinitions,
  findAllDefinitions,
  findDefinitionById,
  findDefinitionByKey,
  updateDefinition as updateDefinitionRepo,
} from './customFields.repository';
import {
  CustomFieldDefinition,
  CustomFieldInput,
  CustomFieldValidationResult,
} from './customFields.types';

export async function listDefinitions(includeInactive: boolean): Promise<CustomFieldDefinition[]> {
  return includeInactive ? findAllDefinitions(true) : findActiveDefinitions();
}

export async function createDefinition(
  input: CustomFieldInput,
  actor: { id: string; ipAddress?: string | null },
): Promise<CustomFieldDefinition> {
  const existing = await findDefinitionByKey(input.field_key);
  if (existing) {
    throw new AppError(`Custom field with key '${input.field_key}' already exists`, 409);
  }
  const created = await createDefinitionRepo(input, actor.id);
  await writeAuditLog({
    userId: actor.id,
    action: 'custom_field.created',
    entityType: 'custom_field_definition',
    entityId: created.id,
    newValue: created,
    ipAddress: actor.ipAddress ?? null,
  });
  return created;
}

export async function updateDefinition(
  id: string,
  input: Partial<CustomFieldInput>,
  actor: { id: string; ipAddress?: string | null },
): Promise<CustomFieldDefinition> {
  if (input.field_key) {
    const byKey = await findDefinitionByKey(input.field_key);
    if (byKey && byKey.id !== id) {
      throw new AppError(`Custom field with key '${input.field_key}' already exists`, 409);
    }
  }
  // Fetch old value for audit before updating.
  const before = await findDefinitionById(id);
  if (!before) throw new AppError('Custom field definition not found', 404);

  const updated = await updateDefinitionRepo(id, input);
  await writeAuditLog({
    userId: actor.id,
    action: 'custom_field.updated',
    entityType: 'custom_field_definition',
    entityId: id,
    oldValue: before,
    newValue: updated,
    ipAddress: actor.ipAddress ?? null,
  });
  return updated;
}

// ── Validation (used by the leads module before writing custom_fields JSONB) ──

function validateSingle(def: CustomFieldDefinition, value: unknown): string | null {
  switch (def.field_type) {
    case 'text':
      return typeof value === 'string' ? null : 'must be text';
    case 'number': {
      const num = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(num) ? null : 'must be a number';
    }
    case 'date':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value))
        ? null
        : 'must be a valid date';
    case 'dropdown':
      return Array.isArray(def.options) && def.options.includes(String(value))
        ? null
        : 'must be one of the defined options';
    case 'checkbox':
      return typeof value === 'boolean' ? null : 'must be a boolean';
    default:
      return 'unsupported field type';
  }
}

function coerceValue(def: CustomFieldDefinition, value: unknown): unknown {
  if (def.field_type === 'number' && typeof value !== 'number') {
    return Number(value);
  }
  return value;
}

/**
 * Validates a lead's custom_fields payload against the active definitions.
 * - Rejects unknown keys (AGENTS.md: custom fields must be validated against
 *   custom_field_definitions before write).
 * - Enforces is_required.
 * - Type-checks each value per field_type.
 * Returns a sanitized map (only known keys) that the caller should persist.
 */
export function validateCustomFieldValues(
  defs: CustomFieldDefinition[],
  values: Record<string, unknown> | null | undefined,
): CustomFieldValidationResult {
  const errors: string[] = [];
  const sanitized: Record<string, unknown> = {};
  const input = values ?? {};
  const defByKey = new Map(defs.map((d) => [d.field_key, d]));

  for (const [key, value] of Object.entries(input)) {
    const def = defByKey.get(key);
    if (!def) {
      errors.push(`Unknown custom field: ${key}`);
      continue;
    }
    if (value === undefined || value === null || value === '') {
      if (def.is_required) errors.push(`${def.label} is required`);
      continue; // omit empties from sanitized output
    }
    const err = validateSingle(def, value);
    if (err) {
      errors.push(`${def.label}: ${err}`);
    } else {
      sanitized[key] = coerceValue(def, value);
    }
  }

  // Required fields that were not provided at all.
  for (const def of defs) {
    if (def.is_required && !(def.field_key in input)) {
      errors.push(`${def.label} is required`);
    }
  }

  return { valid: errors.length === 0, errors, sanitized };
}

export { findActiveDefinitions };

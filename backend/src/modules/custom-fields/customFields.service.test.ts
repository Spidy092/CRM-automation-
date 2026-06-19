import {
  createDefinition,
  updateDefinition,
  validateCustomFieldValues,
} from './customFields.service';
import { CustomFieldDefinition } from './customFields.types';

jest.mock('./customFields.repository', () => ({
  findActiveDefinitions: jest.fn(),
  findAllDefinitions: jest.fn(),
  findDefinitionById: jest.fn(),
  findDefinitionByKey: jest.fn(),
  createDefinition: jest.fn(),
  updateDefinition: jest.fn(),
  definitionKeyExists: jest.fn(),
  pool: { query: jest.fn() },
}));
jest.mock('../../shared/utils/audit', () => ({ writeAuditLog: jest.fn() }));

import {
  createDefinition as createDefinitionRepo,
  findDefinitionByKey,
  findDefinitionById,
  updateDefinition as updateDefinitionRepo,
} from './customFields.repository';
import { writeAuditLog } from '../../shared/utils/audit';

const defs: CustomFieldDefinition[] = [
  {
    id: '1',
    label: 'Company Size',
    field_key: 'company_size',
    field_type: 'number',
    options: null,
    is_required: false,
    is_active: true,
    created_by: 'u',
    created_at: '',
    updated_at: '',
  },
  {
    id: '2',
    label: 'Plan',
    field_key: 'plan',
    field_type: 'dropdown',
    options: ['basic', 'pro'],
    is_required: true,
    is_active: true,
    created_by: 'u',
    created_at: '',
    updated_at: '',
  },
  {
    id: '3',
    label: 'Newsletter',
    field_key: 'newsletter',
    field_type: 'checkbox',
    options: null,
    is_required: false,
    is_active: true,
    created_by: 'u',
    created_at: '',
    updated_at: '',
  },
  {
    id: '4',
    label: 'Renewal',
    field_key: 'renewal',
    field_type: 'date',
    options: null,
    is_required: false,
    is_active: true,
    created_by: 'u',
    created_at: '',
    updated_at: '',
  },
  {
    id: '5',
    label: 'Note',
    field_key: 'note',
    field_type: 'text',
    options: null,
    is_required: false,
    is_active: true,
    created_by: 'u',
    created_at: '',
    updated_at: '',
  },
];

describe('validateCustomFieldValues', () => {
  it('validates and coerces a valid payload', () => {
    const r = validateCustomFieldValues(defs, {
      company_size: '50',
      plan: 'pro',
      newsletter: true,
      renewal: '2026-01-01',
      note: 'hi',
    });
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.sanitized.company_size).toBe(50);
    expect(r.sanitized.plan).toBe('pro');
  });

  it('rejects unknown keys', () => {
    const r = validateCustomFieldValues(defs, { bogus: 'x' });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatch(/Unknown custom field: bogus/);
  });

  it('enforces required fields', () => {
    const r = validateCustomFieldValues(defs, { company_size: 10 });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('Plan is required'))).toBe(true);
  });

  it('rejects wrong type for number', () => {
    const r = validateCustomFieldValues(defs, { plan: 'pro', company_size: 'abc' });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('Company Size'))).toBe(true);
  });

  it('rejects an invalid dropdown option', () => {
    const r = validateCustomFieldValues(defs, { plan: 'enterprise' });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('Plan'))).toBe(true);
  });

  it('rejects a non-boolean checkbox', () => {
    const r = validateCustomFieldValues(defs, { plan: 'pro', newsletter: 'yes' });
    expect(r.valid).toBe(false);
  });

  it('rejects an invalid date', () => {
    const r = validateCustomFieldValues(defs, { plan: 'pro', renewal: 'not-a-date' });
    expect(r.valid).toBe(false);
  });

  it('omits empty optional values from sanitized output', () => {
    const r = validateCustomFieldValues(defs, { plan: 'pro', note: '' });
    expect(r.valid).toBe(true);
    expect('note' in r.sanitized).toBe(false);
  });

  it('handles null input (required missing)', () => {
    const r = validateCustomFieldValues(defs, null);
    expect(r.valid).toBe(false);
  });
});

describe('createDefinition (service)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws 409 when the key already exists', async () => {
    (findDefinitionByKey as jest.Mock).mockResolvedValue({ id: 'x' });
    await expect(
      createDefinition({ label: 'A', field_key: 'a', field_type: 'text' }, { id: 'u1' }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('creates and writes an audit log when the key is free', async () => {
    (findDefinitionByKey as jest.Mock).mockResolvedValue(null);
    const created = {
      id: '1',
      label: 'A',
      field_key: 'a',
      field_type: 'text' as const,
      options: null,
      is_required: false,
      is_active: true,
      created_by: 'u1',
      created_at: '',
      updated_at: '',
    };
    (createDefinitionRepo as jest.Mock).mockResolvedValue(created);
    const res = await createDefinition(
      { label: 'A', field_key: 'a', field_type: 'text' },
      { id: 'u1' },
    );
    expect(res).toEqual(created);
    expect(writeAuditLog).toHaveBeenCalled();
  });
});

describe('updateDefinition (service)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws 404 when the definition is not found', async () => {
    (findDefinitionById as jest.Mock).mockResolvedValue(null);
    await expect(updateDefinition('1', { label: 'B' }, { id: 'u1' })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('throws 409 when a new key collides with another definition', async () => {
    (findDefinitionByKey as jest.Mock).mockResolvedValue({ id: '2' });
    await expect(updateDefinition('1', { field_key: 'b' }, { id: 'u1' })).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('updates and writes an audit log', async () => {
    const before = {
      id: '1',
      label: 'A',
      field_key: 'a',
      field_type: 'text' as const,
      options: null,
      is_required: false,
      is_active: true,
      created_by: 'u1',
      created_at: '',
      updated_at: '',
    };
    const after = { ...before, label: 'B' };
    (findDefinitionById as jest.Mock).mockResolvedValue(before);
    (updateDefinitionRepo as jest.Mock).mockResolvedValue(after);
    const res = await updateDefinition('1', { label: 'B' }, { id: 'u1' });
    expect(res).toEqual(after);
    expect(writeAuditLog).toHaveBeenCalled();
  });
});

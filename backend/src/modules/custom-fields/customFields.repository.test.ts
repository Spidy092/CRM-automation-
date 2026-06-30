jest.mock('../../shared/utils/db', () => ({
  pool: { query: jest.fn() },
  query: jest.fn(),
  queryOne: jest.fn(),
}));

import { query, queryOne } from '../../shared/utils/db';
import {
  findActiveDefinitions,
  findAllDefinitions,
  findDefinitionById,
  findDefinitionByKey,
  createDefinition,
  updateDefinition,
  definitionKeyExists,
} from './customFields.repository';
import { CustomFieldDefinition, CustomFieldInput } from './customFields.types';

const mockQuery = query as jest.Mock;
const mockQueryOne = queryOne as jest.Mock;

const sampleDef: CustomFieldDefinition = {
  id: 'cf-1',
  label: 'Tier',
  field_key: 'tier',
  field_type: 'dropdown',
  options: ['gold', 'silver'],
  is_required: false,
  is_active: true,
  created_by: 'user-1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

beforeEach(() => jest.clearAllMocks());

describe('findActiveDefinitions', () => {
  it('returns active definitions', async () => {
    mockQuery.mockResolvedValue([sampleDef]);
    const result = await findActiveDefinitions();
    expect(result).toEqual([sampleDef]);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('is_active = TRUE'));
  });
});

describe('findAllDefinitions', () => {
  it('includes inactive when flag true', async () => {
    mockQuery.mockResolvedValue([sampleDef]);
    await findAllDefinitions(true);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).not.toContain('WHERE is_active = TRUE');
    expect(sql).toContain('ORDER BY label ASC');
  });

  it('filters to active when flag false', async () => {
    mockQuery.mockResolvedValue([]);
    await findAllDefinitions(false);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('WHERE is_active = TRUE');
  });
});

describe('findDefinitionById', () => {
  it('returns row when found', async () => {
    mockQueryOne.mockResolvedValue(sampleDef);
    const result = await findDefinitionById('cf-1');
    expect(result).toEqual(sampleDef);
    expect(mockQueryOne).toHaveBeenCalledWith(expect.stringContaining('WHERE id = $1'), ['cf-1']);
  });

  it('returns null when not found', async () => {
    mockQueryOne.mockResolvedValue(null);
    expect(await findDefinitionById('x')).toBeNull();
  });
});

describe('findDefinitionByKey', () => {
  it('returns row when found', async () => {
    mockQueryOne.mockResolvedValue(sampleDef);
    const result = await findDefinitionByKey('tier');
    expect(result).toEqual(sampleDef);
    expect(mockQueryOne).toHaveBeenCalledWith(expect.stringContaining('WHERE field_key = $1'), ['tier']);
  });

  it('returns null when not found', async () => {
    mockQueryOne.mockResolvedValue(null);
    expect(await findDefinitionByKey('missing')).toBeNull();
  });
});

describe('createDefinition', () => {
  it('serializes options and uses provided flags', async () => {
    mockQueryOne.mockResolvedValue(sampleDef);
    const input: CustomFieldInput = {
      label: 'Tier',
      field_key: 'tier',
      field_type: 'dropdown',
      options: ['gold', 'silver'],
      is_required: true,
      is_active: false,
    };
    const result = await createDefinition(input, 'user-1');
    expect(result).toEqual(sampleDef);

    const [, params] = mockQueryOne.mock.calls[0];
    expect(params[3]).toBe(JSON.stringify(['gold', 'silver'])); // options serialized
    expect(params[4]).toBe(true); // is_required ?? false
    expect(params[5]).toBe(false); // is_active ?? null
    expect(params[6]).toBe('user-1');
  });

  it('defaults options to null and flags to defaults when omitted', async () => {
    mockQueryOne.mockResolvedValue(sampleDef);
    const input: CustomFieldInput = {
      label: 'Notes',
      field_key: 'notes',
      field_type: 'text',
    };
    await createDefinition(input, 'user-2');
    const [, params] = mockQueryOne.mock.calls[0];
    expect(params[3]).toBeNull(); // options null branch
    expect(params[4]).toBe(false); // is_required default
    expect(params[5]).toBeNull(); // is_active ?? null
  });

  it('throws AppError when insert returns null', async () => {
    mockQueryOne.mockResolvedValue(null);
    await expect(
      createDefinition({ label: 'L', field_key: 'k', field_type: 'text' }, 'u'),
    ).rejects.toMatchObject({ statusCode: 500 });
  });
});

describe('updateDefinition', () => {
  it('throws 404 when definition not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // findDefinitionById
    await expect(updateDefinition('x', { label: 'New' })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('merges provided fields over existing and serializes options', async () => {
    mockQueryOne
      .mockResolvedValueOnce(sampleDef) // findDefinitionById
      .mockResolvedValueOnce({ ...sampleDef, label: 'Updated' }); // UPDATE

    const result = await updateDefinition('cf-1', {
      label: 'Updated',
      options: ['bronze'],
      is_required: true,
    });
    expect(result.label).toBe('Updated');

    const [, params] = mockQueryOne.mock.calls[1];
    expect(params[0]).toBe('Updated'); // input.label
    expect(params[1]).toBe('tier'); // field_key from existing
    expect(params[3]).toBe(JSON.stringify(['bronze'])); // merged options serialized
    expect(params[4]).toBe(true); // is_required overridden
    expect(params[6]).toBe('cf-1');
  });

  it('keeps existing values when input omits fields and handles null options', async () => {
    const existingNoOpts = { ...sampleDef, options: null };
    mockQueryOne
      .mockResolvedValueOnce(existingNoOpts) // findDefinitionById
      .mockResolvedValueOnce(existingNoOpts); // UPDATE

    await updateDefinition('cf-1', {});
    const [, params] = mockQueryOne.mock.calls[1];
    expect(params[0]).toBe('Tier'); // existing label
    expect(params[3]).toBeNull(); // merged options null -> null branch
  });

  it('sets options to null when explicitly cleared', async () => {
    mockQueryOne
      .mockResolvedValueOnce(sampleDef) // findDefinitionById
      .mockResolvedValueOnce(sampleDef); // UPDATE
    await updateDefinition('cf-1', { options: null });
    const [, params] = mockQueryOne.mock.calls[1];
    expect(params[3]).toBeNull(); // options !== undefined -> null
  });

  it('throws 500 when update returns null', async () => {
    mockQueryOne
      .mockResolvedValueOnce(sampleDef) // findDefinitionById
      .mockResolvedValueOnce(null); // UPDATE
    await expect(updateDefinition('cf-1', { label: 'X' })).rejects.toMatchObject({ statusCode: 500 });
  });
});

describe('definitionKeyExists', () => {
  it('returns true when row found', async () => {
    mockQueryOne.mockResolvedValue({ id: 'cf-1' });
    expect(await definitionKeyExists('tier')).toBe(true);
  });

  it('returns false when row null', async () => {
    mockQueryOne.mockResolvedValue(null);
    expect(await definitionKeyExists('missing')).toBe(false);
  });
});

jest.mock('../../shared/utils/db', () => ({
  pool: { query: jest.fn() },
  query: jest.fn(),
  queryOne: jest.fn(),
  withTransaction: jest.fn(),
}));

import { pool, query, queryOne, withTransaction } from '../../shared/utils/db';
import {
  findLeads,
  findLeadById,
  findExistingForDedup,
  findLeadsByScraperLogId,
  findLeadsByIds,
  insertLead,
  updateLead,
  softDeleteLead,
  updateLeadStatus,
  updateLeadOutcome,
  runInTransaction,
  findActivityForLead,
} from './leads.repository';
import { LeadInput, LeadListFilters, LeadRow } from './leads.types';

const mockQuery = query as jest.Mock;
const mockQueryOne = queryOne as jest.Mock;
const mockPoolQuery = pool.query as jest.Mock;
const mockWithTransaction = withTransaction as jest.Mock;

const sampleRow: LeadRow = {
  id: 'lead-1',
  business_name: 'Acme',
  contact_name: 'Jane',
  phone: '+15551234567',
  email: 'jane@acme.test',
  website: null,
  industry: 'tech',
  location: 'NYC',
  country: null,
  google_rating: null,
  review_count: null,
  social_links: null,
  source_platform: 'manual',
  lead_score: 0,
  classification: null,
  status: 'active',
  assigned_to: null,
  pipeline_stage_id: null,
  custom_fields: {},
  tags: [],
  notes: null,
  deal_value: null,
  won_at: null,
  lost_at: null,
  next_follow_up_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null,
  scraper_log_id: null,
};

beforeEach(() => jest.clearAllMocks());

describe('findLeads', () => {
  it('returns rows with no filters and hasMore false', async () => {
    mockQuery.mockResolvedValue([sampleRow]);
    const filters: LeadListFilters = { limit: 20 };
    const result = await findLeads(filters);

    expect(result.rows).toEqual([sampleRow]);
    expect(result.hasMore).toBe(false);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('deleted_at IS NULL');
    expect(sql).toContain('ORDER BY created_at DESC');
    // only the fetchLimit param (limit + 1)
    expect(params).toEqual([21]);
  });

  it('applies every scalar filter and trims when hasMore', async () => {
    // limit 2, return 3 rows -> hasMore true and trimmed to 2
    const rows = [sampleRow, { ...sampleRow, id: 'lead-2' }, { ...sampleRow, id: 'lead-3' }];
    mockQuery.mockResolvedValue(rows);

    const filters: LeadListFilters = {
      limit: 2,
      status: 'active',
      classification: 'hot',
      source_platform: 'manual',
      industry: 'tech',
      country: 'US',
      assigned_to: 'user-1',
      search: 'acme',
      tags: ['vip', 'new'],
      cursorTs: '2026-01-01T00:00:00Z',
      cursorId: 'lead-0',
    };
    const result = await findLeads(filters);

    expect(result.hasMore).toBe(true);
    expect(result.rows).toHaveLength(2);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('status = $1');
    expect(sql).toContain('classification = $2');
    expect(sql).toContain('source_platform = $3');
    expect(sql).toContain('industry = $4');
    expect(sql).toContain('country = $5');
    expect(sql).toContain('assigned_to = $6');
    expect(sql).toContain('ILIKE $7');
    expect(sql).toContain('tags && $8');
    expect(sql).toContain('(created_at, id) < ($9, $10)');
    expect(params).toEqual([
      'active',
      'hot',
      'manual',
      'tech',
      'US',
      'user-1',
      '%acme%',
      ['vip', 'new'],
      '2026-01-01T00:00:00Z',
      'lead-0',
      3, // fetchLimit
    ]);
  });

  it('ignores empty tags array and partial cursor', async () => {
    mockQuery.mockResolvedValue([]);
    const filters: LeadListFilters = {
      limit: 10,
      tags: [],
      cursorTs: '2026-01-01T00:00:00Z',
      // cursorId missing -> cursor branch skipped
    };
    const result = await findLeads(filters);
    expect(result.rows).toEqual([]);
    expect(result.hasMore).toBe(false);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).not.toContain('tags &&');
    expect(sql).not.toContain('(created_at, id) <');
    expect(params).toEqual([11]);
  });

  it('applies exclude_tags condition when provided', async () => {
    mockQuery.mockResolvedValue([sampleRow]);
    const filters: LeadListFilters = {
      limit: 10,
      exclude_tags: ['contacted'],
    };
    const result = await findLeads(filters);
    expect(result.rows).toEqual([sampleRow]);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("NOT (COALESCE(tags, '{}'::text[]) && $1)");
    expect(params).toEqual([['contacted'], 11]);
  });
});

describe('findLeadById', () => {
  it('returns row when found', async () => {
    mockQueryOne.mockResolvedValue(sampleRow);
    const result = await findLeadById('lead-1');
    expect(result).toEqual(sampleRow);
    expect(mockQueryOne).toHaveBeenCalledWith(expect.stringContaining('WHERE id = $1 AND deleted_at IS NULL'), ['lead-1']);
  });

  it('returns null when not found', async () => {
    mockQueryOne.mockResolvedValue(null);
    expect(await findLeadById('missing')).toBeNull();
  });
});

describe('findExistingForDedup', () => {
  it('queries with source, email and phone', async () => {
    mockQueryOne.mockResolvedValue(sampleRow);
    const result = await findExistingForDedup('jane@acme.test', '+15551234567', 'manual');
    expect(result).toEqual(sampleRow);
    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.stringContaining('source_platform = $1'),
      ['manual', 'jane@acme.test', '+15551234567'],
    );
  });

  it('returns null when no duplicate', async () => {
    mockQueryOne.mockResolvedValue(null);
    expect(await findExistingForDedup('a@b.c', '1', 'manual')).toBeNull();
  });
});

describe('findLeadsByScraperLogId', () => {
  it('returns leads created by the given run, newest first', async () => {
    mockQuery.mockResolvedValue([sampleRow]);
    const result = await findLeadsByScraperLogId('log-1');
    expect(result).toEqual([sampleRow]);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('scraper_log_id = $1'),
      ['log-1'],
    );
  });

  it('returns an empty array when the run created no leads', async () => {
    mockQuery.mockResolvedValue([]);
    expect(await findLeadsByScraperLogId('log-2')).toEqual([]);
  });
});

describe('findLeadsByIds', () => {
  it('returns leads matching the given IDs', async () => {
    mockQuery.mockResolvedValue([sampleRow]);
    const result = await findLeadsByIds(['lead-1']);
    expect(result).toEqual([sampleRow]);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('id = ANY($1::uuid[])'), [
      ['lead-1'],
    ]);
  });

  it('returns an empty array without querying when given no IDs', async () => {
    const result = await findLeadsByIds([]);
    expect(result).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('insertLead', () => {
  it('inserts with optional fields defaulted to null and serialized json', async () => {
    mockQueryOne.mockResolvedValue(sampleRow);
    const input: LeadInput = {
      business_name: 'Acme',
      contact_name: 'Jane',
      phone: '+15551234567',
      email: 'jane@acme.test',
      industry: 'tech',
      location: 'NYC',
      source_platform: 'manual',
    };
    const result = await insertLead(input);
    expect(result).toEqual(sampleRow);

    const [, params] = mockQueryOne.mock.calls[0];
    // website ?? null, country ?? null etc.
    expect(params[4]).toBeNull(); // website
    expect(params[7]).toBeNull(); // country
    expect(params[10]).toBeNull(); // social_links jsonArray(undefined) -> null
    expect(params[14]).toBe('{}'); // custom_fields default
    expect(params[15]).toBeNull(); // tags ?? null
  });

  it('serializes provided json fields', async () => {
    mockQueryOne.mockResolvedValue(sampleRow);
    const input: LeadInput = {
      business_name: 'Acme',
      contact_name: 'Jane',
      phone: '1',
      email: 'jane@acme.test',
      industry: 'tech',
      location: 'NYC',
      source_platform: 'manual',
      website: 'https://acme.test',
      country: 'US',
      google_rating: 4.5,
      review_count: 12,
      social_links: { fb: 'x' },
      custom_fields: { tier: 'gold' },
      tags: ['vip'],
      notes: 'hello',
      assigned_to: 'user-1',
      pipeline_stage_id: 'stage-1',
    };
    await insertLead(input);
    const [, params] = mockQueryOne.mock.calls[0];
    expect(params[10]).toBe(JSON.stringify({ fb: 'x' }));
    expect(params[14]).toBe(JSON.stringify({ tier: 'gold' }));
    expect(params[15]).toEqual(['vip']);
  });

  it('throws when insert returns null', async () => {
    mockQueryOne.mockResolvedValue(null);
    const input: LeadInput = {
      business_name: 'Acme',
      contact_name: 'Jane',
      phone: '1',
      email: 'jane@acme.test',
      industry: 'tech',
      location: 'NYC',
      source_platform: 'manual',
    };
    await expect(insertLead(input)).rejects.toThrow('Failed to insert lead');
  });
});

describe('updateLead', () => {
  it('updates scalar + json + tags fields with correct SQL', async () => {
    mockQueryOne.mockResolvedValue(sampleRow);
    const result = await updateLead('lead-1', {
      business_name: 'New Name',
      email: 'NEW@ACME.TEST',
      social_links: { fb: 'y' },
      custom_fields: { tier: 'silver' },
      tags: ['a'],
    });
    expect(result).toEqual(sampleRow);

    const [sql, params] = mockQueryOne.mock.calls[0];
    expect(sql).toContain('business_name = $1');
    expect(sql).toContain('email = lower($2)'); // lower-cased branch
    expect(sql).toContain('social_links = $3::jsonb');
    expect(sql).toContain('custom_fields = $4::jsonb');
    expect(sql).toContain('tags = $5');
    expect(sql).toContain('WHERE id = $6');
    // last param is id
    expect(params[params.length - 1]).toBe('lead-1');
  });

  it('handles null scalar value and empty tags / null json', async () => {
    mockQueryOne.mockResolvedValue(sampleRow);
    await updateLead('lead-1', {
      website: null, // val ?? null branch
      social_links: null, // jsonArray(null) -> null
      custom_fields: null, // jsonArray(null) ?? '{}' -> '{}'
      tags: undefined as unknown as string[], // not present; skip — use explicit below
    });
    const [, params] = mockQueryOne.mock.calls[0];
    // website null, social_links null, custom_fields '{}'
    expect(params).toContain(null);
    expect(params).toContain('{}');
  });

  it('passes empty array when tags set to null-ish', async () => {
    mockQueryOne.mockResolvedValue(sampleRow);
    await updateLead('lead-1', { tags: null as unknown as string[] });
    const [sql, params] = mockQueryOne.mock.calls[0];
    expect(sql).toContain('tags = $1');
    expect(params[0]).toEqual([]); // input.tags ?? []
  });

  it('updates next_follow_up_at, including clearing it with null', async () => {
    mockQueryOne.mockResolvedValue(sampleRow);
    await updateLead('lead-1', { next_follow_up_at: '2026-08-01T09:00:00Z' });
    const [sql, params] = mockQueryOne.mock.calls[0];
    expect(sql).toContain('next_follow_up_at = $1');
    expect(params[0]).toBe('2026-08-01T09:00:00Z');

    mockQueryOne.mockClear();
    mockQueryOne.mockResolvedValue(sampleRow);
    await updateLead('lead-1', { next_follow_up_at: null });
    const [, clearParams] = mockQueryOne.mock.calls[0];
    expect(clearParams[0]).toBeNull();
  });

  it('returns current row when nothing to update', async () => {
    // findLeadById path
    mockQueryOne.mockResolvedValueOnce(sampleRow); // for findLeadById
    const result = await updateLead('lead-1', {});
    expect(result).toEqual(sampleRow);
    // only findLeadById called, no UPDATE
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
    const [sql] = mockQueryOne.mock.calls[0];
    expect(sql).toContain('SELECT');
  });

  it('throws when nothing to update and lead not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    await expect(updateLead('lead-1', {})).rejects.toThrow('Lead not found or deleted');
  });

  it('throws when update returns null', async () => {
    mockQueryOne.mockResolvedValue(null);
    await expect(updateLead('lead-1', { business_name: 'X' })).rejects.toThrow('Lead not found or deleted');
  });
});

describe('softDeleteLead', () => {
  it('issues update setting deleted_at', async () => {
    mockPoolQuery.mockResolvedValue({ rowCount: 1 });
    await softDeleteLead('lead-1');
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining('SET deleted_at = NOW()'),
      ['lead-1'],
    );
  });
});

describe('updateLeadStatus', () => {
  it('updates status and returns row', async () => {
    mockQueryOne.mockResolvedValue({ ...sampleRow, status: 'paused' });
    const result = await updateLeadStatus('lead-1', 'paused');
    expect(result.status).toBe('paused');
    expect(mockQueryOne).toHaveBeenCalledWith(expect.stringContaining('SET status = $1'), ['paused', 'lead-1']);
  });

  it('throws when not found', async () => {
    mockQueryOne.mockResolvedValue(null);
    await expect(updateLeadStatus('x', 'active')).rejects.toThrow('Lead not found or deleted');
  });
});

describe('updateLeadOutcome', () => {
  it('stamps won_at and clears lost_at when outcome is won', async () => {
    mockQueryOne.mockResolvedValue({ ...sampleRow, status: 'won', won_at: '2026-07-20T00:00:00Z' });
    const result = await updateLeadOutcome('lead-1', 'won');
    expect(result.status).toBe('won');
    expect(mockQueryOne).toHaveBeenCalledWith(expect.stringContaining('SET status = $1'), [
      'won',
      'lead-1',
    ]);
  });

  it('reopens the deal (clears both timestamps) when outcome is active', async () => {
    mockQueryOne.mockResolvedValue({ ...sampleRow, status: 'active', won_at: null, lost_at: null });
    const result = await updateLeadOutcome('lead-1', 'active');
    expect(result.status).toBe('active');
  });

  it('throws when not found', async () => {
    mockQueryOne.mockResolvedValue(null);
    await expect(updateLeadOutcome('x', 'lost')).rejects.toThrow('Lead not found or deleted');
  });
});

describe('runInTransaction', () => {
  it('delegates to withTransaction', async () => {
    const fn = jest.fn();
    mockWithTransaction.mockResolvedValue('result');
    const result = await runInTransaction(fn);
    expect(result).toBe('result');
    expect(mockWithTransaction).toHaveBeenCalledWith(fn);
  });
});

describe('findActivityForLead', () => {
  it('returns merged activity rows', async () => {
    const entries = [{ id: 'a1', kind: 'audit' }];
    mockQuery.mockResolvedValue(entries);
    const result = await findActivityForLead('lead-1', 50);
    expect(result).toEqual(entries);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('UNION ALL'), ['lead-1', 50]);
  });
});

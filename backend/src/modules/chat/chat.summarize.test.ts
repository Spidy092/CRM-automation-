import { summarizeReadResult } from './chat.summarize';

describe('summarizeReadResult', () => {
  it('summarizes a paginated list with names and a more hint', () => {
    const result = summarizeReadResult({
      meta: { limit: 25, hasMore: true, nextCursor: 'abc' },
      items: [
        { id: '1', business_name: 'Wild Pour' },
        { id: '2', business_name: 'Blue Tokai' },
      ],
    });
    expect(result).toContain('2+');
    expect(result).toContain('Wild Pour');
    expect(result).toContain('Blue Tokai');
    expect(result).toContain('more');
    expect(result).not.toContain('{');
  });

  it('summarizes a plain array of records', () => {
    const result = summarizeReadResult([{ name: 'Summer Promo', status: 'draft' }]);
    expect(result).toContain('1 record');
    expect(result).toContain('Summer Promo');
  });

  it('unwraps { value } results from proposeAgentAction', () => {
    const result = summarizeReadResult({ value: [{ name: 'Campaign A' }] });
    expect(result).toContain('Campaign A');
  });

  it('lists only the first five names and marks truncation', () => {
    const items = Array.from({ length: 8 }, (_, i) => ({ name: `Lead ${i + 1}` }));
    const result = summarizeReadResult({ items });
    expect(result).toContain('Lead 5');
    expect(result).not.toContain('Lead 6');
    expect(result).toContain('…');
  });

  it('renders scalar metrics as key/value lines', () => {
    const result = summarizeReadResult({
      totalLeads: 95,
      qualifiedLeads: 95,
      activeOutreach: 3,
      recentActivity: [{ date: '2026-06-27', leads: 44 }],
    });
    expect(result).toContain('totalLeads: 95');
    expect(result).toContain('activeOutreach: 3');
    expect(result).toContain('recentActivity: 1 entries');
    expect(result).not.toContain('{');
  });

  it('reports empty lists as no matches', () => {
    expect(summarizeReadResult({ items: [], meta: { hasMore: false } })).toBe(
      'No matching records found.',
    );
  });

  it('handles null and undefined', () => {
    expect(summarizeReadResult(null)).toBe('No data returned.');
    expect(summarizeReadResult(undefined)).toBe('No data returned.');
  });

  it('falls back to truncated JSON for scalars', () => {
    expect(summarizeReadResult('plain string')).toBe('"plain string"');
  });
});

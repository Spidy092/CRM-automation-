import { pool } from '../../shared/utils/db';
import { findLeadTags } from './leadTags.repository';

jest.mock('../../shared/utils/db', () => ({ pool: { query: jest.fn() } }));

describe('lead tag query', () => {
  beforeEach(() => jest.clearAllMocks());

  it('preserves literal tag values and passes the owner separately from SQL', async () => {
    const owner = '11111111-1111-4111-8111-111111111111';
    (pool.query as jest.Mock).mockResolvedValue({ rows: [
      { tag: 'Schools, Bengaluru' }, { tag: ' School Leads ' },
    ] });
    await expect(findLeadTags(owner)).resolves.toEqual(['Schools, Bengaluru', ' School Leads ']);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('assigned_to = $1::uuid'), [owner],
    );
    const sql = (pool.query as jest.Mock).mock.calls[0][0] as string;
    expect(sql).toContain('deleted_at IS NULL');
    expect(sql).not.toContain(owner);
  });

  it('uses a null owner parameter for roles permitted to view all leads', async () => {
    (pool.query as jest.Mock).mockResolvedValue({ rows: [] });
    await expect(findLeadTags(null)).resolves.toEqual([]);
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), [null]);
  });
});

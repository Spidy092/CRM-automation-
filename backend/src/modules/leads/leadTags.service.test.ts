import { getLeadTags } from './leadTags.service';
import { findLeadTags } from './leadTags.repository';
import type { AuthenticatedUser } from '../../shared/types';

jest.mock('./leadTags.repository', () => ({ findLeadTags: jest.fn() }));

const user: AuthenticatedUser = {
  id: 'rep-1',
  role: 'sales',
  name: 'Rep',
  email: 'rep@example.com',
};

describe('lead tag visibility', () => {
  beforeEach(() => jest.clearAllMocks());

  it('restricts sales tag suggestions to their assigned leads', async () => {
    (findLeadTags as jest.Mock).mockResolvedValue(['website-redesign']);
    await expect(getLeadTags(user)).resolves.toEqual(['website-redesign']);
    expect(findLeadTags).toHaveBeenCalledWith('rep-1');
  });

  it.each(['admin', 'manager', 'viewer'] as const)(
    'allows %s to see tags across visible leads',
    async (role) => {
      (findLeadTags as jest.Mock).mockResolvedValue([]);
      await getLeadTags({ ...user, role });
      expect(findLeadTags).toHaveBeenCalledWith(null);
    },
  );
});

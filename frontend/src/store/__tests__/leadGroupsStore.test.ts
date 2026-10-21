import { beforeEach, describe, expect, it, vi } from 'vitest';
import { leadGroupFilters, useLeadGroupsStore } from '../leadGroupsStore';

describe('saved lead groups', () => {
  beforeEach(() => { localStorage.clear(); useLeadGroupsStore.setState({ groups: {} }); });

  it('saves filter definitions per user and restores them from browser storage', async () => {
    const filters = leadGroupFilters(new URLSearchParams('tag=website-redesign&tab=uncontacted&dateRange=7d&offset=50'));
    useLeadGroupsStore.getState().save('rep-1', 'Website prospects', filters);
    const saved = useLeadGroupsStore.getState().groups['rep-1'][0];
    expect(saved.filters).toBe('tab=uncontacted&dateRange=7d&tag=website-redesign');
    expect(useLeadGroupsStore.getState().groups['rep-2']).toBeUndefined();
    await useLeadGroupsStore.persist.rehydrate();
    expect(useLeadGroupsStore.getState().groups['rep-1'][0]).toEqual(saved);
    useLeadGroupsStore.getState().remove('rep-2', saved.id);
    expect(useLeadGroupsStore.getState().groups['rep-1']).toHaveLength(1);
    useLeadGroupsStore.getState().remove('rep-1', saved.id);
    expect(useLeadGroupsStore.getState().groups['rep-1']).toEqual([]);
  });

  it('ignores malformed stored groups', async () => {
    localStorage.setItem('crm.lead-groups', JSON.stringify({ state: { groups: { 'rep-1': [{ id: 1 }] } }, version: 0 }));
    await useLeadGroupsStore.persist.rehydrate();
    expect(useLeadGroupsStore.getState().groups).toEqual({});
  });

  it('preserves both stored and visible groups when saving fails', () => {
    useLeadGroupsStore.getState().save('rep-1', 'Schools', 'tag=school');
    const previous = useLeadGroupsStore.getState().groups;
    const stored = localStorage.getItem('crm.lead-groups');
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage full'); });
    try {
      expect(() => useLeadGroupsStore.getState().save('rep-1', 'New group', 'tag=new')).toThrow();
      expect(useLeadGroupsStore.getState().groups).toEqual(previous);
      expect(localStorage.getItem('crm.lead-groups')).toBe(stored);
    } finally {
      write.mockRestore();
    }
  });

  it('preserves a saved group when browser storage rejects removal', () => {
    useLeadGroupsStore.getState().save('rep-1', 'Schools', 'tag=school');
    const saved = useLeadGroupsStore.getState().groups['rep-1'][0];
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage denied'); });
    try {
      expect(() => useLeadGroupsStore.getState().remove('rep-1', saved.id)).toThrow();
      expect(useLeadGroupsStore.getState().groups['rep-1']).toEqual([saved]);
    } finally {
      write.mockRestore();
    }
  });
  it('restores groups with long URL-encoded filters without discarding other groups', async () => {
    const filters = leadGroupFilters(new URLSearchParams({ q: '学'.repeat(225), tag: 'BengaluruSchools' }));
    expect(filters.length).toBeGreaterThan(2000);
    useLeadGroupsStore.getState().save('rep-1', 'Schools', 'tag=SchoolLeads');
    useLeadGroupsStore.getState().save('rep-1', 'Long search', filters);
    await useLeadGroupsStore.persist.rehydrate();
    expect(useLeadGroupsStore.getState().groups['rep-1']).toHaveLength(2);
    expect(useLeadGroupsStore.getState().groups['rep-1'][1].filters).toBe(filters);
  });

});

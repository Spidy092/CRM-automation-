import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { useAuthStore } from '@/store/authStore';
import { useLeadGroupsStore } from '@/store/leadGroupsStore';
import { SavedLeadGroups } from '../SavedLeadGroups';

describe('SavedLeadGroups', () => {
  beforeEach(() => {
    useLeadGroupsStore.setState({ groups: {} });
    useAuthStore.getState().setUser({ id: 'rep-1', name: 'Rep', email: 'rep@example.com', role: 'sales' });
  });

  it('saves and applies the current tag and uncontacted filters', async () => {
    const onApply = vi.fn();
    renderWithProviders(<SavedLeadGroups searchParams={new URLSearchParams('tag=website-redesign&tab=uncontacted')} onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save current filters' }));
    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'Website prospects' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save group' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Website prospects' }));
    expect(onApply.mock.calls[0][0].get('tag')).toBe('website-redesign');
    expect(onApply.mock.calls[0][0].get('tab')).toBe('uncontacted');
    fireEvent.click(screen.getByRole('button', { name: 'Remove group Website prospects' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Website prospects' })).not.toBeInTheDocument());
  });

  it('does not display another user’s saved groups', () => {
    useLeadGroupsStore.getState().save('rep-2', 'Private group', 'tag=vip');
    renderWithProviders(<SavedLeadGroups searchParams={new URLSearchParams()} onApply={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Private group' })).not.toBeInTheDocument();
  });

  it('rejects duplicate names without overwriting an existing group', async () => {
    useLeadGroupsStore.getState().save('rep-1', 'School prospects', 'tag=school');
    renderWithProviders(<SavedLeadGroups searchParams={new URLSearchParams('tag=vip')} onApply={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save current filters' }));
    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: '  SCHOOL PROSPECTS  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save group' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A group with this name already exists.');
    expect(useLeadGroupsStore.getState().groups['rep-1']).toHaveLength(1);
    expect(useLeadGroupsStore.getState().groups['rep-1'][0].filters).toBe('tag=school');
  });

  it('clears all filters without removing saved groups', () => {
    useLeadGroupsStore.getState().save('rep-1', 'Schools', 'tag=school');
    const onApply = vi.fn();
    renderWithProviders(<SavedLeadGroups searchParams={new URLSearchParams('tag=school&tab=uncontacted')} onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onApply.mock.calls[0][0].toString()).toBe('');
    expect(useLeadGroupsStore.getState().groups['rep-1']).toHaveLength(1);
  });
});

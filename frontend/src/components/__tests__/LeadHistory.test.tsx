import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { LeadHistory } from '../LeadHistory';
import { useLeadHistoryAuthors, useLeadHistory, usePinnedNotes, useSetActivityPinned } from '@/api/leads';
import type { LeadHistoryEntry } from '@/api/leads';

vi.mock('@/api/leads', () => ({
  useLeadHistoryAuthors: vi.fn(),
  useLeadHistory: vi.fn(),
  usePinnedNotes: vi.fn(),
  useSetActivityPinned: vi.fn(),
}));

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (state: { user: unknown }) => unknown) =>
    selector({
      user: { id: 'rep-1', name: 'Rep', email: 'rep@example.com', role: 'sales' },
    }),
}));

const mockedHistory = vi.mocked(useLeadHistory);
const mockedPinned = vi.mocked(usePinnedNotes);
const mockedPin = vi.mocked(useSetActivityPinned);

const NOW = new Date().toISOString();
const OLD = '2026-01-05T10:00:00.000Z';

function entry(overrides: Partial<LeadHistoryEntry> & { id: string }): LeadHistoryEntry {
  return {
    source: 'activity',
    activity_type: 'note',
    channel: null,
    status: null,
    metadata: { note: 'Body' },
    message_body: null,
    step_number: null,
    error_message: null,
    author_id: 'rep-1',
    author_name: 'Rep',
    is_pinned: false,
    created_at: NOW,
    ...overrides,
  };
}

function historyMock(items: LeadHistoryEntry[], extra = {}) {
  return {
    data: { pages: [{ items, meta: { limit: 25, hasMore: false } }], pageParams: [undefined] },
    isLoading: false,
    isError: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    isFetchingNextPage: false,
    refetch: vi.fn(),
    ...extra,
  } as unknown as ReturnType<typeof useLeadHistory>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useLeadHistoryAuthors).mockReturnValue({ data: [], isLoading: false } as never);
  mockedPinned.mockReturnValue({ data: { pages: [] }, isLoading: false } as never);
  mockedPin.mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never);
  mockedHistory.mockReturnValue(historyMock([]));
});

describe('LeadHistory', () => {
  it('defaults to the All activity tab and renders newest first', () => {
    mockedHistory.mockReturnValue(
      historyMock([
        entry({ id: 'new', metadata: { note: 'Newer note' }, created_at: NOW }),
        entry({ id: 'old', metadata: { note: 'Older note' }, created_at: OLD }),
      ]),
    );
    renderWithProviders(<LeadHistory leadId="lead-1" />);

    const allTab = screen.getByRole('tab', { name: 'All activity' });
    expect(allTab.getAttribute('aria-selected')).toBe('true');

    const newer = screen.getByText('Newer note');
    const older = screen.getByText('Older note');
    expect(newer.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('groups entries under Today and explicit dates', () => {
    mockedHistory.mockReturnValue(
      historyMock([
        entry({ id: 'new', metadata: { note: 'Today note' }, created_at: NOW }),
        entry({ id: 'old', metadata: { note: 'January note' }, created_at: OLD }),
      ]),
    );
    renderWithProviders(<LeadHistory leadId="lead-1" />);
    expect(screen.getByRole('heading', { name: 'Today' })).toBeDefined();
    expect(screen.getByRole('heading', { name: /Jan.*2026/ })).toBeDefined();
  });

  it('expands and collapses long entries', () => {
    const long = `x`.repeat(200);
    mockedHistory.mockReturnValue(historyMock([entry({ id: 'n1', metadata: { note: long } })]));
    renderWithProviders(<LeadHistory leadId="lead-1" />);

    expect(screen.queryByText(long)).toBeNull();
    const toggle = screen.getByText('Show more');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByText(long)).toBeDefined();
    expect(screen.getByText('Show less')).toBeDefined();
  });

  it('loads older pages without duplicating entries', () => {
    const dup = entry({ id: 'dup', metadata: { note: 'Dup note' } });
    const second = entry({ id: 'n2', metadata: { note: 'Second' } });
    const fetchNextPage = vi.fn();
    mockedHistory.mockReturnValue(
      historyMock([dup], {
        data: {
          pages: [
            { items: [dup], meta: { limit: 25, hasMore: true, nextCursor: 'c1' } },
            { items: [dup, second], meta: { limit: 25, hasMore: false } },
          ],
          pageParams: [undefined, 'c1'],
        },
        hasNextPage: false,
        fetchNextPage,
      }),
    );
    renderWithProviders(<LeadHistory leadId="lead-1" />);
    expect(screen.getAllByText('Dup note')).toHaveLength(1);
  });

  it('offers Load older activity while more pages exist', () => {
    const fetchNextPage = vi.fn();
    mockedHistory.mockReturnValue(
      historyMock([entry({ id: 'n1', metadata: { note: 'First' } })], {
        hasNextPage: true,
        fetchNextPage,
      }),
    );
    renderWithProviders(<LeadHistory leadId="lead-1" />);
    const button = screen.getByText('Load older activity');
    fireEvent.click(button);
    expect(fetchNextPage).toHaveBeenCalled();
  });

  it('collapses consecutive system events into an expandable summary', () => {
    mockedHistory.mockReturnValue(
      historyMock([
        entry({
          id: 's1',
          activity_type: 'status_change',
          metadata: { from: 'active', to: 'paused' },
          author_name: null,
        }),
        entry({
          id: 's2',
          activity_type: 'status_change',
          metadata: { from: 'paused', to: 'active' },
          author_name: null,
        }),
      ]),
    );
    renderWithProviders(<LeadHistory leadId="lead-1" />);

    // Individual details stay hidden until the summary is expanded.
    expect(screen.queryByText(/Status changed from active to paused/)).toBeNull();
    fireEvent.click(screen.getByText('2 system updates'));
    expect(screen.getByText(/Status changed from active to paused/)).toBeDefined();
    expect(screen.getByText(/Status changed from paused to active/)).toBeDefined();
  });

  it('renders messages with channel, status, and error details', () => {
    mockedHistory.mockReturnValue(
      historyMock([
        {
          ...entry({ id: 'm1' }),
          source: 'message',
          activity_type: null,
          channel: 'email',
          status: 'failed',
          metadata: null,
          message_body: 'Hello there',
          step_number: 2,
          error_message: 'Mailbox full',
          author_id: null,
          author_name: null,
        },
      ]),
    );
    renderWithProviders(<LeadHistory leadId="lead-1" />);
    expect(screen.getByText('Email · Step 2')).toBeDefined();
    expect(screen.getByText('failed')).toBeDefined();
    expect(screen.getByText('Hello there')).toBeDefined();
    expect(screen.getByText('Mailbox full')).toBeDefined();
  });

  it('shows an empty state when there is no history', () => {
    renderWithProviders(<LeadHistory leadId="lead-1" />);
    expect(screen.getByText('No activity yet')).toBeDefined();
  });

  it('shows a no-results state with a clear action when filters match nothing', async () => {
    renderWithProviders(<LeadHistory leadId="lead-1" />);
    fireEvent.change(screen.getByLabelText('Search history'), { target: { value: 'zzz-no-match' } });
    // The debounced server-side search applies after 300ms.
    expect(await screen.findByText('No matches in history')).toBeDefined();
    fireEvent.click(screen.getByText('Clear filters'));
    expect(await screen.findByText('No activity yet')).toBeDefined();
  });

  it('shows an error state with retry', () => {
    const refetch = vi.fn();
    mockedHistory.mockReturnValue(historyMock([], { isError: true, refetch }));
    renderWithProviders(<LeadHistory leadId="lead-1" />);
    expect(screen.getByText('Could not load history')).toBeDefined();
    fireEvent.click(screen.getByText('Try again'));
    expect(refetch).toHaveBeenCalled();
  });

  it('renders pinned notes above the history with unpin for contributors', () => {
    mockedPinned.mockReturnValue({
      data: { pages: [{ items: [entry({ id: 'p1', metadata: { note: 'Pinned body' }, is_pinned: true })] }] },
      isLoading: false,
    } as never);
    const mutateAsync = vi.fn();
    mockedPin.mockReturnValue({ mutateAsync, isPending: false } as never);
    renderWithProviders(<LeadHistory leadId="lead-1" />);

    expect(screen.getByText('Pinned note')).toBeDefined();
    expect(screen.getByText('Pinned body')).toBeDefined();
    fireEvent.click(screen.getByLabelText('Unpin note'));
    expect(mutateAsync).toHaveBeenCalledWith({ leadId: 'lead-1', activityId: 'p1', pinned: false });
  });

  it('supports keyboard navigation across tabs', () => {
    renderWithProviders(<LeadHistory leadId="lead-1" />);
    const allTab = screen.getByRole('tab', { name: 'All activity' });
    allTab.focus();
    fireEvent.keyDown(allTab, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Notes' }).getAttribute('aria-selected')).toBe('true');
  });
});

  it('keeps the selected author while a filtered request loads', () => {
    vi.mocked(useLeadHistoryAuthors).mockReturnValue({ data: [{ id: 'author-1', name: 'Older author' }] } as never);
    renderWithProviders(<LeadHistory leadId="lead-1" />);
    fireEvent.change(screen.getByLabelText('Filter by author'), { target: { value: 'author-1' } });
    expect((screen.getByLabelText('Filter by author') as HTMLSelectElement).value).toBe('author-1');
    expect(mockedHistory).toHaveBeenLastCalledWith('lead-1', expect.objectContaining({ author: 'author-1' }));
  });

  it('does not combine system updates across calendar dates', () => {
    mockedHistory.mockReturnValue(historyMock([
      entry({ id: 's1', activity_type: 'status_change', created_at: NOW }),
      entry({ id: 's2', activity_type: 'status_change', created_at: OLD }),
    ]));
    renderWithProviders(<LeadHistory leadId="lead-1" />);
    expect(screen.queryByText('2 system updates')).toBeNull();
    expect(screen.getByRole('heading', { name: /Jan.*2026/ })).toBeDefined();
  });

  it('keeps existing entries visible when loading older activity fails', () => {
    mockedHistory.mockReturnValue(historyMock([entry({ id: 'n1', metadata: { note: 'Existing note' } })], {
      isError: true, isFetchNextPageError: true, hasNextPage: true,
    }));
    renderWithProviders(<LeadHistory leadId="lead-1" />);
    expect(screen.getByText('Existing note')).toBeDefined();
    expect(screen.getByText(/Could not load older activity/)).toBeDefined();
    expect(screen.getByText('Load older activity')).toBeDefined();
  });

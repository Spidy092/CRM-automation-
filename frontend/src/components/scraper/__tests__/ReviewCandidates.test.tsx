import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { ReviewCandidates } from '../ReviewCandidates';
import { useImportSelectedCandidates } from '@/api/scraper';
import type { ScraperLog } from '@/types';

vi.mock('@/api/scraper', () => ({
  useImportSelectedCandidates: vi.fn(),
}));

const mutate = vi.fn();

function logWith(candidates: unknown[]): ScraperLog {
  return {
    id: 'log-1',
    config_id: 'cfg-1',
    status: 'completed',
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    records_found: candidates.length,
    records_imported: 0,
    records_duplicate: 0,
    records_failed: 0,
    error_message: null,
    raw_response: { import_mode: 'review', candidates },
    failed_items: [],
    created_at: new Date().toISOString(),
  };
}

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    provider: { kind: 'youtube_channel', id: 'UC1' },
    source: { sourceType: 'youtube', collectedAt: new Date().toISOString() },
    business: { name: 'Acme', website: 'https://acme.com', sourceUrls: [], location: 'Bangalore', industry: '' },
    contacts: [
      { channel: 'email', value: 'hi@acme.com', provenance: 'youtube_description', state: 'unknown' },
      { channel: 'phone', value: '+14155552671', provenance: 'youtube_description', state: 'observed' },
    ],
    evidence: [],
    observedOpportunities: [{ fact: 'No website linked from profile' }],
    modelSuggestions: [{ suggestion: 'Might need a chatbot' }],
    targetFit: 75,
    contactQuality: 80,
    eligibility: 'eligible',
    rejectionReasons: [],
    suggestedService: 'website',
    ...overrides,
  };
}

describe('ReviewCandidates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useImportSelectedCandidates).mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof useImportSelectedCandidates>);
  });

  it('renders nothing when a run has no staged candidates (existing auto-import logs compatible)', () => {
    const { container } = renderWithProviders(
      <ReviewCandidates log={logWith([])} canWrite={true} />,
    );
    expect(container.textContent ?? '').not.toContain('Review candidates');
  });

  it('shows contact states, evidence, opportunities, guesses, scores, and service', () => {
    renderWithProviders(<ReviewCandidates log={logWith([candidate()])} canWrite={true} />);
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByText(/unknown/)).toBeInTheDocument();
    expect(screen.getByText(/Observed:/)).toBeInTheDocument();
    expect(screen.getByText(/AI guess \(unverified\):/)).toBeInTheDocument();
    expect(screen.getByText(/Fit 75/)).toBeInTheDocument();
    expect(screen.getByText('website')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Website' })).toHaveAttribute('href', 'https://acme.com');
  });

  it('paginates every staged candidate instead of hiding candidates after fifty', async () => {
    const candidates = Array.from({ length: 60 }, (_, index) =>
      candidate({
        provider: { kind: 'youtube_channel', id: `UC${index}` },
        business: {
          name: `Business ${index}`,
          website: 'https://acme.com',
          sourceUrls: [],
          location: 'Bangalore',
          industry: '',
        },
      }),
    );
    renderWithProviders(<ReviewCandidates log={logWith(candidates)} canWrite={true} />);

    expect(screen.getByText('Business 0')).toBeInTheDocument();
    expect(screen.queryByText('Business 59')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 1–50 of 60')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText('Business 59')).toBeInTheDocument());
  });

  it('labels synthetic contacts research-only and refuses to select them', () => {
    renderWithProviders(
      <ReviewCandidates
        log={logWith([
          candidate({
            provider: { kind: 'youtube_channel', id: 'UC9' },
            business: { name: 'Synth', website: null, sourceUrls: [], location: '', industry: '' },
            contacts: [
              { channel: 'email', value: 'x@y-scraped.local', provenance: 'placeholder_synthetic', state: 'synthetic' },
            ],
            eligibility: 'research_only',
            rejectionReasons: ['synthetic_only'],
          }),
        ])}
        canWrite={true}
      />,
    );
    expect(screen.getByText(/research-only/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Select Synth/ })).toBeDisabled();
    expect(screen.getByText(/synthetic_only/)).toBeInTheDocument();
  });

  it('keeps an unknown-email-only candidate in research', () => {
    renderWithProviders(<ReviewCandidates log={logWith([candidate({
      contacts: [{ channel: 'email', value: 'hi@acme.com', provenance: 'youtube_description', state: 'unknown' }],
      eligibility: 'research_only',
    })])} canWrite={true} />);
    expect(screen.getByRole('button', { name: 'Select Acme' })).toBeDisabled();
  });

  it('imports an explicit selection idempotently (same payload on repeat clicks)', async () => {
    mutate.mockImplementation((_input: unknown, opts: { onSuccess?: (r: unknown) => void }) =>
      opts.onSuccess?.({ recordsImported: 1, recordsDuplicate: 0, recordsFailed: 0 }),
    );
    renderWithProviders(<ReviewCandidates log={logWith([candidate()])} canWrite={true} />);
    fireEvent.click(screen.getByRole('button', { name: /Select Acme/ }));
    fireEvent.click(screen.getByRole('button', { name: /Import selected \(1\)/ }));
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith(
        { logId: 'log-1', selection: ['UC1'] },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      ),
    );
  });

  it('hides selection controls from read-only roles', () => {
    renderWithProviders(<ReviewCandidates log={logWith([candidate()])} canWrite={false} />);
    expect(screen.queryByRole('button', { name: /Import selected/ })).not.toBeInTheDocument();
    expect(screen.getByText('Acme')).toBeInTheDocument();
  });
});

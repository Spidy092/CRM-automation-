import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { CampaignFormPage } from '../CampaignFormPage';
import { apiClient } from '@/api/client';

vi.mock('@/api/client', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue({ data: { success: true, data: [] } }),
    post: vi.fn().mockResolvedValue({
      data: { success: true, data: { id: 'campaign-1', name: 'Q3 Push', steps: [] } },
    }),
    put: vi.fn().mockResolvedValue({ data: { success: true, data: {} } }),
    delete: vi.fn().mockResolvedValue({ data: { success: true } }),
    patch: vi.fn().mockResolvedValue({ data: { success: true, data: {} } }),
  },
}));

const goToStep = async (stepName: RegExp) => {
  await waitFor(() => {
    expect(screen.getByRole('button', { name: stepName })).toBeInTheDocument();
  });
  fireEvent.click(screen.getByRole('button', { name: stepName }));
};

const fillNameAndNext = async (name = 'Q3 Push') => {
  await waitFor(() => {
    expect(screen.getByLabelText(/Campaign Name/i)).toBeInTheDocument();
  });
  fireEvent.change(screen.getByLabelText(/Campaign Name/i), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: /Next/i }));
};

describe('CampaignFormPage (wizard)', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset();
    vi.mocked(apiClient.post).mockReset();
    vi.mocked(apiClient.get).mockResolvedValue({ data: { success: true, data: [] } });
    vi.mocked(apiClient.post).mockResolvedValue({
      data: { success: true, data: { id: 'campaign-1', name: 'Q3 Push', steps: [] } },
    });
  });

  it('renders the step indicator with all five steps', async () => {
    renderWithProviders(<CampaignFormPage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /1\s*Basics/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /2\s*Pipeline/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /3\s*Sequence/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /4\s*Leads/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /5\s*Review & Launch/i })).toBeInTheDocument();
  });

  it('starts on Basics and blocks Next until a name is entered', async () => {
    renderWithProviders(<CampaignFormPage />);
    await waitFor(() => {
      expect(screen.getByLabelText(/Campaign Name/i)).toBeInTheDocument();
    });

    const nextButton = screen.getByRole('button', { name: /Next/i });
    expect(nextButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Campaign Name/i), { target: { value: 'Q3 Push' } });
    expect(nextButton).not.toBeDisabled();
  });

  // ── Step 1: Basics ─────────────────────────────────────────────────────

  it('renders tone selector with three options', async () => {
    renderWithProviders(<CampaignFormPage />);
    await waitFor(() => {
      expect(screen.getByLabelText(/Message Tone/i)).toBeInTheDocument();
    });
    const toneSelect = screen.getByLabelText(/Message Tone/i);
    expect(toneSelect).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Formal' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Professional' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Conversational' })).toBeInTheDocument();
  });

  it('renders target industries and countries inputs', async () => {
    renderWithProviders(<CampaignFormPage />);
    await waitFor(() => {
      expect(screen.getByLabelText(/Target Industries/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/Target Countries/i)).toBeInTheDocument();
  });

  it('renders AI personalization toggle', async () => {
    renderWithProviders(<CampaignFormPage />);
    await waitFor(() => {
      expect(screen.getByLabelText(/AI Personalization/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Use OpenAI to personalize/i)).toBeInTheDocument();
  });

  // ── Step 2: Pipeline ───────────────────────────────────────────────────

  it('shows pipeline auto-enrollment card on step 2', async () => {
    renderWithProviders(<CampaignFormPage />);
    await fillNameAndNext();

    await waitFor(() => {
      expect(screen.getByText(/Pipeline Auto-Enrollment/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/Pipeline/i)).toBeInTheDocument();
    expect(screen.getByText(/Source & Tag Triggers/i)).toBeInTheDocument();
  });

  it('shows source and tag trigger inputs', async () => {
    renderWithProviders(<CampaignFormPage />);
    await fillNameAndNext();

    await waitFor(() => {
      expect(screen.getByLabelText(/Lead Source/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/Lead Tags/i)).toBeInTheDocument();
  });

  // ── Step 3: Sequence ───────────────────────────────────────────────────

  it('shows outreach sequence card and warns without a sequence', async () => {
    renderWithProviders(<CampaignFormPage />);
    await fillNameAndNext();
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    await waitFor(() => {
      expect(screen.getByText(/Outreach Sequence/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/cannot launch/i)).toBeInTheDocument();
  });

  it('shows delivery controls card on step 3', async () => {
    renderWithProviders(<CampaignFormPage />);
    await fillNameAndNext();
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    await waitFor(() => {
      expect(screen.getByText(/Delivery Controls/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/Send Window/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Daily send limit/i)).toBeInTheDocument();
  });

  it('shows send window controls when toggle is enabled', async () => {
    renderWithProviders(<CampaignFormPage />);
    await fillNameAndNext();
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/Send Window/i)).toBeInTheDocument();
    });

    // Enable send window
    fireEvent.click(screen.getByLabelText(/Send Window/i));

    await waitFor(() => {
      expect(screen.getByLabelText(/From/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/Until/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Timezone/i)).toBeInTheDocument();
    expect(screen.getByText('Mon')).toBeInTheDocument();
    expect(screen.getByText('Fri')).toBeInTheDocument();
  });

  it('shows build-from-scratch button', async () => {
    renderWithProviders(<CampaignFormPage />);
    await fillNameAndNext();
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Build one from scratch/i })).toBeInTheDocument();
    });
  });

  // ── Step 4: Leads ──────────────────────────────────────────────────────

  it('shows lead picker on step 4 after saving draft', async () => {
    renderWithProviders(<CampaignFormPage />);
    await fillNameAndNext();
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Who gets contacted/i })).toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText(/Search by business/i)).toBeInTheDocument();
  });

  // ── Step 5: Review ─────────────────────────────────────────────────────

  it('shows review summary with campaign details', async () => {
    renderWithProviders(<CampaignFormPage />);
    await fillNameAndNext();
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    // Wait for step 4 (leads) to appear — the draft save is async
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Who gets contacted/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /^Next$/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Review' })).toBeInTheDocument();
    });

    // Verify review content - use getAllByText since name may appear in step indicator too
    expect(screen.getAllByText('Q3 Push').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Professional/i).length).toBeGreaterThanOrEqual(1);
  });

  it('shows readiness check on review step', async () => {
    renderWithProviders(<CampaignFormPage />);
    await fillNameAndNext();
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Who gets contacted/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /^Next$/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Readiness Check' })).toBeInTheDocument();
    });
  });

  it('blocks launch when no sequence is selected', async () => {
    renderWithProviders(<CampaignFormPage />);
    await fillNameAndNext();
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Who gets contacted/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /^Next$/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Save & Launch/i })).toBeDisabled();
    });
  });

  // ── Full walkthrough ───────────────────────────────────────────────────

  it('walks through pipeline and sequence steps to review', async () => {
    renderWithProviders(<CampaignFormPage />);
    await fillNameAndNext();

    // Step 2: pipeline trigger
    expect(screen.getByText(/Pipeline Auto-Enrollment/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    // Step 3: sequence — warns that launch is blocked without one
    expect(screen.getByText(/Outreach Sequence/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot launch/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    // Step 4: leads — entering it saves the draft first, so the picker appears async
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Who gets contacted/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /^Next$/i }));

    // Step 5: review + readiness check
    expect(screen.getByRole('heading', { name: 'Readiness Check' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Save draft & check readiness/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save & Launch/i })).toBeDisabled();
  });

  it('allows navigating back to previous steps', async () => {
    renderWithProviders(<CampaignFormPage />);
    await fillNameAndNext();

    // Now on step 2
    expect(screen.getByText(/Pipeline Auto-Enrollment/i)).toBeInTheDocument();

    // Click Back
    fireEvent.click(screen.getByRole('button', { name: /Back/i }));

    // Should be back on step 1
    await waitFor(() => {
      expect(screen.getByLabelText(/Campaign Name/i)).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue('Q3 Push')).toBeInTheDocument();
  });
});

import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../lib/test-utils';
import { CampaignFormPage } from '../CampaignFormPage';
import { apiClient } from '../../api/client';

vi.mock('../../api/client', () => ({
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
    vi.mocked(apiClient.put).mockReset();
    vi.mocked(apiClient.get).mockImplementation(async (url) => ({ data: { success: true, data: String(url).includes('automation-preview') ? { templateIssues: [], connectorIssues: [], eligibleLeads: [], skippedLeads: [], expectedJobs: 0 } : [] } }));
    vi.mocked(apiClient.post).mockResolvedValue({
      data: { success: true, data: { id: 'campaign-1', name: 'Q3 Push', steps: [] } },
    });
    vi.mocked(apiClient.put).mockResolvedValue({ data: { success: true, data: {} } });
  });

  it('renders the step indicator with four steps without a required pipeline step', async () => {
    renderWithProviders(<CampaignFormPage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /1\s*Basics/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /Pipeline/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /2\s*Messages/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /3\s*Leads/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /4\s*Review & Launch/i })).toBeInTheDocument();
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

  it('only offers tone rewriting when AI personalization is enabled', async () => {
    renderWithProviders(<CampaignFormPage />);
    expect(screen.queryByLabelText(/Message Tone/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: /AI Personalization/i }));
    expect(screen.getByLabelText(/Message Tone/i)).toBeInTheDocument();
    const toneSelect = screen.getByLabelText(/Message Tone/i);
    expect(toneSelect).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Formal' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Professional' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Conversational' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: /AI Personalization/i }));
    expect(screen.queryByLabelText(/Message Tone/i)).not.toBeInTheDocument();
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

  it('keeps automatic enrollment off and hides rules by default', async () => {
    renderWithProviders(<CampaignFormPage />);
    expect(screen.getByRole('switch', { name: 'Automatically add future leads' })).not.toBeChecked();
    expect(screen.queryByLabelText('Google Business / Places')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/When a lead moves/)).not.toBeInTheDocument();
  });

  it('offers readable source choices and existing custom sources and tags', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url) => ({ data: { success: true, data: url === '/campaigns/enrollment-options' ? { sources: ['partner_referral'], tags: ['vip'] } : [] } }));
    renderWithProviders(<CampaignFormPage />);
    fireEvent.click(screen.getByRole('switch', { name: 'Automatically add future leads' }));
    expect(await screen.findByLabelText('partner referral')).toBeInTheDocument();
    expect(screen.getByLabelText('Google Business / Places')).toBeInTheDocument();
    expect(screen.getByLabelText('vip')).toBeInTheDocument();
    expect(screen.getByLabelText(/When a lead moves/)).toBeInTheDocument();
  });

  it('saves selected source rules, and clears them when automatic enrollment is disabled', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url) => ({ data: { success: true, data: String(url).includes('automation-preview') ? { templateIssues: [], connectorIssues: [], eligibleLeads: [], skippedLeads: [], expectedJobs: 0 } : [] } }));
    renderWithProviders(<CampaignFormPage />);
    fireEvent.change(screen.getByLabelText(/Campaign Name/), { target: { value: 'Q3 Push' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Automatically add future leads' }));
    fireEvent.click(screen.getByLabelText('Google Business / Places'));
    fireEvent.click(screen.getByRole('button', { name: /^Next$/i }));
    await screen.findByText(/Messages and follow-ups/i);
    fireEvent.click(screen.getByRole('button', { name: /^Next$/i }));
    await screen.findByRole('heading', { name: /Who gets contacted/i });
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/campaigns', expect.objectContaining({ trigger_source: ['google_business'] })));
    fireEvent.click(screen.getByRole('button', { name: /^Back$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Back$/i }));
    fireEvent.click(screen.getByRole('switch', { name: 'Automatically add future leads' }));
    fireEvent.click(screen.getByRole('button', { name: /^Next$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Next$/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Next$/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /^Next$/i }));
    await screen.findByRole('heading', { name: 'Readiness Check' });
    fireEvent.click(screen.getByRole('button', { name: /Save as draft/i }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/campaigns/campaign-1', expect.objectContaining({ trigger_source: null, trigger_tags: null, pipeline_id: null, trigger_stage_id: null })));
  });

  it('shows a retry action if loading custom options fails', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url) => {
      if (url === '/campaigns/enrollment-options') throw new Error('unavailable');
      return { data: { success: true, data: [] } };
    });
    renderWithProviders(<CampaignFormPage />);
    fireEvent.click(screen.getByRole('switch', { name: 'Automatically add future leads' }));
    expect(await screen.findByText(/Could not load your custom sources/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByLabelText('Google Business / Places')).toBeInTheDocument();
  });

  it('requires a rule when automatic enrollment is enabled', async () => {
    renderWithProviders(<CampaignFormPage />);
    fireEvent.click(screen.getByRole('switch', { name: 'Automatically add future leads' }));
    await fillNameAndNext();
    fireEvent.click(screen.getByRole('button', { name: /^Next$/i }));
    expect(await screen.findByText(/Choose a source, tag, or pipeline rule/)).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  // ── Step 3: Sequence ───────────────────────────────────────────────────

  it('shows outreach sequence card and warns without a sequence', async () => {
    renderWithProviders(<CampaignFormPage />);
    await fillNameAndNext();

    await waitFor(() => {
      expect(screen.getByText(/Messages and follow-ups/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/cannot launch/i)).toBeInTheDocument();
  });

  it('shows delivery controls card on step 3', async () => {
    renderWithProviders(<CampaignFormPage />);
    await fillNameAndNext();

    await waitFor(() => {
      expect(screen.getByText(/Delivery Controls/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/Send Window/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Daily send limit/i)).toBeInTheDocument();
  });

  it('shows send window controls when toggle is enabled', async () => {
    renderWithProviders(<CampaignFormPage />);
    await fillNameAndNext();

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

  it('shows create-new button', async () => {
    renderWithProviders(<CampaignFormPage />);
    await fillNameAndNext();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Create new/i })).toBeInTheDocument();
    });
  });

  it('keeps presets hidden until requested and allows closing them', async () => {
    renderWithProviders(<CampaignFormPage />);
    await fillNameAndNext();
    const trigger = screen.getByRole('button', { name: 'Use a preset' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Start from a proven sequence')).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Start from a proven sequence')).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.queryByText('Start from a proven sequence')).not.toBeInTheDocument();
  });

  it('closes preset choices when creating a custom sequence', async () => {
    renderWithProviders(<CampaignFormPage />);
    await fillNameAndNext();
    fireEvent.click(screen.getByRole('button', { name: 'Use a preset' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create new' }));
    expect(screen.queryByText('Start from a proven sequence')).not.toBeInTheDocument();
    expect(screen.getByText('New Sequence')).toBeInTheDocument();
  });

  // ── Step 4: Leads ──────────────────────────────────────────────────────

  it('shows lead picker on step 4 after saving draft', async () => {
    renderWithProviders(<CampaignFormPage />);
    await fillNameAndNext();
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Who gets contacted/i })).toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText(/Search by business/i)).toBeInTheDocument();
  });

  // ── Step 5: Review ─────────────────────────────────────────────────────

  it('saves a sequence attached after the first draft before checking readiness again', async () => {
    let savedSequence: string | null = null;
    const sequence = { id: 'seq-1', name: 'Cold Email', steps: [{ stepNumber: 1, channel: 'email', templateId: 'tmpl-1', delayHours: 0 }] };
    vi.mocked(apiClient.get).mockImplementation(async (url) => ({ data: { success: true, data:
      url === '/outreach/sequences' ? [sequence] : String(url).includes('automation-preview')
        ? { templateIssues: savedSequence ? [] : ['Campaign has no outreach sequence.'], connectorIssues: [], eligibleLeads: [], skippedLeads: [], expectedJobs: 0 }
        : [] } }));
    vi.mocked(apiClient.put).mockImplementation(async (_url, input) => {
      savedSequence = (input as { sequence_id?: string }).sequence_id ?? null;
      return { data: { success: true, data: { id: 'campaign-1' } } };
    });
    renderWithProviders(<CampaignFormPage />);
    await fillNameAndNext();
    fireEvent.click(screen.getByRole('button', { name: /^Next$/i }));
    await screen.findByRole('heading', { name: /Who gets contacted/i });
    fireEvent.click(screen.getByRole('button', { name: /^Next$/i }));
    await screen.findByText('Campaign has no outreach sequence.');
    fireEvent.click(screen.getByRole('button', { name: /Choose messages/i }));
    fireEvent.click(screen.getByRole('button', { name: /Cold Email/i }));
    fireEvent.click(screen.getByRole('button', { name: /Review & Launch/i }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/campaigns/campaign-1', expect.objectContaining({ sequence_id: 'seq-1' })));
    await screen.findByRole('heading', { name: 'Review' });
    await waitFor(() => expect(screen.queryByText('Campaign has no outreach sequence.')).not.toBeInTheDocument());
  });

  it('shows review summary with campaign details', async () => {
    renderWithProviders(<CampaignFormPage />);
    await fillNameAndNext();
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    // Wait for step 4 (leads) to appear — the draft save is async
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Who gets contacted/i })).toBeInTheDocument();
    });
    await waitFor(() => expect(screen.getByRole('button', { name: /^Next$/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /^Next$/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Review' })).toBeInTheDocument();
    });

    // Verify review content - use getAllByText since name may appear in step indicator too
    expect(screen.getAllByText('Q3 Push').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Use template wording')).toBeInTheDocument();
  });

  it('shows readiness check on review step', async () => {
    renderWithProviders(<CampaignFormPage />);
    await fillNameAndNext();
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Who gets contacted/i })).toBeInTheDocument();
    });
    await waitFor(() => expect(screen.getByRole('button', { name: /^Next$/i })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /^Next$/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Readiness Check' })).toBeInTheDocument();
    });
  });

  it('blocks launch when no sequence is selected', async () => {
    renderWithProviders(<CampaignFormPage />);
    await fillNameAndNext();
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

  it('reaches review without configuring a pipeline', async () => {
    renderWithProviders(<CampaignFormPage />);
    await fillNameAndNext();

    expect(screen.queryByLabelText(/Pipeline/i)).not.toBeInTheDocument();

    // Step 3: sequence — warns that launch is blocked without one
    expect(screen.getByText(/Messages and follow-ups/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot launch/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    // Step 4: leads — entering it saves the draft first, so the picker appears async
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Who gets contacted/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /^Next$/i }));

    // Step 5: review + readiness check
    await screen.findByRole('heading', { name: 'Readiness Check' });
    expect(
      screen.queryByRole('button', { name: /Save draft & check readiness/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save & Launch/i })).toBeDisabled();
  });

  it('allows navigating back to previous steps', async () => {
    renderWithProviders(<CampaignFormPage />);
    await fillNameAndNext();

    // Now on step 2
    expect(screen.getByText(/Messages and follow-ups/i)).toBeInTheDocument();

    // Click Back
    fireEvent.click(screen.getByRole('button', { name: /Back/i }));

    // Should be back on step 1
    await waitFor(() => {
      expect(screen.getByLabelText(/Campaign Name/i)).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue('Q3 Push')).toBeInTheDocument();
  });

  it('shows "Save & Review AI Brief" button when AI personalization is enabled and brief is pending', async () => {
    renderWithProviders(<CampaignFormPage />);
    await waitFor(() => {
      expect(screen.getByLabelText(/Campaign Name/i)).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText(/Campaign Name/i), { target: { value: 'AI Outreach' } });

    // Toggle AI personalization on
    const aiToggle = screen.getByRole('switch', { name: /AI Personalization/i });
    fireEvent.click(aiToggle);

    fireEvent.click(screen.getByRole('button', { name: /Next/i }));


    // Step 3: sequence
    await waitFor(() => {
      expect(screen.getByText(/Messages and follow-ups/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    // Step 4: leads
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Who gets contacted/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /^Next$/i }));

    // Step 5: review
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Review' })).toBeInTheDocument();
    });

    // When AI personalization is enabled and brief is not approved, primary action is guided
    expect(screen.getByRole('button', { name: /Save & Review AI Brief/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save & Launch/i })).not.toBeInTheDocument();
  });
});

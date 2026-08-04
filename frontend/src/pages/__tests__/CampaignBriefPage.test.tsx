import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { CampaignBriefPage } from '../CampaignBriefPage';

const mockUseBrief = vi.fn();
const mockApproveMutateAsync = vi.fn();
const mockRejectMutateAsync = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useParams: () => ({ id: 'camp-1' }) };
});

vi.mock('@/api/aiCampaignBrain', () => ({
  useCampaignBrief: () => mockUseBrief(),
  useApproveBrief: () => ({ mutateAsync: mockApproveMutateAsync, isPending: false }),
  useRejectBrief: () => ({ mutateAsync: mockRejectMutateAsync, isPending: false }),
}));

const fakeBrief = {
  id: 'b1',
  campaign_id: 'c1',
  total_leads_evaluated: 188,
  eligible_leads: 150,
  high_fit_leads: 42,
  segment_summary: '188 local service businesses',
  recommended_offer_angle: 'WhatsApp booking automation',
  expected_objections: ['too expensive', 'no time'],
  risk_warnings: ['8 may be competitors'],
  recommended_sequence: [
    { step_number: 1, channel: 'email', delay_hours: 0, goal: 'Initial outreach' },
    { step_number: 2, channel: 'whatsapp', delay_hours: 24, goal: 'Follow up' },
  ],
  template_suggestions: [
    { channel: 'email', subject: 'Quick question', body_preview: 'Hi there...' },
  ],
  recommended_autonomy_level: 'guarded' as const,
  confidence_score: 78,
  status: 'draft' as const,
  approved_by: null,
  approved_at: null,
  created_at: '2026-06-26T10:00:00.000Z',
};

describe('CampaignBriefPage', () => {
  beforeEach(() => {
    mockUseBrief.mockReset();
    mockApproveMutateAsync.mockReset();
    mockRejectMutateAsync.mockReset();
  });

  it('renders the brief when loaded', () => {
    mockUseBrief.mockReturnValue({ data: fakeBrief, isLoading: false, error: null });
    renderWithProviders(<CampaignBriefPage />);
    expect(screen.getByText('Campaign Brief')).toBeInTheDocument();
    expect(screen.getByText('188 local service businesses')).toBeInTheDocument();
    expect(screen.getByText('WhatsApp booking automation')).toBeInTheDocument();
  });

  it('renders an empty state when there is no brief', () => {
    mockUseBrief.mockReturnValue({ data: null, isLoading: false, error: null });
    renderWithProviders(<CampaignBriefPage />);
    expect(screen.getByText(/No brief generated yet/i)).toBeInTheDocument();
  });

  it('shows loading state', () => {
    mockUseBrief.mockReturnValue({ data: null, isLoading: true, error: null });
    renderWithProviders(<CampaignBriefPage />);
    expect(screen.getByText('Campaign Brief')).toBeInTheDocument();
  });

  it('shows error state when brief fails to load', () => {
    mockUseBrief.mockReturnValue({ data: null, isLoading: false, error: new Error('fail') });
    renderWithProviders(<CampaignBriefPage />);
    expect(screen.getByText(/Could not load the campaign brief/i)).toBeInTheDocument();
  });

  it('displays stat cards with correct values', () => {
    mockUseBrief.mockReturnValue({ data: fakeBrief, isLoading: false, error: null });
    renderWithProviders(<CampaignBriefPage />);
    expect(screen.getByText('188')).toBeInTheDocument(); // total_leads_evaluated
    expect(screen.getByText('150')).toBeInTheDocument(); // eligible_leads
    expect(screen.getByText('42')).toBeInTheDocument(); // high_fit_leads
  });

  it('displays status badge for draft status', () => {
    mockUseBrief.mockReturnValue({ data: fakeBrief, isLoading: false, error: null });
    renderWithProviders(<CampaignBriefPage />);
    expect(screen.getByText('draft')).toBeInTheDocument();
  });

  it('displays status badge for approved status', () => {
    mockUseBrief.mockReturnValue({
      data: { ...fakeBrief, status: 'approved' },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<CampaignBriefPage />);
    expect(screen.getByText('approved')).toBeInTheDocument();
  });

  it('displays autonomy level and confidence score', () => {
    mockUseBrief.mockReturnValue({ data: fakeBrief, isLoading: false, error: null });
    renderWithProviders(<CampaignBriefPage />);
    expect(screen.getByText(/Autonomy: guarded/i)).toBeInTheDocument();
    expect(screen.getByText(/Confidence 78/i)).toBeInTheDocument();
  });

  it('displays expected objections', () => {
    mockUseBrief.mockReturnValue({ data: fakeBrief, isLoading: false, error: null });
    renderWithProviders(<CampaignBriefPage />);
    expect(screen.getByText(/too expensive/i)).toBeInTheDocument();
    expect(screen.getByText(/no time/i)).toBeInTheDocument();
  });

  it('displays risk warnings', () => {
    mockUseBrief.mockReturnValue({ data: fakeBrief, isLoading: false, error: null });
    renderWithProviders(<CampaignBriefPage />);
    expect(screen.getByText(/8 may be competitors/i)).toBeInTheDocument();
  });

  it('displays recommended sequence steps', () => {
    mockUseBrief.mockReturnValue({ data: fakeBrief, isLoading: false, error: null });
    renderWithProviders(<CampaignBriefPage />);
    expect(screen.getByText('Initial outreach')).toBeInTheDocument();
    expect(screen.getByText('Follow up')).toBeInTheDocument();
  });

  it('displays template suggestions', () => {
    mockUseBrief.mockReturnValue({ data: fakeBrief, isLoading: false, error: null });
    renderWithProviders(<CampaignBriefPage />);
    expect(screen.getByText('Quick question')).toBeInTheDocument();
    expect(screen.getByText('Hi there...')).toBeInTheDocument();
  });

  it('shows Approve and Reject buttons for draft briefs', () => {
    mockUseBrief.mockReturnValue({ data: fakeBrief, isLoading: false, error: null });
    renderWithProviders(<CampaignBriefPage />);
    expect(screen.getByRole('button', { name: /Approve/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reject/i })).toBeInTheDocument();
  });

  it('does not show Approve/Reject buttons for approved briefs', () => {
    mockUseBrief.mockReturnValue({
      data: { ...fakeBrief, status: 'approved' },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<CampaignBriefPage />);
    expect(screen.queryByRole('button', { name: /Approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reject/i })).not.toBeInTheDocument();
  });

  it('calls approve API when Approve is clicked', async () => {
    mockUseBrief.mockReturnValue({ data: fakeBrief, isLoading: false, error: null });
    mockApproveMutateAsync.mockResolvedValue({});
    renderWithProviders(<CampaignBriefPage />);

    fireEvent.click(screen.getByRole('button', { name: /Approve/i }));

    await waitFor(() => {
      expect(mockApproveMutateAsync).toHaveBeenCalled();
    });
  });

  it('calls reject API when Reject is clicked', async () => {
    mockUseBrief.mockReturnValue({ data: fakeBrief, isLoading: false, error: null });
    mockRejectMutateAsync.mockResolvedValue({});
    renderWithProviders(<CampaignBriefPage />);

    fireEvent.click(screen.getByRole('button', { name: /Reject/i }));

    await waitFor(() => {
      expect(mockRejectMutateAsync).toHaveBeenCalled();
    });
  });

  it('shows "None identified" when objections list is empty', () => {
    mockUseBrief.mockReturnValue({
      data: { ...fakeBrief, expected_objections: [] },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<CampaignBriefPage />);
    expect(screen.getByText('None identified.')).toBeInTheDocument();
  });

  it('shows "No risks flagged" when warnings list is empty', () => {
    mockUseBrief.mockReturnValue({
      data: { ...fakeBrief, risk_warnings: [] },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<CampaignBriefPage />);
    expect(screen.getByText('No risks flagged.')).toBeInTheDocument();
  });

  it('has a Back link to campaigns', () => {
    mockUseBrief.mockReturnValue({ data: fakeBrief, isLoading: false, error: null });
    renderWithProviders(<CampaignBriefPage />);
    expect(screen.getByRole('link', { name: /Back/i })).toHaveAttribute('href', '/campaigns');
  });
});

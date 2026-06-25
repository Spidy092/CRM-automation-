import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { LeadDetailPage } from '../LeadDetailPage';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ id: 'lead-123' }),
    useNavigate: () => vi.fn(),
  };
});

vi.mock('@/api/client', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue({
      data: {
        data: {
          id: 'lead-123',
          business_name: 'Test Corp',
          email: 'test@test.com',
          phone: '+1234567890',
          status: 'active',
          lead_score: 75,
          classification: 'hot',
          source_type: 'google_places',
          created_at: new Date().toISOString(),
          custom_fields: {},
        },
      },
    }),
  },
}));

vi.mock('@/api/leads', () => ({
  useLead: vi.fn().mockReturnValue({
    data: {
      id: 'lead-123',
      business_name: 'Test Corp',
      email: 'test@test.com',
      phone: '+1234567890',
      status: 'active',
      lead_score: 75,
      classification: 'hot',
      source_type: 'google_places',
      created_at: new Date().toISOString(),
      custom_fields: {},
    },
    isLoading: false,
    error: null,
  }),
  useLeadActivity: vi.fn().mockReturnValue({
    data: [],
    isLoading: false,
  }),
  usePauseLead: vi.fn().mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useDeleteLead: vi.fn().mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

describe('LeadDetailPage', () => {
  it('renders the lead business name', () => {
    renderWithProviders(<LeadDetailPage />);
    expect(screen.getByText('Test Corp')).toBeDefined();
  });

  it('renders lead score', () => {
    renderWithProviders(<LeadDetailPage />);
    expect(screen.getByText('75')).toBeDefined();
  });

  it('renders classification', () => {
    renderWithProviders(<LeadDetailPage />);
    expect(screen.getByText('hot')).toBeDefined();
  });
});

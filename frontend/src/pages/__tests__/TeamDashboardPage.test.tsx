import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { TeamDashboardPage } from '../TeamDashboardPage';

const mockGet = vi.hoisted(() => vi.fn());

vi.mock('@/api/client', () => ({
  apiClient: {
    get: mockGet,
    post: vi.fn().mockResolvedValue({ data: { success: true, data: {} } }),
    put: vi.fn().mockResolvedValue({ data: { success: true, data: {} } }),
    delete: vi.fn().mockResolvedValue({ data: { success: true } }),
    patch: vi.fn().mockResolvedValue({ data: { success: true, data: {} } }),
  },
}));

vi.mock('@/api/pipelines', () => ({
  usePipelines: () => ({
    data: [
      {
        id: 'p1',
        name: 'Sales Pipeline',
        is_default: true,
        stages: [
          { id: 's1', name: 'New Lead', position: 1, pipeline_id: 'p1' },
          { id: 's2', name: 'Contacted', position: 2, pipeline_id: 'p1' },
        ],
      },
    ],
    isLoading: false,
  }),
}));

const mockData = [
  {
    user_id: 'u1',
    name: 'Alice',
    assigned_count: 10,
    contacted_count: 5,
    contacted_pct: 50,
    avg_response_time: 3600,
    total_activities: 8,
  },
  {
    user_id: 'u2',
    name: 'Bob',
    assigned_count: 4,
    contacted_count: 2,
    contacted_pct: 50,
    avg_response_time: 1800,
    total_activities: 3,
  },
];

vi.mock('@/api/client', () => ({
  apiClient: {
    get: mockGet,
    post: vi.fn().mockResolvedValue({ data: { success: true, data: {} } }),
    put: vi.fn().mockResolvedValue({ data: { success: true, data: {} } }),
    delete: vi.fn().mockResolvedValue({ data: { success: true } }),
    patch: vi.fn().mockResolvedValue({ data: { success: true, data: {} } }),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue({ data: { success: true, data: mockData } });
});

vi.mock('@/api/pipelines', () => ({
  usePipelines: () => ({
    data: [
      {
        id: 'p1',
        name: 'Sales Pipeline',
        is_default: true,
        stages: [
          { id: 's1', name: 'New Lead', position: 1, pipeline_id: 'p1' },
          { id: 's2', name: 'Contacted', position: 2, pipeline_id: 'p1' },
        ],
      },
    ],
    isLoading: false,
  }),
}));

describe('TeamDashboardPage', () => {
  it('renders successfully', async () => {
    const { container } = renderWithProviders(<TeamDashboardPage />);
    await waitFor(() => {
      expect(container).toBeTruthy();
    });
  });

  it('displays the page title', async () => {
    renderWithProviders(<TeamDashboardPage />);
    await waitFor(() => {
      expect(document.body.textContent).toContain('Team Dashboard');
    });
  });

  it('shows summary cards with aggregated metrics', async () => {
    renderWithProviders(<TeamDashboardPage />);
    await waitFor(() => {
      expect(document.body.textContent).toContain('Total Leads');
      expect(document.body.textContent).toContain('14');
      expect(document.body.textContent).toContain('Contacted Leads');
      expect(document.body.textContent).toContain('7');
      expect(document.body.textContent).toContain('Total Activities');
      expect(document.body.textContent).toContain('11');
    });
  });

  it('renders per-member table rows', async () => {
    renderWithProviders(<TeamDashboardPage />);
    await waitFor(() => {
      expect(document.body.textContent).toContain('Alice');
      expect(document.body.textContent).toContain('Bob');
    });
  });

  it('calls the API with filter params when Apply is clicked', async () => {
    renderWithProviders(<TeamDashboardPage />);

    const fromInput = screen.getByLabelText('From') as HTMLInputElement;
    const toInput = screen.getByLabelText('To') as HTMLInputElement;

    fireEvent.change(fromInput, { target: { value: '2025-01-01' } });
    fireEvent.change(toInput, { target: { value: '2025-01-31' } });

    const applyButton = screen.getByRole('button', { name: 'Apply' });
    fireEvent.click(applyButton);

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(
        '/team/metrics',
        expect.objectContaining({
          params: expect.objectContaining({
            from: expect.stringContaining('2025-01-01'),
            to: expect.stringContaining('2025-01-31'),
          }),
        }),
      );
    });
  });

  it('clears filters when Clear is clicked', async () => {
    renderWithProviders(<TeamDashboardPage />);

    const fromInput = screen.getByLabelText('From') as HTMLInputElement;
    fireEvent.change(fromInput, { target: { value: '2025-01-01' } });

    const clearButton = screen.getByRole('button', { name: 'Clear' });
    fireEvent.click(clearButton);

    await waitFor(() => {
      expect(fromInput.value).toBe('');
    });
  });

  it('renders stage dropdown with pipeline stages', async () => {
    renderWithProviders(<TeamDashboardPage />);
    await waitFor(() => {
      const stageSelect = screen.getByLabelText('Stage') as HTMLSelectElement;
      expect(stageSelect).toBeDefined();
      expect(stageSelect.tagName).toBe('SELECT');
    });
  });

  it('shows refresh button', async () => {
    renderWithProviders(<TeamDashboardPage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /refresh/i })).toBeDefined();
    });
  });
});

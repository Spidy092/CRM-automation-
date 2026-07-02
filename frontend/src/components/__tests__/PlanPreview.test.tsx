import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import { PlanPreview } from '../PlanPreview';
import type { PlanPreview as PlanPreviewType } from '@/api/agentPlans';

const preview: PlanPreviewType = {
  plan: {
    id: 'plan-1',
    goal: 'find leads',
    status: 'proposed',
    autonomy_level: 'supervised',
    confidence: null,
    created_at: '',
  },
  steps: [
    {
      id: 's1',
      step_index: 0,
      action_name: 'lead.list',
      action_args: {},
      risk_tier: 'read',
      depends_on: [],
      rationale: 'get leads',
      status: 'pending',
    },
    {
      id: 's2',
      step_index: 1,
      action_name: 'campaign.launch',
      action_args: {},
      risk_tier: 'customer_facing_write',
      depends_on: [0],
      rationale: 'launch campaign',
      status: 'pending',
    },
  ],
  estimatedCostCents: 15,
  requiresApproval: true,
};

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('PlanPreview', () => {
  it('renders the plan goal and step count', () => {
    render(<PlanPreview preview={preview} onApprove={vi.fn()} onCancel={vi.fn()} />, {
      wrapper,
    });
    expect(screen.getByText(/find leads/i)).toBeInTheDocument();
    expect(screen.getByText(/2 steps/i)).toBeInTheDocument();
  });

  it('shows risk badge per step', async () => {
    render(<PlanPreview preview={preview} onApprove={vi.fn()} onCancel={vi.fn()} />, {
      wrapper,
    });
    fireEvent.click(screen.getByLabelText(/expand plan/i));
    expect(await screen.findByText(/read/i)).toBeInTheDocument();
    expect(await screen.findByText(/customer_facing_write/i)).toBeInTheDocument();
  });

  it('disables approve button while approving', async () => {
    render(
      <PlanPreview
        preview={preview}
        onApprove={vi.fn(() => new Promise(() => {}))}
        onCancel={vi.fn()}
      />,
      { wrapper },
    );
    const approveBtn = screen.getByTestId('approve-plan-btn');
    fireEvent.click(approveBtn);
    expect(approveBtn).toBeDisabled();
  });

  it('renders the estimated cost', () => {
    render(<PlanPreview preview={preview} onApprove={vi.fn()} onCancel={vi.fn()} />, {
      wrapper,
    });
    expect(screen.getByText(/\$0\.15/)).toBeInTheDocument();
  });
});

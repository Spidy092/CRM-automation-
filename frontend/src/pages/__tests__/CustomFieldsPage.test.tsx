import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '@/lib/test-utils';
import { CustomFieldsPage } from '../CustomFieldsPage';

vi.mock('@/api/customFields', () => ({
  useCustomFields: vi.fn().mockReturnValue({
    data: [
      {
        id: '1',
        label: 'Annual Revenue',
        field_key: 'annual_revenue',
        field_type: 'number',
        options: null,
        is_required: true,
        is_active: true,
      },
      {
        id: '2',
        label: 'Company Size',
        field_key: 'company_size',
        field_type: 'dropdown',
        options: ['Small', 'Medium', 'Large'],
        is_required: false,
        is_active: true,
      },
    ],
    isLoading: false,
    error: null,
  }),
  useCreateCustomField: vi.fn().mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
  useUpdateCustomField: vi.fn().mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
}));

describe('CustomFieldsPage', () => {
  it('renders successfully', () => {
    const { container } = renderWithProviders(<CustomFieldsPage />);
    expect(container).toBeTruthy();
  });

  it('renders page title', () => {
    renderWithProviders(<CustomFieldsPage />);
    expect(document.body.textContent).toContain('Custom Fields');
  });

  it('renders field labels', async () => {
    renderWithProviders(<CustomFieldsPage />);
    await new Promise((r) => setTimeout(r, 50));
    expect(document.body.textContent).toContain('Annual Revenue');
    expect(document.body.textContent).toContain('Company Size');
  });

  it('renders add field button', () => {
    renderWithProviders(<CustomFieldsPage />);
    expect(document.body.textContent).toContain('Add Field');
  });

  it('renders table headers', () => {
    renderWithProviders(<CustomFieldsPage />);
    expect(document.body.textContent).toContain('Label');
    expect(document.body.textContent).toContain('Key');
    expect(document.body.textContent).toContain('Type');
  });
});

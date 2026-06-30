import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '@/lib/test-utils';
import AISettingsPage from '../AISettingsPage';

vi.mock('@/api/aiSettings', () => ({
  useAiSettings: vi.fn().mockReturnValue({
    data: {
      enabled: false,
      base_url: null,
      has_api_key: false,
      model: 'gpt-4o',
      max_tokens: 500,
      temperature: 0.7,
      system_prompt_override: null,
      cache_ttl_seconds: 604800,
    },
    isLoading: false,
    error: null,
  }),
  useUpdateAiSettings: vi.fn().mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
  }),
}));

describe('AISettingsPage', () => {
  it('renders successfully', () => {
    const { container } = renderWithProviders(<AISettingsPage />);
    expect(container).toBeTruthy();
  });

  it('renders page title', () => {
    renderWithProviders(<AISettingsPage />);
    expect(document.body.textContent).toContain('AI Personalization Settings');
  });

  it('renders API key input', () => {
    const { container } = renderWithProviders(<AISettingsPage />);
    const apiKeyInput = container.querySelector('#api_key');
    expect(apiKeyInput).toBeTruthy();
  });

  it('renders model input', () => {
    const { container } = renderWithProviders(<AISettingsPage />);
    const modelInput = container.querySelector('#model');
    expect(modelInput).toBeTruthy();
  });

  it('renders save button', () => {
    renderWithProviders(<AISettingsPage />);
    expect(document.body.textContent).toContain('Save Settings');
  });

  it('defaults a fresh install to the Xiaomi MiMo provider preset', () => {
    const { container } = renderWithProviders(<AISettingsPage />);
    const providerSelect = container.querySelector<HTMLSelectElement>('#provider');
    expect(providerSelect).toBeTruthy();
    expect(providerSelect?.value).toBe('xiaomi');

    // The MiMo preset should have pre-filled base_url + model.
    const baseUrl = container.querySelector<HTMLInputElement>('#base_url');
    const model = container.querySelector<HTMLInputElement>('#model');
    expect(baseUrl?.value).toBe('https://api.xiaomimimo.com/v1');
    expect(model?.value).toBe('mimo-v2.5-pro');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/lib/test-utils';
import { LoginPage } from '../LoginPage';

// Mock the login mutation hook
const mockMutateAsync = vi.fn();
const mockLoginStore = vi.fn();
const mockNavigate = vi.fn();

vi.mock('@/api/auth', () => ({
  useLogin: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}));

vi.mock('@/store/authStore', () => ({
  useAuthStore: () => ({
    login: mockLoginStore,
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  mockMutateAsync.mockResolvedValue({
    user: { id: '1', email: 'test@test.com' },
    accessToken: 'access',
    refreshToken: 'refresh',
  });
});

describe('LoginPage', () => {
  it('renders without crashing', () => {
    const { container } = renderWithProviders(<LoginPage />);
    expect(container).toBeTruthy();
  });

  it('renders the brand mark and headline', () => {
    renderWithProviders(<LoginPage />);
    expect(document.body.textContent).toContain('CRM Platform');
    expect(document.body.textContent).toContain('Sign in to your workspace');
  });

  it('renders the value propositions', () => {
    renderWithProviders(<LoginPage />);
    expect(document.body.textContent).toContain('AI-personalized outreach at scale');
    expect(document.body.textContent).toContain('Multi-channel sequences in one inbox');
    expect(document.body.textContent).toContain('Real-time pipeline insights');
  });

  it('renders the trust stats', () => {
    renderWithProviders(<LoginPage />);
    expect(document.body.textContent).toContain('Trusted by 500+ sales teams worldwide');
  });

  it('renders the dashboard illustration', () => {
    const { container } = renderWithProviders(<LoginPage />);
    const svg = container.querySelector('svg[aria-hidden="true"]');
    expect(svg).toBeTruthy();
  });

  it('renders email and password inputs with accessible labels', () => {
    const { container } = renderWithProviders(<LoginPage />);
    const emailInput = container.querySelector('#login-email');
    const passwordInput = container.querySelector('#login-password');
    expect(emailInput).toBeTruthy();
    expect(passwordInput).toBeTruthy();
    expect(emailInput?.getAttribute('type')).toBe('email');
    expect(passwordInput?.getAttribute('type')).toBe('password');
  });

  it('accepts text in email and password inputs', async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<LoginPage />);
    const emailInput = container.querySelector('#login-email') as HTMLInputElement;
    const passwordInput = container.querySelector('#login-password') as HTMLInputElement;
    await user.type(emailInput, 'user@example.com');
    await user.type(passwordInput, 'secret123');
    expect(emailInput.value).toBe('user@example.com');
    expect(passwordInput.value).toBe('secret123');
  });

  it('renders password show/hide toggle with aria-pressed', () => {
    const { container } = renderWithProviders(<LoginPage />);
    const toggle = container.querySelector('[aria-label="Toggle password visibility"]');
    expect(toggle).toBeTruthy();
    expect(toggle?.getAttribute('aria-pressed')).toBe('false');
    expect(toggle?.getAttribute('type')).toBe('button');
  });

  it('password show/hide toggle flips input type', async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<LoginPage />);
    const passwordInput = container.querySelector('#login-password') as HTMLInputElement;
    const toggle = container.querySelector('[aria-label="Toggle password visibility"]') as HTMLButtonElement;
    expect(passwordInput.type).toBe('password');
    await user.click(toggle);
    expect(passwordInput.type).toBe('text');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    await user.click(toggle);
    expect(passwordInput.type).toBe('password');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('shows field error when email is invalid after blur', async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<LoginPage />);
    const emailInput = container.querySelector('#login-email') as HTMLInputElement;
    await user.type(emailInput, 'not-an-email');
    fireEvent.blur(emailInput);
    await waitFor(() => {
      expect(document.body.textContent).toContain('Enter a valid email');
    });
  });

  it('shows field error when password is empty after blur', async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<LoginPage />);
    const passwordInput = container.querySelector('#login-password') as HTMLInputElement;
    fireEvent.blur(passwordInput);
    await waitFor(() => {
      expect(document.body.textContent).toContain('Password is required');
    });
  });

  it('submits valid form, calls login mutation, navigates on success', async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<LoginPage />);
    await user.type(container.querySelector('#login-email') as HTMLInputElement, 'user@example.com');
    await user.type(container.querySelector('#login-password') as HTMLInputElement, 'secret123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({ email: 'user@example.com', password: 'secret123' });
      expect(mockLoginStore).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/');
    });
  });

  it('renders inline alert and shake on server error', async () => {
    const user = userEvent.setup();
    mockMutateAsync.mockRejectedValueOnce(new Error('Invalid credentials'));
    const { container } = renderWithProviders(<LoginPage />);
    await user.type(container.querySelector('#login-email') as HTMLInputElement, 'user@example.com');
    await user.type(container.querySelector('#login-password') as HTMLInputElement, 'wrong');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => {
      expect(document.body.textContent).toContain('Invalid credentials');
    });
    // The form container should have the animate-shake class applied
    const form = container.querySelector('form');
    expect(form?.className).toContain('animate-shake');
  });

  it('focus order: email → password → toggle → submit → forgot link', async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<LoginPage />);
    await user.tab();
    expect(document.activeElement?.id).toBe('login-email');
    await user.tab();
    expect(document.activeElement?.id).toBe('login-password');
    await user.tab();
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Toggle password visibility');
    await user.tab();
    expect((document.activeElement as HTMLButtonElement)?.type).toBe('submit');
    await user.tab();
    expect(document.activeElement?.textContent).toContain('Forgot');
  });
});

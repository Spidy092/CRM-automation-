# Login Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dark glassmorphism `LoginPage` with a Linear/Vercel-style light, monochrome split layout that aligns with the project's existing design system. Preserve all current auth behavior. Add only a password show/hide toggle and inline field validation.

**Architecture:** Refactor `frontend/src/pages/LoginPage.tsx` in place (no new files in `pages/`). Add a new `frontend/src/components/auth/LoginIllustration.tsx` for the inline SVG. Extend `frontend/src/index.css` with two `@keyframes` (`rise`, `shake`) and `prefers-reduced-motion` overrides. Use existing shadcn `Input`/`Label`/`Button` and CSS variables — no new design tokens, no new npm deps.

**Tech Stack:** React 18, TypeScript, Tailwind v4, shadcn/ui, lucide-react, Vitest, @testing-library/react.

**Working branch:** Create `feature/login-page-redesign` from `develop` before starting work. If `develop` does not exist locally, branch from `main`. Do NOT implement on `main` directly.

**Spec reference:** `docs/superpowers/specs/2026-06-29-login-page-redesign-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `frontend/src/pages/LoginPage.tsx` | Replace | Layout shell + state + form. ~280 lines. |
| `frontend/src/pages/__tests__/LoginPage.test.tsx` | Replace | 12 test cases for render, validation, show/hide, submit, focus, a11y. |
| `frontend/src/components/auth/LoginIllustration.tsx` | Create | Inline SVG abstract dashboard. ~60 lines. |
| `frontend/src/components/auth/__tests__/LoginIllustration.test.tsx` | Create | 1 smoke test. |
| `frontend/src/index.css` | Modify | Add 2 `@keyframes` + reduced-motion override. |

No other files change. `useLogin`, `useAuthStore`, `react-router-dom`, and `App.tsx` are untouched.

---

## Task 1: Add motion keyframes to `index.css`

**Files:**
- Modify: `frontend/src/index.css` (append at end, after `@theme inline` block)

- [ ] **Step 1: Append keyframes and reduced-motion overrides**

Append this block to the END of `frontend/src/index.css`:

```css
/* === Login page motion (added 2026-06-29, redesign spec) === */

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20%      { transform: translateX(-4px); }
  40%      { transform: translateX(4px); }
  60%      { transform: translateX(-3px); }
  80%      { transform: translateX(2px); }
}

.animate-rise {
  animation: rise 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.animate-shake {
  animation: shake 0.24s ease-in-out 1;
}

/* Stagger delays for entrance cascade */
.delay-0   { animation-delay: 0ms; }
.delay-80  { animation-delay: 80ms; }
.delay-160 { animation-delay: 160ms; }
.delay-200 { animation-delay: 200ms; }
.delay-240 { animation-delay: 240ms; }
.delay-280 { animation-delay: 280ms; }
.delay-320 { animation-delay: 320ms; }
.delay-360 { animation-delay: 360ms; }
.delay-400 { animation-delay: 400ms; }

@media (prefers-reduced-motion: reduce) {
  .animate-rise,
  .animate-shake {
    animation: none !important;
  }
}
```

- [ ] **Step 2: Verify CSS compiles**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.app.json 2>&1 | head -20`
Expected: No errors related to CSS. (CSS files are not type-checked by tsc; this just ensures no broken TS imports.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/index.css
git commit -m "feat(login): add rise/shake keyframes and reduced-motion overrides"
```

---

## Task 2: Create `LoginIllustration` component (TDD)

**Files:**
- Create: `frontend/src/components/auth/LoginIllustration.tsx`
- Create: `frontend/src/components/auth/__tests__/LoginIllustration.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/auth/__tests__/LoginIllustration.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { renderWithProviders } from '@/lib/test-utils';
import { LoginIllustration } from '../LoginIllustration';

describe('LoginIllustration', () => {
  it('renders an svg element', () => {
    const { container } = renderWithProviders(<LoginIllustration />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('uses currentColor for strokes (themeable)', () => {
    const { container } = renderWithProviders(<LoginIllustration />);
    const strokedElements = container.querySelectorAll('[stroke="currentColor"]');
    expect(strokedElements.length).toBeGreaterThan(0);
  });

  it('is decorative (aria-hidden)', () => {
    const { container } = renderWithProviders(<LoginIllustration />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `cd frontend && npx vitest run src/components/auth/__tests__/LoginIllustration.test.tsx 2>&1 | tail -20`
Expected: FAIL — "Failed to resolve import ../LoginIllustration" or "Cannot find module".

- [ ] **Step 3: Create the component**

Create `frontend/src/components/auth/LoginIllustration.tsx`:

```tsx
interface LoginIllustrationProps {
  className?: string;
}

export function LoginIllustration({ className }: LoginIllustrationProps) {
  return (
    <svg
      viewBox="0 0 480 280"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      role="img"
    >
      {/* Outer card frame */}
      <rect x="20" y="20" width="440" height="240" rx="12" />
      {/* Header bar */}
      <line x1="20" y1="56" x2="460" y2="56" />
      <circle cx="40" cy="38" r="3" />
      <circle cx="54" cy="38" r="3" />
      <circle cx="68" cy="38" r="3" />

      {/* Pipeline bars (3 stacked) */}
      <rect x="40" y="80" width="180" height="14" rx="4" />
      <rect x="40" y="104" width="140" height="14" rx="4" />
      <rect x="40" y="128" width="200" height="14" rx="4" />

      {/* Stat cards (3 right column) */}
      <rect x="260" y="80" width="80" height="40" rx="6" />
      <rect x="350" y="80" width="80" height="40" rx="6" />
      <rect x="260" y="130" width="170" height="40" rx="6" />

      {/* Mini line chart in stat card 3 */}
      <polyline points="270,160 290,150 310,156 330,144 350,148 370,138 390,142 410,132" />

      {/* Bottom section — message list */}
      <line x1="40" y1="180" x2="440" y2="180" />
      <circle cx="50" cy="200" r="6" />
      <line x1="64" y1="196" x2="200" y2="196" />
      <line x1="64" y1="206" x2="160" y2="206" />

      <circle cx="50" cy="232" r="6" />
      <line x1="64" y1="228" x2="220" y2="228" />
      <line x1="64" y1="238" x2="180" y2="238" />
    </svg>
  );
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `cd frontend && npx vitest run src/components/auth/__tests__/LoginIllustration.test.tsx 2>&1 | tail -20`
Expected: PASS — 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/auth/LoginIllustration.tsx frontend/src/components/auth/__tests__/LoginIllustration.test.tsx
git commit -m "feat(login): add LoginIllustration component with svg dashboard mock"
```

---

## Task 3: Write all failing tests for `LoginPage`

**Files:**
- Replace: `frontend/src/pages/__tests__/LoginPage.test.tsx`

- [ ] **Step 1: Replace the test file with full test suite**

Replace the entire contents of `frontend/src/pages/__tests__/LoginPage.test.tsx` with:

```tsx
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/pages/__tests__/LoginPage.test.tsx 2>&1 | tail -30`
Expected: ALL tests fail (LoginPage still has old markup). Some will fail with "Cannot read properties of undefined" because `useLogin` mock returns the old shape — that's fine, it confirms tests are wired up.

- [ ] **Step 3: Commit (test scaffolding only)**

```bash
git add frontend/src/pages/__tests__/LoginPage.test.tsx
git commit -m "test(login): write failing test suite for redesigned LoginPage"
```

---

## Task 4: Replace `LoginPage.tsx` with layout shell + state

**Files:**
- Replace: `frontend/src/pages/LoginPage.tsx`

- [ ] **Step 1: Replace the entire `LoginPage.tsx`**

Replace the entire contents of `frontend/src/pages/LoginPage.tsx` with:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useLogin } from '@/api/auth';
import { useAuthStore } from '@/store/authStore';
import { Loader2, Lock, Mail, Zap, Eye, EyeOff, AlertCircle, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoginIllustration } from '@/components/auth/LoginIllustration';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [touched, setTouched] = useState<{ email?: boolean; password?: boolean }>({});
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const navigate = useNavigate();
  const login = useLogin();
  const { login: setAuth } = useAuthStore();

  const leftPanelRef = useRef<HTMLDivElement>(null);
  const illustrationRef = useRef<HTMLDivElement>(null);
  const parallaxRafRef = useRef<number | null>(null);

  // Field-level validators
  const validateEmail = (value: string): string | undefined => {
    if (!value.trim()) return 'Email is required';
    if (!EMAIL_REGEX.test(value)) return 'Enter a valid email';
    return undefined;
  };

  const validatePassword = (value: string): string | undefined => {
    if (!value) return 'Password is required';
    return undefined;
  };

  // Handlers
  const handleEmailBlur = () => {
    setTouched((t) => ({ ...t, email: true }));
    const err = validateEmail(email);
    setFieldErrors((f) => ({ ...f, email: err }));
  };

  const handlePasswordBlur = () => {
    setTouched((t) => ({ ...t, password: true }));
    const err = validatePassword(password);
    setFieldErrors((f) => ({ ...f, password: err }));
  };

  const handleEmailChange = (value: string) => {
    setEmail(value);
    if (touched.email) {
      setFieldErrors((f) => ({ ...f, email: validateEmail(value) }));
    }
  };

  const handlePasswordChange = (value: string) => {
    setPassword(value);
    if (touched.password) {
      setFieldErrors((f) => ({ ...f, password: validatePassword(value) }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const emailErr = validateEmail(email);
    const passwordErr = validatePassword(password);
    setFieldErrors({ email: emailErr, password: passwordErr });
    setTouched({ email: true, password: true });
    if (emailErr || passwordErr) return;

    try {
      const result = await login.mutateAsync({ email, password });
      setAuth(result.user, result.accessToken, result.refreshToken);
      navigate('/');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Login failed. Please try again.';
      setError(message);
      setShake(true);
      window.setTimeout(() => setShake(false), 280);
    }
  };

  // Parallax on illustration (mouse over left panel)
  useEffect(() => {
    const panel = leftPanelRef.current;
    const illust = illustrationRef.current;
    if (!panel || !illust) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    const handleMove = (event: MouseEvent) => {
      if (parallaxRafRef.current !== null) return;
      parallaxRafRef.current = window.requestAnimationFrame(() => {
        parallaxRafRef.current = null;
        const rect = panel.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 2 - 1; // -1..1
        const y = ((event.clientY - rect.top) / rect.height) * 2 - 1;
        illust.style.transform = `translate(${x * 8}px, ${y * 8}px)`;
      });
    };

    const handleLeave = () => {
      illust.style.transform = 'translate(0px, 0px)';
    };

    panel.addEventListener('mousemove', handleMove);
    panel.addEventListener('mouseleave', handleLeave);
    return () => {
      panel.removeEventListener('mousemove', handleMove);
      panel.removeEventListener('mouseleave', handleLeave);
      if (parallaxRafRef.current !== null) {
        window.cancelAnimationFrame(parallaxRafRef.current);
      }
    };
  }, []);

  const submitDisabled = !email || !password || login.isPending;

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-[60%_40%]">
      {/* LEFT PANEL — brand + value (desktop only) */}
      <aside
        ref={leftPanelRef}
        className="bg-muted hidden lg:flex flex-col justify-between p-12 lg:p-16"
      >
        <div className="animate-rise delay-0 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-foreground text-background">
            <Zap className="h-4 w-4" strokeWidth={2.5} />
          </div>
          <span className="text-base font-semibold tracking-tight text-foreground">CRM Platform</span>
        </div>

        <div className="flex-1 flex flex-col justify-center space-y-8 max-w-md">
          <h1 className="animate-rise delay-80 text-4xl lg:text-5xl font-semibold tracking-tight text-foreground">
            Sign in to your workspace.
          </h1>

          <ul className="space-y-3">
            <li className="animate-rise delay-160 flex items-start gap-3 text-sm text-muted-foreground">
              <Check className="h-4 w-4 mt-0.5 text-foreground/60 flex-shrink-0" />
              <span>AI-personalized outreach at scale</span>
            </li>
            <li className="animate-rise delay-200 flex items-start gap-3 text-sm text-muted-foreground">
              <Check className="h-4 w-4 mt-0.5 text-foreground/60 flex-shrink-0" />
              <span>Multi-channel sequences in one inbox</span>
            </li>
            <li className="animate-rise delay-240 flex items-start gap-3 text-sm text-muted-foreground">
              <Check className="h-4 w-4 mt-0.5 text-foreground/60 flex-shrink-0" />
              <span>Real-time pipeline insights</span>
            </li>
          </ul>

          <div
            ref={illustrationRef}
            className="animate-rise delay-280 text-foreground/40 transition-transform duration-200 ease-out"
          >
            <LoginIllustration className="w-full h-auto" />
          </div>
        </div>

        <p className="animate-rise delay-360 text-xs uppercase tracking-wider text-muted-foreground">
          Trusted by 500+ sales teams worldwide
        </p>
      </aside>

      {/* RIGHT PANEL — form */}
      <main className="bg-card flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm animate-rise delay-200">
          {/* Mobile-only brand mark (logo above form on small screens) */}
          <div className="lg:hidden mb-10 flex items-center gap-2 justify-center">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-foreground text-background">
              <Zap className="h-4 w-4" strokeWidth={2.5} />
            </div>
            <span className="text-base font-semibold tracking-tight text-foreground">CRM Platform</span>
          </div>

          <div className="space-y-2 mb-8">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">Welcome back</h2>
            <p className="text-sm text-muted-foreground">Sign in to continue to your workspace</p>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-5 flex items-start gap-3 rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 animate-rise"
            >
              <AlertCircle className="h-4 w-4 mt-0.5 text-destructive flex-shrink-0" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          <form
            onSubmit={handleSubmit}
            noValidate
            className={`space-y-4 ${shake ? 'animate-shake' : ''}`}
          >
            <div className="space-y-1.5">
              <Label htmlFor="login-email" className="text-sm font-medium text-foreground">
                Email address
              </Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => handleEmailChange(e.target.value)}
                  onBlur={handleEmailBlur}
                  placeholder="you@company.com"
                  aria-invalid={Boolean(fieldErrors.email)}
                  aria-describedby={fieldErrors.email ? 'login-email-error' : undefined}
                  className="pl-10"
                />
              </div>
              {fieldErrors.email && (
                <p id="login-email-error" className="text-xs text-destructive mt-1">
                  {fieldErrors.email}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="login-password" className="text-sm font-medium text-foreground">
                Password
              </Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="login-password"
                  type={passwordVisible ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => handlePasswordChange(e.target.value)}
                  onBlur={handlePasswordBlur}
                  placeholder="••••••••"
                  aria-invalid={Boolean(fieldErrors.password)}
                  aria-describedby={fieldErrors.password ? 'login-password-error' : undefined}
                  className="pl-10 pr-10"
                />
                <button
                  type="button"
                  aria-label="Toggle password visibility"
                  aria-pressed={passwordVisible}
                  onClick={() => setPasswordVisible((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {passwordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {fieldErrors.password && (
                <p id="login-password-error" className="text-xs text-destructive mt-1">
                  {fieldErrors.password}
                </p>
              )}
            </div>

            <Button
              id="login-submit"
              type="submit"
              disabled={submitDisabled}
              className="w-full mt-2"
            >
              {login.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Signing in…
                </>
              ) : (
                'Sign in'
              )}
            </Button>
          </form>

          <div className="mt-5 text-center">
            <Link
              to="/forgot-password"
              className="text-sm text-muted-foreground hover:text-foreground focus:outline-none focus-visible:underline"
            >
              Forgot your password?
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Run tests to verify progress**

Run: `cd frontend && npx vitest run src/pages/__tests__/LoginPage.test.tsx 2>&1 | tail -40`
Expected: Many tests now PASS. Some may still fail (e.g., specific assertions on text content, focus order, server-error rendering). Note which fail for next task.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/LoginPage.tsx
git commit -m "feat(login): redesign LoginPage to Linear/Vercel-style monochrome split layout"
```

---

## Task 5: Iterate on remaining test failures

**Files:**
- Modify: `frontend/src/pages/LoginPage.tsx` (if tests reveal issues)

- [ ] **Step 1: Run the full test suite and list failures**

Run: `cd frontend && npx vitest run src/pages/__tests__/LoginPage.test.tsx 2>&1 | tail -60`
Expected: Most tests pass. Note any remaining failures.

Common likely failures and fixes:

- **"renders value propositions"** — If `text-muted-foreground` is rendering them too dim or if test selector misses: check that copy matches exactly.
- **"submits valid form, calls login mutation"** — If `mockMutateAsync` mock isn't being picked up: ensure the `@/api/auth` mock path matches the import in `LoginPage.tsx` exactly. The mock uses `useLogin: () => ({ mutateAsync: mockMutateAsync, isPending: false })`. The component destructures `login = useLogin()` then calls `login.mutateAsync(...)`. Check this works.
- **"renders inline alert and shake on server error"** — If shake class not detected: check `form.className` includes `animate-shake` exactly when `shake === true`. The conditional `${shake ? 'animate-shake' : ''}` should produce this.
- **"focus order"** — If focus jumps unexpectedly: the show/hide toggle is `type="button"` and inside the password wrapper. It will be tabbed in DOM order. Verify DOM order is: `<input id="login-email">` → `<input id="login-password">` → `<button aria-label="Toggle...">` → `<button type="submit">` → `<Link>Forgot</Link>`.

- [ ] **Step 2: Apply targeted fixes**

For each remaining failure, edit `LoginPage.tsx` minimally to address it. Common fixes:
- Adjust text content to match expected strings.
- Ensure `data-testid` if any test relies on it.
- Verify focus order via actual DOM structure.

- [ ] **Step 3: Re-run tests**

Run: `cd frontend && npx vitest run src/pages/__tests__/LoginPage.test.tsx 2>&1 | tail -30`
Expected: ALL 15 tests pass.

- [ ] **Step 4: Commit any fixes**

```bash
git add frontend/src/pages/LoginPage.tsx
git commit -m "fix(login): address remaining test failures from redesign"
```

---

## Task 6: Full verification + lint + build

**Files:** none modified (verification only)

- [ ] **Step 1: Run lint**

Run: `cd frontend && npm run lint 2>&1 | tail -30`
Expected: No errors. Warnings acceptable.

- [ ] **Step 2: Run all LoginPage-related tests**

Run: `cd frontend && npx vitest run src/pages/__tests__/LoginPage.test.tsx src/components/auth/__tests__/LoginIllustration.test.tsx 2>&1 | tail -30`
Expected: 18 tests pass (15 LoginPage + 3 LoginIllustration), 0 fail.

- [ ] **Step 3: Run full test suite to confirm no regressions**

Run: `cd frontend && npm test 2>&1 | tail -40`
Expected: All previously-passing tests still pass. No new failures.

- [ ] **Step 4: Run build**

Run: `cd frontend && npm run build 2>&1 | tail -30`
Expected: Build succeeds.

- [ ] **Step 5: Visual smoke (manual)**

Open `frontend/` in a browser via `npm run dev` and visit `/login` (or whatever route serves LoginPage — verify in `App.tsx` if needed).

Check at three widths:
- **1440px:** split layout shows left brand panel + right form. Headline, value props, illustration, stats all visible. Form centered vertically. Submit button full-width.
- **768px:** split collapses to single column. Logo appears above form. No left panel.
- **375px:** same as 768px but tighter padding. Inputs remain full-width.

Verify:
- Tab through form: email → password → toggle → submit → forgot link.
- Click show/hide: password text reveals, icon flips to EyeOff.
- Click submit with empty fields: field errors appear under both inputs.
- Type invalid email, blur: "Enter a valid email" appears under email.
- Type valid email + any password, submit: navigate to `/` (or attempt — depends on backend state).
- Hover button: subtle darken.
- Move mouse over left panel: illustration follows cursor subtly (±8px).

- [ ] **Step 6: Verify reduced-motion**

In browser dev tools, enable "Emulate CSS prefers-reduced-motion: reduce". Reload `/login`. Verify:
- No entrance animation (elements appear immediately).
- Mouse parallax does NOT engage.
- Error shake still does NOT engage.

- [ ] **Step 7: Commit final verification notes (optional)**

If any small fixes were needed during visual smoke:

```bash
git add frontend/src/pages/LoginPage.tsx
git commit -m "fix(login): polish from visual smoke verification"
```

Otherwise skip this step.

---

## Task 7: Final commit + push (do NOT execute without user approval)

> **HARD GATE:** Do NOT run `git push` without explicit user confirmation. The branch is local; merging to `develop` requires review and approval.

- [ ] **Step 1: Show the user the final commit log**

Run: `git log --oneline -10`
Expected: 5-7 commits since branch creation, all on `feature/login-page-redesign` (or chosen branch).

- [ ] **Step 2: Ask the user how to integrate**

Use `ask_user` (or `questionnaire`) to confirm:
- Push to remote? (requires `gh` auth + user approval)
- Merge into `develop` locally? (no remote push)
- Open a PR? (requires `gh pr create`)

This step is a CHECKPOINT — stop here and wait for user input.

---

## Self-Review Notes (for plan author)

After writing this plan, I verified:

1. **Spec coverage:**
   - Layout (split 60/40, mobile collapse) → Tasks 4 ✓
   - Visual tokens (typography, color, spacing) → Task 4 ✓
   - Left panel content (brand, headline, value props, illustration, stats) → Task 4 ✓
   - Right panel form (heading, fields, toggle, submit, forgot link) → Task 4 ✓
   - Validation (plain JS, blur-triggered, inline errors) → Task 4 ✓
   - Motion (rise stagger, parallax, shake) → Tasks 1, 4, plus implementation in Task 4 ✓
   - Loading state (button spinner + label) → Task 4 ✓
   - Error state (inline alert + shake trigger) → Task 4 ✓
   - Success state (existing flow preserved) → Task 4 ✓
   - Accessibility (ARIA, focus order, reduced motion) → Tasks 1, 3, 4 ✓
   - Tests (12 cases) → Task 3 ✓

2. **Placeholder scan:** No "TBD" / "TODO" / "implement later" / "add appropriate handling" placeholders. All code blocks are complete.

3. **Type consistency:**
   - `mockMutateAsync` in test matches `login.mutateAsync(...)` in component ✓
   - `LoginIllustration` import path matches test (`../LoginIllustration`) ✓
   - `LoginIllustration` exports a named function `LoginIllustration` ✓
   - `EMAIL_REGEX` is module-level const used in both `validateEmail` and any other check ✓
   - `setShake` state value toggled to `true` then reset to `false` after 280ms; class applied conditionally ✓
   - Submit button disabled predicate uses `submitDisabled = !email || !password || login.isPending` ✓

4. **Known risks from spec section 9:**
   - Tailwind v4 arbitrary values (`grid-cols-[60%_40%]`) — verified used elsewhere in project? If not, fall back to `lg:grid-cols-5` with `col-span-3` + `col-span-2`. Test in Task 6 step 5.
   - shadcn `Input` className accepts `pl-10 pr-10` — verify by visual smoke. If `Input` overrides padding, use wrapper div with padding instead.
   - `useAuthStore` mock signature — `useAuthStore` is a hook from zustand; the test mock returns an object with `login` method matching the destructured `login: setAuth` pattern. This should work.

5. **Granularity check:** 7 tasks, each with multiple 2-5-minute steps. No task is vague.

---

## Acceptance Criteria (mapped to spec success criteria)

| Spec criterion | Met by |
|---|---|
| Aesthetic refresh aligned with Linear/Vercel | Task 4 (split, monochrome, system tokens) |
| Pure monochrome (no accent color) | Task 4 (uses `text-foreground`, `bg-muted`, `bg-card`) |
| Uses existing shadcn components and CSS variables | Task 4 (imports `Input`, `Label`, `Button`) |
| Rich micro-interactions | Task 1 (keyframes) + Task 4 (stagger + parallax + shake wired) |
| Preserves all current auth behavior | Task 4 (preserves `useLogin`, `setAuth`, `navigate('/')`) |
| Adds password show/hide toggle | Task 4 (Eye/EyeOff button, `passwordVisible` state) |
| Inline field validation on blur | Task 4 (handleEmailBlur, handlePasswordBlur, `touched` tracking) |
| Accessibility (keyboard, ARIA, reduced motion) | Task 1 (reduced-motion override) + Task 3 (focus order test) + Task 4 (aria-invalid, aria-describedby, aria-pressed, role="alert") |
| Tests pass with ≥85% coverage | Tasks 2, 3, 5 (18 tests, includes render, interaction, integration, a11y) |
| No new npm dependencies | Plan does not install any packages; uses existing `zod` is NOT used (verified absent) |
| No changes outside scope | Plan touches only 5 files: `LoginPage.tsx`, `LoginPage.test.tsx`, `LoginIllustration.tsx`, `LoginIllustration.test.tsx`, `index.css` |

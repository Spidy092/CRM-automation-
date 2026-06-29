# Login Page Redesign — Design Spec

**Date:** 2026-06-29
**Status:** Draft — pending user review
**Scope:** Frontend only — `frontend/src/pages/LoginPage.tsx` and `frontend/src/index.css`
**Author:** Brainstorming session output

---

## 1. Goal

Replace the existing dark glassmorphism login page with a Linear/Vercel-style light, monochrome design that aligns with the project's existing design system. Preserve all current functionality. No new auth features.

## 2. Background

The current `LoginPage.tsx` uses:
- A dark `linear-gradient` background (`#0f0c29 → #302b63 → #24243e`)
- Animated blur orbs (indigo + violet)
- A gradient-bordered glass card with `backdrop-filter: blur(24px)`
- Indigo/violet primary button with gradient + glow shadow
- Inline gradient text on the heading

This page is the **only** dark-themed outlier in the app. Every other page uses the light theme defined in `src/index.css` (HSL variables, `bg: hsl(210 40% 98%)`, `primary: hsl(222 47% 11%)`). The redesign brings the login page into alignment with the design system that already exists.

## 3. Goals & Non-Goals

### Goals
- Aesthetic refresh aligned with Linear/Vercel design language.
- Pure monochrome (black/white/grayscale) — no accent color.
- Use existing shadcn components and CSS variables; introduce no new design tokens.
- Rich micro-interactions: entrance stagger, illustration parallax, error shake.
- Preserve all current auth behavior (login mutation, store update, redirect).
- Add a password show/hide toggle (only functional addition).
- Improve validation UX (inline field errors on blur).
- Maintain accessibility (keyboard, ARIA, reduced motion).

### Non-Goals
- No new auth methods (SSO, magic link, OTP, social login, 2FA).
- No "Remember me" checkbox.
- No "Sign up" link or new signup flow.
- No changes to `useLogin`, `useAuthStore`, or routing.
- No changes to backend auth.
- No new npm dependencies.

## 4. Design

### 4.1 Layout

**Desktop (≥1024px) — split two-column:**

- Left panel: 60% width, `bg-muted` (hsl 210 40% 98%), padding `p-12 lg:p-16`.
- Right panel: 40% width, `bg-card` (white), form centered vertically, max-width 400px.
- Divider: implicit (color shift slate-50 → white). No border line.
- Right panel has **no card container** — bare whitespace separation.

**Mobile (<1024px) — single column:**
- Single column on `bg-muted`.
- Logo (centered) → form on white background (no card border) → end.
- Padding `px-6`, form max-width 100%.

### 4.2 Visual Tokens

All tokens come from existing CSS variables in `src/index.css`. No new tokens introduced.

| Element | Style |
|---|---|
| Left panel headline | `text-4xl lg:text-5xl font-semibold tracking-tight text-foreground` |
| Value prop items | `text-sm text-muted-foreground`, lucide `Check` icon at `text-foreground/60` |
| Trust stats | `text-xs uppercase tracking-wider text-muted-foreground` |
| Right form heading | `text-2xl font-semibold tracking-tight text-foreground` |
| Right form subheading | `text-sm text-muted-foreground` |
| Form labels | `text-sm font-medium text-foreground` |
| Input text | `text-sm` |
| Input border | `border border-input` (1px hsl 214 32% 91%) |
| Input focus | `focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-card` |
| Primary button | `bg-primary text-primary-foreground` — solid foreground-black. **No gradient, no glow.** |
| Button hover | `bg-primary/90`, `transition-colors duration-150` |
| Button disabled | `opacity-50 cursor-not-allowed` |
| Error text | `text-destructive`, `bg-destructive/10`, `border-destructive/20` |
| Border radius | `rounded-md` (6px) — matches `--radius-md` |
| Input padding | `py-2.5 px-3` |
| Section gap (left) | `space-y-8` |
| Form field gap | `space-y-4` |

### 4.3 Left Panel Content (top → bottom)

1. **Brand mark** — 32px square `bg-foreground text-background` with simplified `Zap` icon, plus wordmark "CRM Platform" `text-base font-semibold` to its right.
2. **Headline** — "Sign in to your workspace."
3. **Value props** — 3 items, lucide `Check` icons:
   - "AI-personalized outreach at scale"
   - "Multi-channel sequences in one inbox"
   - "Real-time pipeline insights"
4. **Illustration** — inline SVG abstract dashboard mock. Stroke-only (`stroke="currentColor"`), `text-foreground/40`. Composed of: 3 horizontal bars (pipeline stages), 1 small line chart, 3 stat cards. `width: 100%, max-width: 480px`. Lives in a `flex-1` region with `my-8`.
5. **Trust stats** — "Trusted by 500+ sales teams worldwide"

### 4.4 Right Panel Form

- Heading: "Welcome back"
- Subheading: "Sign in to continue to your workspace"
- Email field: `Input` from shadcn, `Mail` icon left-aligned, `autoComplete="email"`, `id="login-email"`
- Password field: `Input` from shadcn, `Lock` icon left-aligned, show/hide toggle right-aligned (lucide `Eye`/`EyeOff`), `autoComplete="current-password"`, `id="login-password"`
- Submit button: full-width, label "Sign in", `Loader2` spinner + "Signing in…" during pending
- Forgot password link: centered below button, `text-sm text-muted-foreground hover:text-foreground`
- Inline error alert above form (red), with `AlertCircle` icon + message

### 4.5 Validation

- Inline validation in plain JS (no `zod` dependency — verified absent from `frontend/package.json`).
- Email: must match regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` → message: "Enter a valid email".
- Password: must be non-empty → message: "Password is required".
- Field-level errors:
  - Shown under each input on **blur** (after first blur), not on every keystroke.
  - Clear on next valid keystroke.
- Server errors: caught from `login.mutateAsync()` reject, shown in inline alert above form.
- Submit button disabled when fields are empty (no schema gate, just non-empty check).

### 4.6 Motion

| Motion | Trigger | Spec |
|---|---|---|
| Entrance stagger | Mount | Logo (0ms) → headline (80ms) → value props (160ms, +40ms each) → illustration (280ms) → stats (360ms) → right panel (200ms). Duration 400ms, easing `cubic-bezier(0.16, 1, 0.3, 1)`. CSS keyframe `rise` (fade + translate-y 8px → 0). |
| Illustration parallax | `mousemove` on left panel | `transform: translate(x*8px, y*8px)` where (x, y) normalized -1..1 from panel center. Throttled via `requestAnimationFrame`. Returns to 0,0 on `mouseleave` (200ms ease). |
| Button hover | Hover | `bg-primary/90`, `transition-colors duration-150`. No lift, no glow. |
| Input focus | Focus | `ring-2 ring-ring ring-offset-2 ring-offset-card` |
| Error shake | Server error returned | Form card horizontal shake ±4px, 4 frames, 240ms total. CSS keyframe `shake`. |
| Error alert slide | Error state change | Slide-down from -8px + fade-in over 240ms. |

**Reduced motion:** Use `@media (prefers-reduced-motion: reduce)` to override `animation: none` on `.animate-rise` and `.animate-shake` classes. Parallax handler is gated by checking `window.matchMedia('(prefers-reduced-motion: reduce)').matches` and skips attaching the `mousemove` listener if true. Focus ring and color transitions remain.

### 4.7 Loading State

- Button text changes to "Signing in…" with `Loader2` spinner.
- Button `disabled`, `opacity-50`, `cursor-not-allowed`.
- No layout shift (spinner replaces text in same line).

### 4.8 Error State

- Inline alert above form: `bg-destructive/10 border border-destructive/20 text-destructive`, `AlertCircle` icon + message.
- Form card shakes once (240ms).
- Field-level error renders under each input (if applicable).

### 4.9 Success State

- On `login.mutateAsync()` resolve, call `setAuth(...)` then `navigate('/')` — identical to current behavior. No success screen.

## 5. Accessibility

- Every input has `id` + matching `htmlFor` on its label.
- Inputs use `aria-invalid={Boolean(fieldError)}` and `aria-describedby={errorId}` pointing to the error message element.
- Form has `noValidate` (we control validation, browser doesn't run native validation popups).
- Password show/hide toggle: `aria-label="Toggle password visibility"`, `aria-pressed={passwordVisible}`, `type="button"` (won't submit form).
- Focus order: email → password → show/hide → submit → forgot password link.
- All motion respects `prefers-reduced-motion`.
- Color contrast: all text uses `text-foreground` (very dark) or `text-muted-foreground` (mid slate) on white/slate-50 — exceeds WCAG AA.
- The inline error alert container has `role="alert"` (which implicitly has `aria-live="assertive"`) so screen readers announce errors immediately.

## 6. Implementation

### 6.1 Files Changed

| File | Change |
|---|---|
| `frontend/src/pages/LoginPage.tsx` | Replace markup. Preserve auth mutation + store + navigate. Add: `passwordVisible`, `fieldErrors`, `touched`, parallax `mousemove` handler, error shake trigger. |
| `frontend/src/index.css` | Add 2 keyframes: `rise` (fade + translate-y), `shake` (horizontal). Add `prefers-reduced-motion` overrides. |

### 6.2 Files Created

| File | Purpose |
|---|---|
| `frontend/src/components/auth/LoginIllustration.tsx` | Extracted SVG illustration component. Inline, stroke-only, `currentColor`. ~50 lines. |

(If the SVG stays small, it can live inline in `LoginPage.tsx`. Decision deferred to implementation.)

### 6.3 Component Skeleton (TypeScript)

```tsx
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

  // Parallax handler — useRef + rAF throttle, translate illustration
  // Validation — plain JS, on blur (no zod dep)
  // Submit — same as current, plus setShake on error

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-[60%_40%]">
      <aside ref={leftPanelRef} className="bg-muted p-12 lg:p-16 flex-col justify-between hidden lg:flex">
        {/* brand, headline, value props, illustration, stats */}
      </aside>
      <main className="bg-card flex items-center justify-center px-6 py-12">
        <form className="w-full max-w-sm space-y-4" noValidate onSubmit={handleSubmit}>
          {/* heading, subheading, error alert, email, password (with toggle), submit, forgot link */}
        </form>
      </main>
    </div>
  );
}
```

### 6.4 CSS Additions (in `src/index.css`)

```css
@keyframes rise {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25%      { transform: translateX(-4px); }
  75%      { transform: translateX(4px); }
}

@media (prefers-reduced-motion: reduce) {
  .animate-rise,
  .animate-shake {
    animation: none !important;
  }
}
```

(Or use Tailwind v4's `--animate-rise` token pattern, matching the existing `--animate-fade-in` definition.)

## 7. Testing

Update `frontend/src/pages/__tests__/LoginPage.test.tsx`:

| Test | Type |
|---|---|
| Renders without crashing (existing) | Smoke |
| Email + password inputs accept text | Interaction |
| Password show/hide toggle flips input type | Interaction |
| Show/hide toggle is `type="button"` (won't submit) | Interaction |
| Submit empty form shows field errors | Interaction |
| Blur on email shows email error after first interaction | Interaction |
| Submit valid form calls `useLogin.mutateAsync` | Integration |
| Successful login calls `setAuth` and navigates to `/` | Integration |
| Server error renders inline alert and triggers shake | Integration |
| Focus order is email → password → toggle → submit → link | A11y |
| All inputs have accessible labels | A11y |
| `prefers-reduced-motion` disables entrance animation | A11y |

Existing `renderWithProviders` from `@/lib/test-utils` is used. Existing `apiClient` mock pattern is preserved.

Coverage target: ≥85% for `LoginPage.tsx` (above the 70% project minimum).

## 8. Verification

Before merge:

1. `npm run lint` passes.
2. `npm run test -- LoginPage` passes with all new test cases.
3. `npm run build` succeeds.
4. Visual smoke at three breakpoints: 1440px, 768px, 375px (manual or via Playwright screenshot).
5. Keyboard-only navigation works (Tab order, Enter submits, Esc no-op).
6. `prefers-reduced-motion: reduce` setting verified to disable entrance + parallax + shake.

## 9. Risks & Edge Cases

| Risk | Mitigation |
|---|---|
| Login page looks disconnected from rest of app (app uses indigo accents elsewhere) | Acknowledged user choice. Document in PR description. Other pages remain untouched. |
| `prefers-reduced-motion` not respected | Explicit media queries gate all motion. Test included. |
| Parallax handler leaks (no cleanup) | `useEffect` cleanup removes `mousemove` listener. rAF cancelled on unmount. |
| ~~Zod dependency~~ | ~~Resolved~~ `zod` is NOT in `frontend/package.json`. Spec updated to use plain JS validation. No new npm dependencies. |
| Tailwind v4 class name compatibility | Verify `lg:grid-cols-[60%_40%]` and arbitrary value syntax works with project's Tailwind v4 setup. |
| Existing test mock doesn't include `LoginPage`-specific routes | Test already mocks `apiClient` generically; should work. |

## 10. Out of Scope (Explicit)

- No new auth methods (SSO, magic link, OTP, social login, 2FA).
- No "Remember me" checkbox.
- No signup page.
- No changes to backend.
- No new npm packages.
- No changes to `useLogin`, `useAuthStore`, routing, or any other module.
- No changes to other pages — login is the only visual refresh in this scope.

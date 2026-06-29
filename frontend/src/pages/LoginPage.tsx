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

  const submitDisabled = login.isPending;

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

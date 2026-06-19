import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useLogin } from '@/api/auth';
import { useAuthStore } from '@/store/authStore';
import { Loader2, Lock, Mail, Zap } from 'lucide-react';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const login = useLogin();
  const { login: setAuth } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      const result = await login.mutateAsync({ email, password });
      setAuth(result.user, result.accessToken, result.refreshToken);
      navigate('/');
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Login failed. Please try again.');
      }
    }
  };

  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)' }}
    >
      {/* Animated background orbs */}
      <div
        className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full opacity-30 blur-3xl"
        style={{ background: 'radial-gradient(circle, #6366f1, transparent 70%)' }}
      />
      <div
        className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full opacity-20 blur-3xl"
        style={{ background: 'radial-gradient(circle, #8b5cf6, transparent 70%)' }}
      />

      {/* Card */}
      <div
        className="relative z-10 w-full max-w-md animate-in fade-in slide-in-from-bottom-4 duration-700"
      >
        {/* Gradient border wrapper */}
        <div
          className="rounded-2xl p-px"
          style={{
            background: 'linear-gradient(135deg, rgba(99,102,241,0.6), rgba(139,92,246,0.3), rgba(99,102,241,0.1))',
          }}
        >
          <div
            className="rounded-2xl px-8 py-10"
            style={{
              background: 'rgba(15, 12, 41, 0.85)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
            }}
          >
            {/* Brand */}
            <div className="mb-8 flex flex-col items-center gap-3">
              <div
                className="flex h-14 w-14 items-center justify-center rounded-2xl"
                style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
              >
                <Zap className="h-7 w-7 text-white" strokeWidth={2.5} />
              </div>
              <div className="text-center">
                <h1
                  className="text-2xl font-bold tracking-tight"
                  style={{
                    background: 'linear-gradient(90deg, #a5b4fc, #c4b5fd)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                  }}
                >
                  CRM Platform
                </h1>
                <p className="mt-1 text-sm text-slate-400">Sign in to your workspace</p>
              </div>
            </div>

            {/* Error alert */}
            {error && (
              <div className="mb-5 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
                <span className="mt-0.5 text-red-400">⚠</span>
                <p className="text-sm text-red-300">{error}</p>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
              {/* Email */}
              <div className="space-y-1.5">
                <label htmlFor="login-email" className="block text-sm font-medium text-slate-300">
                  Email address
                </label>
                <div className="group relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 transition-colors group-focus-within:text-indigo-400" />
                  <input
                    id="login-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-500 outline-none transition-all duration-200
                      focus:border-indigo-500/60 focus:bg-white/8 focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <label htmlFor="login-password" className="block text-sm font-medium text-slate-300">
                  Password
                </label>
                <div className="group relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 transition-colors group-focus-within:text-indigo-400" />
                  <input
                    id="login-password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-500 outline-none transition-all duration-200
                      focus:border-indigo-500/60 focus:bg-white/8 focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              </div>

              {/* Submit */}
              <button
                id="login-submit"
                type="submit"
                disabled={login.isPending}
                className="relative mt-2 flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl px-4 py-2.5 text-sm font-semibold text-white
                  transition-all duration-200 disabled:opacity-70 active:scale-[0.98]"
                style={{
                  background: login.isPending
                    ? 'linear-gradient(135deg, #4f46e5, #7c3aed)'
                    : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  boxShadow: '0 4px 24px rgba(99,102,241,0.35)',
                }}
                onMouseEnter={(e) => {
                  if (!login.isPending) {
                    (e.currentTarget as HTMLButtonElement).style.boxShadow =
                      '0 6px 32px rgba(99,102,241,0.55)';
                    (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
                  }
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.boxShadow =
                    '0 4px 24px rgba(99,102,241,0.35)';
                  (e.currentTarget as HTMLButtonElement).style.transform = '';
                }}
              >
                {login.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Signing in…
                  </>
                ) : (
                  'Sign In'
                )}
              </button>
            </form>

            {/* Forgot password */}
            <div className="mt-5 text-center">
              <Link
                to="/forgot-password"
                className="text-sm text-indigo-400 transition-colors hover:text-indigo-300 focus:outline-none focus-visible:underline"
              >
                Forgot your password?
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

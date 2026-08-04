import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useUpdateProfile, useChangePassword } from '@/api/users';
import { useApiKeys, useCreateApiKey, useDeleteApiKey } from '@/api/auth';
import { applyTheme } from '@/lib/theme';
import { useToast } from '@/components/ui/Toast';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  User,
  Lock,
  SlidersHorizontal,
  ShieldCheck,
  Key,
  Pencil,
  Check,
  X,
  Eye,
  EyeOff,
  Trash2,
  Copy,
  CheckCircle2,
  Sun,
  Moon,
  Monitor,
  Bell,
  BellOff,
  LayoutGrid,
  List,
  AlertCircle,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { getApiErrorMessage } from '@/lib/apiError';
import type { UserRole } from '@/types';
import type { AccountTab as Tab, Preferences } from '@/types/account';
import { ROLE_COLORS, ROLE_PERMISSIONS } from '@/types/account';

function formatDate(dateStr: string | Date): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 'Invalid date';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'security', label: 'Security', icon: Lock },
  { id: 'preferences', label: 'Preferences', icon: SlidersHorizontal },
  { id: 'permissions', label: 'Permissions', icon: ShieldCheck },
  { id: 'apikeys', label: 'API Keys', icon: Key },
];

function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem('crm_preferences');
    if (raw) return JSON.parse(raw) as Preferences;
  } catch (err) {
    console.warn('[Preferences] Failed to parse stored preferences from localStorage:', err);
  }
  return {
    theme: 'system',
    notificationSound: true,
    defaultPipelineView: 'board',
    compactMode: false,
  };
}

function savePreferences(prefs: Preferences): void {
  localStorage.setItem('crm_preferences', JSON.stringify(prefs));
}

// ─── Sub-sections ─────────────────────────────────────────────────────────────

function PermissionDot({ has }: { has: boolean }) {
  return has ? (
    <CheckCircle2 className="mx-auto h-4 w-4 text-emerald-500" />
  ) : (
    <X className="mx-auto h-4 w-4 text-slate-300" />
  );
}

// ─── Profile Tab ─────────────────────────────────────────────────────────────

function ProfileTab() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const updateProfile = useUpdateProfile();
  const { showToast } = useToast();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.name ?? '');
  const [nameError, setNameError] = useState('');

  // Keep local name state in sync if store updates externally (BUG-3)
  useEffect(() => {
    if (!editing) {
      setName(user?.name ?? '');
    }
  }, [user?.name, editing]);

  const initials = user?.name
    ? user.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : '?';

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('Name is required.');
      return;
    }
    if (trimmed.length > 100) {
      setNameError('Name must be 100 characters or fewer.');
      return;
    }
    setNameError('');
    try {
      const updated = await updateProfile.mutateAsync({ id: user!.id, name: trimmed });
      // Sync Zustand store so the sidebar reflects the new name immediately
      setUser({ ...user!, name: updated.name });
      showToast('Profile updated successfully.', 'success');
      setEditing(false);
    } catch (err: unknown) {
      const msg = getApiErrorMessage(err, 'Failed to update profile.');
      showToast(msg, 'error');
    }
  };

  const handleCancel = () => {
    setName(user?.name ?? '');
    setNameError('');
    setEditing(false);
  };

  if (!user) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
            <Skeleton className="mt-1 h-4 w-64" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-6">
              <Skeleton className="h-20 w-20 rounded-2xl" />
              <div className="flex-1 space-y-3">
                <Skeleton className="h-10 w-full max-w-sm" />
                <Skeleton className="h-10 w-full max-w-sm" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Avatar + identity */}
      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
          <CardDescription>Your public profile visible to teammates.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-6">
            {/* Avatar */}
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-2xl font-bold text-white shadow-md">
              {initials}
            </div>

            <div className="flex-1 space-y-4">
              {/* Name */}
              <div>
                <Label htmlFor="account-name" className="text-sm font-medium text-slate-700">
                  Full Name
                </Label>
                {editing ? (
                  <form onSubmit={handleSave} className="mt-1.5 flex max-w-sm items-center gap-2">
                    <Input
                      id="account-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoFocus
                      aria-invalid={!!nameError}
                    />
                    <Button
                      type="submit"
                      size="icon"
                      disabled={updateProfile.isPending}
                      aria-label="Save name"
                    >
                      {updateProfile.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={handleCancel}
                      aria-label="Cancel edit"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </form>
                ) : (
                  <div className="mt-1.5 flex max-w-sm items-center gap-2">
                    <p className="flex-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">
                      {user?.name}
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setName(user?.name ?? '');
                        setEditing(true);
                      }}
                      aria-label="Edit name"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                )}
                {nameError && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-red-600">
                    <AlertCircle className="h-3 w-3" />
                    {nameError}
                  </p>
                )}
              </div>

              {/* Email (read-only) */}
              <div>
                <Label className="text-sm font-medium text-slate-700">Email Address</Label>
                <div className="mt-1.5 flex max-w-sm items-center gap-2">
                  <p className="flex-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                    {user?.email}
                  </p>
                  <span
                    title="Email changes require admin assistance"
                    className="rounded-md border border-slate-200 bg-slate-100 px-2 py-2 text-xs text-slate-400 cursor-default select-none"
                  >
                    Read-only
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  To change your email address, contact your admin.
                </p>
              </div>

              {/* Role badge */}
              <div>
                <Label className="text-sm font-medium text-slate-700">Role</Label>
                <div className="mt-1.5">
                  <span
                    className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold capitalize ${ROLE_COLORS[user?.role as UserRole] ?? ''}`}
                  >
                    {user?.role}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Role changes are managed by your admin.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Account metadata */}
      <Card>
        <CardHeader>
          <CardTitle>Account Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">User ID</dt>
              <dd className="mt-1 font-mono text-sm text-slate-600 dark:text-slate-300">{user?.id}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Account Status
              </dt>
              <dd className="mt-1 flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
                Active
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Last Updated
              </dt>
              <dd className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                {(user as unknown as { updated_at?: string })?.updated_at
                  ? formatDate((user as unknown as { updated_at: string }).updated_at)
                  : 'Not modified'}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Security Tab ─────────────────────────────────────────────────────────────

function SecurityTab() {
  const user = useAuthStore((s) => s.user);
  const changePassword = useChangePassword();
  const { showToast } = useToast();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [formError, setFormError] = useState('');

  // Password strength indicator
  const strength = (() => {
    if (!newPassword) return 0;
    let score = 0;
    if (newPassword.length >= 8) score++;
    if (/[A-Z]/.test(newPassword)) score++;
    if (/[a-z]/.test(newPassword)) score++;
    if (/[0-9]/.test(newPassword)) score++;
    if (/[^A-Za-z0-9]/.test(newPassword)) score++;
    return score;
  })();

  const strengthLabel = ['', 'Very Weak', 'Weak', 'Fair', 'Good', 'Strong'][strength];
  const strengthColor = [
    '',
    'bg-red-500',
    'bg-orange-500',
    'bg-amber-500',
    'bg-blue-500',
    'bg-emerald-500',
  ][strength];

  const [confirmTouched, setConfirmTouched] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setConfirmTouched(true);

    if (!currentPassword) {
      setFormError('Current password is required.');
      return;
    }
    if (newPassword.length < 8) {
      setFormError('New password must be at least 8 characters.');
      return;
    }
    if (!/[A-Z]/.test(newPassword)) {
      setFormError('New password must contain at least one uppercase letter.');
      return;
    }
    if (!/[a-z]/.test(newPassword)) {
      setFormError('New password must contain at least one lowercase letter.');
      return;
    }
    if (!/[0-9]/.test(newPassword)) {
      setFormError('New password must contain at least one number.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setFormError('New passwords do not match.');
      return;
    }

    try {
      await changePassword.mutateAsync({
        id: user!.id,
        currentPassword,
        newPassword,
      });
      showToast('Password changed successfully.', 'success');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      const msg = getApiErrorMessage(err, 'Failed to change password.');
      setFormError(msg);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Change Password</CardTitle>
          <CardDescription>
            Update your password. Must be at least 8 characters with uppercase, lowercase, and a
            number. Adding special characters increases password strength to Strong.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="max-w-sm space-y-4">
            {/* Current password */}
            <div className="space-y-1.5">
              <Label htmlFor="current-password">Current Password</Label>
              <div className="relative">
                <Input
                  id="current-password"
                  type={showCurrent ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  aria-label={showCurrent ? 'Hide password' : 'Show password'}
                >
                  {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* New password */}
            <div className="space-y-1.5">
              <Label htmlFor="new-password">New Password</Label>
              <div className="relative">
                <Input
                  id="new-password"
                  type={showNew ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowNew((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  aria-label={showNew ? 'Hide password' : 'Show password'}
                >
                  {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              {/* Strength bar */}
              {newPassword && (
                <div className="space-y-1 pt-1">
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div
                        key={i}
                        className={`h-1 flex-1 rounded-full transition-colors ${
                          i <= strength ? strengthColor : 'bg-slate-200'
                        }`}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-slate-500">
                    Strength:{' '}
                    <span
                      className={`font-medium ${strength >= 4 ? 'text-emerald-600' : strength >= 3 ? 'text-blue-600' : 'text-red-600'}`}
                    >
                      {strengthLabel}
                    </span>
                  </p>
                </div>
              )}
            </div>

            {/* Confirm password */}
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">Confirm New Password</Label>
              <div className="relative">
                <Input
                  id="confirm-password"
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onBlur={() => setConfirmTouched(true)}
                  autoComplete="new-password"
                  className={`pr-10 ${
                    confirmTouched && confirmPassword && newPassword !== confirmPassword
                      ? 'border-red-400 focus:ring-red-400'
                      : ''
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  aria-label={showConfirm ? 'Hide password' : 'Show password'}
                >
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {confirmTouched && confirmPassword && newPassword !== confirmPassword && (
                <p className="flex items-center gap-1 text-xs text-red-600">
                  <AlertCircle className="h-3 w-3" />
                  Passwords do not match.
                </p>
              )}
            </div>

            {formError && (
              <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {formError}
              </div>
            )}

            <Button
              type="submit"
              disabled={changePassword.isPending || !currentPassword || !newPassword || !confirmPassword}
            >
              {changePassword.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Updating…
                </>
              ) : (
                'Update Password'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Security Tips</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-slate-600">
            {[
              'Use a unique password you do not use on other sites.',
              'Avoid keyboard patterns like "qwerty" or "asdf".',
              'A strong password has uppercase, lowercase, numbers, and symbols.',
              'Never share your password with teammates — use API keys for integrations.',
            ].map((tip) => (
              <li key={tip} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                {tip}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Preferences Tab ──────────────────────────────────────────────────────────

function PreferencesTab() {
  const [prefs, setPrefs] = useState<Preferences>(loadPreferences);
  const { showToast } = useToast();

  const update = (patch: Partial<Preferences>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    savePreferences(next);
    if (patch.theme) {
      applyTheme(patch.theme);
    }
    showToast('Preference saved.', 'success');
  };

  return (
    <div className="space-y-6">
      {/* Theme */}
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Choose how the CRM looks on your device.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3 max-w-sm">
            {(
              [
                { value: 'light', label: 'Light', Icon: Sun },
                { value: 'dark', label: 'Dark', Icon: Moon },
                { value: 'system', label: 'System', Icon: Monitor },
              ] as const
            ).map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                aria-pressed={prefs.theme === value}
                aria-label={`Select ${label} theme`}
                onClick={() => update({ theme: value })}
                className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-sm font-medium transition-all ${
                  prefs.theme === value
                    ? 'border-slate-950 dark:border-slate-100 bg-slate-950 dark:bg-slate-100 text-white dark:text-slate-950 shadow-md'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:border-slate-300'
                }`}
              >
                <Icon className="h-5 w-5" />
                {label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-400">
            Theme preference is saved locally and applies on next visit.
          </p>
        </CardContent>
      </Card>

      {/* Notification sound */}
      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>Control how the CRM alerts you to new activity.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {prefs.notificationSound ? (
                <Bell className="h-5 w-5 text-slate-500" />
              ) : (
                <BellOff className="h-5 w-5 text-slate-400" />
              )}
              <div>
                <p className="text-sm font-medium text-slate-900">Notification Sound</p>
                <p className="text-xs text-slate-500">Play a sound when new notifications arrive</p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={prefs.notificationSound}
              onClick={() => update({ notificationSound: !prefs.notificationSound })}
              className={`relative inline-flex h-6 w-11 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-slate-950 focus:ring-offset-2 ${
                prefs.notificationSound ? 'bg-slate-950' : 'bg-slate-200'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  prefs.notificationSound ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Default pipeline view */}
      <Card>
        <CardHeader>
          <CardTitle>Default Pipeline View</CardTitle>
          <CardDescription>Choose your preferred layout when opening Pipelines.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3 max-w-xs">
            {(
              [
                { value: 'board', label: 'Kanban Board', Icon: LayoutGrid },
                { value: 'list', label: 'List View', Icon: List },
              ] as const
            ).map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => update({ defaultPipelineView: value })}
                className={`flex flex-1 items-center gap-2 rounded-lg border-2 px-4 py-3 text-sm font-medium transition-all ${
                  prefs.defaultPipelineView === value
                    ? 'border-slate-950 bg-slate-950 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Compact mode */}
      <Card>
        <CardHeader>
          <CardTitle>Display Density</CardTitle>
          <CardDescription>Adjust how much information is shown at once in tables.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-900">Compact Mode</p>
              <p className="text-xs text-slate-500">
                Reduce row height in tables for higher information density
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={prefs.compactMode}
              onClick={() => update({ compactMode: !prefs.compactMode })}
              className={`relative inline-flex h-6 w-11 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-slate-950 focus:ring-offset-2 ${
                prefs.compactMode ? 'bg-slate-950' : 'bg-slate-200'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  prefs.compactMode ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Permissions Tab ──────────────────────────────────────────────────────────

function PermissionsTab() {
  const user = useAuthStore((s) => s.user);
  const role = (user?.role as UserRole) ?? 'viewer';
  const permissions = ROLE_PERMISSIONS[role];
  const modules = Object.keys(permissions);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Your Access Level</CardTitle>
          <CardDescription>
            Your role is{' '}
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${ROLE_COLORS[role]}`}
            >
              {role}
            </span>
            . Contact your admin to request a role change.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="w-40 font-semibold text-slate-700">Module</TableHead>
                  <TableHead className="text-center font-semibold text-slate-700">Read</TableHead>
                  <TableHead className="text-center font-semibold text-slate-700">Write</TableHead>
                  <TableHead className="text-center font-semibold text-slate-700">Admin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {modules.map((mod) => {
                  const p = permissions[mod];
                  return (
                    <TableRow key={mod}>
                      <TableCell className="font-medium text-slate-700">{mod}</TableCell>
                      <TableCell className="text-center">
                        <PermissionDot has={p.read} />
                      </TableCell>
                      <TableCell className="text-center">
                        <PermissionDot has={p.write} />
                      </TableCell>
                      <TableCell className="text-center">
                        <PermissionDot has={p.admin} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-500">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              Allowed
            </div>
            <div className="flex items-center gap-1.5">
              <X className="h-4 w-4 text-slate-300" />
              Not allowed
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Role Descriptions</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-3">
            {(
              [
                ['admin', 'Full access to all modules and settings.'],
                ['manager', 'Leads, campaigns, pipeline, assignments, reports — no system settings.'],
                ['sales', 'Own leads, pipeline updates, outreach pause/resume.'],
                ['marketing', 'Campaigns, templates, reports.'],
                ['viewer', 'Read-only access to leads and reports.'],
              ] as const
            ).map(([r, desc]) => (
              <div key={r} className="flex items-start gap-3">
                <span
                  className={`mt-0.5 inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${ROLE_COLORS[r as UserRole]}`}
                >
                  {r}
                </span>
                <p className="text-sm text-slate-600">{desc}</p>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── API Keys Tab ─────────────────────────────────────────────────────────────

function ApiKeysTab() {
  const { data: keys = [], refetch, isLoading } = useApiKeys();
  const createMutation = useCreateApiKey();
  const deleteMutation = useDeleteApiKey();
  const { showToast } = useToast();

  const [keyName, setKeyName] = useState('');
  const [expiresIn, setExpiresIn] = useState('90');
  const [newRawKey, setNewRawKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const getApiBaseUrl = () => {
    const envUrl = import.meta.env.VITE_API_URL;
    if (envUrl && envUrl.startsWith('http')) return envUrl;
    return `${window.location.origin}${envUrl || '/api/v1'}`;
  };
  const mcpUrl = `${getApiBaseUrl()}/mcp`;

  const formatDate = (d: string) =>
    new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).format(
      new Date(d),
    );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const result = await createMutation.mutateAsync({
        name: keyName,
        expiresInDays: expiresIn === 'never' ? undefined : parseInt(expiresIn, 10),
      });
      setNewRawKey(result.rawKey);
      setKeyName('');
      refetch();
    } catch (err: unknown) {
      const msg = getApiErrorMessage(err, 'Failed to create key.');
      showToast(msg, 'error');
    }
  };

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const confirmDeleteKey = keys.find((k) => k.id === confirmDeleteId);

  const handleConfirmDelete = async () => {
    if (!confirmDeleteId) return;
    try {
      await deleteMutation.mutateAsync(confirmDeleteId);
      showToast('Key revoked successfully.', 'success');
      setConfirmDeleteId(null);
      refetch();
    } catch (err: unknown) {
      const msg = getApiErrorMessage(err, 'Failed to revoke key.');
      showToast(msg, 'error');
    }
  };

  const copyToClipboard = async () => {
    if (!newRawKey) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(newRawKey);
      } else {
        // Fallback for non-secure HTTP contexts
        const textarea = document.createElement('textarea');
        textarea.value = newRawKey;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      showToast('Copied to clipboard.', 'success');
    } catch {
      showToast('Failed to copy to clipboard. Please copy manually.', 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Generate */}
      <Card>
        <CardHeader>
          <CardTitle>Generate New Key</CardTitle>
          <CardDescription>
            Personal Access Tokens for MCP connectors and AI agents.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!newRawKey ? (
            <form onSubmit={handleCreate} className="max-w-sm space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="key-name">Key Name</Label>
                <Input
                  id="key-name"
                  placeholder="e.g. Claude Desktop MCP"
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="key-expiry">Expiration</Label>
                <select
                  id="key-expiry"
                  className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-950"
                  value={expiresIn}
                  onChange={(e) => setExpiresIn(e.target.value)}
                >
                  <option value="30">30 days</option>
                  <option value="60">60 days</option>
                  <option value="90">90 days</option>
                  <option value="never">Never expire</option>
                </select>
              </div>
              <Button type="submit" disabled={createMutation.isPending || !keyName}>
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating…
                  </>
                ) : (
                  'Generate API Key'
                )}
              </Button>
            </form>
          ) : (
            <div className="max-w-md space-y-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <div>
                <h4 className="text-sm font-semibold text-amber-800">Save your key now!</h4>
                <p className="text-sm text-amber-700">
                  This key will only be shown once. Copy and store it securely.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input value={newRawKey} readOnly className="font-mono bg-white" />
                <Button type="button" variant="outline" size="icon" onClick={copyToClipboard}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  if (!copied) {
                    if (
                      !window.confirm(
                        'Have you copied your API key? Once dismissed, this key will never be shown again.',
                      )
                    ) {
                      return;
                    }
                  }
                  setNewRawKey(null);
                }}
              >
                Done
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active keys */}
      <Card>
        <CardHeader>
          <CardTitle>Active Keys</CardTitle>
          <CardDescription>Keys currently able to access the API on your behalf.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead>Name</TableHead>
                  <TableHead>Prefix</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="w-[80px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-slate-400">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : keys.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-slate-400">
                      No active API keys. Generate one above.
                    </TableCell>
                  </TableRow>
                ) : (
                  keys.map((k) => (
                    <TableRow key={k.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <Key className="h-4 w-4 text-slate-400" />
                          {k.name}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm text-slate-500">
                        {k.prefix}…
                      </TableCell>
                      <TableCell className="text-slate-500">{formatDate(k.created_at)}</TableCell>
                      <TableCell className="text-slate-500">
                        {k.last_used_at ? formatDate(k.last_used_at) : 'Never'}
                      </TableCell>
                      <TableCell className="text-slate-500">
                        {k.expires_at ? formatDate(k.expires_at) : 'Never'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-red-500 hover:bg-red-50 hover:text-red-700"
                          onClick={() => setConfirmDeleteId(k.id)}
                          disabled={deleteMutation.isPending}
                          title="Revoke"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* MCP snippet */}
      <Card>
        <CardHeader>
          <CardTitle>Connect via MCP</CardTitle>
          <CardDescription>
            Use your API key to connect AI agents through the Model Context Protocol.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md bg-slate-950 p-4 text-slate-50 overflow-x-auto">
            <pre className="font-mono text-xs whitespace-pre">
              {`{\n  "mcpServers": {\n    "crm-automation": {\n      "command": "node",\n      "args": ["/path/to/backend/mcp-bridge.js"],\n      "env": {\n        "CRM_API_KEY": "YOUR_KEY_HERE",\n        "CRM_MCP_URL": "${mcpUrl}"\n      }\n    }\n  }\n}`}
            </pre>
          </div>
        </CardContent>
      </Card>

      {/* Confirm Revoke Modal */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-sm p-4 animate-fade-in">
          <Card className="w-full max-w-md shadow-xl border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-base font-semibold">Revoke API Key</CardTitle>
                  <CardDescription className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {confirmDeleteKey ? `"${confirmDeleteKey.name}"` : 'This key'} will be permanently revoked.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-2">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Are you sure you want to revoke this API key? Any applications or integrations using this key will immediately lose access to your CRM account.
              </p>
              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmDeleteId(null)}
                  disabled={deleteMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={handleConfirmDelete}
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                      Revoking…
                    </>
                  ) : (
                    'Revoke Key'
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ─── Main AccountPage ──────────────────────────────────────────────────────────

export function AccountPage() {
  const [activeTab, setActiveTab] = useState<Tab>('profile');

  // Restore tab from URL hash on mount
  useEffect(() => {
    const hash = window.location.hash.replace('#', '') as Tab;
    const valid: Tab[] = ['profile', 'security', 'preferences', 'permissions', 'apikeys'];
    if (valid.includes(hash)) setActiveTab(hash);
  }, []);

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    window.history.replaceState(null, '', `#${tab}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent, currentIndex: number) => {
    const tabsList: Tab[] = ['profile', 'security', 'preferences', 'permissions', 'apikeys'];
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const nextIndex = (currentIndex + 1) % tabsList.length;
      handleTabChange(tabsList[nextIndex]);
      document.getElementById(`account-tab-${tabsList[nextIndex]}`)?.focus();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prevIndex = (currentIndex - 1 + tabsList.length) % tabsList.length;
      handleTabChange(tabsList[prevIndex]);
      document.getElementById(`account-tab-${tabsList[prevIndex]}`)?.focus();
    }
  };

  const ActiveContent = {
    profile: ProfileTab,
    security: SecurityTab,
    preferences: PreferencesTab,
    permissions: PermissionsTab,
    apikeys: ApiKeysTab,
  }[activeTab];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Account"
        title="My Account"
        description="Manage your profile, password, preferences, and API access."
      />

      {/* Tab navigation */}
      <div className="border-b border-slate-200 dark:border-slate-800">
        <nav className="-mb-px flex gap-1 overflow-x-auto" role="tablist" aria-label="Account tabs">
          {TABS.map(({ id, label, icon: Icon }, idx) => (
            <button
              key={id}
              type="button"
              id={`account-tab-${id}`}
              role="tab"
              aria-selected={activeTab === id}
              aria-controls={`account-tabpanel-${id}`}
              tabIndex={activeTab === id ? 0 : -1}
              onKeyDown={(e) => handleKeyDown(e, idx)}
              onClick={() => handleTabChange(id)}
              className={`flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-slate-950 dark:focus:ring-slate-100 ${
                activeTab === id
                  ? 'border-slate-950 dark:border-slate-100 text-slate-950 dark:text-slate-50 font-semibold'
                  : 'border-transparent text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      <div
        role="tabpanel"
        id={`account-tabpanel-${activeTab}`}
        aria-labelledby={`account-tab-${activeTab}`}
      >
        <ActiveContent />
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useUsers, useCreateUser } from '@/api/users';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { LoadingTable } from '@/components/ui/LoadingTable';
import { useToast } from '@/components/ui/Toast';
import { useAuthStore } from '@/store/authStore';
import type { UserRole } from '@/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { Plus, X, AlertCircle, InboxIcon, Loader2, Shield, CheckCircle2 } from 'lucide-react';

const roleColors: Record<UserRole, string> = {
  admin: 'bg-purple-100 text-purple-800',
  manager: 'bg-blue-100 text-blue-800',
  sales: 'bg-emerald-100 text-emerald-800',
  marketing: 'bg-amber-100 text-amber-800',
  viewer: 'bg-slate-100 text-slate-600',
};

export function UsersPage() {
  const { data: users, isLoading, error } = useUsers();
  const createUser = useCreateUser();
  const { showToast } = useToast();
  const currentUser = useAuthStore((s) => s.user);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('sales');
  const [formError, setFormError] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const isAdmin = currentUser?.role === 'admin';

  const resetForm = () => {
    setName('');
    setEmail('');
    setPassword('');
    setRole('sales');
    setFormError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setFeedback(null);

    if (!name.trim() || !email.trim() || !password.trim()) {
      setFormError('All fields are required.');
      setFeedback({ type: 'error', message: 'All fields are required.' });
      return;
    }

    if (password.length < 8) {
      setFormError('Password must be at least 8 characters.');
      setFeedback({ type: 'error', message: 'Password must be at least 8 characters.' });
      return;
    }

    if (!/[A-Z]/.test(password)) {
      setFormError('Password must contain at least one uppercase letter.');
      setFeedback({ type: 'error', message: 'Password must contain at least one uppercase letter.' });
      return;
    }

    if (!/[0-9]/.test(password)) {
      setFormError('Password must contain at least one number.');
      setFeedback({ type: 'error', message: 'Password must contain at least one number.' });
      return;
    }

    try {
      await createUser.mutateAsync({ name: name.trim(), email: email.trim(), password, role });
      setFeedback({ type: 'success', message: `User ${name.trim()} created successfully.` });
      showToast('User created successfully.', 'success');
      resetForm();
      setShowForm(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create user. Please try again.';
      setFormError(message);
      setFeedback({ type: 'error', message });
      showToast(message, 'error');
    }
  };

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-slate-900">User Management</h1>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Shield className="mb-4 h-12 w-12 text-slate-300" />
            <p className="text-lg font-medium text-slate-600">Access Restricted</p>
            <p className="text-sm text-slate-500">Only administrators can manage users.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="User Management"
        description="Create and manage user accounts"
        eyebrow="Administration"
        actions={
          !showForm ? (
            <Button onClick={() => { resetForm(); setFeedback(null); setShowForm(true); }}>
              <Plus className="mr-2 h-4 w-4" />
              Add User
            </Button>
          ) : undefined
        }
      />

      {feedback && (
        <div
          role="status"
          className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${
            feedback.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <p className="text-sm font-medium">{feedback.message}</p>
        </div>
      )}

      {/* Create user form */}
      {showForm && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Create New User</CardTitle>
                <CardDescription>Fill in the details to create a new user account</CardDescription>
              </div>
              <Button variant="ghost" size="icon" onClick={() => { setShowForm(false); resetForm(); setFeedback(null); }}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              {formError && (
                <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                  <p className="text-sm text-red-700">{formError}</p>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="user-name">Full Name</Label>
                  <Input
                    id="user-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="John Doe"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="user-email">Email</Label>
                  <Input
                    id="user-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="john@company.com"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="user-password">Password</Label>
                  <Input
                    id="user-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min 8 chars, 1 uppercase, 1 number"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="user-role">Role</Label>
                  <select
                    id="user-role"
                    value={role}
                    onChange={(e) => setRole(e.target.value as UserRole)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <option value="sales">Sales</option>
                    <option value="marketing">Marketing</option>
                    <option value="manager">Manager</option>
                    <option value="viewer">Viewer</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => { setShowForm(false); resetForm(); setFeedback(null); }}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createUser.isPending}>
                  {createUser.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating…
                    </>
                  ) : (
                    'Create User'
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Error state */}
      {error && (
        <ErrorState message="Failed to load users. Please try refreshing the page." />
      )}

      {/* Loading state */}
      {isLoading && <LoadingTable />}

      {/* Empty state */}
      {!isLoading && !error && users && users.length === 0 && (
        <EmptyState
          icon={<InboxIcon className="h-6 w-6" />}
          title="No users found"
          description="Create the first user to get started."
        />
      )}

      {/* Users table */}
      {!isLoading && !error && users && users.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50/50">
                    <th className="px-4 py-3 text-left font-medium text-slate-600">Name</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">Email</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">Role</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {users.map((user) => (
                    <tr key={user.id} className="transition-colors hover:bg-slate-50/50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700">
                            {user.name.charAt(0).toUpperCase()}
                          </div>
                          <span className="font-medium text-slate-900">{user.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{user.email}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${roleColors[user.role]}`}>
                          {user.role}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${user.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                          {user.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {new Date(user.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

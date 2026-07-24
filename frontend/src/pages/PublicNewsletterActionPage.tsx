import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams, useParams, Link } from 'react-router-dom';
import {
  useConfirmSubscription,
  useUnsubscribe,
  useNewsletterPreferences,
  useUpdateNewsletterPreferences,
  type NewsletterFrequency,
} from '@/api/newsletter';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/Toast';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { CheckCircle, MailOpen, AlertCircle } from 'lucide-react';
import { getApiErrorMessage } from '@/lib/apiError';

export function PublicNewsletterActionPage() {
  const { action } = useParams<{ action: 'confirm' | 'unsubscribe' | 'preferences' }>();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const { showToast } = useToast();

  const confirmSub = useConfirmSubscription();
  const unsubscribe = useUnsubscribe();
  
  const [actionDone, setActionDone] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // For preferences
  const { data: preferences, isLoading: prefsLoading, error: prefsError } = useNewsletterPreferences(token ?? '');
  const updatePrefs = useUpdateNewsletterPreferences();
  const [frequency, setFrequency] = useState<NewsletterFrequency>('weekly');

  useEffect(() => {
    if (preferences) {
      setFrequency(preferences.frequency);
    }
  }, [preferences]);

  useEffect(() => {
    if (!token) return;

    if (action === 'confirm') {
      confirmSub.mutateAsync(token)
        .then(() => setActionDone(true))
        .catch((err) => setActionError(getApiErrorMessage(err, 'Failed to confirm subscription')));
    } else if (action === 'unsubscribe') {
      unsubscribe.mutateAsync(token)
        .then(() => setActionDone(true))
        .catch((err) => setActionError(getApiErrorMessage(err, 'Failed to unsubscribe')));
    }
    // Preferences is handled via useQuery
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, token]);

  const handleUpdatePreferences = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    try {
      await updatePrefs.mutateAsync({ token, input: { frequency } });
      showToast('Preferences updated successfully', 'success');
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to update preferences'), 'error');
    }
  };

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <AlertCircle className="mx-auto h-12 w-12 text-red-500" />
            <h1 className="mt-4 text-xl font-semibold text-slate-900">Invalid Link</h1>
            <p className="mt-2 text-sm text-slate-600">The link you followed is missing a valid token.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (action === 'confirm' || action === 'unsubscribe') {
    if (actionError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
          <Card className="w-full max-w-md">
            <CardContent className="p-8 text-center">
              <AlertCircle className="mx-auto h-12 w-12 text-red-500" />
              <h1 className="mt-4 text-xl font-semibold text-slate-900">Error</h1>
              <p className="mt-2 text-sm text-slate-600">{actionError}</p>
            </CardContent>
          </Card>
        </div>
      );
    }

    if (!actionDone) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
          <LoadingSpinner />
        </div>
      );
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <CheckCircle className="mx-auto h-12 w-12 text-green-500" />
            <h1 className="mt-4 text-xl font-semibold text-slate-900">
              {action === 'confirm' ? 'Subscription Confirmed!' : 'Unsubscribed Successfully'}
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              {action === 'confirm' 
                ? 'Your email has been confirmed. You will start receiving our newsletter.' 
                : 'You have been successfully removed from our newsletter list.'}
            </p>
            {action === 'unsubscribe' && (
              <Button asChild variant="link" className="mt-4">
                <Link to="/subscribe">Subscribe again</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (action === 'preferences') {
    if (prefsLoading) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
          <LoadingSpinner />
        </div>
      );
    }

    if (prefsError || !preferences) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
          <Card className="w-full max-w-md">
            <CardContent className="p-8 text-center">
              <AlertCircle className="mx-auto h-12 w-12 text-red-500" />
              <h1 className="mt-4 text-xl font-semibold text-slate-900">Error</h1>
              <p className="mt-2 text-sm text-slate-600">Failed to load your preferences. The link might be expired.</p>
            </CardContent>
          </Card>
        </div>
      );
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
        <main className="mx-auto w-full max-w-md">
          <Card>
            <CardContent className="p-6 sm:p-8">
              <div className="mb-6 flex flex-col items-center text-center">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                  <MailOpen className="h-6 w-6" />
                </div>
                <h1 className="text-2xl font-semibold text-slate-950">Update Preferences</h1>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Manage your newsletter subscription for {preferences.email}
                </p>
              </div>

              <form onSubmit={handleUpdatePreferences} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="frequency">Frequency</Label>
                  <select
                    id="frequency"
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value as NewsletterFrequency)}
                    className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition-colors focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>

                <div className="flex gap-3 pt-2">
                  <Button type="submit" disabled={updatePrefs.isPending} className="flex-1">
                    {updatePrefs.isPending ? 'Saving...' : 'Save Preferences'}
                  </Button>
                  <Button type="button" variant="outline" asChild className="flex-1">
                    <Link to={`/newsletter/unsubscribe?token=${token}`}>Unsubscribe</Link>
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return null;
}

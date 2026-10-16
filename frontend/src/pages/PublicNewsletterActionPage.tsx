import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { NEWSLETTER_TOPIC_LABELS } from '@/lib/newsletterPresentation';
import { useSearchParams, useParams, Link } from 'react-router-dom';
import {
  useConfirmSubscription,
  useUnsubscribe,
  useNewsletterPreferences,
  useUpdateNewsletterPreferences,
  type NewsletterTopic,
} from '@/api/newsletter';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/Toast';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { CheckCircle, MailOpen, AlertCircle } from 'lucide-react';
import { getApiErrorMessage } from '@/lib/apiError';

const preferencesSchema = z.object({
  topics: z.array(z.enum(['product_updates', 'promotions', 'company_news'])),
  frequency: z.enum(['daily', 'weekly', 'monthly']),
});
type Preferences = z.infer<typeof preferencesSchema>;

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
  const { data: preferences, isLoading: prefsLoading, error: prefsError, refetch: retryPreferences } = useNewsletterPreferences(token ?? '', action === 'preferences');
  const updatePrefs = useUpdateNewsletterPreferences();
  const preferencesForm = useForm<Preferences>({ resolver: zodResolver(preferencesSchema), defaultValues: { topics: [], frequency: 'weekly' } });

  useEffect(() => {
    if (preferences) {
      preferencesForm.reset({ topics: preferences.topics as NewsletterTopic[], frequency: preferences.frequency });
    }
  }, [preferences, preferencesForm]);

  useEffect(() => {
    if (!token) return;

    if (action === 'confirm') {
      confirmSub.mutateAsync(token)
        .then(() => setActionDone(true))
        .catch((err) => setActionError(getApiErrorMessage(err, 'Failed to confirm subscription')));
    }
    // Preferences is handled via useQuery
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, token]);

  const handleUpdatePreferences = async (values: Preferences) => {
    if (!token) return;
    try {
      await updatePrefs.mutateAsync({ token, input: values });
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

  if (action === 'unsubscribe') {
    const tokenLooksValid = /^[a-f0-9]{64}$/i.test(token);
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            {actionDone ? (
              <>
                <CheckCircle className="mx-auto h-12 w-12 text-green-500" />
                <h1 className="mt-4 text-xl font-semibold text-slate-900">Unsubscribed Successfully</h1>
                <p className="mt-2 text-sm text-slate-600">You have been removed from our newsletter list.</p>
                <Button asChild variant="link" className="mt-4">
                  <Link to="/subscribe">Subscribe again</Link>
                </Button>
              </>
            ) : (
              <>
                <MailOpen className="mx-auto h-12 w-12 text-slate-500" />
                <h1 className="mt-4 text-xl font-semibold text-slate-900">Unsubscribe from our newsletter?</h1>
                <p className="mt-2 text-sm text-slate-600">
                  Confirm to stop receiving newsletter emails at this address.
                </p>
                {!tokenLooksValid ? (
                  <p role="alert" className="mt-4 text-sm text-red-600">
                    This unsubscribe link is invalid or incomplete. Use the link from the newsletter email you received.
                  </p>
                ) : actionError ? (
                  <p role="alert" className="mt-4 text-sm text-red-600">{actionError}</p>
                ) : null}
                {tokenLooksValid && (
                  <Button
                    className="mt-5"
                    disabled={unsubscribe.isPending}
                    onClick={() => {
                      setActionError(null);
                      unsubscribe.mutateAsync(token)
                        .then(() => setActionDone(true))
                        .catch((err) => setActionError(getApiErrorMessage(err, 'Failed to unsubscribe')));
                    }}
                  >
                    {unsubscribe.isPending ? 'Unsubscribing...' : 'Confirm unsubscribe'}
                  </Button>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (action === 'confirm') {
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
              Subscription Confirmed!
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Your email has been confirmed. You will start receiving our newsletter.
            </p>
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
              <p className="mt-2 text-sm text-slate-600">Couldn’t load your preferences. Retry, or open the preference link from a newsletter email.</p>
              <Button className="mt-4" onClick={() => void retryPreferences()}>Retry</Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    if (preferences.status === 'unsubscribed') {
      return (
        <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
          <Card className="w-full max-w-md"><CardContent className="p-8 text-center">
            <h1 className="text-xl font-semibold">You’re unsubscribed</h1>
            <p className="mt-2 text-sm text-slate-600">You won’t receive newsletter emails. Subscribe again if you’d like to rejoin.</p>
            <Button asChild variant="link" className="mt-4"><Link to="/subscribe">Subscribe again</Link></Button>
          </CardContent></Card>
        </main>
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
                  Choose which newsletters you receive and how often. You can unsubscribe at any time.
                </p>
              </div>

              <form onSubmit={preferencesForm.handleSubmit(handleUpdatePreferences)} className="space-y-5">
                <fieldset className="space-y-2" disabled={updatePrefs.isPending}>
                  <legend className="text-sm font-medium">Topics you want to receive</legend>
                  {Object.entries(NEWSLETTER_TOPIC_LABELS).map(([topic, label]) => (
                    <label key={topic} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" value={topic} {...preferencesForm.register('topics')} />
                      {label}
                    </label>
                  ))}
                  <p className="text-sm text-slate-600">Selecting no topics excludes you from topic-targeted emails. Use Unsubscribe to stop all newsletters.</p>
                </fieldset>
                <div className="space-y-2">
                  <Label htmlFor="frequency">Maximum sending frequency</Label>
                  <select
                    id="frequency"
                    {...preferencesForm.register('frequency')}
                    disabled={updatePrefs.isPending}
                    className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition-colors focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
                  >
                    <option value="daily">Daily — at most every 24 hours</option>
                    <option value="weekly">Weekly — at most every 7 days</option>
                    <option value="monthly">Monthly — at most every 30 days</option>
                  </select>
                </div>

                <p className="text-sm text-slate-600">This is a limit across all newsletters, not a promise of an email on that schedule.</p>
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

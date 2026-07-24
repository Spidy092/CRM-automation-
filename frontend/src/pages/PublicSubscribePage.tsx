import { useState, type FormEvent } from 'react';
import { useSubscribe, type NewsletterFrequency } from '@/api/newsletter';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
import { CheckCircle, Send, MailOpen } from 'lucide-react';

export function PublicSubscribePage() {
  const { showToast } = useToast();
  const subscribe = useSubscribe();
  const [email, setEmail] = useState('');
  const [frequency, setFrequency] = useState<NewsletterFrequency>('weekly');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!email) {
      showToast('Email is required', 'error');
      return;
    }

    try {
      await subscribe.mutateAsync({ email, frequency });
      setSubmitted(true);
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to subscribe to the newsletter'), 'error');
    }
  };

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <CheckCircle className="mx-auto h-12 w-12 text-green-500" />
            <h1 className="mt-4 text-xl font-semibold text-slate-900">Subscription received</h1>
            <p className="mt-2 text-sm text-slate-600">
              Please check your inbox to confirm your subscription!
            </p>
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
              <h1 className="text-2xl font-semibold text-slate-950">Subscribe to our Newsletter</h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Get the latest updates, industry insights, and news delivered straight to your inbox.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address <span className="text-red-500">*</span></Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </div>

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

              <Button type="submit" disabled={subscribe.isPending} className="w-full">
                <Send className="mr-2 h-4 w-4" />
                {subscribe.isPending ? 'Subscribing...' : 'Subscribe'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

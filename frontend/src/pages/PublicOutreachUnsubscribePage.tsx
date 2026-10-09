import { useSearchParams } from 'react-router-dom';
import { useUnsubscribeOutreach } from '@/api/outreach';
import { getApiErrorMessage } from '@/lib/apiError';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/** Confirmation protects recipients from automatic opt-out by email link scanners. */
export function PublicOutreachUnsubscribePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const validToken = /^[a-f0-9]{64}$/.test(token);
  const unsubscribe = useUnsubscribeOutreach();
  return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4" style={{ overflowWrap: 'anywhere' }}>
    <Card className="w-full max-w-md"><CardContent className="space-y-4 p-8 text-center">
      <h1 className="text-xl font-semibold">{unsubscribe.isSuccess ? 'Unsubscribed' : 'Unsubscribe from outreach'}</h1>
      {!validToken ? <p role="alert">This unsubscribe link is invalid.</p> : unsubscribe.isSuccess ?
        <p>You will no longer receive outreach messages from us.</p> : <>
          <p>Confirm below to stop receiving outreach messages.</p>
          {unsubscribe.isError && <p role="alert" className="text-sm text-red-600">{getApiErrorMessage(unsubscribe.error, 'Could not unsubscribe. Please try again.')}</p>}
          <Button onClick={() => unsubscribe.mutate(token)} disabled={unsubscribe.isPending}>{unsubscribe.isPending ? 'Unsubscribing…' : 'Confirm unsubscribe'}</Button>
        </>}
    </CardContent></Card>
  </main>;
}

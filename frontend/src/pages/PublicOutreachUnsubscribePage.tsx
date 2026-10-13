import { useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { useUnsubscribeOutreach, useUnsubscribeFeedback } from '@/api/outreach';
import { getApiErrorMessage } from '@/lib/apiError';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/** Confirmation protects recipients from automatic opt-out by email link scanners. */
export function PublicOutreachUnsubscribePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const validToken = /^[a-f0-9]{64}$/.test(token);
  const unsubscribe = useUnsubscribeOutreach();
  const feedback = useUnsubscribeFeedback();
  const [reason, setReason] = useState('');
  const [skipped, setSkipped] = useState(false);
  return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4" style={{ overflowWrap: 'anywhere' }}>
    <Card className="w-full max-w-md"><CardContent className="space-y-4 p-8 text-center">
      <h1 className="text-xl font-semibold">{unsubscribe.isSuccess ? 'Unsubscribed' : 'Unsubscribe from outreach'}</h1>
      {!validToken ? <p role="alert">{token ? 'This unsubscribe link is invalid or incomplete.' : 'To unsubscribe, use the Unsubscribe link in the email you received. No login is required.'}</p> : unsubscribe.isSuccess ? <>
        <p>You will no longer receive outreach messages from us.</p>
        {!skipped && !feedback.isSuccess && <div className="space-y-3 text-left">
          <label htmlFor="unsubscribe-reason" className="block text-sm font-medium">Why did you unsubscribe? (Optional)</label>
          <select id="unsubscribe-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded border border-slate-300 bg-white p-2">
            <option value="">Choose a reason</option>
            <option value="not_relevant">Not relevant to me</option>
            <option value="too_frequent">Too many emails</option>
            <option value="not_requested">I didn’t request these emails</option>
            <option value="other">Other</option>
          </select>
          {feedback.isError && <p role="alert">Feedback could not be saved. You are still unsubscribed.</p>}
          <div className="flex justify-center gap-2">
            <Button onClick={() => feedback.mutate({ token, reason })} disabled={!reason || feedback.isPending}>{feedback.isPending ? 'Saving…' : 'Submit feedback'}</Button>
            <Button variant="outline" onClick={() => setSkipped(true)}>Skip</Button>
          </div>
        </div>}
        {feedback.isSuccess && <p role="status">Thank you for your feedback.</p>}
      </> : <>
          <p>Confirm below to stop receiving outreach messages.</p>
          {unsubscribe.isError && <p role="alert" className="text-sm text-red-600">{getApiErrorMessage(unsubscribe.error, 'Could not unsubscribe. Please try again.')}</p>}
          <Button onClick={() => unsubscribe.mutate(token)} disabled={unsubscribe.isPending}>{unsubscribe.isPending ? 'Unsubscribing…' : 'Confirm unsubscribe'}</Button>
        </>}
    </CardContent></Card>
  </main>;
}

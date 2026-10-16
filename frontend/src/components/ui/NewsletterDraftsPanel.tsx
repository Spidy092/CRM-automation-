import { useState } from 'react';
import { useNewsletterDrafts, useSaveNewsletterDraft, useDeleteNewsletterDraft, useSendNewsletterDraft, type NewsletterDraft } from '@/api/newsletter';
import { getApiErrorMessage } from '@/lib/apiError';
import { Button } from './button';
import { LoadingSpinner } from './LoadingSpinner';
import { ErrorState } from './ErrorState';
import { NewsletterBroadcastModal } from './NewsletterBroadcastModal';

export function NewsletterDraftsPanel() {
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<NewsletterDraft | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = useNewsletterDrafts(page);
  const save = useSaveNewsletterDraft();
  const remove = useDeleteNewsletterDraft();
  const send = useSendNewsletterDraft();
  const busy = save.isPending || remove.isPending || send.isPending;
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); setDeleting(null); }
    catch (err) { setError(getApiErrorMessage(err, 'Draft operation failed. Please retry.')); }
  };
  return <section className="rounded-lg border bg-white p-5" aria-label="Newsletter drafts">
    <h3 className="font-semibold">Drafts</h3>
    <p className="mt-1 text-sm text-slate-600">Saved on the server. Open a draft to edit, preview, test, and send. Sending freezes its content so retries stay safe.</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {query.isLoading && <LoadingSpinner />}
    {query.error && <ErrorState message={getApiErrorMessage(query.error, 'Could not load drafts.')} onRetry={() => query.refetch()} />}
    {!query.isLoading && !query.error && query.data?.length === 0 && <p className="py-6 text-sm text-slate-500">No drafts on this page. Use “Save draft” in the newsletter editor to create one.</p>}
    <ul className="divide-y">
      {query.data?.map((draft) => <li key={draft.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div><h4 className="font-medium">{draft.content.subject || 'Untitled newsletter'}</h4>
          <p className="text-sm text-slate-500">{draft.status === 'sending' ? 'Sending started — retry to recover' : 'Draft'} · Revision {draft.revision} · {new Date(draft.updated_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {draft.status === 'draft' && <Button size="sm" disabled={busy} onClick={() => setEditing(draft)}>Edit</Button>}
          {draft.status === 'sending' && <Button size="sm" disabled={busy} onClick={() => void act(() => send.mutateAsync(draft))}>Retry sending</Button>}
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(() => save.mutateAsync({ content: { ...draft.content, subject: `${draft.content.subject} (copy)`.slice(0, 255), scheduledAt: undefined, scheduledAtLocal: undefined } }))}>Duplicate</Button>
          {draft.status === 'draft' && (deleting === draft.id
            ? <><Button size="sm" disabled={busy} onClick={() => void act(() => remove.mutateAsync(draft))}>Confirm delete</Button><Button size="sm" variant="ghost" onClick={() => setDeleting(null)}>Keep draft</Button></>
            : <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDeleting(draft.id)}>Delete</Button>)}
        </div>
      </li>)}
    </ul>
    <div className="mt-3 flex items-center gap-3">
      <Button variant="outline" size="sm" disabled={page === 0 || query.isFetching} onClick={() => setPage(page - 1)}>Previous drafts</Button>
      <span className="text-sm">Page {page + 1}</span>
      <Button variant="outline" size="sm" disabled={!query.data || query.data.length < 25 || query.isFetching} onClick={() => setPage(page + 1)}>Next drafts</Button>
    </div>
    {editing && <NewsletterBroadcastModal key={editing.id} draft={editing} onClose={() => setEditing(null)} />}
  </section>;
}

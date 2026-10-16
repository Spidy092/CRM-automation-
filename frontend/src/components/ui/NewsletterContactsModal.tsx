import { NEWSLETTER_TOPIC_LABELS } from '@/lib/newsletterPresentation';
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useInfiniteLeads } from '@/api/leads';
import { useAddNewsletterContacts } from '@/api/newsletter';
import { useModalFocus } from '@/hooks/useModalFocus';
import { getApiErrorMessage } from '@/lib/apiError';
import { Button } from './button';
import { Input } from './input';

const schema = z.object({
  leadIds: z.array(z.string().uuid()).min(1, 'Select at least one contact.').max(100, 'Select up to 100 contacts at a time.'),
  topics: z.array(z.enum(['product_updates', 'promotions', 'company_news'])),
  frequency: z.enum(['daily', 'weekly', 'monthly']),
});
type Values = z.infer<typeof schema>;
const topics: Values['topics'] = ['product_updates', 'promotions', 'company_news'];

export function NewsletterContactsModal({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  const [search, setSearch] = useState('');
  const [result, setResult] = useState<{ added: number; failed: number; skipped: number; failedLeadIds: string[] } | null>(null);
  const mutation = useAddNewsletterContacts();
  const close = (): void => { if (!mutation.isPending) onClose(); };
  const dialogRef = useModalFocus(close);
  const leads = useInfiniteLeads({ search, limit: 25 });
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { leadIds: [], topics: [...topics], frequency: 'weekly' },
  });
  const selected = form.watch('leadIds');
  const items = leads.data?.pages.flatMap((page) => page.items) ?? [];
  const submit = async (values: Values): Promise<void> => {
    form.clearErrors('root');
    setResult(null);
    try {
      const summary = await mutation.mutateAsync({ leadIds: values.leadIds ?? [], topics: values.topics ?? [], frequency: values.frequency ?? 'weekly' });
      setResult(summary);
      form.setValue('leadIds', summary.failedLeadIds);
    } catch (error) {
      form.setError('root', { message: getApiErrorMessage(error, 'Could not add contacts.') });
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <h2 id={titleId} className="text-xl font-bold">Add contacts to newsletter</h2>
        <p className="mt-2 text-base text-slate-600">Select CRM leads to subscribe immediately. No confirmation email is sent. They will be eligible for future newsletters and can unsubscribe from any newsletter email.</p>
        <p className="mt-2 text-xs text-slate-500">Existing subscribers keep their preferences. Previously unsubscribed addresses and opted-out leads are skipped.</p>
        <form onSubmit={form.handleSubmit(submit)} className="mt-4 space-y-4">
          <fieldset disabled={mutation.isPending} className="space-y-4">
            <div>
              <label htmlFor={`${titleId}-search`} className="block text-sm font-medium">Search CRM contacts</label>
              <Input id={`${titleId}-search`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search leads" />
            </div>
            {leads.isLoading && <p role="status">Loading contacts…</p>}
            {leads.error && <div role="alert"><p>Could not load contacts.</p><Button type="button" variant="outline" onClick={() => leads.refetch()}>Retry</Button></div>}
            {!leads.isLoading && !leads.error && items.length === 0 && <p>No contacts match your search.</p>}
            <div className="max-h-60 space-y-2 overflow-y-auto" aria-label="CRM contacts">
              {items.map((lead) => (
                <label key={lead.id} className="flex items-center gap-3 rounded border p-2 text-sm">
                  <input type="checkbox" aria-label={`Select ${lead.email || lead.business_name}`} checked={selected.includes(lead.id)} disabled={!lead.email || lead.status === 'opted_out'} onChange={(event) => form.setValue('leadIds', event.target.checked ? [...selected, lead.id] : selected.filter((id) => id !== lead.id), { shouldValidate: true })} />
                  <span><span className="block font-medium">{lead.contact_name || lead.business_name}</span><span className="text-slate-500">{lead.email || 'No email address'}{lead.status === 'opted_out' ? ' · Opted out' : ''}</span></span>
                </label>
              ))}
            </div>
            {leads.hasNextPage && <Button type="button" variant="outline" disabled={leads.isFetchingNextPage} onClick={() => leads.fetchNextPage()}>{leads.isFetchingNextPage ? 'Loading…' : 'Load more contacts'}</Button>}
            <p className="text-base">{selected.length} selected · Maximum 100 per addition</p>
            {form.formState.errors.leadIds && <p role="alert" className="text-sm text-red-700">{form.formState.errors.leadIds.message}</p>}
            <div>
              <label htmlFor={`${titleId}-frequency`} className="block text-sm font-medium">Maximum sending frequency</label>
              <select id={`${titleId}-frequency`} {...form.register('frequency')} className="mt-1 rounded border p-2 text-sm">
                <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
              </select>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Topics</legend>
              {topics.map((topic) => <label key={topic} className="flex items-center gap-2 text-sm"><input type="checkbox" value={topic} {...form.register('topics')} />{NEWSLETTER_TOPIC_LABELS[topic]}</label>)}
            </fieldset>
            {form.formState.errors.root && <p role="alert" className="text-sm text-red-700">{form.formState.errors.root.message}</p>}
            {result && <p role="status" className="text-base text-green-800">{result.added} contacts subscribed. {result.skipped} skipped (already subscribed, unsubscribed, opted out, duplicate, or missing a valid email). {result.failed > 0 && `${result.failed} could not be added; retry those contacts.`}</p>}
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={close}>Close</Button><Button type="submit">{mutation.isPending ? 'Adding…' : 'Add selected contacts'}</Button></div>
          </fieldset>
        </form>
      </div>
    </div>
  );
}

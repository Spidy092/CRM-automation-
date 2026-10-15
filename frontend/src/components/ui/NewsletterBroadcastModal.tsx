import { useModalFocus } from '@/hooks/useModalFocus';
import { useId, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from './button';
import { Input } from './input';
import { Textarea } from './textarea';
import { LoadingSpinner } from './LoadingSpinner';
import { useBroadcast, useEligibleCount, useTestSendNewsletter, type NewsletterTopic, type NewsletterFrequency } from '@/api/newsletter';
import { useTemplates } from '@/api/templates';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
import {
  compileBlocksToHtml,
  blocksAreEmpty,
  createBlock,
  type NewsletterBlock,
  type NewsletterBlockType,
} from '@/lib/newsletterComposer';

interface Props {
  onClose: () => void;
}

const DRAFT_KEY = 'newsletter:broadcast:draft';

const blockSchema = z.object({
  id: z.string(),
  type: z.enum(['heading', 'paragraph', 'bullets', 'button']),
  text: z.string().default(''),
  items: z.array(z.string()).default([]),
  url: z.string().default(''),
});

const formSchema = z
  .object({
    subject: z.string().min(1, 'Subject is required').max(255),
    previewText: z.string().max(300).optional().default(''),
    editMode: z.enum(['blocks', 'html']).default('blocks'),
    blocks: z.array(blockSchema).default([]),
    htmlBody: z.string().optional().default(''),
    topics: z.array(z.enum(['product_updates', 'promotions', 'company_news'])).default([]),
    frequency: z.enum(['daily', 'weekly', 'monthly']).optional(),
    templateId: z.string().optional(),
    testEmail: z.string().email('Enter a valid email').optional().or(z.literal('')),
    scheduledAt: z.string().optional().default(''),
    timezone: z.string().default('UTC'),
  })
  .superRefine((v, ctx) => {
    if (v.editMode === 'blocks' && blocksAreEmpty(v.blocks as NewsletterBlock[])) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['blocks'], message: 'Add at least one content block.' });
    }
    if (v.editMode === 'html' && !(v.htmlBody ?? '').trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['htmlBody'], message: 'Content is required.' });
    }
  });

type FormValues = z.infer<typeof formSchema>;

const TIMEZONES = (() => {
  try {
    const preferred = ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Singapore', 'Australia/Sydney'];
    // Preferred zones are always offered: Intl.DateTimeFormat canonicalizes
    // aliases (e.g. Asia/Kolkata) even when supportedValuesOf omits them, so
    // filtering strictly by that list would wrongly hide valid zones.
    const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
    const rest = all.filter((tz) => !preferred.includes(tz)).slice(0, 40);
    return [...preferred, ...rest];
  } catch {
    return ['UTC'];
  }
})();

function stripToText(html: string): string {
  return html
    .replace(/<a\b[^>]*\shref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]*>/g, '')
    .slice(0, 2000);
}

interface SavedBroadcastDraft {
  values: Partial<FormValues>;
  idempotencyKey?: string;
}

function loadDraft(): SavedBroadcastDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FormValues> & { idempotencyKey?: unknown; values?: unknown };
    // Read the legacy flat draft shape while preserving newer identity metadata.
    const values = parsed.values && typeof parsed.values === 'object'
      ? parsed.values as Partial<FormValues>
      : parsed;
    return {
      values,
      ...(typeof parsed.idempotencyKey === 'string' ? { idempotencyKey: parsed.idempotencyKey } : {}),
    };
  } catch {
    return null;
  }
}

export function NewsletterBroadcastModal({ onClose }: Props) {
  const titleId = useId();
  const dialogRef = useModalFocus(onClose);
  const [savedDraft] = useState(loadDraft);
  const [idempotencyKey] = useState(() => savedDraft?.idempotencyKey ?? crypto.randomUUID());
  const [step, setStep] = useState(0);
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop');
  const [sendState, setSendState] = useState<'idle' | 'pending' | 'success' | 'failure'>('idle');
  const [sendError, setSendError] = useState<string | null>(null);
  const [testState, setTestState] = useState<string | null>(null);
  const { showToast } = useToast();
  const broadcastMutation = useBroadcast();
  const testSendMutation = useTestSendNewsletter();
  const { data: templatesData, isLoading: templatesLoading } = useTemplates({ channel: 'email', approval_status: 'approved', limit: 20 });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      subject: '',
      previewText: '',
      editMode: 'blocks',
      blocks: [createBlock('paragraph')],
      htmlBody: '',
      topics: [],
      timezone: 'UTC',
      scheduledAt: '',
      testEmail: '',
      ...savedDraft?.values,
    },
  });

  const watched = form.watch();
  const editMode = watched.editMode ?? 'blocks';
  const blocks = (watched.blocks ?? []) as NewsletterBlock[];
  /** The actual sendable HTML regardless of editing path. */
  const effectiveHtml = editMode === 'blocks' ? compileBlocksToHtml(blocks) : (watched.htmlBody ?? '');
  const targeting = useMemo(
    () => ({
      ...(watched.topics?.length ? { topics: watched.topics as string[] } : {}),
      ...(watched.frequency ? { frequency: watched.frequency as NewsletterFrequency } : {}),
    }),
    [watched.topics, watched.frequency]
  );
  const { data: eligible, isLoading: eligibleLoading } = useEligibleCount(targeting);



  const persistDraft = () => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ values: form.getValues(), idempotencyKey }));
      showToast('Draft saved. Reopen to continue editing.', 'success');
    } catch {
      showToast('Could not save draft in this browser.', 'error');
    }
  };

  const applyTemplate = (templateId: string) => {
    const tpl = templatesData?.items.find((t) => t.id === templateId);
    if (!tpl) return;
    if (tpl.subject) form.setValue('subject', tpl.subject);
    // Template content is designed HTML: load it into the advanced tab and
    // switch there so the user sees exactly what will send.
    form.setValue('htmlBody', tpl.html_body ?? tpl.body);
    form.setValue('editMode', 'html');
    if (tpl.preheader) form.setValue('previewText', tpl.preheader);
    form.setValue('templateId', templateId);
  };

  const updateBlock = (id: string, patch: Partial<NewsletterBlock>) => {
    form.setValue(
      'blocks',
      blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)),
      { shouldDirty: true },
    );
  };

  const moveBlock = (id: string, dir: -1 | 1) => {
    const idx = blocks.findIndex((b) => b.id === id);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= blocks.length) return;
    const copy = [...blocks];
    [copy[idx], copy[next]] = [copy[next], copy[idx]];
    form.setValue('blocks', copy, { shouldDirty: true });
  };

  const handleTestSend = async () => {
    const to = form.getValues('testEmail');
    if (!to) {
      setTestState('Enter an explicit test address first.');
      return;
    }
    const { subject, previewText } = form.getValues();
    if (!subject.trim() || !effectiveHtml.trim()) {
      setTestState('Add a subject and content before test-sending.');
      return;
    }
    setTestState('Sending test…');
    try {
      const res = await testSendMutation.mutateAsync({ to, subject, htmlBody: effectiveHtml, previewText });
      setTestState(`Test accepted by ${res.channel}. Check ${to}.`);
    } catch (err) {
      setTestState(getApiErrorMessage(err, 'Test send failed.'));
    }
  };

  const handleSubmit = async (values: FormValues) => {
    setSendState('pending');
    setSendError(null);
    try {
      // Keep the same request identity and exact draft across modal remounts if
      // the server accepts the request but the response is lost.
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ values: form.getValues(), idempotencyKey }));
      } catch {
        // Storage can be unavailable; keep the request usable in this mount.
      }
      // Send the wall-clock value plus the selected IANA zone; the backend
      // converts the pair to the correct UTC instant (the zone affects the
      // scheduled moment, not just its label). DST gaps are rejected server-side.
      const res = await broadcastMutation.mutateAsync({
        subject: values.subject,
        htmlBody: effectiveHtml,
        ...(values.previewText ? { previewText: values.previewText } : {}),
        ...(values.topics.length ? { topics: values.topics as NewsletterTopic[] } : {}),
        ...(values.frequency ? { frequency: values.frequency } : {}),
        ...(values.scheduledAt ? { scheduledAtLocal: values.scheduledAt } : {}),
        timezone: values.timezone,
        idempotencyKey,
        ...(values.templateId ? { templateId: values.templateId } : {}),
      });
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        // Non-fatal.
      }
      setSendState('success');
      showToast(
        res.scheduledAt
          ? `Broadcast scheduled for ${new Date(res.scheduledAt).toLocaleString(undefined, { timeZone: 'UTC' })} UTC.`
          : 'Broadcast enqueued.',
      );
      onClose();
    } catch (err) {
      setSendState('failure');
      setSendError(getApiErrorMessage(err, 'Failed to enqueue broadcast.'));
    }
  };

  const previewDoc = useMemo(() => {
    const footer = `<br/><br/><hr/><p style="font-size:12px;color:#666;">You are receiving this because you subscribed to our newsletter.<br/><a href="#">Update Preferences</a> | <a href="#">Unsubscribe</a></p>`;
    const preview = watched.previewText
      ? `<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${watched.previewText.replace(/</g, '&lt;')}</span>`
      : '';
    const body = effectiveHtml || '<p style="color:#999;">Nothing to preview yet.</p>';
    return `<!doctype html><html><body style="font-family:sans-serif;line-height:1.5;color:#333;max-width:600px;margin:0 auto;padding:16px;">${preview}${body}${footer}</body></html>`;
  }, [effectiveHtml, watched.previewText]);

  const steps = ['Content', 'Preview & test', 'Recipients', 'Review & send'];
  const topicOptions: NewsletterTopic[] = ['product_updates', 'promotions', 'company_news'];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <h2 id={titleId} className="text-xl font-bold">Create newsletter</h2>
        <ol className="mt-2 flex gap-2 text-xs" aria-label="Creation steps">
          {steps.map((label, i) => (
            <li key={label} aria-current={i === step ? 'step' : undefined} className={`rounded-full px-2 py-1 ${i === step ? 'bg-slate-900 text-white' : i < step ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-500'}`}>
              {i + 1}. {label}
            </li>
          ))}
        </ol>

        <form onSubmit={form.handleSubmit(handleSubmit)} className="mt-4 space-y-4">
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <label htmlFor="nl-template" className="mb-1 block text-sm font-medium text-slate-700">Template (approved email templates)</label>
                <select
                  id="nl-template"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.watch('templateId') ?? ''}
                  onChange={(e) => applyTemplate(e.target.value)}
                >
                  <option value="">Start from scratch</option>
                  {(templatesData?.items ?? []).map((t) => (
                    <option key={t.id} value={t.id}>{t.name}{t.subject ? ` — ${t.subject}` : ''}</option>
                  ))}
                </select>
                {templatesLoading && <p className="mt-1 text-xs text-slate-500">Loading templates…</p>}
              </div>
              <div>
                <label htmlFor="nl-subject" className="mb-1 block text-sm font-medium text-slate-700">Subject</label>
                <Input id="nl-subject" {...form.register('subject')} placeholder="e.g. October product updates" />
                {form.formState.errors.subject && <p className="mt-1 text-xs text-red-600">{form.formState.errors.subject.message}</p>}
              </div>
              <div>
                <label htmlFor="nl-preview" className="mb-1 block text-sm font-medium text-slate-700">Preview text (inbox snippet)</label>
                <Input id="nl-preview" {...form.register('previewText')} placeholder="Short summary shown next to the subject" maxLength={300} />
              </div>
              <div>
                <div className="mb-2 flex items-center gap-2" role="group" aria-label="Content editing mode">
                  <Button type="button" size="sm" variant={editMode === 'blocks' ? 'default' : 'outline'} onClick={() => form.setValue('editMode', 'blocks')}>Blocks</Button>
                  <Button type="button" size="sm" variant={editMode === 'html' ? 'default' : 'outline'} onClick={() => form.setValue('editMode', 'html')}>HTML (advanced)</Button>
                </div>
                {editMode === 'blocks' ? (
                  <div className="space-y-3" aria-label="Content blocks">
                    {blocks.map((block, idx) => (
                      <fieldset key={block.id} className="rounded-lg border p-3">
                        <legend className="px-1 text-xs font-medium capitalize text-slate-500">{block.type} block {idx + 1}</legend>
                        {block.type === 'bullets' ? (
                          <div className="space-y-2">
                            {block.items.map((item, i) => (
                              <div key={i} className="flex gap-2">
                                <label className="sr-only" htmlFor={`nl-block-${block.id}-item-${i}`}>Bullet {i + 1}</label>
                                <Input
                                  id={`nl-block-${block.id}-item-${i}`}
                                  value={item}
                                  onChange={(e) => {
                                    const items = [...block.items];
                                    items[i] = e.target.value;
                                    updateBlock(block.id, { items });
                                  }}
                                  placeholder={`Bullet ${i + 1}`}
                                />
                                <Button type="button" variant="ghost" size="sm" aria-label={`Remove bullet ${i + 1}`} onClick={() => updateBlock(block.id, { items: block.items.filter((_, k) => k !== i) })}>✕</Button>
                              </div>
                            ))}
                            <Button type="button" variant="outline" size="sm" onClick={() => updateBlock(block.id, { items: [...block.items, ''] })}>+ Bullet</Button>
                          </div>
                        ) : block.type === 'button' ? (
                          <div className="grid gap-2">
                            <label className="text-xs text-slate-500" htmlFor={`nl-block-${block.id}-text`}>Button label<Input id={`nl-block-${block.id}-text`} value={block.text} onChange={(e) => updateBlock(block.id, { text: e.target.value })} placeholder="Read the update" /></label>
                            <label className="text-xs text-slate-500" htmlFor={`nl-block-${block.id}-url`}>Link URL (https://…)<Input id={`nl-block-${block.id}-url`} value={block.url} onChange={(e) => updateBlock(block.id, { url: e.target.value })} placeholder="https://example.com/post" inputMode="url" /></label>
                          </div>
                        ) : block.type === 'heading' ? (
                          <div>
                            <label className="sr-only" htmlFor={`nl-block-${block.id}-text`}>Heading text</label>
                            <Input id={`nl-block-${block.id}-text`} value={block.text} onChange={(e) => updateBlock(block.id, { text: e.target.value })} placeholder="Section heading" />
                          </div>
                        ) : (
                          <div>
                            <label className="sr-only" htmlFor={`nl-block-${block.id}-text`}>Paragraph text</label>
                            <Textarea id={`nl-block-${block.id}-text`} rows={4} value={block.text} onChange={(e) => updateBlock(block.id, { text: e.target.value })} placeholder="Write a paragraph… (blank line = new paragraph)" />
                          </div>
                        )}
                        <div className="mt-2 flex gap-1">
                          <Button type="button" variant="ghost" size="sm" aria-label={`Move ${block.type} block up`} disabled={idx === 0} onClick={() => moveBlock(block.id, -1)}>↑</Button>
                          <Button type="button" variant="ghost" size="sm" aria-label={`Move ${block.type} block down`} disabled={idx === blocks.length - 1} onClick={() => moveBlock(block.id, 1)}>↓</Button>
                          <Button type="button" variant="ghost" size="sm" aria-label={`Delete ${block.type} block`} onClick={() => form.setValue('blocks', blocks.filter((b) => b.id !== block.id), { shouldDirty: true })}>Delete</Button>
                        </div>
                      </fieldset>
                    ))}
                    <div className="flex flex-wrap gap-2" role="group" aria-label="Add a block">
                      {(['heading', 'paragraph', 'bullets', 'button'] as NewsletterBlockType[]).map((t) => (
                        <Button key={t} type="button" variant="outline" size="sm" onClick={() => form.setValue('blocks', [...blocks, createBlock(t)], { shouldDirty: true })}>+ {t}</Button>
                      ))}
                    </div>
                    {form.formState.errors.blocks && <p className="text-xs text-red-600">{form.formState.errors.blocks.message as string}</p>}
                  </div>
                ) : (
                  <div>
                    <label htmlFor="nl-body" className="mb-1 block text-sm font-medium text-slate-700">Content (HTML)</label>
                    <Textarea id="nl-body" rows={10} {...form.register('htmlBody')} placeholder="<p>Hello subscribers…</p>" aria-describedby="nl-body-help" />
                    <p id="nl-body-help" className="mt-1 text-[11px] text-slate-500">Advanced: raw HTML. Subscriber-provided values are escaped in footers. A plain-text alternative is generated automatically on send.</p>
                    {form.formState.errors.htmlBody && <p className="mt-1 text-xs text-red-600">{form.formState.errors.htmlBody.message}</p>}
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-center gap-2" role="group" aria-label="Preview device">
                <Button type="button" variant={previewMode === 'desktop' ? 'default' : 'outline'} size="sm" onClick={() => setPreviewMode('desktop')}>Desktop</Button>
                <Button type="button" variant={previewMode === 'mobile' ? 'default' : 'outline'} size="sm" onClick={() => setPreviewMode('mobile')}>Mobile</Button>
              </div>
              <div className={`mx-auto overflow-hidden rounded-lg border ${previewMode === 'mobile' ? 'max-w-[375px]' : 'max-w-full'}`}>
                <iframe title={`Email preview (${previewMode})`} sandbox="" srcDoc={previewDoc} className="h-80 w-full bg-white" />
              </div>
              <details className="rounded-lg border p-3 text-sm">
                <summary className="cursor-pointer font-medium">Plain-text alternative</summary>
                <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-600">{stripToText(effectiveHtml)}</pre>
              </details>
              <div className="rounded-lg border p-3">
                <label htmlFor="nl-test-email" className="mb-1 block text-sm font-medium text-slate-700">Test email to an explicitly selected address</label>
                <div className="flex gap-2">
                  <Input id="nl-test-email" type="email" placeholder="you@example.com" {...form.register('testEmail')} />
                  <Button type="button" variant="outline" onClick={handleTestSend} disabled={testSendMutation.isPending}>
                    {testSendMutation.isPending ? <LoadingSpinner /> : 'Send test'}
                  </Button>
                </div>
                {testState && <p className="mt-2 text-xs text-slate-600" role="status">{testState}</p>}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <fieldset>
                <legend className="text-sm font-medium text-slate-700">Topics (optional targeting)</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {topicOptions.map((topic) => (
                    <label key={topic} className="flex items-center gap-1 rounded-full border px-3 py-1 text-xs">
                      <input
                        type="checkbox"
                        checked={(form.watch('topics') ?? []).includes(topic)}
                        onChange={(e) => {
                          const current = form.getValues('topics') ?? [];
                          form.setValue('topics', e.target.checked ? [...current, topic] : current.filter((t) => t !== topic));
                        }}
                      />
                      {topic}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div>
                <label htmlFor="nl-frequency" className="mb-1 block text-sm font-medium text-slate-700">Frequency (optional targeting)</label>
                <select
                  id="nl-frequency"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.watch('frequency') ?? ''}
                  onChange={(e) => form.setValue('frequency', (e.target.value || undefined) as NewsletterFrequency | undefined)}
                >
                  <option value="">All frequencies (manual broadcast default)</option>
                  <option value="daily">daily</option>
                  <option value="weekly">weekly</option>
                  <option value="monthly">monthly</option>
                </select>
              </div>
              <div className="rounded-lg bg-slate-50 p-3 text-sm" role="status" aria-live="polite">
                {eligibleLoading ? 'Counting eligible recipients…' : (
                  <>
                    <strong>{eligible?.eligible ?? 0}</strong> eligible recipient(s) — confirmed subscribers only.
                    Pending, unsubscribed, and suppressed recipients are always excluded and rechecked before dispatch.
                    Manual broadcasts send to the selected segment now (or at the scheduled time); automated digests separately respect frequency preferences.
                  </>
                )}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4 text-sm">
              <dl className="grid gap-2 rounded-lg border p-4">
                <div className="flex justify-between gap-4"><dt className="text-slate-500">From</dt><dd className="text-right">Configured SendGrid/SMTP default sender</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-slate-500">Recipients</dt><dd className="text-right">{eligibleLoading ? '…' : `${eligible?.eligible ?? 0} eligible (confirmed only)`}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-slate-500">Subject</dt><dd className="text-right font-medium">{watched.subject || '—'}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-slate-500">Timing</dt><dd className="text-right">{watched.scheduledAt ? `${new Date(watched.scheduledAt).toLocaleString()} (${watched.timezone})` : 'Send now'}</dd></div>
              </dl>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="nl-schedule" className="mb-1 block text-sm font-medium text-slate-700">Schedule (optional)</label>
                  <Input id="nl-schedule" type="datetime-local" {...form.register('scheduledAt')} />
                </div>
                <div>
                  <label htmlFor="nl-timezone" className="mb-1 block text-sm font-medium text-slate-700">Timezone</label>
                  <select id="nl-timezone" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" {...form.register('timezone')}>
                    {TIMEZONES.map((tz) => (<option key={tz} value={tz}>{tz}</option>))}
                  </select>
                </div>
              </div>
              {sendState === 'failure' && sendError && <p className="text-sm text-red-600" role="alert">{sendError}</p>}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <Button type="button" variant="ghost" onClick={persistDraft}>Save draft</Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              {step > 0 && <Button type="button" variant="outline" onClick={() => setStep(step - 1)}>Back</Button>}
              {step < 3 && (
                <Button
                  type="button"
                  onClick={async () => {
                    if (step === 0) {
                      const valid = await form.trigger(['subject', 'blocks', 'htmlBody']);
                      if (!valid) return;
                    }
                    setStep(step + 1);
                  }}
                >
                  Continue
                </Button>
              )}
              {step === 3 && (
                <Button type="submit" disabled={sendState === 'pending' || broadcastMutation.isPending}>
                  {sendState === 'pending' ? 'Sending…' : watched.scheduledAt ? 'Schedule broadcast' : 'Send now'}
                </Button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

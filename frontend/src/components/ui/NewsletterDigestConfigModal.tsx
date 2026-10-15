import { useModalFocus } from '@/hooks/useModalFocus';
import { useEffect, useId, useState } from 'react';
import { Button } from './button';
import { Input } from './input';
import { Textarea } from './textarea';
import { Sparkles, Save } from 'lucide-react';
import {
  useDigestConfig,
  useUpdateDigestConfig,
  useDigestStatus,
  useDigestDraft,
  useSaveDigestDraft,
  useApproveDigestDraft,
  useSetDigestAutoSend,
  type NewsletterDigestConfig,
} from '@/api/newsletter';
import { useToast } from '@/components/ui/Toast';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { getApiErrorMessage } from '@/lib/apiError';

interface Props {
  onClose: () => void;
}

export function NewsletterDigestConfigModal({ onClose }: Props) {
  const titleId = useId();
  const dialogRef = useModalFocus(onClose);
  const { data: config, isLoading } = useDigestConfig();
  const { data: status, isLoading: statusLoading } = useDigestStatus();
  const { data: draftState, isLoading: draftLoading } = useDigestDraft();
  const updateMutation = useUpdateDigestConfig();
  const saveDraftMutation = useSaveDigestDraft();
  const approveMutation = useApproveDigestDraft();
  const autoSendMutation = useSetDigestAutoSend();
  const { showToast } = useToast();

  const [formData, setFormData] = useState<NewsletterDigestConfig>({
    topic: 'Weekly Sales Tips & Growth Hacks',
    tone: 'professional',
    customPrompt: 'Provide actionable sales techniques and productivity advice.',
    targetAudience: 'Sales reps and business professionals',
  });
  const [draftDirty, setDraftDirty] = useState(false);
  const [configDirty, setConfigDirty] = useState(false);
  const [draftEdits, setDraftEdits] = useState({ subject: '', htmlBody: '' });

  useEffect(() => {
    if (config && !configDirty) setFormData(config);
  }, [config, configDirty]);

  useEffect(() => {
    if (draftState?.draft && !draftDirty) {
      setDraftEdits({ subject: draftState.draft.subject, htmlBody: draftState.draft.htmlBody });
    }
  }, [draftState?.draft, draftDirty]);



  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.topic.trim()) {
      showToast('Please provide a digest topic.', 'error');
      return;
    }
    try {
      await updateMutation.mutateAsync(formData);
      showToast('AI Digest settings updated successfully!');
      onClose();
    } catch {
      showToast('Failed to save AI Digest settings.', 'error');
    }
  };

  const handleSaveDraftEdits = async () => {
    try {
      await saveDraftMutation.mutateAsync(draftEdits);
      setDraftDirty(false);
      showToast('Draft saved for review.');
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to save draft.'), 'error');
    }
  };

  const handleApprove = async () => {
    try {
      await approveMutation.mutateAsync();
      showToast('Draft approved and broadcast enqueued.');
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to approve draft.'), 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation">
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-primary/10 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h2 id={titleId} className="text-xl font-bold text-slate-900">AI Digest Settings</h2>
            <p className="text-xs text-slate-500">Customize the topic, tone, and guidelines for Friday AI newsletters.</p>
          </div>
        </div>

        {/* Status group: enabled state, schedule, last outcome — all from real backend data */}
        <section aria-label="Digest status" className="mt-4 rounded-lg border bg-slate-50 p-4 text-sm">
          {statusLoading ? (
            <p className="flex items-center gap-2 text-slate-500"><LoadingSpinner /> Loading digest status…</p>
          ) : status ? (
            <dl className="grid gap-1">
              <div className="flex justify-between"><dt className="text-slate-500">Enabled</dt><dd className="font-medium">{status.enabled ? 'On' : 'Off'}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Schedule</dt><dd>{status.schedule} · {status.timezone}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Next run</dt><dd>{status.enabled ? (status.nextRunAt ? new Date(status.nextRunAt).toLocaleString() : 'Not reported by scheduler') : '— (disabled)'}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-slate-500">Last outcome</dt><dd className="text-right">{status.lastOutcome.status.replace('_', ' ')} — {status.lastOutcome.message}{status.lastOutcome.at ? ` (${new Date(status.lastOutcome.at).toLocaleString()})` : ''}</dd></div>
              <div className="flex items-center justify-between gap-4 pt-2">
                <dt className="text-slate-500">Automatic sending <span className="block text-[11px]">Off = drafts for human review (default). On = send to daily + weekly confirmed subscribers.</span></dt>
                <dd>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={draftState?.autoSend ?? status.autoSend}
                      onChange={(e) => autoSendMutation.mutate({ autoSend: e.target.checked })}
                      aria-label="Automatically send AI digest without review"
                    />
                    Auto-send
                  </label>
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-slate-500">Digest status is currently unavailable.</p>
          )}
        </section>

        {/* Review group: preview / edit / approve before sending */}
        <section aria-label="Digest draft review" className="mt-4 rounded-lg border p-4">
          <h3 className="text-sm font-semibold">Review draft</h3>
          {draftLoading ? (
            <p className="mt-2 flex items-center gap-2 text-sm text-slate-500"><LoadingSpinner /> Loading draft…</p>
          ) : draftState?.draft ? (
            <div className="mt-2 space-y-3">
              <p className="text-xs text-slate-500">Status: {draftState.draft.status} · Updated {new Date(draftState.draft.updatedAt).toLocaleString()}</p>
              <div>
                <label htmlFor="digest-draft-subject" className="mb-1 block text-sm font-medium text-slate-700">Subject</label>
                <Input id="digest-draft-subject" value={draftEdits.subject} onChange={(e) => { setDraftDirty(true); setDraftEdits({ ...draftEdits, subject: e.target.value }); }} />
              </div>
              <div>
                <label htmlFor="digest-draft-body" className="mb-1 block text-sm font-medium text-slate-700">Content</label>
                <Textarea id="digest-draft-body" rows={6} value={draftEdits.htmlBody} onChange={(e) => { setDraftDirty(true); setDraftEdits({ ...draftEdits, htmlBody: e.target.value }); }} />
              </div>
              {draftDirty && <p className="text-sm text-amber-800" role="status">Save edits before approving this draft.</p>}
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={handleSaveDraftEdits} disabled={saveDraftMutation.isPending}>Save edits</Button>
                <Button type="button" onClick={handleApprove} disabled={draftDirty || saveDraftMutation.isPending || approveMutation.isPending || draftState.draft.status !== 'draft'}>{approveMutation.isPending ? 'Approving…' : 'Approve & send'}</Button>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-500">No AI draft yet. Friday runs generate a draft for review here; nothing sends automatically unless auto-send is on.</p>
          )}
        </section>

        {isLoading ? (
          <div className="py-8 flex justify-center">
            <LoadingSpinner />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div>
              <label htmlFor="digest-topic" className="mb-1 block text-sm font-medium text-slate-700">Digest Topic / Title</label>
              <Input
                id="digest-topic"
                value={formData.topic}
                onChange={(e) => { setConfigDirty(true); setFormData({ ...formData, topic: e.target.value }); }}
                placeholder="e.g. Weekly Sales Strategy & Prospecting Hacks"
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="digest-tone" className="mb-1 block text-sm font-medium text-slate-700">Tone of Voice</label>
                <select
                  id="digest-tone"
                  value={formData.tone}
                  onChange={(e) =>
                    { setConfigDirty(true); setFormData({ ...formData, tone: e.target.value as NewsletterDigestConfig['tone'] }); }
                  }
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="professional">Professional & Direct</option>
                  <option value="casual">Casual & Friendly</option>
                  <option value="motivational">Motivational & High Energy</option>
                  <option value="technical">Technical & In-Depth</option>
                </select>
              </div>

              <div>
                <label htmlFor="digest-audience" className="mb-1 block text-sm font-medium text-slate-700">Target Audience</label>
                <Input
                  id="digest-audience"
                  value={formData.targetAudience}
                  onChange={(e) => { setConfigDirty(true); setFormData({ ...formData, targetAudience: e.target.value }); }}
                  placeholder="e.g. B2B Account Executives"
                />
              </div>
            </div>

            <div>
              <label htmlFor="digest-prompt" className="mb-1 block text-sm font-medium text-slate-700">Custom Content Prompt & Instructions</label>
              <Textarea
                id="digest-prompt"
                value={formData.customPrompt}
                onChange={(e) => { setConfigDirty(true); setFormData({ ...formData, customPrompt: e.target.value }); }}
                placeholder="e.g. Include 3 actionable tips for closing deals faster and 1 weekly objection handling template."
                rows={4}
              />
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button type="button" variant="outline" onClick={onClose} disabled={updateMutation.isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateMutation.isPending} className="gap-2">
                <Save className="h-4 w-4" />
                {updateMutation.isPending ? 'Saving...' : 'Save Settings'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { usePreviewTemplate, useTestSendTemplate } from '@/api/templates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
import { Monitor, Smartphone, X, Send, AlertTriangle } from 'lucide-react';

/**
 * Server-authoritative template preview.
 * HTML renders inside a sandboxed iframe (sandbox="" blocks scripts and any
 * access to the application session). The notice labels previews as
 * approximations — never a guarantee of identical client rendering.
 */
export function TemplatePreviewModal({
  templateId,
  templateName,
  onClose,
}: {
  templateId: string;
  templateName: string;
  onClose: () => void;
}) {
  const preview = usePreviewTemplate();
  const [width, setWidth] = useState<'desktop' | 'mobile'>('desktop');
  const [tab, setTab] = useState<'design' | 'text'>('design');

  useEffect(() => {
    preview.mutate({ id: templateId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  const data = preview.data;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={`Preview ${templateName}`}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-slate-900">Preview — {templateName}</h3>
            <p className="text-xs text-slate-500">Fictional sample values. Approximates rendering; email clients may differ.</p>
          </div>
          <div className="flex items-center gap-1">
            <Button variant={width === 'desktop' ? 'default' : 'ghost'} size="sm" onClick={() => setWidth('desktop')} aria-label="Desktop preview" aria-pressed={width === 'desktop'}>
              <Monitor className="h-4 w-4" />
            </Button>
            <Button variant={width === 'mobile' ? 'default' : 'ghost'} size="sm" onClick={() => setWidth('mobile')} aria-label="Mobile preview" aria-pressed={width === 'mobile'}>
              <Smartphone className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close preview">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex gap-1 border-b border-slate-100 px-4 pt-2">
          <button type="button" onClick={() => setTab('design')} className={`rounded-t px-3 py-1.5 text-xs font-medium ${tab === 'design' ? 'bg-slate-100 text-slate-900' : 'text-slate-500'}`}>Design</button>
          <button type="button" onClick={() => setTab('text')} className={`rounded-t px-3 py-1.5 text-xs font-medium ${tab === 'text' ? 'bg-slate-100 text-slate-900' : 'text-slate-500'}`}>Plain text</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-100 p-4">
          {preview.isPending && <p className="text-sm text-slate-500" role="status">Rendering preview…</p>}
          {preview.isError && <p role="alert" className="text-sm text-red-600">{getApiErrorMessage(preview.error, 'Failed to render preview.')}</p>}
          {data && (
            <div className="space-y-3">
              {(data.invalidVariables.length > 0 || data.unsafeLinks.length > 0) && (
                <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {data.invalidVariables.length > 0 && <p>Unknown variables: {data.invalidVariables.map((v) => `{{${v}}}`).join(', ')}</p>}
                  {data.unsafeLinks.length > 0 && <p>Unsafe links removed at send time: {data.unsafeLinks.slice(0, 3).join(', ')}</p>}
                </div>
              )}
              {data.compliance.warnings.length > 0 && (
                <div className="flex items-start gap-2 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div>{data.compliance.warnings.map((w) => <p key={w}>{w}</p>)}</div>
                </div>
              )}
              {data.subject && (
                <div className="rounded-md bg-white px-3 py-2 text-sm">
                  <span className="font-medium text-slate-900">Subject: </span>
                  <span className="text-slate-700">{data.subject}</span>
                </div>
              )}
              {tab === 'design' && data.html && (
                <div className={`mx-auto overflow-hidden rounded-md bg-white shadow ${width === 'mobile' ? 'max-w-[375px]' : 'max-w-full'}`}>
                  <iframe sandbox="" srcDoc={data.html} title="Email preview (isolated)" className="h-[480px] w-full border-0" />
                </div>
              )}
              {tab === 'design' && !data.html && (
                <pre className="whitespace-pre-wrap rounded-md bg-white p-4 text-sm text-slate-700">{data.text}</pre>
              )}
              {tab === 'text' && (
                <pre className="whitespace-pre-wrap rounded-md bg-white p-4 text-sm text-slate-700">{data.text}</pre>
              )}
              <p className="text-[11px] text-slate-400">{data.notice}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Isolated test email. Sends only to the explicitly entered recipient via the
 * existing authorized delivery chain — never enrolls campaigns, touches
 * pipelines, or triggers automation.
 */
export function TestSendModal({
  templateId,
  onClose,
}: {
  templateId: string;
  onClose: () => void;
}) {
  const [to, setTo] = useState('');
  const [error, setError] = useState('');
  const testSend = useTestSendTemplate();
  const { showToast } = useToast();

  const handleSend = async () => {
    const trimmed = to.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Enter a valid recipient email address.');
      return;
    }
    setError('');
    try {
      const result = await testSend.mutateAsync({ id: templateId, to: trimmed });
      showToast(`Test email sent to ${result.to}. No campaign or lead was affected.`, 'success');
      onClose();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to send test email.'));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Send test email">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-slate-900">Send test email</h2>
        <p className="mt-1 text-sm text-slate-500">
          Sends this template once to an address you control, with fictional sample values.
          It does not enroll any campaign or change any lead.
        </p>
        <div className="mt-4 space-y-1.5">
          <Label htmlFor="test-send-to">Recipient email *</Label>
          <Input id="test-send-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@example.com" />
          {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
          {testSend.data?.warnings?.map((w) => (
            <p key={w} className="text-xs text-amber-700">{w}</p>
          ))}
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSend} disabled={testSend.isPending}>
            <Send className="mr-2 h-4 w-4" />
            {testSend.isPending ? 'Sending…' : 'Send test'}
          </Button>
        </div>
      </div>
    </div>
  );
}

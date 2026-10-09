import { useMemo, useRef } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { VARIABLE_CATALOG, WHATSAPP_TEXT_LIMIT, estimateSmsSegmentsClient, validateWhatsappClient } from '@/lib/emailDesign';
import { extractVariables } from '@/lib/templateVars';

/**
 * WhatsApp structured editor. Uses only provider-supported components —
 * free text (Cloud API `type: text`, 4096 chars), {{variables}}, one media
 * attachment (handled by the Attachments panel), and link-style buttons
 * appended as text. No email layout controls appear here.
 */
export function WhatsappEditor({ body, onChange, attachmentCount, error }: {
  body: string;
  onChange: (v: string) => void;
  attachmentCount: number;
  error?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const check = useMemo(() => validateWhatsappClient(body, attachmentCount), [body, attachmentCount]);
  const vars = extractVariables(body);

  const insertVar = (name: string) => {
    const el = ref.current;
    const token = `{{${name}}}`;
    if (!el) return onChange(`${body}${token}`);
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    onChange(`${body.slice(0, start)}${token}${body.slice(end)}`);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor="wa-body">Message body *</Label>
        <span className={`text-xs tabular-nums ${body.length > WHATSAPP_TEXT_LIMIT ? 'font-medium text-red-600' : 'text-slate-500'}`} role="status">
          {body.length} / {WHATSAPP_TEXT_LIMIT}
        </span>
      </div>
      <p className="text-xs text-slate-500">
        Sent through the WhatsApp Cloud API as a text message{attachmentCount > 0 ? ' with your first attachment as media' : ''}.
        Approved templates are required before use in sequences — approval status is shown in the gallery.
      </p>
      <div className="flex flex-wrap gap-1" aria-label="Insert WhatsApp variable">
        {VARIABLE_CATALOG.filter((v) => v !== 'unsubscribe_link').map((v) => (
          <button key={v} type="button" onClick={() => insertVar(v)} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700 hover:bg-slate-200" title={`Insert {{${v}}}`}>
            {`{{${v}}}`}
          </button>
        ))}
      </div>
      <Textarea id="wa-body" ref={ref} value={body} rows={7} onChange={(e) => onChange(e.target.value)} placeholder="Hi {{contact_name}}, this is [your name] from [company]…" aria-invalid={check.errors.length > 0} />
      {error && <p className="text-xs text-red-600">{error}</p>}
      {check.errors.map((e) => <p key={e} role="alert" className="text-xs text-red-600">{e}</p>)}
      {check.warnings.map((w) => <p key={w} className="text-xs text-amber-700">{w}</p>)}
      {vars.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {vars.map((v) => <code key={v} className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">{`{{${v}}}`}</code>)}
        </div>
      )}
    </div>
  );
}

/**
 * SMS plain-text editor with encoding-aware character counting and segment
 * estimates (GSM-7 vs UCS-2). No layout controls — text only.
 */
export function SmsEditor({ body, onChange, error }: {
  body: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const est = useMemo(() => estimateSmsSegmentsClient(body), [body]);
  const vars = extractVariables(body);

  const insertVar = (name: string) => {
    const el = ref.current;
    const token = `{{${name}}}`;
    if (!el) return onChange(`${body}${token}`);
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    onChange(`${body.slice(0, start)}${token}${body.slice(end)}`);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor="sms-body">Message body *</Label>
        <span className="text-xs tabular-nums text-slate-500" role="status">
          {est.characters} chars · {est.encoding} · {est.segments} segment{est.segments === 1 ? '' : 's'}
          {est.segments > 0 && ` (${est.remainingInSegment} left)`}
        </span>
      </div>
      <p className="text-xs text-slate-500">Plain text only — sent via Twilio. Keep it short: each segment is billed separately.</p>
      <div className="flex flex-wrap gap-1" aria-label="Insert SMS variable">
        {VARIABLE_CATALOG.filter((v) => v !== 'unsubscribe_link').map((v) => (
          <button key={v} type="button" onClick={() => insertVar(v)} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700 hover:bg-slate-200" title={`Insert {{${v}}}`}>
            {`{{${v}}}`}
          </button>
        ))}
      </div>
      <Textarea id="sms-body" ref={ref} value={body} rows={5} onChange={(e) => onChange(e.target.value)} placeholder="Hi {{first_name}}, quick note from [company]…" />
      {error && <p className="text-xs text-red-600">{error}</p>}
      {est.segments > 1 && <p className="text-xs text-amber-700">This message will send as {est.segments} concatenated segments.</p>}
      {est.encoding === 'UCS-2' && <p className="text-xs text-amber-700">Contains non-GSM characters (e.g. emoji) — UCS-2 encoding fits fewer characters per segment.</p>}
      {vars.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {vars.map((v) => <code key={v} className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">{`{{${v}}}`}</code>)}
        </div>
      )}
      <details className="rounded-md bg-slate-50 px-2 py-1.5 text-[11px] text-slate-500">
        <summary className="cursor-pointer font-medium text-slate-600">How are segments counted?</summary>
        <p className="pt-1">GSM-7 allows 160 characters in one segment and 153 per segment when concatenated. Unicode (UCS-2) allows 70 in one segment and 67 per concatenated segment. Some GSM-7 extension characters count as two.</p>
      </details>
    </div>
  );
}

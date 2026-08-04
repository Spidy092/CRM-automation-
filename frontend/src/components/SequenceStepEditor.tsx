import { useState } from 'react';
import { useCreateTemplate, useTemplates } from '@/api/templates';
import type { Sequence, SequenceStep } from '@/api/outreach';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
import { extractVariables } from '@/lib/templateVars';
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Mail,
  MessageSquare,
  Pencil,
  Phone,
  Zap,
  AlertTriangle,
} from 'lucide-react';

// ── Channel presentation (shared across sequence UIs) ──────────────────────

export const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  whatsapp: <MessageSquare className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />,
  email: <Mail className="h-4 w-4 text-blue-600 dark:text-blue-400" />,
  sms: <Zap className="h-4 w-4 text-amber-600 dark:text-amber-400" />,
  phone_call: <Phone className="h-4 w-4 text-purple-600 dark:text-purple-400" />,
};

export const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  email: 'Email',
  sms: 'SMS',
  phone_call: 'Phone Call (manual task)',
};

export const CHANNEL_COLORS: Record<string, string> = {
  whatsapp: 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800/60 text-emerald-900 dark:text-emerald-200',
  email: 'bg-blue-50 dark:bg-blue-950/60 border-blue-200 dark:border-blue-800/60 text-blue-900 dark:text-blue-200',
  sms: 'bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-200',
  phone_call: 'bg-purple-50 dark:bg-purple-950/60 border-purple-200 dark:border-purple-800/60 text-purple-900 dark:text-purple-200',
};

/** Every step must reference a template — the backend rejects steps without one. */
export function stepsAreComplete(steps: SequenceStep[]): boolean {
  return steps.length > 0 && steps.every((step) => Boolean(step.templateId));
}

// ── Inline template composer ────────────────────────────────────────────────

/**
 * Writes and saves a template without leaving the sequence editor. Templates created by
 * a role that could approve them land approved server-side, so the new message is
 * immediately selectable here — no trip to the Templates page.
 */
function InlineTemplateComposer({
  channel,
  onCreated,
  onCancel,
}: {
  channel: SequenceStep['channel'];
  onCreated: (templateId: string) => void;
  onCancel: () => void;
}) {
  const createTemplate = useCreateTemplate();
  const { showToast } = useToast();
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const needsSubject = channel === 'email';
  const canSave = name.trim() !== '' && body.trim() !== '' && (!needsSubject || subject.trim() !== '');

  const handleSave = async () => {
    if (!canSave) return;
    try {
      const created = await createTemplate.mutateAsync({
        name: name.trim(),
        channel,
        subject: needsSubject ? subject.trim() : null,
        body: body.trim(),
        variables: extractVariables(body),
      });
      showToast('Message saved and attached to this step.', 'success');
      onCreated(created.id);
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to save the message.'), 'error');
    }
  };

  return (
    <div className="mt-2 space-y-2 rounded-md border border-indigo-200 bg-white p-3">
      <div className="space-y-1">
        <Label className="text-xs text-slate-500">Name (internal)</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`${CHANNEL_LABELS[channel] ?? channel} — step message`}
          className="h-8 text-xs"
        />
      </div>

      {needsSubject && (
        <div className="space-y-1">
          <Label className="text-xs text-slate-500">Subject</Label>
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Quick question about {{company}}"
            className="h-8 text-xs"
          />
        </div>
      )}

      <div className="space-y-1">
        <Label className="text-xs text-slate-500">Message</Label>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          placeholder={'Hi {{first_name}},\n\n...'}
          className="text-xs"
        />
        <p className="text-xs text-slate-500">
          Use <code className="rounded bg-slate-100 px-1">{'{{merge_field}}'}</code> for
          personalisation — e.g. <code className="rounded bg-slate-100 px-1">{'{{first_name}}'}</code>.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={handleSave} disabled={!canSave || createTemplate.isPending}>
          {createTemplate.isPending ? 'Saving…' : 'Save & use'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ── Step editor ─────────────────────────────────────────────────────────────

export function SequenceStepEditor({
  steps,
  onChange,
}: {
  steps: SequenceStep[];
  onChange: (steps: SequenceStep[]) => void;
}) {
  const { data: templatesData } = useTemplates({ approval_status: 'approved' });
  const templates = templatesData?.items ?? [];
  // Index of the step whose inline "write a new message" composer is open, if any.
  const [composingFor, setComposingFor] = useState<number | null>(null);

  const addStep = () => {
    const nextNumber = steps.length + 1;
    onChange([
      ...steps,
      {
        stepNumber: nextNumber,
        channel: 'email',
        delayHours: nextNumber === 1 ? 0 : 24,
        templateId: null,
      },
    ]);
  };

  const removeStep = (index: number) => {
    const updated = steps
      .filter((_, i) => i !== index)
      .map((s, i) => ({ ...s, stepNumber: i + 1 }));
    onChange(updated);
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    const updated = [...steps];
    [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
    onChange(updated.map((s, i) => ({ ...s, stepNumber: i + 1 })));
  };

  const moveDown = (index: number) => {
    if (index === steps.length - 1) return;
    const updated = [...steps];
    [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
    onChange(updated.map((s, i) => ({ ...s, stepNumber: i + 1 })));
  };

  const updateStep = (index: number, field: keyof SequenceStep, value: unknown) => {
    const updated = steps.map((s, i) => (i === index ? { ...s, [field]: value } : s));
    onChange(updated);
  };

  /**
   * Templates are channel-specific, so a step's existing template stops being valid
   * the moment its channel changes — clear it rather than leave a stale id that the
   * dropdown cannot display but the payload would still submit.
   */
  const updateChannel = (index: number, channel: SequenceStep['channel']) => {
    const updated = steps.map((s, i) => (i === index ? { ...s, channel, templateId: null } : s));
    onChange(updated);
    setComposingFor(null);
  };

  return (
    <div className="space-y-3">
      {steps.map((step, i) => {
        const channelTemplates = templates.filter((template) => template.channel === step.channel);
        return (
          <div
            key={i}
            className={`rounded-lg border p-3 ${CHANNEL_COLORS[step.channel] ?? 'bg-slate-50 border-slate-200'}`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold shadow-sm">
                  {step.stepNumber}
                </span>
                {CHANNEL_ICONS[step.channel]}
                <span className="text-sm font-medium text-slate-700">
                  {CHANNEL_LABELS[step.channel]}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => moveUp(i)}
                  disabled={i === 0}
                  className="rounded p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30"
                  aria-label="Move up"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => moveDown(i)}
                  disabled={i === steps.length - 1}
                  className="rounded p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30"
                  aria-label="Move down"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => removeStep(i)}
                  className="rounded p-0.5 text-red-400 hover:text-red-600"
                  aria-label="Remove step"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs text-slate-500">Channel</Label>
                <select
                  value={step.channel}
                  onChange={(e) => updateChannel(i, e.target.value as SequenceStep['channel'])}
                  className="flex h-8 w-full rounded-md border border-input bg-white px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="whatsapp">WhatsApp</option>
                  <option value="email">Email</option>
                  <option value="sms">SMS</option>
                  <option value="phone_call">Phone Call (manual)</option>
                </select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-slate-500">
                  {i === 0 ? 'Delay (hours, 0 = immediate)' : 'Delay after previous (hours)'}
                </Label>
                <Input
                  type="number"
                  min={0}
                  value={step.delayHours}
                  onChange={(e) => updateStep(i, 'delayHours', Number(e.target.value))}
                  className="h-8 text-xs"
                />
              </div>

              <div className="col-span-1 space-y-1 sm:col-span-2">
                <Label className="text-xs text-slate-500">Message *</Label>

                {channelTemplates.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No {CHANNEL_LABELS[step.channel] ?? step.channel} messages saved yet — write the
                    first one below.
                  </p>
                ) : (
                  <div className="flex items-center gap-2">
                    <select
                      value={step.templateId ?? ''}
                      onChange={(e) => updateStep(i, 'templateId', e.target.value || null)}
                      className={`flex h-8 w-full rounded-md border px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                        step.templateId ? 'border-input bg-white' : 'border-amber-400 bg-amber-50'
                      }`}
                    >
                      <option value="">Select a saved message</option>
                      {channelTemplates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {composingFor === i ? (
                  <InlineTemplateComposer
                    channel={step.channel}
                    onCreated={(templateId) => {
                      updateStep(i, 'templateId', templateId);
                      setComposingFor(null);
                    }}
                    onCancel={() => setComposingFor(null)}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setComposingFor(i)}
                    className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-indigo-700 underline-offset-2 hover:underline"
                  >
                    <Pencil className="h-3 w-3" />
                    Write a new message
                  </button>
                )}

                {!step.templateId && composingFor !== i && (
                  <p className="flex items-center gap-1 text-xs text-amber-700">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    This step needs a message before the sequence can be saved.
                  </p>
                )}
              </div>
            </div>

            {step.channel === 'phone_call' && (
              <p className="mt-2 text-xs text-purple-600">
                ⚡ Phone call steps create a task for the assigned rep — no message is auto-sent.
              </p>
            )}
          </div>
        );
      })}

      <Button type="button" variant="outline" size="sm" onClick={addStep} className="w-full">
        <Plus className="mr-1 h-3.5 w-3.5" />
        Add Step
      </Button>
    </div>
  );
}

// ── Sequence form (name + steps) ────────────────────────────────────────────

export function SequenceForm({
  initial,
  onSave,
  onCancel,
  isPending,
}: {
  initial?: Sequence;
  onSave: (name: string, steps: SequenceStep[], description?: string) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [steps, setSteps] = useState<SequenceStep[]>(
    initial?.steps ?? [{ stepNumber: 1, channel: 'whatsapp', delayHours: 0, templateId: null }],
  );

  const complete = stepsAreComplete(steps);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !complete) return;
    onSave(name.trim(), steps, description.trim() || undefined);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="seq-name">Sequence Name *</Label>
        <Input
          id="seq-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., 3-Step Restaurant Outreach"
          required
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="seq-description">Description <span className="text-xs font-normal text-slate-400">(optional)</span></Label>
        <textarea
          id="seq-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe what this sequence is for…"
          rows={2}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
      </div>

      <div className="space-y-2">
        <Label>Steps (WhatsApp → Email → SMS → Phone Call)</Label>
        <SequenceStepEditor steps={steps} onChange={setSteps} />
      </div>

      {!complete && steps.length > 0 && (
        <p className="text-xs text-amber-700">
          Every step needs an approved template before the sequence can be saved.
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending || !name.trim() || !complete}>
          {isPending ? 'Saving…' : initial ? 'Save Changes' : 'Create Sequence'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

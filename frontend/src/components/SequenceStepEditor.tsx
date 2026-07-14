import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTemplates } from '@/api/templates';
import type { Sequence, SequenceStep } from '@/api/outreach';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Mail,
  MessageSquare,
  Phone,
  Zap,
  AlertTriangle,
} from 'lucide-react';

// ── Channel presentation (shared across sequence UIs) ──────────────────────

export const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  whatsapp: <MessageSquare className="h-4 w-4 text-emerald-600" />,
  email: <Mail className="h-4 w-4 text-blue-600" />,
  sms: <Zap className="h-4 w-4 text-amber-600" />,
  phone_call: <Phone className="h-4 w-4 text-purple-600" />,
};

export const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  email: 'Email',
  sms: 'SMS',
  phone_call: 'Phone Call (manual task)',
};

export const CHANNEL_COLORS: Record<string, string> = {
  whatsapp: 'bg-emerald-50 border-emerald-200',
  email: 'bg-blue-50 border-blue-200',
  sms: 'bg-amber-50 border-amber-200',
  phone_call: 'bg-purple-50 border-purple-200',
};

/** Every step must reference a template — the backend rejects steps without one. */
export function stepsAreComplete(steps: SequenceStep[]): boolean {
  return steps.length > 0 && steps.every((step) => Boolean(step.templateId));
}

// ── Step editor ─────────────────────────────────────────────────────────────

export function SequenceStepEditor({
  steps,
  onChange,
}: {
  steps: SequenceStep[];
  onChange: (steps: SequenceStep[]) => void;
}) {
  const { data: templates = [] } = useTemplates({ approval_status: 'approved' });
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
                  onChange={(e) =>
                    updateStep(i, 'channel', e.target.value as SequenceStep['channel'])
                  }
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
                <Label className="text-xs text-slate-500">Approved Template *</Label>
                {channelTemplates.length === 0 ? (
                  <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      No approved {CHANNEL_LABELS[step.channel] ?? step.channel} templates yet.{' '}
                      <Link to="/templates/new" className="font-medium underline">
                        Create one
                      </Link>{' '}
                      and get it approved on the{' '}
                      <Link to="/templates" className="font-medium underline">
                        Templates page
                      </Link>
                      .
                    </span>
                  </div>
                ) : (
                  <>
                    <select
                      value={step.templateId ?? ''}
                      onChange={(e) => updateStep(i, 'templateId', e.target.value || null)}
                      className={`flex h-8 w-full rounded-md border px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                        step.templateId ? 'border-input bg-white' : 'border-amber-400 bg-amber-50'
                      }`}
                    >
                      <option value="">Select approved template</option>
                      {channelTemplates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </select>
                    {!step.templateId && (
                      <p className="text-xs text-amber-700">A template is required for this step.</p>
                    )}
                  </>
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

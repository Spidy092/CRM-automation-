import { useState } from 'react';
import {
  useSequences,
  useCreateSequence,
  useUpdateSequence,
  useDeleteSequence,
  useOutreachTasks,
} from '@/api/outreach';
import type { Sequence, SequenceStep } from '@/api/outreach';
import { useTemplates } from '@/api/templates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingTable } from '@/components/ui/LoadingTable';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { Plus, Trash2, Edit2, ChevronDown, ChevronUp, Mail, MessageSquare, Phone, Zap } from 'lucide-react';

// ── Channel icon ────────────────────────────────────────────────────────────

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  whatsapp: <MessageSquare className="h-4 w-4 text-green-600" />,
  email: <Mail className="h-4 w-4 text-blue-600" />,
  sms: <Zap className="h-4 w-4 text-amber-600" />,
  phone_call: <Phone className="h-4 w-4 text-purple-600" />,
};

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  email: 'Email',
  sms: 'SMS',
  phone_call: 'Phone Call (manual task)',
};

const CHANNEL_COLORS: Record<string, string> = {
  whatsapp: 'bg-green-50 border-green-200',
  email: 'bg-blue-50 border-blue-200',
  sms: 'bg-amber-50 border-amber-200',
  phone_call: 'bg-purple-50 border-purple-200',
};

// ── Step editor ─────────────────────────────────────────────────────────────

function StepEditor({
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
      {steps.map((step, i) => (
        <div
          key={i}
          className={`rounded-lg border p-3 ${CHANNEL_COLORS[step.channel] ?? 'bg-gray-50 border-gray-200'}`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold shadow-sm">
                {step.stepNumber}
              </span>
              {CHANNEL_ICONS[step.channel]}
              <span className="text-sm font-medium text-gray-700">
                {CHANNEL_LABELS[step.channel]}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => moveUp(i)}
                disabled={i === 0}
                className="rounded p-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                aria-label="Move up"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => moveDown(i)}
                disabled={i === steps.length - 1}
                className="rounded p-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-30"
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-gray-500">Channel</Label>
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
              <Label className="text-xs text-gray-500">
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

            <div className="col-span-2 space-y-1">
              <Label className="text-xs text-gray-500">Approved Template</Label>
              <select
                value={step.templateId ?? ''}
                onChange={(e) => updateStep(i, 'templateId', e.target.value || null)}
                className="flex h-8 w-full rounded-md border border-input bg-white px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">Select approved template</option>
                {templates
                  .filter((template) => template.channel === step.channel)
                  .map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          {step.channel === 'phone_call' && (
            <p className="mt-2 text-xs text-purple-600">
              ⚡ Phone call steps create a task for the assigned rep — no message is auto-sent.
            </p>
          )}
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" onClick={addStep} className="w-full">
        <Plus className="mr-1 h-3.5 w-3.5" />
        Add Step
      </Button>
    </div>
  );
}

// ── Sequence form ───────────────────────────────────────────────────────────

function SequenceForm({
  initial,
  onSave,
  onCancel,
  isPending,
}: {
  initial?: Sequence;
  onSave: (name: string, steps: SequenceStep[]) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [steps, setSteps] = useState<SequenceStep[]>(
    initial?.steps ?? [{ stepNumber: 1, channel: 'whatsapp', delayHours: 0, templateId: null }],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave(name.trim(), steps);
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

      <div className="space-y-2">
        <Label>Steps (WhatsApp → Email → SMS → Phone Call)</Label>
        <StepEditor steps={steps} onChange={setSteps} />
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending || !name.trim() || steps.length === 0}>
          {isPending ? 'Saving…' : initial ? 'Save Changes' : 'Create Sequence'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export function OutreachSequencesPage() {
  const { data: sequenceData, isLoading } = useSequences();
  const createSequence = useCreateSequence();
  const updateSequence = useUpdateSequence();
  const deleteSequence = useDeleteSequence();
  const { data: tasks = [], isLoading: isTasksLoading, isError: isTasksError } = useOutreachTasks({
    status: 'pending',
    assignedTo: 'me',
  });
  const { showToast } = useToast();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const sequences = (sequenceData as { items?: Sequence[] } | undefined)?.items ?? [];

  const handleCreate = async (name: string, steps: SequenceStep[]) => {
    try {
      await createSequence.mutateAsync({ name, steps });
      showToast('Sequence created.', 'success');
      setShowCreateForm(false);
    } catch {
      showToast('Failed to create sequence.', 'error');
    }
  };

  const handleUpdate = async (id: string, name: string, steps: SequenceStep[]) => {
    try {
      await updateSequence.mutateAsync({ id, input: { name, steps } });
      showToast('Sequence updated.', 'success');
      setEditingId(null);
    } catch {
      showToast('Failed to update sequence.', 'error');
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete sequence "${name}"? This cannot be undone.`)) return;
    try {
      await deleteSequence.mutateAsync(id);
      showToast('Sequence deleted.', 'success');
    } catch {
      showToast('Failed to delete sequence.', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Outreach automation"
        title="Outreach Sequences"
        description="Define multi-step flows across WhatsApp, email, SMS, and manual phone-call tasks."
        metrics={[
          { label: 'Sequences', value: sequences.length },
          { label: 'Total steps', value: sequences.reduce((sum, sequence) => sum + sequence.steps.length, 0) },
          { label: 'Phone tasks', value: sequences.reduce((sum, sequence) => sum + sequence.steps.filter((step) => step.channel === 'phone_call').length, 0) },
          { label: 'Immediate starts', value: sequences.filter((sequence) => sequence.steps[0]?.delayHours === 0).length, tone: 'success' },
        ]}
        actions={
          !showCreateForm ? (
            <Button onClick={() => setShowCreateForm(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New Sequence
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Phone Task Inbox</CardTitle>
          <CardDescription>Pending phone-call handoffs assigned to you.</CardDescription>
        </CardHeader>
        <CardContent>
          {isTasksLoading ? (
            <LoadingTable rows={3} cols={3} />
          ) : isTasksError ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">Unable to load tasks.</div>
          ) : tasks.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-sm text-gray-500">No pending phone-call tasks.</div>
          ) : (
            <div className="divide-y rounded-md border">
              {tasks.map((task) => (
                <div key={task.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                  <div>
                    <div className="font-medium text-gray-900">{task.title}</div>
                    <div className="text-gray-500">{task.due_at ? new Date(task.due_at).toLocaleString() : 'No due date'}</div>
                  </div>
                  <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">{task.status}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {showCreateForm && (
        <Card>
          <CardHeader>
            <CardTitle>Create Sequence</CardTitle>
            <CardDescription>Add steps in the order they should fire.</CardDescription>
          </CardHeader>
          <CardContent>
            <SequenceForm
              onSave={handleCreate}
              onCancel={() => setShowCreateForm(false)}
              isPending={createSequence.isPending}
            />
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <LoadingTable rows={4} cols={3} />
      ) : sequences.length === 0 && !showCreateForm ? (
        <EmptyState
          icon={<Zap className="h-6 w-6" />}
          title="No sequences yet"
          description="Create a sequence to automate follow-up while keeping phone calls as manual rep tasks."
          action={
            <Button size="sm" onClick={() => setShowCreateForm(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Create first sequence
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {sequences.map((seq) => (
            <Card key={seq.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{seq.name}</CardTitle>
                    <CardDescription className="text-xs mt-0.5">
                      {seq.steps.length} step{seq.steps.length !== 1 ? 's' : ''} ·{' '}
                      {seq.steps.map((s) => CHANNEL_LABELS[s.channel] ?? s.channel).join(' → ')}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => setEditingId(seq.id === editingId ? null : seq.id)}
                    >
                      <Edit2 className="mr-1 h-3 w-3" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs text-red-600 hover:bg-red-50"
                      onClick={() => handleDelete(seq.id, seq.name)}
                      disabled={deleteSequence.isPending}
                    >
                      <Trash2 className="mr-1 h-3 w-3" />
                      Delete
                    </Button>
                  </div>
                </div>
              </CardHeader>

              {editingId === seq.id && (
                <CardContent>
                  <SequenceForm
                    initial={seq}
                    onSave={(name, steps) => handleUpdate(seq.id, name, steps)}
                    onCancel={() => setEditingId(null)}
                    isPending={updateSequence.isPending}
                  />
                </CardContent>
              )}

              {editingId !== seq.id && (
                <CardContent className="pt-0">
                  <div className="flex flex-wrap gap-2">
                    {seq.steps.map((step) => (
                      <div
                        key={step.stepNumber}
                        className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${CHANNEL_COLORS[step.channel] ?? 'bg-gray-50 border-gray-200'}`}
                      >
                        {CHANNEL_ICONS[step.channel]}
                        <span className="font-medium">Step {step.stepNumber}</span>
                        <span className="text-gray-500">
                          {step.delayHours === 0 ? '(immediate)' : `+${step.delayHours}h`}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

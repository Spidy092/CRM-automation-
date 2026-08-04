import { useState, Component, type ReactNode, type ErrorInfo } from 'react';
import { Link } from 'react-router-dom';
import {
  useSequences,
  useSequenceStats,
  useCreateSequence,
  useUpdateSequence,
  useDeleteSequence,
  useOutreachTasks,
} from '@/api/outreach';
import { apiClient } from '@/api/client';
import type { Sequence, SequenceEnrollmentStats, SequenceStep } from '@/api/outreach';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingTable } from '@/components/ui/LoadingTable';
import { PageHeader } from '@/components/ui/PageHeader';
import { ContentTabs } from '@/components/ContentTabs';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useToast } from '@/components/ui/Toast';
import {
  SequenceForm,
  CHANNEL_ICONS,
  CHANNEL_LABELS,
  CHANNEL_COLORS,
} from '@/components/SequenceStepEditor';
import { SequencePresetPicker } from '@/components/SequencePresetPicker';
import {
  Plus,
  Trash2,
  Edit2,
  Zap,
  Users,
  CheckCircle2,
  UserMinus,
  Clock,
  ToggleLeft,
  ToggleRight,
  ExternalLink,
  Copy,
} from 'lucide-react';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Lightweight error boundary that isolates a single card from crashing the whole list. */
class CardErrorBoundary extends Component<
  { children: ReactNode; name: string },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode; name: string }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`Error rendering card "${this.props.name}":`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <Card className="border-red-200 bg-red-50/50">
          <CardContent className="flex items-center gap-3 py-4 text-sm text-red-700">
            <Trash2 className="h-4 w-4 shrink-0" />
            <span>Failed to render &quot;{this.props.name}&quot; — {this.state.error?.message}</span>
          </CardContent>
        </Card>
      );
    }
    return this.props.children;
  }
}

/** Sum all step delays and return a human-readable "X steps over Y days" string. */
function durationLabel(steps: SequenceStep[]): string {
  if (steps.length === 0) return '0 steps';
  const totalHours = steps.reduce((sum, s) => sum + (s.delayHours ?? 0), 0);
  const days = Math.round(totalHours / 24);
  const stepWord = steps.length === 1 ? 'step' : 'steps';
  if (days === 0) return `${steps.length} ${stepWord} · same day`;
  const dayWord = days === 1 ? 'day' : 'days';
  return `${steps.length} ${stepWord} over ${days} ${dayWord}`;
}

// ── Enrollment stats panel ────────────────────────────────────────────────────

function EnrollmentStats({ sequenceId }: { sequenceId: string }) {
  const { data: stats, isLoading } = useSequenceStats(sequenceId);

  const statItems = [
    {
      label: 'Currently in',
      value: stats?.currently_in ?? 0,
      icon: <Users className="h-3.5 w-3.5 text-blue-500" />,
      color: 'text-blue-700',
    },
    {
      label: 'Completed',
      value: stats?.completed ?? 0,
      icon: <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />,
      color: 'text-green-700',
    },
    {
      label: 'Removed',
      value: stats?.removed ?? 0,
      icon: <UserMinus className="h-3.5 w-3.5 text-slate-400" />,
      color: 'text-slate-600',
    },
  ];

  return (
    <div className="grid grid-cols-3 divide-x divide-slate-100 border-t border-slate-100">
      {statItems.map((item) => (
        <div key={item.label} className="flex flex-col items-center gap-0.5 px-3 py-2.5">
          <div className="flex items-center gap-1">
            {item.icon}
            <span className={`text-base font-bold ${item.color}`}>
              {isLoading ? '—' : item.value}
            </span>
          </div>
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
            {item.label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Sequence card ─────────────────────────────────────────────────────────────

function SequenceCard({
  seq,
  onEdit,
  onDelete,
  onDuplicate,
  onToggleActive,
  isDeleting,
  isUpdating,
}: {
  seq: Sequence;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onToggleActive: () => void;
  isDeleting: boolean;
  isUpdating: boolean;
}) {
  return (
    <Card className="overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate">{seq.name}</h3>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                seq.is_active
                  ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
              }`}
            >
              {seq.is_active ? '● Active' : '○ Inactive'}
            </span>
          </div>
          {seq.description && (
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 line-clamp-2">{seq.description}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            title={seq.is_active ? 'Deactivate sequence' : 'Activate sequence'}
            onClick={onToggleActive}
            disabled={isUpdating}
            className="rounded p-1 text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 disabled:opacity-40"
          >
            {seq.is_active ? (
              <ToggleRight className="h-5 w-5 text-emerald-500" />
            ) : (
              <ToggleLeft className="h-5 w-5" />
            )}
          </button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onEdit}>
            <Edit2 className="mr-1 h-3 w-3" />
            Edit
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onDuplicate}>
            <Copy className="mr-1 h-3 w-3" />
            Duplicate
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
            onClick={onDelete}
            disabled={isDeleting}
          >
            <Trash2 className="mr-1 h-3 w-3" />
            Delete
          </Button>
        </div>
      </div>

      {/* Steps */}
      <div className="px-5 py-3">
        <div className="mb-2 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <Clock className="h-3.5 w-3.5" />
          <span className="font-medium">{durationLabel(seq.steps)}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {seq.steps.map((step) => (
            <div
              key={step.stepNumber}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
                CHANNEL_COLORS[step.channel] ?? 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800'
              }`}
            >
              {CHANNEL_ICONS[step.channel]}
              <span className="font-medium">Step {step.stepNumber}</span>
              <span className="text-slate-500 dark:text-slate-400">
                {step.delayHours === 0 ? '(immediate)' : `+${step.delayHours}h`}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Enrollment stats */}
      <EnrollmentStats sequenceId={seq.id} />

      {/* Footer actions */}
      <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 px-5 py-2.5">
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {seq.steps.map((s) => CHANNEL_LABELS[s.channel] ?? s.channel).join(' → ')}
        </span>
        <Button size="sm" variant="outline" className="h-7 text-xs" asChild>
          <Link to={`/campaigns/new`} state={{ prefillSequenceId: seq.id }}>
            <Users className="mr-1 h-3 w-3" />
            Add clients
            <ExternalLink className="ml-1 h-3 w-3 opacity-50" />
          </Link>
        </Button>
      </div>
    </Card>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function OutreachSequencesPage() {
  const { data: sequenceData, isLoading } = useSequences();
  const createSequence = useCreateSequence();
  const updateSequence = useUpdateSequence();
  const deleteSequence = useDeleteSequence();
  const {
    data: tasks = [],
    isLoading: isTasksLoading,
    isError: isTasksError,
  } = useOutreachTasks({ status: 'pending', assignedTo: 'me' });
  const { showToast } = useToast();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const sequences = (sequenceData as { items?: Sequence[] } | undefined)?.items ?? [];

  const handleCreate = async (name: string, steps: SequenceStep[], description?: string) => {
    try {
      await createSequence.mutateAsync({ name, description: description ?? null, steps });
      showToast('Sequence created.', 'success');
      setShowCreateForm(false);
    } catch {
      showToast('Failed to create sequence.', 'error');
    }
  };

  const handleUpdate = async (
    id: string,
    name: string,
    steps: SequenceStep[],
    description?: string,
  ) => {
    try {
      await updateSequence.mutateAsync({ id, input: { name, description: description ?? null, steps } });
      showToast('Sequence updated.', 'success');
      setEditingId(null);
    } catch {
      showToast('Failed to update sequence.', 'error');
    }
  };

  const handleDelete = async (id: string, name: string) => {
    try {
      const statsResponse = await apiClient.get<{ data: SequenceEnrollmentStats }>(
        `/outreach/sequences/${id}/stats`,
      );
      const stats = statsResponse.data.data;
      const activeLeads = stats?.currently_in ?? 0;
      const warning =
        activeLeads > 0
          ? `\n\n⚠ This sequence has ${activeLeads} lead(s) currently enrolled. Deleting it will stop their outreach flow.`
          : '';
      if (!confirm(`Archive sequence "${name}"? This will hide it from active use.${warning}`)) return;
    } catch {
      if (!confirm(`Archive sequence "${name}"? This will hide it from active use.`)) return;
    }
    try {
      await deleteSequence.mutateAsync(id);
      showToast('Sequence archived.', 'success');
    } catch {
      showToast('Failed to archive sequence.', 'error');
    }
  };

  const handleDuplicate = async (seq: Sequence) => {
    try {
      await createSequence.mutateAsync({
        name: `${seq.name} (Copy)`,
        description: seq.description ?? null,
        steps: seq.steps,
      });
      showToast('Sequence duplicated.', 'success');
    } catch {
      showToast('Failed to duplicate sequence.', 'error');
    }
  };

  const handleToggleActive = async (seq: Sequence) => {
    try {
      await updateSequence.mutateAsync({
        id: seq.id,
        input: { is_active: !seq.is_active },
      });
      showToast(
        seq.is_active ? 'Sequence deactivated.' : 'Sequence activated.',
        'success',
      );
    } catch {
      showToast('Failed to update sequence status.', 'error');
    }
  };

  const totalSteps = sequences.reduce((sum, seq) => sum + seq.steps.length, 0);
  const phoneSteps = sequences.reduce(
    (sum, seq) => sum + seq.steps.filter((s) => s.channel === 'phone_call').length,
    0,
  );
  const immediateStarts = sequences.filter((seq) => seq.steps[0]?.delayHours === 0).length;
  const activeCount = sequences.filter((seq) => seq.is_active).length;

  return (
    <div className="space-y-6">
      <ContentTabs />
      <PageHeader
        eyebrow="Outreach automation"
        title="Outreach Sequences"
        description="Define multi-step flows across WhatsApp, email, SMS, and manual phone-call tasks."
        metrics={[
          { label: 'Sequences', value: sequences.length },
          { label: 'Active', value: activeCount, tone: 'success' },
          { label: 'Total steps', value: totalSteps },
          { label: 'Phone tasks', value: phoneSteps },
          { label: 'Immediate starts', value: immediateStarts },
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

      {/* Phone task inbox */}
      <Card>
        <CardHeader>
          <CardTitle>Phone Task Inbox</CardTitle>
          <CardDescription>Pending phone-call handoffs assigned to you.</CardDescription>
        </CardHeader>
        <CardContent>
          {isTasksLoading ? (
            <LoadingTable rows={3} cols={3} />
          ) : isTasksError ? (
            <ErrorState message="Unable to load tasks." />
          ) : tasks.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-sm text-slate-500">
              No pending phone-call tasks.
            </div>
          ) : (
            <div className="divide-y rounded-md border">
              {tasks.map((task) => (
                <div key={task.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                  <div>
                    <div className="font-medium text-slate-900">{task.title}</div>
                    <div className="text-slate-500">
                      {task.due_at ? new Date(task.due_at).toLocaleString() : 'No due date'}
                    </div>
                  </div>
                  <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">
                    {task.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create form */}
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

      {/* Sequence list */}
      {isLoading ? (
        <LoadingTable rows={4} cols={3} />
      ) : sequences.length === 0 && !showCreateForm ? (
        <div className="space-y-6">
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
          <Card>
            <CardContent className="pt-6">
              <SequencePresetPicker onApplied={(sequence) => setEditingId(sequence.id)} />
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="space-y-4">
          {sequences.map((seq) =>
            editingId === seq.id ? (
              <CardErrorBoundary key={seq.id} name={seq.name}>
                <Card>
                  <CardHeader>
                    <CardTitle>Edit — {seq.name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <SequenceForm
                      initial={seq}
                      onSave={(name, steps, description) =>
                        handleUpdate(seq.id, name, steps, description)
                      }
                      onCancel={() => setEditingId(null)}
                      isPending={updateSequence.isPending}
                    />
                  </CardContent>
                </Card>
              </CardErrorBoundary>
            ) : (
              <CardErrorBoundary key={seq.id} name={seq.name}>
                <SequenceCard
                  seq={seq}
                  onEdit={() => setEditingId(seq.id)}
                  onDelete={() => handleDelete(seq.id, seq.name)}
                  onDuplicate={() => handleDuplicate(seq)}
                  onToggleActive={() => handleToggleActive(seq)}
                  isDeleting={deleteSequence.isPending}
                  isUpdating={updateSequence.isPending}
                />
              </CardErrorBoundary>
            ),
          )}
        </div>
      )}
    </div>
  );
}

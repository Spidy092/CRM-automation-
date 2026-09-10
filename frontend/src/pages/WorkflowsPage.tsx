import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileText,
  GitBranch,
  Pause,
  Play,
  Plus,
  Search,
  Sparkles,
  Workflow,
  Zap,
} from 'lucide-react';
import {
  usePauseWorkflow,
  usePublishWorkflow,
  useResumeWorkflow,
  useWorkflows,
} from '@/api/workflows';
import type { WorkflowDetail, WorkflowNode } from '@/api/workflows';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Input } from '@/components/ui/input';
import { LoadingTable } from '@/components/ui/LoadingTable';
import { PageHeader } from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';

type Filter = 'all' | WorkflowDetail['status'];

const FILTER_LABELS: Record<Filter, string> = {
  all: 'All',
  published: 'Published',
  draft: 'Drafts',
  paused: 'Paused',
  archived: 'Archived',
};

const STATUS_STYLES: Record<WorkflowDetail['status'], string> = {
  draft: 'border-slate-200 bg-slate-50 text-slate-700',
  published: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  paused: 'border-amber-200 bg-amber-50 text-amber-700',
  archived: 'border-slate-200 bg-slate-50 text-slate-500',
};

const STATUS_DOT: Record<WorkflowDetail['status'], string> = {
  draft: 'bg-slate-400',
  published: 'bg-emerald-500',
  paused: 'bg-amber-500',
  archived: 'bg-slate-300',
};

const TRIGGER_LABELS: Record<string, string> = {
  'lead.created': 'Lead created',
  'lead.updated': 'Lead updated',
  'lead.stage_changed': 'Stage changed',
  'lead.tag_added': 'Tag added',
  'form.submitted': 'Form submitted',
  'message.event': 'Message event',
  'booking.created': 'Booking created',
  'booking.cancelled': 'Booking cancelled',
  'webhook.received': 'Webhook received',
  'schedule.reached': 'Schedule reached',
};

function getCurrentNodes(workflow: WorkflowDetail): WorkflowNode[] {
  return workflow.current_version?.definition.nodes ?? [];
}

function getTrigger(workflow: WorkflowDetail): string | null {
  return getCurrentNodes(workflow).find((node) => node.type === 'trigger')?.trigger?.event ?? null;
}

function formatRelativeDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
  if (days === 0) return 'Updated today';
  if (days === 1) return 'Updated yesterday';
  return `Updated ${days} days ago`;
}

function WorkflowSummary({ workflow }: { workflow: WorkflowDetail }) {
  const nodes = getCurrentNodes(workflow);
  const trigger = getTrigger(workflow);
  const actionCount = nodes.filter((node) => node.type === 'action').length;
  const conditionCount = nodes.filter((node) => node.type === 'condition').length;
  const waitCount = nodes.filter((node) => node.type === 'wait').length;

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-md border border-slate-200/80 bg-slate-50/70 px-3 py-2.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Starts with</p>
        <p className="mt-1 truncate text-sm font-semibold text-slate-800" title={trigger ?? undefined}>
          {trigger ? TRIGGER_LABELS[trigger] ?? trigger : 'Not configured'}
        </p>
        {trigger && <p className="mt-0.5 truncate font-mono text-[11px] text-slate-400" title={trigger}>{trigger}</p>}
      </div>
      <div className="rounded-md border border-slate-200/80 bg-slate-50/70 px-3 py-2.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Path</p>
        <p className="mt-1 text-sm font-semibold text-slate-800">
          {actionCount} action{actionCount === 1 ? '' : 's'}
          {conditionCount > 0 ? ` · ${conditionCount} branch${conditionCount === 1 ? '' : 'es'}` : ''}
        </p>
      </div>
      <div className="rounded-md border border-slate-200/80 bg-slate-50/70 px-3 py-2.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Timing</p>
        <p className="mt-1 text-sm font-semibold text-slate-800">
          {waitCount > 0 ? `${waitCount} wait${waitCount === 1 ? '' : 's'}` : 'Runs immediately'}
        </p>
      </div>
    </div>
  );
}

function LifecycleButton({ workflow }: { workflow: WorkflowDetail }) {
  const publish = usePublishWorkflow();
  const pause = usePauseWorkflow();
  const resume = useResumeWorkflow();
  const { showToast } = useToast();
  const mutation =
    workflow.status === 'draft' ? publish : workflow.status === 'published' ? pause : resume;
  const label = workflow.status === 'draft' ? 'Publish' : workflow.status === 'published' ? 'Pause' : 'Resume';
  const pastTense = workflow.status === 'draft' ? 'published' : workflow.status === 'published' ? 'paused' : 'resumed';
  const Icon = workflow.status === 'published' ? Pause : Play;

  if (workflow.status === 'archived') return null;

  const handleClick = async () => {
    try {
      await mutation.mutateAsync(workflow.id);
      showToast(`Workflow ${pastTense}.`, 'success');
    } catch (error) {
      showToast(getApiErrorMessage(error, `Unable to ${label.toLowerCase()} this workflow.`), 'error');
    }
  };

  return (
    <Button
      type="button"
      size="sm"
      variant={workflow.status === 'published' ? 'outline' : 'default'}
      onClick={handleClick}
      disabled={mutation.isPending}
    >
      <Icon className="mr-1.5 h-3.5 w-3.5" />
      {mutation.isPending ? `${label}ing…` : label}
    </Button>
  );
}

function WorkflowCard({ workflow }: { workflow: WorkflowDetail }) {
  const nodes = getCurrentNodes(workflow);
  const trigger = getTrigger(workflow);

  return (
    <Card className="group overflow-hidden border-slate-200/90 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md">
      <CardHeader className="border-b border-slate-100 bg-white pb-4 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 gap-3">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
              <Workflow className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <CardTitle className="truncate text-base">{workflow.name}</CardTitle>
              {workflow.description ? (
                <CardDescription className="mt-1 line-clamp-2 leading-5">{workflow.description}</CardDescription>
              ) : (
                <CardDescription className="mt-1 italic">No description added</CardDescription>
              )}
            </div>
          </div>
          <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${STATUS_STYLES[workflow.status]}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[workflow.status]}`} aria-hidden="true" />
            {workflow.status}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {workflow.current_version ? (
          <>
            <WorkflowSummary workflow={workflow} />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5"><GitBranch className="h-3.5 w-3.5" />Version {workflow.current_version.version}</span>
              <span className="inline-flex items-center gap-1.5"><Zap className="h-3.5 w-3.5" />{nodes.length} node{nodes.length === 1 ? '' : 's'}</span>
              <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />{formatRelativeDate(workflow.updated_at)}</span>
            </div>
            {trigger && workflow.status === 'published' && (
              <div className="flex items-center gap-2 rounded-md border border-emerald-100 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                Configured for {TRIGGER_LABELS[trigger] ?? trigger}
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            This workflow does not have a definition yet.
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
          <span className="text-xs text-slate-400">Actions require backend consent checks</span>
          <LifecycleButton workflow={workflow} />
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyFilteredState({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-6 py-10 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 shadow-sm"><Search className="h-5 w-5" /></div>
      <p className="mt-3 text-sm font-semibold text-slate-800">No matching workflows</p>
      <p className="mt-1 max-w-sm text-sm leading-6 text-slate-500">Try another search or clear the current status filter.</p>
      <Button type="button" variant="outline" size="sm" className="mt-4" onClick={onClear}>Clear filters</Button>
    </div>
  );
}

function AutomationRoles() {
  return (
    <section aria-labelledby="automation-roles-title" className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="automation-roles-title" className="text-sm font-semibold text-slate-900 dark:text-slate-100">Know which tool to use</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">Each tool owns one part of the customer journey.</p>
        </div>
        <span className="text-xs text-slate-400">Pipeline → Campaign → Workflow</span>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <Link to="/pipelines" className="group rounded-md border border-slate-200 bg-slate-50/70 p-3 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60 dark:hover:border-slate-600">
          <div className="flex items-center gap-2"><GitBranch className="h-4 w-4 text-indigo-600" /><p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Pipeline</p></div>
          <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">Tracks where a lead is in the sales process.</p>
          <span className="mt-2 inline-flex text-xs font-semibold text-indigo-700 group-hover:underline dark:text-indigo-300">View stages <ArrowRight className="ml-1 h-3.5 w-3.5" /></span>
        </Link>
        <Link to="/campaigns" className="group rounded-md border border-slate-200 bg-slate-50/70 p-3 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60 dark:hover:border-slate-600">
          <div className="flex items-center gap-2"><FileText className="h-4 w-4 text-blue-600" /><p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Campaign</p></div>
          <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">Defines the audience and outreach goal.</p>
          <span className="mt-2 inline-flex text-xs font-semibold text-blue-700 group-hover:underline dark:text-blue-300">View campaigns <ArrowRight className="ml-1 h-3.5 w-3.5" /></span>
        </Link>
        <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
          <div className="flex items-center gap-2"><Workflow className="h-4 w-4 text-emerald-700 dark:text-emerald-300" /><p className="text-sm font-semibold text-emerald-950 dark:text-emerald-100">Workflow</p></div>
          <p className="mt-1 text-xs leading-5 text-emerald-900/75 dark:text-emerald-200/80">Decides what the CRM should do when an event happens.</p>
          <span className="mt-2 inline-flex text-xs font-semibold text-emerald-800 dark:text-emerald-200">You are here</span>
        </div>
      </div>
    </section>
  );
}

export function WorkflowsPage() {
  const { data: workflows = [], isLoading, isError, refetch } = useWorkflows();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  const filteredWorkflows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return workflows.filter((workflow) => {
      const matchesStatus = filter === 'all' || workflow.status === filter;
      const matchesQuery = !normalized || `${workflow.name} ${workflow.description ?? ''}`.toLowerCase().includes(normalized);
      return matchesStatus && matchesQuery;
    });
  }, [filter, query, workflows]);

  const clearFilters = () => {
    setFilter('all');
    setQuery('');
  };

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        eyebrow="Automation / Operations"
        title="Workflows"
        description="Turn CRM events into explicit, auditable paths for your team. Build in draft, validate the graph, then publish when the path is ready."
        metrics={[
          { label: 'Total workflows', value: workflows.length },
          { label: 'Published', value: workflows.filter((workflow) => workflow.status === 'published').length, tone: 'success' },
          { label: 'Drafts', value: workflows.filter((workflow) => workflow.status === 'draft').length },
        ]}
        actions={<Button asChild><Link to="/automation/workflows/new"><Plus className="mr-1.5 h-4 w-4" />New workflow</Link></Button>}
      />

      <AutomationRoles />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50/80 px-4 py-3 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-300" />
          <div><p className="font-semibold">A safer automation core</p><p className="mt-0.5 leading-5 text-blue-800/80 dark:text-blue-100/80">Definitions are validated before saving. Customer-facing actions stay guarded until connector consent and idempotency checks are enabled.</p></div>
        </div>
        <div className="hidden items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 lg:flex dark:border-slate-800 dark:bg-slate-900">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"><ArrowRight className="h-4 w-4" /></div>
          <div><p className="text-xs font-semibold text-slate-800 dark:text-slate-100">How it runs</p><p className="text-xs leading-5 text-slate-500">Event → condition → action</p></div>
        </div>
      </div>

      {!isLoading && !isError && workflows.length > 0 && (
        <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filter workflows">
            {(['all', 'published', 'draft', 'paused', 'archived'] as Filter[]).map((value) => {
              const count = value === 'all' ? workflows.length : workflows.filter((workflow) => workflow.status === value).length;
              return (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={filter === value}
                  onClick={() => setFilter(value)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 ${filter === value ? 'bg-slate-950 text-white dark:bg-slate-100 dark:text-slate-950' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-100'}`}
                >
                  {FILTER_LABELS[value]} <span className="ml-1 opacity-60">{count}</span>
                </button>
              );
            })}
          </div>
          <label className="relative block w-full sm:max-w-xs"><span className="sr-only">Search workflows</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search workflows" className="h-9 pl-9 text-sm" /></label>
        </div>
      )}

      {isLoading && <LoadingTable rows={4} cols={4} />}
      {isError && <ErrorState message="Unable to load workflows." onRetry={() => void refetch()} />}
      {!isLoading && !isError && workflows.length === 0 && <EmptyState icon={<Workflow className="h-6 w-6" />} title="No workflows yet" description="Create your first workflow to connect a CRM event to a validated action path." action={<Button asChild><Link to="/automation/workflows/new">Create your first workflow</Link></Button>} />}
      {!isLoading && !isError && workflows.length > 0 && filteredWorkflows.length === 0 && <EmptyFilteredState onClear={clearFilters} />}
      {!isLoading && !isError && filteredWorkflows.length > 0 && <div className="grid gap-4 xl:grid-cols-2">{filteredWorkflows.map((workflow) => <WorkflowCard key={workflow.id} workflow={workflow} />)}</div>}
    </div>
  );
}

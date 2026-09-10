import { useMemo, useState, type ChangeEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDown,
  CheckCircle2,
  ChevronLeft,
  GitBranch,
  Play,
  Save,
  Send,
  Zap,
} from 'lucide-react';
import {
  useCreateWorkflow,
  useValidateWorkflow,
  type WorkflowActionType,
  type WorkflowComparisonOperator,
  type WorkflowCondition,
  type WorkflowDefinition,
  type WorkflowNode,
  type WorkflowScalar,
  type WorkflowTriggerType,
  type WorkflowValidationIssue,
} from '@/api/workflows';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/PageHeader';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';

const TRIGGERS: Array<{ value: WorkflowTriggerType; label: string }> = [
  { value: 'lead.created', label: 'Lead created' },
  { value: 'lead.updated', label: 'Lead updated' },
  { value: 'lead.stage_changed', label: 'Lead stage changed' },
  { value: 'lead.tag_added', label: 'Lead tag added' },
  { value: 'form.submitted', label: 'Form submitted' },
  { value: 'message.event', label: 'Message event' },
  { value: 'booking.created', label: 'Booking created' },
  { value: 'booking.cancelled', label: 'Booking cancelled' },
  { value: 'webhook.received', label: 'Webhook received' },
  { value: 'schedule.reached', label: 'Schedule reached' },
];

const ACTIONS: Array<{ value: WorkflowActionType; label: string; example: string }> = [
  { value: 'lead.update', label: 'Update lead fields', example: '{"notes":"Follow up tomorrow","deal_value":1000}' },
  { value: 'lead.add_tag', label: 'Add a lead tag', example: '{"tag":"hot-lead"}' },
  { value: 'lead.remove_tag', label: 'Remove a lead tag', example: '{"tag":"unqualified"}' },
  { value: 'lead.assign', label: 'Assign a lead', example: '{"user_id":"<user-id>"}' },
  { value: 'pipeline.move', label: 'Move pipeline stage', example: '{"stage_id":"<stage-id>"}' },
  { value: 'task.create', label: 'Create a task', example: '{"title":"Call lead","due_in_hours":24}' },
  { value: 'message.send', label: 'Send a message', example: '{"channel":"email","template_id":"<template-id>"}' },
  { value: 'sequence.enroll', label: 'Enroll in a sequence', example: '{"sequence_id":"<sequence-id>"}' },
  { value: 'notification.send', label: 'Send an internal notification', example: '{"message":"New qualified lead"}' },
  { value: 'webhook.call', label: 'Call a webhook', example: '{"url":"https://example.com/hook","method":"POST"}' },
];

const OPERATORS: Array<{ value: WorkflowComparisonOperator; label: string }> = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'does not equal' },
  { value: 'in', label: 'is one of' },
  { value: 'not_in', label: 'is not one of' },
  { value: 'gt', label: 'is greater than' },
  { value: 'gte', label: 'is at least' },
  { value: 'lt', label: 'is less than' },
  { value: 'lte', label: 'is at most' },
  { value: 'contains', label: 'contains' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'exists', label: 'exists' },
];

type SelectChange = ChangeEvent<HTMLSelectElement>;

const selectClassName = 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2';

function scalarFromInput(value: string): WorkflowScalar {
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (trimmed !== '' && Number.isFinite(Number(trimmed))) return Number(trimmed);
  return value;
}

function parseCondition(
  field: string,
  operator: WorkflowComparisonOperator,
  value: string,
): WorkflowCondition {
  const normalizedField = field.trim();
  if (!normalizedField) throw new Error('Enter a field for the condition.');
  if (operator === 'exists') return { field: normalizedField, operator };
  if (!value.trim()) throw new Error('Enter a value for the condition.');
  if (operator === 'in' || operator === 'not_in') {
    const values = value.split(',').map((item) => scalarFromInput(item));
    if (values.length === 0) throw new Error('Enter at least one condition value.');
    return { field: normalizedField, operator, value: values };
  }
  return { field: normalizedField, operator, value: scalarFromInput(value) };
}

function parseActionInput(value: string): Record<string, WorkflowScalar | WorkflowScalar[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('Action input must be valid JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Action input must be a JSON object.');
  }
  const entries = Object.entries(parsed);
  for (const [key, entry] of entries) {
    const validScalar = entry === null || ['string', 'number', 'boolean'].includes(typeof entry);
    const validArray = Array.isArray(entry) && entry.every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item));
    if (!validScalar && !validArray) throw new Error(`Action input “${key}” must be a scalar or scalar array.`);
  }
  return parsed as Record<string, WorkflowScalar | WorkflowScalar[]>;
}

function createDefinition(
  name: string,
  description: string,
  triggerEvent: WorkflowTriggerType,
  includeCondition: boolean,
  conditionField: string,
  conditionOperator: WorkflowComparisonOperator,
  conditionValue: string,
  includeAction: boolean,
  actionType: WorkflowActionType,
  actionInput: string,
  includeWait: boolean,
  waitMinutes: string,
): WorkflowDefinition {
  const nodes: WorkflowNode[] = [];
  const actionInputObject = includeAction ? parseActionInput(actionInput) : null;
  const condition = includeCondition ? parseCondition(conditionField, conditionOperator, conditionValue) : null;
  const firstBranchNodeId = includeAction ? 'action' : includeWait ? 'wait' : 'end';
  const nextAfterAction = includeWait ? 'wait' : 'end';

  nodes.push({
    id: 'trigger',
    type: 'trigger',
    next: [includeCondition ? 'condition' : firstBranchNodeId],
    trigger: { event: triggerEvent },
  });

  if (includeCondition && condition) {
    nodes.push({
      id: 'condition',
      type: 'condition',
      next: [firstBranchNodeId, 'end'],
      branches: { true: firstBranchNodeId, false: 'end' },
      condition,
    });
  }

  if (includeAction && actionInputObject) {
    nodes.push({
      id: 'action',
      type: 'action',
      next: [nextAfterAction],
      action: { type: actionType, input: actionInputObject },
    });
  }

  if (includeWait) {
    const parsedWaitMinutes = Number(waitMinutes);
    if (!Number.isInteger(parsedWaitMinutes) || parsedWaitMinutes < 1 || parsedWaitMinutes > 43_200) {
      throw new Error('Wait time must be a whole number between 1 and 43,200 minutes.');
    }
    nodes.push({ id: 'wait', type: 'wait', next: ['end'], waitMinutes: parsedWaitMinutes });
  }

  nodes.push({ id: 'end', type: 'end', next: [] });
  return { name: name.trim(), description: description.trim() || null, entryNodeId: 'trigger', nodes };
}

function getPreviewPath(definition: WorkflowDefinition): WorkflowNode[] {
  const nodesById = new Map(definition.nodes.map((node) => [node.id, node]));
  const path: WorkflowNode[] = [];
  const visited = new Set<string>();
  let currentId: string | undefined = definition.entryNodeId;

  while (currentId && path.length < 12 && !visited.has(currentId)) {
    const node = nodesById.get(currentId);
    if (!node) break;
    path.push(node);
    visited.add(currentId);
    currentId = node.type === 'condition'
      ? node.branches?.true ?? node.next[0]
      : node.next[0];
  }

  return path;
}

function getNodeLabel(node: WorkflowNode): string {
  switch (node.type) {
    case 'trigger':
      return 'Trigger';
    case 'condition':
      return 'Condition';
    case 'action':
      return 'Action';
    case 'wait':
      return 'Wait';
    case 'goal':
      return 'Goal';
    case 'end':
      return 'End';
  }
}

function getNodeDetail(node: WorkflowNode): string {
  switch (node.type) {
    case 'trigger':
      return node.trigger?.event ?? 'Event trigger';
    case 'condition':
      return 'True continues · False exits';
    case 'action':
      return node.action?.type ?? 'Configured action';
    case 'wait':
      return `${node.waitMinutes ?? 0} minutes`;
    case 'goal':
      return 'Goal checkpoint';
    case 'end':
      return 'Terminal exit';
  }
}

function nodeAccent(node: WorkflowNode): { icon: string; surface: string } {
  switch (node.type) {
    case 'trigger':
      return { icon: 'text-emerald-700', surface: 'border-emerald-200 bg-emerald-50' };
    case 'condition':
      return { icon: 'text-indigo-700', surface: 'border-indigo-200 bg-indigo-50' };
    case 'action':
      return { icon: 'text-amber-700', surface: 'border-amber-200 bg-amber-50' };
    case 'wait':
      return { icon: 'text-blue-700', surface: 'border-blue-200 bg-blue-50' };
    case 'goal':
      return { icon: 'text-violet-700', surface: 'border-violet-200 bg-violet-50' };
    case 'end':
      return { icon: 'text-slate-600', surface: 'border-slate-200 bg-slate-100' };
  }
}

function NodeIcon({ node }: { node: WorkflowNode }) {
  const accent = nodeAccent(node);
  const Icon = node.type === 'trigger'
    ? Play
    : node.type === 'condition'
      ? GitBranch
      : node.type === 'action'
        ? Zap
        : node.type === 'end'
          ? CheckCircle2
          : ArrowDown;
  return <Icon className={`h-4 w-4 ${accent.icon}`} aria-hidden="true" />;
}

function GraphPreview({ definition }: { definition: WorkflowDefinition | null }) {
  const path = definition ? getPreviewPath(definition) : [];
  const conditionNode = path.find((node) => node.type === 'condition');

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            <GitBranch className="h-3.5 w-3.5" />
            Graph preview
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">A readable view of the path this definition will execute.</p>
        </div>
        {definition && <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">{path.length} nodes</span>}
      </div>

      {!definition ? (
        <div className="mt-5 rounded-md border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center">
          <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm"><GitBranch className="h-4 w-4" /></div>
          <p className="mt-3 text-sm font-semibold text-slate-700">Your path will appear here</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">Add a name and configure the steps to preview the graph.</p>
        </div>
      ) : (
        <>
          <div className="mt-5 space-y-0">
            {path.map((node, index) => {
              const accent = nodeAccent(node);
              return (
                <div key={node.id} className="relative flex gap-3 pb-4 last:pb-0">
                  {index < path.length - 1 && <span className="absolute left-[17px] top-9 h-[calc(100%-1.25rem)] w-px bg-slate-200" aria-hidden="true" />}
                  <div className={`relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${accent.surface}`}><NodeIcon node={node} /></div>
                  <div className="min-w-0 pt-0.5">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">{String(index + 1).padStart(2, '0')} · {getNodeLabel(node)}</p>
                    <p className="mt-0.5 truncate text-sm font-semibold text-slate-800" title={getNodeDetail(node)}>{getNodeDetail(node)}</p>
                  </div>
                </div>
              );
            })}
          </div>
          {conditionNode && (
            <div className="mt-4 grid gap-2 border-t border-slate-100 pt-4 sm:grid-cols-2">
              <div className="rounded-md border border-emerald-100 bg-emerald-50/60 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-emerald-700">True branch</p>
                <p className="mt-1 text-xs leading-5 text-emerald-800">Continues through the configured path.</p>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">False branch</p>
                <p className="mt-1 text-xs leading-5 text-slate-600">Exits at the End node.</p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ValidationIssues({ issues }: { issues: WorkflowValidationIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-red-800">
        <AlertTriangle className="h-4 w-4" />
        Fix these validation issues before saving
      </div>
      <ul className="mt-2 space-y-1 text-xs text-red-700">
        {issues.map((issue, index) => <li key={`${issue.path}-${index}`}>{issue.path}: {issue.message}</li>)}
      </ul>
    </div>
  );
}

export function WorkflowBuilderPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const createWorkflow = useCreateWorkflow();
  const validateWorkflow = useValidateWorkflow();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [triggerEvent, setTriggerEvent] = useState<WorkflowTriggerType>('lead.created');
  const [includeCondition, setIncludeCondition] = useState(false);
  const [conditionField, setConditionField] = useState('lead.score');
  const [conditionOperator, setConditionOperator] = useState<WorkflowComparisonOperator>('gte');
  const [conditionValue, setConditionValue] = useState('70');
  const [includeAction, setIncludeAction] = useState(true);
  const [actionType, setActionType] = useState<WorkflowActionType>('lead.add_tag');
  const [actionInput, setActionInput] = useState('{"tag":"new-lead"}');
  const [includeWait, setIncludeWait] = useState(false);
  const [waitMinutes, setWaitMinutes] = useState('60');
  const [localError, setLocalError] = useState<string | null>(null);
  const [validationIssues, setValidationIssues] = useState<WorkflowValidationIssue[]>([]);

  const selectedAction = useMemo(() => ACTIONS.find((action) => action.value === actionType) ?? ACTIONS[0], [actionType]);

  const liveDefinition = useMemo(() => {
    if (!name.trim()) return null;
    try {
      return createDefinition(
        name,
        description,
        triggerEvent,
        includeCondition,
        conditionField,
        conditionOperator,
        conditionValue,
        includeAction,
        actionType,
        actionInput,
        includeWait,
        waitMinutes,
      );
    } catch {
      return null;
    }
  }, [actionInput, actionType, conditionField, conditionOperator, conditionValue, description, includeAction, includeCondition, includeWait, name, triggerEvent, waitMinutes]);

  const build = (): WorkflowDefinition => {
    if (!name.trim()) throw new Error('Enter a workflow name.');
    return createDefinition(
      name,
      description,
      triggerEvent,
      includeCondition,
      conditionField,
      conditionOperator,
      conditionValue,
      includeAction,
      actionType,
      actionInput,
      includeWait,
      waitMinutes,
    );
  };

  const validate = async (): Promise<WorkflowDefinition | null> => {
    setLocalError(null);
    setValidationIssues([]);
    let definition: WorkflowDefinition;
    try {
      definition = build();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Unable to build workflow definition.');
      return null;
    }
    try {
      const result = await validateWorkflow.mutateAsync(definition);
      setValidationIssues(result.issues);
      if (result.valid) showToast('Workflow definition is valid.', 'success');
      return result.valid ? definition : null;
    } catch (error) {
      setLocalError(getApiErrorMessage(error, 'Unable to validate this workflow.'));
      return null;
    }
  };

  const handleSave = async () => {
    const definition = await validate();
    if (!definition) return;
    try {
      await createWorkflow.mutateAsync({ name: name.trim(), description: description.trim() || null, definition });
      showToast('Workflow saved as a draft.', 'success');
      navigate('/automation/workflows');
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Unable to save this workflow.'), 'error');
    }
  };

  const handleActionTypeChange = (event: SelectChange) => {
    const value = event.target.value as WorkflowActionType;
    setActionType(value);
    const nextAction = ACTIONS.find((action) => action.value === value);
    setActionInput(nextAction?.example ?? '{}');
  };

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        eyebrow="Automation / Workflows"
        title="Build workflow"
        description="Create a small, explicit graph. Validate it before saving, then publish it from the workflow catalog when it is ready."
        actions={(
          <Button asChild variant="outline">
            <Link to="/automation/workflows"><ChevronLeft className="mr-1.5 h-4 w-4" />Back to workflows</Link>
          </Button>
        )}
      />

      <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
        <div>
          <p className="font-semibold">Action execution is guarded</p>
        <p className="mt-0.5 max-w-3xl leading-5 text-amber-900/80">Safe CRM mutations can run for admin and manager-owned workflows. Messages, tasks, notifications, and webhooks remain disabled until consent, authorization, and durable idempotency checks are enabled.</p>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="space-y-5">
          <Card className="border-slate-200/90 shadow-sm">
            <CardHeader className="border-b border-slate-100 pb-4">
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-sm font-bold text-slate-600">01</span>
                <div><CardTitle>Workflow basics</CardTitle><CardDescription className="mt-1">Give this automation a clear operational name.</CardDescription></div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="workflow-name">Name</Label>
                <Input id="workflow-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="New lead qualification" maxLength={255} />
                <p className="text-xs text-slate-500">Use a name your team can recognize in an execution log.</p>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="workflow-description">Description <span className="font-normal text-slate-400">(optional)</span></Label>
                <Textarea id="workflow-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What outcome does this workflow own?" maxLength={2000} />
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200/90 shadow-sm">
            <CardHeader className="border-b border-slate-100 pb-4">
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 text-sm font-bold text-emerald-700">02</span>
                <div><CardTitle className="flex items-center gap-2"><Play className="h-4 w-4 text-emerald-600" />Trigger</CardTitle><CardDescription className="mt-1">One event starts each workflow enrollment.</CardDescription></div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label htmlFor="workflow-trigger">Start when</Label>
              <select id="workflow-trigger" className={selectClassName} value={triggerEvent} onChange={(event: SelectChange) => setTriggerEvent(event.target.value as WorkflowTriggerType)}>
                {TRIGGERS.map((trigger) => <option key={trigger.value} value={trigger.value}>{trigger.label}</option>)}
              </select>
              <p className="text-xs leading-5 text-slate-500">Only one trigger is supported per workflow. Use conditions to narrow who enters.</p>
            </CardContent>
          </Card>

          <Card className="border-slate-200/90 shadow-sm">
            <CardHeader className="border-b border-slate-100 pb-4">
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-indigo-200 bg-indigo-50 text-sm font-bold text-indigo-700">03</span>
                <div><CardTitle className="flex items-center gap-2"><GitBranch className="h-4 w-4 text-indigo-600" />Condition <span className="text-sm font-normal text-slate-400">(optional)</span></CardTitle><CardDescription className="mt-1">Keep the false branch explicit: it exits at End.</CardDescription></div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 bg-slate-50/70 px-3 py-2.5 text-sm text-slate-700 transition-colors hover:border-slate-300">
                <input type="checkbox" checked={includeCondition} onChange={(event) => setIncludeCondition(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900" />
                <span><span className="font-semibold text-slate-800">Add a condition branch</span><span className="mt-0.5 block text-xs leading-5 text-slate-500">Route matching records through the action path.</span></span>
              </label>
              {includeCondition && (
                <div className="grid gap-3 rounded-md border border-indigo-100 bg-indigo-50/30 p-3 sm:grid-cols-3">
                  <div className="space-y-2 sm:col-span-3"><Label htmlFor="condition-field">Record field</Label><Input id="condition-field" value={conditionField} onChange={(event) => setConditionField(event.target.value)} placeholder="lead.score" /></div>
                  <div className="space-y-2"><Label htmlFor="condition-operator">Operator</Label><select id="condition-operator" className={selectClassName} value={conditionOperator} onChange={(event: SelectChange) => setConditionOperator(event.target.value as WorkflowComparisonOperator)}>{OPERATORS.map((operator) => <option key={operator.value} value={operator.value}>{operator.label}</option>)}</select></div>
                  <div className="space-y-2 sm:col-span-2"><Label htmlFor="condition-value">Value {conditionOperator === 'exists' && <span className="font-normal text-slate-400">(not used)</span>}</Label><Input id="condition-value" value={conditionValue} disabled={conditionOperator === 'exists'} onChange={(event) => setConditionValue(event.target.value)} placeholder="70 or qualified" /></div>
                  <p className="text-xs leading-5 text-slate-500 sm:col-span-3">For “is one of” and “is not one of”, enter comma-separated values. Numbers and booleans are converted automatically.</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-200/90 shadow-sm">
            <CardHeader className="border-b border-slate-100 pb-4">
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-amber-200 bg-amber-50 text-sm font-bold text-amber-700">04</span>
                <div><CardTitle className="flex items-center gap-2"><Zap className="h-4 w-4 text-amber-600" />Action</CardTitle><CardDescription className="mt-1">Choose the operation on the true branch.</CardDescription></div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 bg-slate-50/70 px-3 py-2.5 text-sm text-slate-700 transition-colors hover:border-slate-300">
                <input type="checkbox" checked={includeAction} onChange={(event) => setIncludeAction(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900" />
                <span><span className="font-semibold text-slate-800">Add an action node</span><span className="mt-0.5 block text-xs leading-5 text-slate-500">Lead fields, tags, owners, and pipeline stages run through the CRM services. Other actions stay guarded.</span></span>
              </label>
              {includeAction && (
                <div className="space-y-4 rounded-md border border-amber-100 bg-amber-50/30 p-3">
                  <div className="space-y-2"><Label htmlFor="workflow-action">Action type</Label><select id="workflow-action" className={selectClassName} value={actionType} onChange={handleActionTypeChange}>{ACTIONS.map((action) => <option key={action.value} value={action.value}>{action.label}</option>)}</select></div>
                  <div className="space-y-2"><Label htmlFor="workflow-action-input">Action input JSON</Label><Textarea id="workflow-action-input" value={actionInput} onChange={(event) => setActionInput(event.target.value)} className="min-h-28 font-mono text-xs" spellCheck={false} aria-describedby="workflow-action-help" /><p id="workflow-action-help" className="text-xs text-slate-500">Example: <code className="rounded bg-white px-1 text-[11px] text-slate-700">{selectedAction.example}</code></p></div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-200/90 shadow-sm">
            <CardHeader className="border-b border-slate-100 pb-4">
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-blue-200 bg-blue-50 text-sm font-bold text-blue-700">05</span>
                <div><CardTitle className="flex items-center gap-2"><ArrowDown className="h-4 w-4 text-blue-600" />Wait <span className="text-sm font-normal text-slate-400">(optional)</span></CardTitle><CardDescription className="mt-1">Resume through the worker scheduler before End.</CardDescription></div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 bg-slate-50/70 px-3 py-2.5 text-sm text-slate-700 transition-colors hover:border-slate-300">
                <input type="checkbox" checked={includeWait} onChange={(event) => setIncludeWait(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900" />
                <span><span className="font-semibold text-slate-800">Add a wait node after the action</span><span className="mt-0.5 block text-xs leading-5 text-slate-500">Use minutes for a delay between 1 minute and 30 days.</span></span>
              </label>
              {includeWait && <div className="max-w-xs space-y-2"><Label htmlFor="workflow-wait">Minutes</Label><Input id="workflow-wait" type="number" min={1} max={43200} step={1} value={waitMinutes} onChange={(event) => setWaitMinutes(event.target.value)} /><p className="text-xs text-slate-500">Between 1 minute and 43,200 minutes.</p></div>}
            </CardContent>
          </Card>

          {localError && <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{localError}</div>}
          <ValidationIssues issues={validationIssues} />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
            <p className="text-xs text-slate-500">Save creates a draft. Publishing is a separate lifecycle action.</p>
            <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" onClick={() => void validate()} disabled={validateWorkflow.isPending || createWorkflow.isPending}><CheckCircle2 className="mr-1.5 h-4 w-4" />{validateWorkflow.isPending ? 'Validating…' : 'Validate graph'}</Button><Button type="button" onClick={() => void handleSave()} disabled={validateWorkflow.isPending || createWorkflow.isPending}><Save className="mr-1.5 h-4 w-4" />{createWorkflow.isPending ? 'Saving…' : 'Save draft'}</Button></div>
          </div>
        </div>

        <aside className="space-y-5 xl:sticky xl:top-5 xl:self-start">
          <GraphPreview definition={liveDefinition} />
          <Card className="border-slate-200/90 shadow-sm">
            <CardHeader className="border-b border-slate-100 pb-4"><CardTitle className="text-sm">Lifecycle</CardTitle><CardDescription className="mt-1">A predictable path from draft to execution.</CardDescription></CardHeader>
            <CardContent className="space-y-3 text-xs leading-5 text-slate-600">
              <p><strong className="text-slate-800">Draft:</strong> saved but does not enroll leads.</p>
              <p><strong className="text-slate-800">Published:</strong> accepts matching events when automation is enabled.</p>
              <p><strong className="text-slate-800">Paused:</strong> keeps the definition but stops new execution work.</p>
              <div className="flex items-start gap-2 border-t border-slate-100 pt-3 text-amber-700"><Send className="mt-0.5 h-3.5 w-3.5 shrink-0" />Messages, tasks, notifications, and webhooks remain blocked until their consent and idempotency contracts are ready.</div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

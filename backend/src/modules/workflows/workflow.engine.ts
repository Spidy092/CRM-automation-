import type {
  WorkflowCondition,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowScalar,
  WorkflowValidationIssue,
} from './workflow.types';

export type WorkflowContext = Record<string, unknown>;

function getField(context: WorkflowContext, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (value === null || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[key];
  }, context);
}

function scalarEqual(left: unknown, right: WorkflowScalar): boolean {
  return left === right;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function evaluateFieldCondition(
  condition: Extract<WorkflowCondition, { field: string }>,
  context: WorkflowContext,
): boolean {
  const actual = getField(context, condition.field);
  const expected = condition.value;

  switch (condition.operator) {
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'eq':
      return expected !== undefined && !Array.isArray(expected) && scalarEqual(actual, expected);
    case 'neq':
      return expected === undefined || Array.isArray(expected) || !scalarEqual(actual, expected);
    case 'in':
      return (
        Array.isArray(expected) && expected.some((candidate) => scalarEqual(actual, candidate))
      );
    case 'not_in':
      return (
        !Array.isArray(expected) || !expected.some((candidate) => scalarEqual(actual, candidate))
      );
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const left = asNumber(actual);
      const right = asNumber(expected);
      if (left === null || right === null) return false;
      if (condition.operator === 'gt') return left > right;
      if (condition.operator === 'gte') return left >= right;
      if (condition.operator === 'lt') return left < right;
      return left <= right;
    }
    case 'contains':
      return (
        typeof actual === 'string' && typeof expected === 'string' && actual.includes(expected)
      );
    case 'starts_with':
      return (
        typeof actual === 'string' && typeof expected === 'string' && actual.startsWith(expected)
      );
    default:
      return false;
  }
}

/** Evaluate a workflow condition against an event/record context. */
export function evaluateWorkflowCondition(
  condition: WorkflowCondition,
  context: WorkflowContext,
): boolean {
  if ('field' in condition) return evaluateFieldCondition(condition, context);
  if ('all' in condition)
    return condition.all.every((child) => evaluateWorkflowCondition(child, context));
  if ('any' in condition)
    return condition.any.some((child) => evaluateWorkflowCondition(child, context));
  return !evaluateWorkflowCondition(condition.not, context);
}

function addIssue(issues: WorkflowValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function outgoingNodeIds(node: WorkflowNode): string[] {
  if (node.type !== 'condition' || !node.branches) return node.next;
  return [...new Set([...node.next, node.branches.true, node.branches.false])];
}

/** Resolve the next node for a condition after its predicate has been evaluated. */
export function resolveWorkflowNextNode(
  node: WorkflowNode,
  context: WorkflowContext,
): string | null {
  if (node.type === 'condition') {
    if (!node.branches || !node.condition) return null;
    return node.branches[evaluateWorkflowCondition(node.condition, context) ? 'true' : 'false'];
  }
  return node.next[0] ?? null;
}

function detectCycle(nodes: Map<string, WorkflowNode>): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const node = nodes.get(id);
    if (node && outgoingNodeIds(node).some((nextId) => visit(nextId))) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  }

  for (const id of nodes.keys()) {
    if (visit(id)) return true;
  }
  return false;
}

function findUnreachableNodes(entryNodeId: string, nodes: Map<string, WorkflowNode>): string[] {
  const reachable = new Set<string>();
  const pending = [entryNodeId];
  while (pending.length > 0) {
    const id = pending.pop();
    if (!id || reachable.has(id)) continue;
    reachable.add(id);
    const node = nodes.get(id);
    if (!node) continue;
    for (const nextId of outgoingNodeIds(node)) pending.push(nextId);
  }
  return [...nodes.keys()].filter((id) => !reachable.has(id));
}

/**
 * Validate graph invariants that cannot be expressed by the request schema.
 * This is safe to call at publish time and again before execution.
 */
export function validateWorkflowDefinition(
  definition: WorkflowDefinition,
): WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = [];
  const nodes = new Map<string, WorkflowNode>();

  for (const node of definition.nodes) {
    if (nodes.has(node.id)) addIssue(issues, `nodes.${node.id}`, 'Node IDs must be unique.');
    nodes.set(node.id, node);
  }

  const entry = nodes.get(definition.entryNodeId);
  if (!entry) addIssue(issues, 'entryNodeId', 'Entry node does not exist.');
  else if (entry.type !== 'trigger')
    addIssue(issues, 'entryNodeId', 'Entry node must be a trigger.');

  for (const node of definition.nodes) {
    for (const nextId of outgoingNodeIds(node)) {
      if (!nodes.has(nextId))
        addIssue(issues, `nodes.${node.id}.next`, `Unknown target node '${nextId}'.`);
    }
    if (node.type === 'trigger' && !node.trigger)
      addIssue(issues, `nodes.${node.id}`, 'Trigger node requires trigger configuration.');
    if (node.type === 'condition' && !node.condition)
      addIssue(issues, `nodes.${node.id}`, 'Condition node requires a condition.');
    if (node.type === 'condition' && !node.branches)
      addIssue(issues, `nodes.${node.id}`, 'Condition node requires true and false branches.');
    if (
      node.type === 'condition' &&
      node.branches &&
      node.next.some((nextId) => nextId !== node.branches?.true && nextId !== node.branches?.false)
    ) {
      addIssue(
        issues,
        `nodes.${node.id}.next`,
        'Condition node next edges must match its true and false branches.',
      );
    }
    if (node.type !== 'condition' && node.branches)
      addIssue(issues, `nodes.${node.id}.branches`, 'Only condition nodes may define branches.');
    if (node.type !== 'condition' && node.next.length > 1)
      addIssue(
        issues,
        `nodes.${node.id}.next`,
        'Only condition nodes may have more than one outgoing edge.',
      );
    if (node.type === 'action' && !node.action)
      addIssue(issues, `nodes.${node.id}`, 'Action node requires action configuration.');
    if (node.type === 'wait' && node.waitMinutes === undefined)
      addIssue(issues, `nodes.${node.id}`, 'Wait node requires waitMinutes.');
    if (node.type === 'wait' && node.next.length !== 1)
      addIssue(issues, `nodes.${node.id}.next`, 'Wait nodes require exactly one continuation.');
    if (node.type === 'goal' && !node.goal)
      addIssue(issues, `nodes.${node.id}`, 'Goal node requires a goal condition.');
    if (node.type === 'end' && node.next.length > 0)
      addIssue(issues, `nodes.${node.id}.next`, 'End nodes cannot have outgoing edges.');
  }

  if (detectCycle(nodes)) addIssue(issues, 'nodes', 'Workflow graph must be acyclic.');
  for (const nodeId of findUnreachableNodes(definition.entryNodeId, nodes)) {
    addIssue(issues, `nodes.${nodeId}`, 'Node is unreachable from entryNodeId.');
  }

  return issues;
}

import type { PlanStepRow } from './plan.types';

export function topoSortIntoWaves(steps: PlanStepRow[]): PlanStepRow[][] {
  const byIndex = new Map<number, PlanStepRow>();
  for (const s of steps) byIndex.set(s.step_index, s);

  // Build adjacency: node -> list of nodes that depend on it
  const adj: Map<number, number[]> = new Map();
  const indegree = new Map<number, number>();
  for (const s of steps) {
    adj.set(s.step_index, []);
    indegree.set(s.step_index, 0);
  }
  for (const s of steps) {
    for (const dep of s.depends_on) {
      adj.get(dep)!.push(s.step_index);
      indegree.set(s.step_index, (indegree.get(s.step_index) ?? 0) + 1);
    }
  }

  const waves: PlanStepRow[][] = [];
  let frontier = steps
    .filter((s) => (indegree.get(s.step_index) ?? 0) === 0)
    .map((s) => s.step_index);

  while (frontier.length > 0) {
    waves.push(frontier.map((i) => byIndex.get(i)!));
    const next: number[] = [];
    for (const n of frontier) {
      for (const m of adj.get(n) ?? []) {
        const newDeg = (indegree.get(m) ?? 0) - 1;
        indegree.set(m, newDeg);
        if (newDeg === 0) next.push(m);
      }
    }
    frontier = next;
  }

  if (waves.flat().length !== steps.length) {
    throw new Error('Plan contains a cycle');
  }

  return waves;
}

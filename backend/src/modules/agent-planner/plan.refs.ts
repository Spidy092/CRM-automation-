/**
 * Step-output references let a plan step consume the result of an earlier step.
 *
 * Syntax: a string arg value of exactly `$steps.<index>.<path>`, e.g.
 *   "$steps.0.id"            → result of step 0, field `id`
 *   "$steps.1.items.*.id"    → map over the `items` array of step 1, picking `id`
 *
 * References must be whole string values (no interpolation inside larger
 * strings). A `*` segment maps the remaining path over an array. Referenced
 * steps must be declared in `depends_on`, so the topological runner guarantees
 * the result exists before resolution.
 *
 * Resolution failures throw StepRefError; the runner marks the step failed
 * exactly like any other execution error.
 */

export class StepRefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StepRefError';
    Object.setPrototypeOf(this, StepRefError.prototype);
  }
}

const STEP_REF_RE = /^\$steps\.(\d+)\.(.+)$/;

export function parseStepRef(value: unknown): { stepIndex: number; path: string } | null {
  if (typeof value !== 'string') return null;
  const match = STEP_REF_RE.exec(value);
  if (!match) return null;
  return { stepIndex: Number(match[1]), path: match[2] };
}

/** Collect the step indexes referenced anywhere inside an args object. */
export function collectStepRefs(args: unknown): number[] {
  const found = new Set<number>();
  const walk = (value: unknown): void => {
    const ref = parseStepRef(value);
    if (ref) {
      found.add(ref.stepIndex);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value && typeof value === 'object') {
      Object.values(value as Record<string, unknown>).forEach(walk);
    }
  };
  walk(args);
  return [...found].sort((a, b) => a - b);
}

function resolvePath(result: unknown, path: string, refText: string): unknown {
  const segments = path.split('.');
  let current: unknown = result;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment === '*') {
      if (!Array.isArray(current)) {
        throw new StepRefError(`Step reference ${refText}: '*' applied to a non-array value`);
      }
      const rest = segments.slice(i + 1).join('.');
      return (current as unknown[]).map((item) => (rest ? resolvePath(item, rest, refText) : item));
    }
    if (current === null || current === undefined || typeof current !== 'object') {
      throw new StepRefError(`Step reference ${refText}: path segment '${segment}' not found`);
    }
    current = (current as Record<string, unknown>)[segment];
  }
  if (current === undefined) {
    throw new StepRefError(`Step reference ${refText}: resolved to undefined`);
  }
  return current;
}

/**
 * Replace every `$steps.N.path` string in the args with the value from the
 * corresponding step result. Throws StepRefError when a referenced result is
 * missing or the path does not resolve.
 */
export function resolveStepArgs(
  args: Record<string, unknown>,
  resultsByIndex: Map<number, Record<string, unknown> | null>,
): Record<string, unknown> {
  const substitute = (value: unknown): unknown => {
    const ref = parseStepRef(value);
    if (ref) {
      if (!resultsByIndex.has(ref.stepIndex)) {
        throw new StepRefError(
          `Step reference ${String(value)}: step ${ref.stepIndex} has no recorded result`,
        );
      }
      return resolvePath(resultsByIndex.get(ref.stepIndex), ref.path, String(value));
    }
    if (Array.isArray(value)) return value.map(substitute);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, substitute(v)]),
      );
    }
    return value;
  };
  return substitute(args) as Record<string, unknown>;
}

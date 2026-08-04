/**
 * Merge-field helpers shared by every surface that composes template bodies —
 * the full template editor and the inline composer in the campaign wizard.
 * Keep the pattern in one place so both derive the same `variables` array.
 */

const VARIABLE_PATTERN = /\{\{(\w+)\}\}/g;

/** Collect the distinct `{{merge_field}}` names used in a template body. */
export function extractVariables(body: string): string[] {
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  VARIABLE_PATTERN.lastIndex = 0;
  while ((m = VARIABLE_PATTERN.exec(body)) !== null) {
    found.add(m[1]);
  }
  return Array.from(found);
}

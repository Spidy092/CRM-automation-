export function isAgentPlannerEnabled(override?: boolean | null): boolean {
  if (typeof override === 'boolean') return override;
  const env = process.env.NODE_ENV;
  const explicit = process.env.AGENT_PLANNER_ENABLED;
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  return env !== 'production';
}

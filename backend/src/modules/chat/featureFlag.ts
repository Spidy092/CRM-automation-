export function isAgentPlannerEnabled(): boolean {
  const env = process.env.NODE_ENV;
  const explicit = process.env.AGENT_PLANNER_ENABLED;
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  return env !== 'production';
}

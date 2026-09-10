/**
 * The runtime stays off until the additive workflow/outbox migrations and
 * transactional producers have been deployed together.
 */
export function workflowAutomationEnabled(): boolean {
  return process.env.WORKFLOW_AUTOMATION_ENABLED === 'true';
}

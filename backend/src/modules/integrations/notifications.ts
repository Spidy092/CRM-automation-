/**
 * Sprint 2 stub for outbound Slack / Teams notifications.
 *
 * Real vendor wiring (templated messages, retries, channel mapping per
 * workspace) is Sprint 3 work. For now this module:
 *   - Reads webhook URLs from environment variables.
 *   - Sends a simple `application/json` POST to each configured endpoint
 *     using the runtime's built-in `fetch` (Node 18+).
 *   - Catches every transport error and logs at `warn` — never throws.
 *
 * Adding this as a stand-alone module keeps the worker free of HTTP
 * concerns and gives us a single seam to swap in the Sprint 3 dispatcher
 * without touching call sites.
 */

import { logger } from '../../shared/utils/logger';

export interface AssignmentNotification {
  leadId: string;
  leadName: string | null;
  assignedTo: string;
  assignedBy: string;
  score: number;
  classification: 'hot' | 'warm' | 'cold';
}

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const TEAMS_WEBHOOK_URL = process.env.TEAMS_WEBHOOK_URL;

interface DispatchResult {
  slack: 'sent' | 'skipped' | 'failed';
  teams: 'sent' | 'skipped' | 'failed';
}

export async function notifyAssignment(payload: AssignmentNotification): Promise<DispatchResult> {
  const result: DispatchResult = {
    slack: SLACK_WEBHOOK_URL ? 'sent' : 'skipped',
    teams: TEAMS_WEBHOOK_URL ? 'sent' : 'skipped',
  };

  // Fire both in parallel; failures are logged but never propagated.
  const tasks: Array<Promise<void>> = [];
  if (SLACK_WEBHOOK_URL) {
    tasks.push(
      postSlack(SLACK_WEBHOOK_URL, payload).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn('slack notification failed', { leadId: payload.leadId, error: message });
        result.slack = 'failed';
      }),
    );
  }
  if (TEAMS_WEBHOOK_URL) {
    tasks.push(
      postTeams(TEAMS_WEBHOOK_URL, payload).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn('teams notification failed', { leadId: payload.leadId, error: message });
        result.teams = 'failed';
      }),
    );
  }

  await Promise.all(tasks);

  logger.info('assignment notification dispatched', {
    leadId: payload.leadId,
    assignedTo: payload.assignedTo,
    slack: result.slack,
    teams: result.teams,
  });

  return result;
}

async function postSlack(url: string, payload: AssignmentNotification): Promise<void> {
  // Slack incoming-webhook format: `{ text: string }`.
  const text =
    `:zap: New lead assigned: *${payload.leadName ?? payload.leadId}* ` +
    `(score ${payload.score}, ${payload.classification}) → <@${payload.assignedTo}>`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) {
    throw new Error(`slack webhook returned ${res.status}`);
  }
}

async function postTeams(url: string, payload: AssignmentNotification): Promise<void> {
  // Teams incoming-webhook (MessageCard) format.
  const card = {
    '@type': 'MessageCard',
    '@context': 'https://schema.org/extensions',
    summary: `New lead assigned: ${payload.leadName ?? payload.leadId}`,
    themeColor: '6366F1',
    title: 'New lead assigned',
    text: `**${payload.leadName ?? payload.leadId}** was round-robin-assigned to user \`${payload.assignedTo}\` (score ${payload.score}, ${payload.classification}).`,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(card),
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) {
    throw new Error(`teams webhook returned ${res.status}`);
  }
}

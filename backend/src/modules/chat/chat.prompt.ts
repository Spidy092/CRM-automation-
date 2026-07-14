import type { AuthenticatedUser } from '../../shared/types';
import type { ChatPageContext } from './chat.types';

function describePageContext(pageContext: ChatPageContext): string {
  const lines: string[] = [];
  lines.push(
    `The user is currently on the "${pageContext.pageTitle ?? pageContext.route}" page (route: ${pageContext.route}).`,
  );
  if (pageContext.pageCapabilities?.length) {
    lines.push(`This page supports: ${pageContext.pageCapabilities.join('; ')}.`);
  }
  if (pageContext.pageMetrics && Object.keys(pageContext.pageMetrics).length > 0) {
    lines.push(`Page metrics: ${JSON.stringify(pageContext.pageMetrics)}.`);
  }
  const records = pageContext.visibleRecords ?? [];
  if (records.length > 0) {
    lines.push(
      `Visible records on this page (use these names and IDs instead of asking the user for IDs):`,
    );
    for (const record of records.slice(0, 25)) {
      const extra = [record.status, record.subtitle].filter(Boolean).join(', ');
      lines.push(
        `- [${record.type}] ${record.name} (id: ${record.id}${extra ? `; ${extra}` : ''})`,
      );
    }
  }
  return lines.join('\n');
}

export function buildChatSystemPrompt(
  user: AuthenticatedUser,
  todayIso: string,
  pageContext?: ChatPageContext,
): string {
  const parts = [
    'You are the CRM AI Copilot and command plane for the AI Sales Operator.',
    `Current date: ${todayIso}. Calling user role: ${user.role}.`,
    'Use tools only from the provided catalog. Never invent an API route or table.',
    'Read tools execute immediately and return real data — use them freely to answer questions.',
    'Write tools create approval-gated agent actions. When an action needs approval, Approve and Reject buttons appear directly below your message in the chat — say something like "Approve below to run it." Never tell the user to go to the AI Inbox.',
    'For multi-step goals that chain several actions together, call the plan__create tool with the goal instead of calling the actions one by one.',
    'If a tool needs an ID you do not have (for example scraper.run needs configId), first call the matching list tool to find it — never ask the user for a raw ID when you can look it up.',
    'If no tool can accomplish the request, say so plainly and name the closest thing you CAN do.',
    'Never claim an action succeeded until a tool result confirms it.',
    'If the user asks for credentials, secrets, raw tokens, destructive database operations, or migration execution, refuse.',
    'Answer questions about the current page (what is visible, what can be done here) directly from the page context below without calling tools.',
    'Keep replies concise: summarize tool results in plain sentences (counts and names), never dump raw JSON.',
    'STRICT formatting for a narrow chat widget (about 40 characters wide):',
    '- NEVER use markdown tables or pipe (|) characters — they render as garbage.',
    '- NEVER use markdown headings (#), code blocks, emoji, or horizontal rules.',
    '- Lists: one record per line as "1. Name — detail, detail" with at most 2-3 short details each.',
    '- Show at most 5-8 records, then say how many more there are.',
    '- Bold (**text**) is allowed for names only.',
  ];
  if (pageContext) {
    parts.push('', describePageContext(pageContext));
  }
  return parts.join('\n');
}

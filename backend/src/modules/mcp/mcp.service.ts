import { ZodError } from 'zod';
import { AppError } from '../../shared/middleware/errorHandler';
import { AGENT_ACTIONS } from '../agent/agent.actions';
import { proposeAgentAction } from '../agent/agent.service';
import type { AgentActor } from '../agent/agent.types';
// actionParameters is the single source of truth for per-action JSON Schemas
// (already maintained for the in-app Copilot's OpenAI tools) — reuse it here
// so MCP and chat tool schemas can never drift apart.
import { actionParameters, actionNameToToolName, toolNameToActionName } from '../chat/chat.actions';
import { logger } from '../../shared/utils/logger';
import type { McpToolDefinition, McpToolCallResult } from './mcp.types';

/**
 * MCP tool names must match ^[a-zA-Z0-9_-]{1,64}$, so dots become double
 * underscores — the same convention the in-app Copilot uses for OpenAI tools.
 */
export function listMcpTools(actor: AgentActor): McpToolDefinition[] {
  return Object.values(AGENT_ACTIONS)
    .filter((definition) => definition.allowedRoles.includes(actor.role))
    .map((definition) => ({
      name: actionNameToToolName(definition.name),
      description: `${definition.description} [risk: ${definition.riskTier}]`,
      inputSchema: actionParameters[definition.name],
    }));
}

/**
 * Execute an MCP tools/call by routing through the agent action pipeline.
 *
 * source is 'chat' so the policy gate treats MCP clients exactly like the
 * in-app Copilot: reads execute immediately, every write requires human
 * approval via an AI Inbox item. The sourceMessage marks the action as
 * MCP-originated in agent_actions / ai_decision_log for auditability.
 */
export async function callMcpTool(
  toolName: string,
  args: Record<string, unknown>,
  actor: AgentActor,
): Promise<McpToolCallResult> {
  const actionName = toolNameToActionName(toolName);
  if (!AGENT_ACTIONS[actionName]) {
    return errorResult(`Unknown tool: ${toolName}`);
  }

  try {
    const proposal = await proposeAgentAction({
      source: 'chat',
      actionName: actionName,
      args,
      actor,
      sourceMessage: `MCP tool call: ${toolName}`,
    });

    if (proposal.policy.outcome === 'reject') {
      return errorResult(`Action rejected: ${proposal.policy.reason}`);
    }

    if (proposal.policy.outcome === 'require_approval') {
      return textResult({
        status: 'pending_approval',
        reason: proposal.policy.reason,
        agent_action_id: proposal.action?.id ?? null,
        message:
          'This write action was recorded and needs human approval in the AI Inbox before it executes.',
      });
    }

    return textResult({ status: 'succeeded', result: proposal.result ?? null });
  } catch (err) {
    const message = formatToolCallError(err);
    logger.error('mcp: tool call failed', { toolName, error: message });
    return errorResult(`Tool call failed: ${message}`);
  }
}

/**
 * Mirrors errorHandler.ts's ZodError formatting (`err.errors.map(...).join(', ')`)
 * so MCP clients get the same human-readable validation message as REST callers,
 * instead of the raw stringified ZodError JSON that Error#message produces.
 */
function formatToolCallError(err: unknown): string {
  if (err instanceof ZodError) {
    return err.errors.map((e) => e.message).join(', ');
  }
  if (err instanceof AppError) {
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

function textResult(payload: Record<string, unknown>): McpToolCallResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

function errorResult(message: string): McpToolCallResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

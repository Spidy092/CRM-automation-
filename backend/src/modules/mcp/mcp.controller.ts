import type { Request, Response } from 'express';
import { toAgentActor } from '../agent/agent.types';
import {
  jsonRpcBodySchema,
  initializeParamsSchema,
  toolsCallParamsSchema,
  type JsonRpcMessage,
} from './mcp.schema';
import {
  type JsonRpcResponse,
  JSONRPC_INVALID_REQUEST,
  JSONRPC_METHOD_NOT_FOUND,
  JSONRPC_INVALID_PARAMS,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  DEFAULT_PROTOCOL_VERSION,
} from './mcp.types';
import { listMcpTools, callMcpTool } from './mcp.service';
import type { AgentActor } from '../agent/agent.types';

/**
 * Stateless MCP Streamable HTTP endpoint (single POST, JSON responses, no
 * SSE stream and no server-issued session ids — both optional per spec).
 */
export async function handleMcpPost(req: Request, res: Response): Promise<void> {
  const parsed = jsonRpcBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      jsonrpc: '2.0',
      id: null,
      error: { code: JSONRPC_INVALID_REQUEST, message: 'Invalid JSON-RPC request body' },
    });
    return;
  }

  const actor = toAgentActor(req.user!, req.ip);
  const messages = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  const responses: JsonRpcResponse[] = [];

  for (const message of messages) {
    const response = await handleMessage(message, actor);
    if (response) responses.push(response);
  }

  // Notification-only batch: acknowledge with no body (spec: 202 Accepted).
  if (responses.length === 0) {
    res.status(202).end();
    return;
  }

  res.status(200).json(Array.isArray(parsed.data) ? responses : responses[0]);
}

/** MCP clients may open GET for an SSE stream; this server does not offer one. */
export function handleMcpGet(_req: Request, res: Response): void {
  res
    .status(405)
    .set('Allow', 'POST')
    .json({
      jsonrpc: '2.0',
      id: null,
      error: { code: JSONRPC_METHOD_NOT_FOUND, message: 'SSE stream not supported; use POST' },
    });
}

async function handleMessage(
  message: JsonRpcMessage,
  actor: AgentActor,
): Promise<JsonRpcResponse | null> {
  // Notifications (no id) never get a response.
  if (message.id === undefined) return null;

  switch (message.method) {
    case 'initialize': {
      const params = initializeParamsSchema.safeParse(message.params ?? {});
      if (!params.success) {
        return invalidParams(message.id, 'initialize requires protocolVersion');
      }
      const requested = params.data.protocolVersion;
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
            ? requested
            : DEFAULT_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
        },
      };
    }
    case 'ping':
      return { jsonrpc: '2.0', id: message.id, result: {} };
    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: { tools: listMcpTools(actor) as unknown as Record<string, unknown>[] } as Record<
          string,
          unknown
        >,
      };
    case 'tools/call': {
      const params = toolsCallParamsSchema.safeParse(message.params ?? {});
      if (!params.success) {
        return invalidParams(message.id, 'tools/call requires a valid tool name');
      }
      const result = await callMcpTool(params.data.name, params.data.arguments ?? {}, actor);
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: result as unknown as Record<string, unknown>,
      };
    }
    default:
      return {
        jsonrpc: '2.0',
        id: message.id,
        error: { code: JSONRPC_METHOD_NOT_FOUND, message: `Method not found: ${message.method}` },
      };
  }
}

function invalidParams(id: JsonRpcMessage['id'], message: string): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code: JSONRPC_INVALID_PARAMS, message },
  };
}

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

import crypto from 'crypto';

// In-memory store for active SSE sessions.
// For a multi-instance deployment, this requires sticky sessions or a pub/sub backplane.
const sseSessions = new Map<string, Response>();

/**
 * Handles incoming JSON-RPC POST messages.
 * If a ?sessionId=... query parameter is provided, it routes the response over the corresponding SSE stream.
 * Otherwise, it responds statelessly directly to the POST request.
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

  const sessionId = req.query.sessionId as string | undefined;

  // Notification-only batch
  if (responses.length === 0) {
    res.status(202).end();
    return;
  }

  const finalResponse = Array.isArray(parsed.data) ? responses : responses[0];

  if (sessionId) {
    const sseStream = sseSessions.get(sessionId);
    if (!sseStream) {
      res.status(404).json({
        jsonrpc: '2.0',
        id: null,
        error: { code: JSONRPC_INVALID_REQUEST, message: 'SSE session not found' },
      });
      return;
    }
    // Send standard MCP SSE message event
    sseStream.write(`event: message\ndata: ${JSON.stringify(finalResponse)}\n\n`);
    res.status(202).end(); // Acknowledge receipt to the POST client
  } else {
    // Stateless POST behavior
    res.status(200).json(finalResponse);
  }
}

/**
 * Establishes an SSE stream for MCP clients.
 * Generates a unique sessionId, stores the connection, and emits the 'endpoint' event.
 */
export function handleMcpGet(req: Request, res: Response): void {
  // Only accept SSE connections
  if (req.headers.accept !== 'text/event-stream') {
    res.status(400).json({
      jsonrpc: '2.0',
      id: null,
      error: { code: JSONRPC_INVALID_REQUEST, message: 'Only text/event-stream is supported for GET' },
    });
    return;
  }

  const sessionId = crypto.randomUUID();

  // Setup SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Add to active sessions
  sseSessions.set(sessionId, res);

  // Clean up on client disconnect
  req.on('close', () => {
    sseSessions.delete(sessionId);
  });

  // Construct the absolute POST endpoint URL for this session
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  // req.originalUrl could be /api/v1/mcp
  const endpointUrl = `${protocol}://${host}${req.originalUrl.split('?')[0]}/message?sessionId=${sessionId}`;

  // Emit the MCP endpoint event
  res.write(`event: endpoint\ndata: ${endpointUrl}\n\n`);
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







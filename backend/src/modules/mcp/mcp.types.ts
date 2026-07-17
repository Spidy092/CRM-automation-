import type { JsonRpcId } from './mcp.schema';

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolResultContent {
  type: 'text';
  text: string;
}

export interface McpToolCallResult {
  content: McpToolResultContent[];
  isError?: boolean;
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: Record<string, unknown>;
}

export interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  id: JsonRpcId | null;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcErrorResponse;

// JSON-RPC 2.0 standard error codes.
export const JSONRPC_PARSE_ERROR = -32700;
export const JSONRPC_INVALID_REQUEST = -32600;
export const JSONRPC_METHOD_NOT_FOUND = -32601;
export const JSONRPC_INVALID_PARAMS = -32602;
export const JSONRPC_INTERNAL_ERROR = -32603;

export const MCP_SERVER_NAME = 'crm-ai-sales-operator';
export const MCP_SERVER_VERSION = '1.0.0';
export const SUPPORTED_PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18'];
export const DEFAULT_PROTOCOL_VERSION = '2025-03-26';

import { z } from 'zod';

/**
 * JSON-RPC 2.0 envelope for MCP Streamable HTTP requests.
 * A POST body may be a single message or a batch array (2025-03-26 spec).
 */
export const jsonRpcIdSchema = z.union([z.string(), z.number()]);

export const jsonRpcMessageSchema = z.object({
  jsonrpc: z.literal('2.0'),
  // Absent id ⇒ notification (no response expected).
  id: jsonRpcIdSchema.optional(),
  method: z.string().min(1).max(100),
  params: z.record(z.unknown()).optional(),
});

export const jsonRpcBodySchema = z.union([
  jsonRpcMessageSchema,
  z.array(jsonRpcMessageSchema).min(1).max(20),
]);

export const initializeParamsSchema = z.object({
  protocolVersion: z.string().min(1).max(40),
  capabilities: z.record(z.unknown()).optional(),
  clientInfo: z
    .object({
      name: z.string().max(200).optional(),
      version: z.string().max(100).optional(),
    })
    .passthrough()
    .optional(),
});

export const toolsCallParamsSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, 'tool name must match ^[a-zA-Z0-9_-]+$'),
  arguments: z.record(z.unknown()).optional(),
});

export type JsonRpcMessage = z.infer<typeof jsonRpcMessageSchema>;
export type JsonRpcId = z.infer<typeof jsonRpcIdSchema>;

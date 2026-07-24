import { Router, type Request, type Response } from 'express';
import { wrap } from '../../shared/utils/asyncHandler';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import { authenticatedLimiter } from '../../shared/middleware/rateLimiter';
import { handleMcpPost, handleMcpGet } from './mcp.controller';

const router = Router();

// ── OAuth Protected Resource Metadata (RFC 9728) ─────────────────────────────
// Claude Web checks this endpoint to understand what auth the MCP server needs.
// Returning an empty authorization_servers array tells Claude to use a plain
// Bearer token (API key) rather than initiating an OAuth flow.
router.get('/oauth/protected-resource', (_req: Request, res: Response): void => {
  const base = process.env.BACKEND_URL ?? 'https://crm.gururajhr.in';
  res.json({
    resource: `${base}/api/v1/mcp`,
    authorization_servers: [],
    bearer_methods_supported: ['header', 'query'],
    resource_documentation: `${base}/docs/MCP_CONNECTION.md`,
  });
});

// MCP Streamable HTTP endpoint. Clients authenticate with the same JWT
// bearer token as the REST API or with ?apiKey=crm_... query parameter.
// Per-action RBAC and the agent policy gate are enforced inside the action pipeline.

// Middleware that also sets WWW-Authenticate on 401 so Claude can
// discover the resource metadata endpoint without an OAuth server.
const mcpAuthenticate = async (req: Request, res: Response, next: () => void): Promise<void> => {
  const originalJson = res.json.bind(res);
  // Intercept 401 to inject the WWW-Authenticate header
  res.json = (body: unknown) => {
    if (res.statusCode === 401) {
      const base = process.env.BACKEND_URL ?? 'https://crm.gururajhr.in';
      res.setHeader(
        'WWW-Authenticate',
        `Bearer realm="CRM", resource_metadata="${base}/api/v1/mcp/oauth/protected-resource"`,
      );
    }
    return originalJson(body);
  };
  await authenticate(req, res, next);
};

router.use(mcpAuthenticate, authenticatedLimiter);

router.post(
  '/',
  authorize('admin', 'manager', 'sales', 'marketing', 'viewer'),
  wrap(handleMcpPost),
);
router.post(
  '/message',
  authorize('admin', 'manager', 'sales', 'marketing', 'viewer'),
  wrap(handleMcpPost),
);
router.get('/', authorize('admin', 'manager', 'sales', 'marketing', 'viewer'), handleMcpGet);

export { router as mcpRoutes };

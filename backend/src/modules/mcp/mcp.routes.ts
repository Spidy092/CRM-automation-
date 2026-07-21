import { Router } from 'express';
import { wrap } from '../../shared/utils/asyncHandler';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import { authenticatedLimiter } from '../../shared/middleware/rateLimiter';
import { handleMcpPost, handleMcpGet } from './mcp.controller';

const router = Router();

// MCP Streamable HTTP endpoint. Clients authenticate with the same JWT
// bearer token as the REST API; per-action RBAC and the agent policy gate
// are enforced inside the action pipeline.
router.use(authenticate, authenticatedLimiter);

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

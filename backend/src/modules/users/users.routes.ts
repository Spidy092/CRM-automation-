import { Router } from 'express';
import { wrap } from '../../shared/utils/asyncHandler';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import { authenticatedLimiter, passwordChangeLimiter } from '../../shared/middleware/rateLimiter';
import {
  createUserHandler,
  listUsersHandler,
  getUserHandler,
  updateProfileHandler,
  updatePermissionsHandler,
  changePasswordHandler,
} from './users.controller';

const router = Router();

// All users routes require a valid JWT and rate limiting.
router.use(authenticate);
router.use(authenticatedLimiter);

// POST /api/v1/users — Create a new user. Admin only.
router.post('/', authorize('admin'), wrap(createUserHandler));

// GET /api/v1/users — List all users. Admin and Manager only.
router.get('/', authorize('admin', 'manager'), wrap(listUsersHandler));

// GET /api/v1/users/:id — Get a single user.
// All authenticated roles allowed; service enforces ownership for non-admin/manager.
router.get(
  '/:id',
  authorize('admin', 'manager', 'sales', 'marketing', 'viewer'),
  wrap(getUserHandler),
);

// PATCH /api/v1/users/:id — Update own name (or any user if admin).
// All authenticated roles allowed; service enforces ownership restriction.
router.patch(
  '/:id',
  authorize('admin', 'manager', 'sales', 'marketing', 'viewer'),
  wrap(updateProfileHandler),
);

// PATCH /api/v1/users/:id/permissions — Update role and/or active status. Admin only.
router.patch('/:id/permissions', authorize('admin'), wrap(updatePermissionsHandler));

// PATCH /api/v1/users/:id/password — Change own password (current + new). All authenticated roles.
// Protected by rateLimiter to prevent brute-forcing passwords. Service enforces ownership.
router.patch(
  '/:id/password',
  passwordChangeLimiter,
  authorize('admin', 'manager', 'sales', 'marketing', 'viewer'),
  wrap(changePasswordHandler),
);

export { router as usersRoutes };

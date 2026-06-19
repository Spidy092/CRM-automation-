import { Router } from 'express';
import { wrap } from '../../shared/utils/asyncHandler';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import {
  createDefinitionHandler,
  listDefinitionsHandler,
  updateDefinitionHandler,
} from './customFields.controller';

const router = Router();

// All custom-field routes require authentication.
router.use(authenticate);

// All authenticated roles can read the field catalog (UI needs it to render forms).
router.get('/', wrap(listDefinitionsHandler));

// Only admins manage custom field definitions.
router.post('/', authorize('admin'), wrap(createDefinitionHandler));
router.put('/:id', authorize('admin'), wrap(updateDefinitionHandler));

export { router as customFieldsRoutes };

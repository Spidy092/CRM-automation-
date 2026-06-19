import { Router } from 'express';
import { wrap } from '../../shared/utils/asyncHandler';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import { authenticatedLimiter } from '../../shared/middleware/rateLimiter';
import {
  listPipelinesHandler,
  getPipelineHandler,
  createPipelineHandler,
  updatePipelineHandler,
  deletePipelineHandler,
  listStagesHandler,
  createStageHandler,
  updateStageHandler,
  deleteStageHandler,
  moveLeadHandler,
} from './pipeline.controller';

const router = Router();

router.use(authenticate, authenticatedLimiter);

router.get('/', wrap(listPipelinesHandler));
router.get('/:id', wrap(getPipelineHandler));
router.post('/', authorize('admin', 'manager'), wrap(createPipelineHandler));
router.put('/:id', authorize('admin', 'manager'), wrap(updatePipelineHandler));
router.delete('/:id', authorize('admin'), wrap(deletePipelineHandler));

router.get('/:pipelineId/stages', wrap(listStagesHandler));
router.post('/:pipelineId/stages', authorize('admin', 'manager'), wrap(createStageHandler));
router.put('/stages/:id', authorize('admin', 'manager'), wrap(updateStageHandler));
router.delete('/stages/:id', authorize('admin', 'manager'), wrap(deleteStageHandler));

router.post('/move-lead', authorize('admin', 'manager', 'sales'), wrap(moveLeadHandler));

export { router as pipelineRoutes };

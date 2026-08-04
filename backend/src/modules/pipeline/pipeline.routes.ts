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

router.post('/move-lead', authorize('admin', 'manager', 'sales'), wrap(moveLeadHandler));

router.get('/stages/:id', wrap(listStagesHandler));
router.put('/stages/:id', authorize('admin', 'manager'), wrap(updateStageHandler));
router.delete('/stages/:id', authorize('admin', 'manager'), wrap(deleteStageHandler));

router.get('/:pipelineId/stages', wrap(listStagesHandler));
router.post('/:pipelineId/stages', authorize('admin', 'manager'), wrap(createStageHandler));

router.get('/', wrap(listPipelinesHandler));
router.post('/', authorize('admin', 'manager'), wrap(createPipelineHandler));
router.get('/:id', wrap(getPipelineHandler));
router.put('/:id', authorize('admin', 'manager'), wrap(updatePipelineHandler));
router.delete('/:id', authorize('admin'), wrap(deletePipelineHandler));

export { router as pipelineRoutes };

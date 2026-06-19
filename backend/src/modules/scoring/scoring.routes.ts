import { Router } from 'express';
import { wrap } from '../../shared/utils/asyncHandler';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import { authenticatedLimiter } from '../../shared/middleware/rateLimiter';
import {
  getConfigHandler,
  updateConfigHandler,
  listRulesHandler,
  getRuleHandler,
  createRuleHandler,
  updateRuleHandler,
  deleteRuleHandler,
  calculateScoreHandler,
  recalculateAllHandler,
} from './scoring.controller';

const router = Router();

router.use(authenticate, authenticatedLimiter);

router.get('/config', wrap(getConfigHandler));
router.put('/config', authorize('admin', 'manager'), wrap(updateConfigHandler));

router.get('/rules', wrap(listRulesHandler));
router.get('/rules/:id', wrap(getRuleHandler));
router.post('/rules', authorize('admin', 'manager'), wrap(createRuleHandler));
router.put('/rules/:id', authorize('admin', 'manager'), wrap(updateRuleHandler));
router.delete('/rules/:id', authorize('admin'), wrap(deleteRuleHandler));

router.post('/calculate/:leadId', authorize('admin', 'manager'), wrap(calculateScoreHandler));
router.post('/recalculate-all', authorize('admin'), wrap(recalculateAllHandler));

export { router as scoringRoutes };

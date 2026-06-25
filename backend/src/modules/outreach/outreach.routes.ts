import { Router } from 'express';
import { wrap } from '../../shared/utils/asyncHandler';
import { authenticate } from '../../shared/middleware/auth';
import { authorize } from '../../shared/middleware/rbac';
import { authenticatedLimiter } from '../../shared/middleware/rateLimiter';
import {
  listSequencesHandler,
  getSequenceHandler,
  createSequenceHandler,
  updateSequenceHandler,
  deleteSequenceHandler,
  getLeadTimelineHandler,
  getLeadLogsHandler,
  listTasksHandler,
  sendManualOutreachHandler,
  createTaskHandler,
  updateTaskHandler,
} from './outreach.controller';

const router = Router();

router.use(authenticate, authenticatedLimiter);

// Sequences
router.get('/sequences', wrap(listSequencesHandler));
router.get('/sequences/:id', wrap(getSequenceHandler));
router.post('/sequences', authorize('admin', 'marketing'), wrap(createSequenceHandler));
router.put('/sequences/:id', authorize('admin', 'marketing'), wrap(updateSequenceHandler));
router.delete('/sequences/:id', authorize('admin', 'marketing'), wrap(deleteSequenceHandler));

// Lead activity timeline
router.get('/leads/:leadId/timeline', wrap(getLeadTimelineHandler));
router.get('/leads/:leadId/logs', wrap(getLeadLogsHandler));

router.post('/send', authorize('admin', 'manager', 'sales'), wrap(sendManualOutreachHandler));

// Tasks (sales + admin + manager can create/update)
router.get('/tasks', authorize('admin', 'manager', 'sales'), wrap(listTasksHandler));
router.post('/tasks', authorize('admin', 'manager', 'sales'), wrap(createTaskHandler));
router.put('/tasks/:id', authorize('admin', 'manager', 'sales'), wrap(updateTaskHandler));

export { router as outreachRoutes };

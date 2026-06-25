import { Router } from 'express';
import { authenticate } from '../../shared/middleware/auth';
import { requireRole } from '../../shared/middleware/rbac';
import { getInbox, actionInboxItem } from './ai-inbox.controller';

const router = Router();

// All roles that interact with leads can see their inbox
router.get('/', authenticate, requireRole(['admin', 'manager', 'sales', 'marketing']), getInbox);

// Action an inbox item (approve / reject / snooze)
router.patch('/:id/action', authenticate, requireRole(['admin', 'manager', 'sales', 'marketing']), actionInboxItem);

export default router;

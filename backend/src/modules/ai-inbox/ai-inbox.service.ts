import { logger } from '../../shared/utils/logger';
import { incAiInboxItem } from '../../shared/utils/metrics';
import {
  createInboxItem,
  findInboxItems,
  findInboxItemById,
  actionInboxItem,
  countInboxItems,
  expireGuardedItems,
} from './ai-inbox.repository';
import type {
  AiInboxItem,
  CreateInboxItemInput,
  ListInboxItemsOptions,
} from './ai-inbox.types';

export async function createItem(input: CreateInboxItemInput): Promise<AiInboxItem> {
  const item = await createInboxItem(input);
  incAiInboxItem(item.item_type, 'created');
  logger.info('ai inbox: item created', {
    id: item.id,
    type: item.item_type,
    assignedTo: item.assigned_to,
    urgency: item.urgency_score,
  });
  return item;
}

export async function listItems(opts: ListInboxItemsOptions): Promise<{
  items: AiInboxItem[];
  total: number;
}> {
  const [items, total] = await Promise.all([
    findInboxItems(opts),
    countInboxItems(opts.assigned_to),
  ]);
  return { items, total };
}

export async function actionItem(
  id: string,
  userId: string,
  action: 'approve' | 'reject' | 'snooze',
  snoozedUntil?: string,
): Promise<AiInboxItem> {
  const existing = await findInboxItemById(id);
  if (!existing) throw new Error(`Inbox item not found: ${id}`);

  const statusMap = { approve: 'actioned', reject: 'actioned', snooze: 'snoozed' } as const;

  const updated = await actionInboxItem(id, {
    status: statusMap[action],
    actioned_by: userId,
    snoozed_until: action === 'snooze' ? snoozedUntil : undefined,
  });

  if (!updated) throw new Error(`Failed to action inbox item: ${id}`);

  incAiInboxItem(updated.item_type, action);
  logger.info('ai inbox: item actioned', {
    id, action, userId, type: updated.item_type,
  });

  return updated;
}

/**
 * Run expiry sweep for guarded-mode approve_response items.
 * Called by a scheduled job (or the aiInbox worker on a repeatable cron).
 * Returns the number of items that were auto-actioned.
 */
export async function runExpirySweep(): Promise<number> {
  const expired = await expireGuardedItems();

  for (const item of expired) {
    incAiInboxItem('approve_response', 'auto_resolved');
    logger.info('ai inbox: guarded item auto-actioned on expiry', {
      id: item.id,
      leadId: item.lead_id,
    });
  }

  return expired.length;
}

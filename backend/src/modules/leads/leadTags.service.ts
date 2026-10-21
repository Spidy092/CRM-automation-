import type { AuthenticatedUser } from '../../shared/types';
import { findLeadTags } from './leadTags.repository';

export async function getLeadTags(actor: AuthenticatedUser): Promise<string[]> {
  return findLeadTags(actor.role === 'sales' ? actor.id : null);
}

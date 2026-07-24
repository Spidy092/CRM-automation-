import type { LeadStatus } from '@/types';
import type { StatusTone } from '@/components/ui/StatusBadge';

export const statusTones: Record<LeadStatus, StatusTone> = {
  active: 'green',
  paused: 'amber',
  won: 'blue',
  lost: 'red',
  opted_out: 'gray',
};

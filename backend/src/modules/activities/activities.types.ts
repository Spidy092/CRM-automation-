export type ActivityType =
  | 'call'
  | 'whatsapp'
  | 'email'
  | 'note'
  | 'status_change'
  | 'assignment_change';

export interface Activity {
  id: string;
  lead_id: string;
  user_id: string | null;
  type: ActivityType;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ActivityWithUser extends Activity {
  user_name: string | null;
  user_email: string | null;
}

export interface CreateActivityInput {
  lead_id: string;
  user_id: string;
  type: ActivityType;
  metadata?: Record<string, unknown>;
}

export interface Actor {
  id: string;
  role: 'admin' | 'manager' | 'sales' | 'marketing' | 'viewer';
  ipAddress?: string | null;
}

export interface ActivityListFilters {
  leadId: string;
  limit: number;
  offset: number;
  type?: ActivityType;
}

export interface ActivityListResult {
  items: ActivityWithUser[];
  meta: {
    total: number;
    limit: number;
    offset: number;
  };
}

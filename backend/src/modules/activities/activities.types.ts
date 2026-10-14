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
  /** True when the note's `metadata` carries `pinned: true`. Always selected. */
  is_pinned: boolean;
}

export interface CreateActivityInput {
  lead_id: string;
  user_id: string | null;
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
  /** Keyset cursor parts — when both are set, `offset` is ignored. */
  cursorTs?: string;
  cursorId?: string;
  /** Matches note body, outcome label, or author name (ILIKE, server-side). */
  search?: string;
  /** Only activities created by this user id. */
  authorId?: string;
  /** ISO-8601 bounds applied to `created_at`. */
  dateFrom?: string;
  dateTo?: string;
  /** Only pinned notes (the pinned strip above the history). */
  pinnedOnly?: boolean;
}

export interface ActivityListResult {
  items: ActivityWithUser[];
  meta: {
    total: number;
    limit: number;
    offset: number;
    /** True when another page exists after this one (cursor paging). */
    hasMore?: boolean;
    /** Opaque cursor for the next page; present only when `hasMore` is true. */
    nextCursor?: string;
  };
}

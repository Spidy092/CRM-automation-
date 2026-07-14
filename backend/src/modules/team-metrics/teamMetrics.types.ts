import { UserRole } from '../../shared/types';

export interface TeamMetricsActor {
  id: string;
  role: UserRole;
}

export interface TeamMetricsFilters {
  from: Date;
  to: Date;
  stage?: string;
}

export interface MemberMetrics {
  user_id: string;
  name: string;
  assigned_count: number;
  contacted_count: number;
  contacted_pct: number | null;
  avg_response_time: number | null;
  total_activities: number;
}

export type TeamMetricsResult<T, E> = { ok: true; value: T } | { ok: false; error: E };

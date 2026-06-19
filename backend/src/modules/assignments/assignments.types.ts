export interface Assignment {
  id: string;
  lead_id: string;
  assigned_to: string;
  assigned_by: string;
  assignment_type: 'round_robin' | 'manual' | 'override';
  created_at: string;
}

export interface AssignmentConfig {
  id: string;
  is_enabled: boolean;
  threshold_score: number;
  eligible_roles: string[];
  updated_by: string;
  updated_at: string;
}

export interface RoundRobinUser {
  id: string;
  name: string;
  email: string;
  is_available: boolean;
  last_assigned_at: string | null;
  assignment_count: number;
}

export interface ManualAssignmentInput {
  lead_id: string;
  user_id: string;
}

export interface OverrideAssignmentInput {
  lead_id: string;
  new_user_id: string;
  reason: string;
}

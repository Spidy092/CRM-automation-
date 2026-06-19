export interface ScoringConfig {
  id: string;
  hot_min_score: number;
  warm_min_score: number;
  assignment_threshold: number;
  updated_by: string | null;
  updated_at: string;
}

export interface ScoringRule {
  id: string;
  factor: string;
  weight: number;
  condition: Record<string, unknown>;
  score_value: number;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CreateScoringRuleInput {
  factor: string;
  weight: number;
  condition: Record<string, unknown>;
  score_value: number;
  is_active?: boolean;
}

export interface UpdateScoringRuleInput {
  factor?: string;
  weight?: number;
  condition?: Record<string, unknown>;
  score_value?: number;
  is_active?: boolean;
}

export interface UpdateScoringConfigInput {
  hot_min_score?: number;
  warm_min_score?: number;
  assignment_threshold?: number;
}

export interface LeadScore {
  lead_id: string;
  score: number;
  classification: 'hot' | 'warm' | 'cold';
  factors: Array<{
    factor: string;
    score: number;
    matched: boolean;
  }>;
}

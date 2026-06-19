export interface Pipeline {
  id: string;
  name: string;
  is_default: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface PipelineStage {
  id: string;
  pipeline_id: string;
  name: string;
  position: number;
  is_terminal_won: boolean;
  is_terminal_lost: boolean;
  created_at: string;
  updated_at: string;
}

export interface PipelineWithStages extends Pipeline {
  stages: PipelineStage[];
}

export interface CreatePipelineInput {
  name: string;
  is_default?: boolean;
  stages: Array<{
    name: string;
    position: number;
    is_terminal_won?: boolean;
    is_terminal_lost?: boolean;
  }>;
}

export interface UpdatePipelineInput {
  name?: string;
  is_default?: boolean;
}

export interface CreateStageInput {
  name: string;
  position: number;
  is_terminal_won?: boolean;
  is_terminal_lost?: boolean;
}

export interface UpdateStageInput {
  name?: string;
  position?: number;
  is_terminal_won?: boolean;
  is_terminal_lost?: boolean;
}

export interface MoveLeadInput {
  lead_id: string;
  stage_id: string;
}

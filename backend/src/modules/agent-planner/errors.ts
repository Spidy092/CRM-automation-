import { AppError } from '../../shared/middleware/errorHandler';

export type PlannerErrorCode =
  | 'invalid_plan'
  | 'planner_timeout'
  | 'planner_malformed'
  | 'compliance_in_plan';

export type RunnerErrorCode =
  | 'budget_exhausted'
  | 'step_failed'
  | 'plan_cancelled'
  | 'recovery_exhausted'
  | 'approval_timeout';

export function mapCodeToHttp(code: PlannerErrorCode | RunnerErrorCode): number {
  switch (code) {
    case 'invalid_plan':
    case 'compliance_in_plan':
      return 422;
    case 'planner_timeout':
      return 504;
    case 'planner_malformed':
      return 502;
    case 'budget_exhausted':
    case 'step_failed':
    case 'approval_timeout':
      return 409;
    case 'recovery_exhausted':
      return 500;
    case 'plan_cancelled':
      return 200;
  }
}

export class PlannerError extends AppError {
  constructor(
    public code: PlannerErrorCode,
    message: string,
    public planDraft?: unknown,
  ) {
    super(message, mapCodeToHttp(code));
    this.name = 'PlannerError';
  }
}

export class RunnerError extends AppError {
  constructor(
    public code: RunnerErrorCode,
    message: string,
    public planId: string,
    public stepIndex?: number,
  ) {
    super(message, mapCodeToHttp(code));
    this.name = 'RunnerError';
  }
}

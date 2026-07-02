import { RunnerError } from './errors';
import type { PlanRow, PlanStepRow } from './plan.types';

const COST_BY_RISK_TIER: Record<string, number> = {
  read: 0.1,
  low_risk_write: 1,
  sensitive_write: 5,
  customer_facing_write: 10,
};

export interface BudgetTracker {
  assertCanStartStep(step: PlanStepRow): void;
  recordStepStart(): void;
  recordStepCost(step: PlanStepRow, actualCostCents: number): void;
  getRemainingCost(): number;
  getStepsExecuted(): number;
  isOvertime(): boolean;
}

export function createBudgetTracker(plan: PlanRow): BudgetTracker {
  let stepsExecuted = 0;
  let costUsed = plan.cost_used_cents;
  const stepCap = plan.step_cap;
  const costCap = plan.cost_cap_cents;
  const deadlineAt = plan.deadline_at ? Date.parse(plan.deadline_at) : null;

  function assertNotOvertime(): void {
    if (deadlineAt !== null && Date.now() > deadlineAt) {
      throw new RunnerError('budget_exhausted', 'Plan deadline exceeded', plan.id);
    }
  }

  return {
    assertCanStartStep(_step: PlanStepRow): void {
      assertNotOvertime();
      if (stepsExecuted >= stepCap) {
        throw new RunnerError('budget_exhausted', `Budget step_cap ${stepCap} reached`, plan.id);
      }
      if (costUsed >= costCap) {
        throw new RunnerError(
          'budget_exhausted',
          `Budget cost_cap ${costCap} cents reached`,
          plan.id,
        );
      }
    },
    recordStepStart(): void {
      stepsExecuted++;
    },
    recordStepCost(step: PlanStepRow, actualCostCents: number): void {
      const estimated = COST_BY_RISK_TIER[step.risk_tier] ?? 0;
      costUsed += Math.max(actualCostCents, estimated);
    },
    getRemainingCost(): number {
      return Math.max(0, costCap - costUsed);
    },
    getStepsExecuted(): number {
      return stepsExecuted;
    },
    isOvertime(): boolean {
      return deadlineAt !== null && Date.now() > deadlineAt;
    },
  };
}

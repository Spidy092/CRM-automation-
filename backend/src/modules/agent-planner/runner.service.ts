import * as Sentry from '@sentry/node';
import { logger } from '../../shared/utils/logger';
import { proposeAgentAction } from '../agent/agent.service';
import type { AgentActor } from '../agent/agent.types';
import {
  findPlanById,
  findPlanStepsByPlan,
  updatePlanStatus,
  updatePlanStepStatus,
  claimPlanForRecovery,
} from './plan.repository';
import type { PlanStepRow, PlanStatus } from './plan.types';
import { RunnerError, StepAwaitingApproval, StepRejected } from './errors';
import { topoSortIntoWaves } from './runner.topo';
import { createBudgetTracker } from './runner.budget';
import {
  incPlanSucceeded,
  incPlanFailed,
  incStepExecuted,
  observePlanDuration,
  observeStepDuration,
} from './metrics';

export interface PlanRunResult {
  planId: string;
  status: PlanStatus;
  errorMessage: string | null;
}

export async function executePlan(planId: string, actor: AgentActor): Promise<PlanRunResult> {
  const foundPlan = await findPlanById(planId);
  if (!foundPlan) {
    throw new RunnerError('step_failed', `Plan ${planId} not found`, planId);
  }

  if (
    foundPlan.status !== 'approved' &&
    foundPlan.status !== 'running' &&
    foundPlan.status !== 'paused_for_approval'
  ) {
    return { planId, status: foundPlan.status, errorMessage: foundPlan.error_message };
  }

  const startTimeMs = foundPlan.started_at
    ? Date.parse(foundPlan.started_at) || Date.now()
    : Date.now();

  const plan =
    foundPlan.status === 'approved'
      ? await updatePlanStatus(planId, 'running', { startedAt: new Date().toISOString() })
      : foundPlan;

  const budget = createBudgetTracker(plan);

  let steps: PlanStepRow[];
  try {
    steps = await findPlanStepsByPlan(planId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err);
    await updatePlanStatus(planId, 'failed', { errorMessage: message });
    incPlanFailed({ autonomyLevel: plan.autonomy_level ?? 'supervised', reason: 'step_failed' });
    return { planId, status: 'failed', errorMessage: message };
  }

  const waves = topoSortIntoWaves(steps);

  async function runStep(step: PlanStepRow): Promise<void> {
    if (step.status !== 'pending' && step.status !== 'running') {
      return;
    }

    budget.assertCanStartStep(step);
    budget.recordStepStart();
    const stepStart = Date.now();

    try {
      const proposal = await proposeAgentAction({
        source: plan.source,
        actionName: step.action_name,
        args: step.action_args,
        actor,
        sourceMessage: plan.source_message ?? null,
        confidence: plan.confidence,
        autonomyLevel: plan.autonomy_level,
      });

      if (proposal.policy.outcome === 'require_approval') {
        const actionId = proposal.action?.id;
        if (actionId) {
          const { pool } = await import('../../shared/utils/db');
          await pool.query(
            `UPDATE agent_actions
             SET agent_plan_id = $1, agent_plan_step_id = $2
             WHERE id = $3`,
            [planId, step.id, actionId],
          );
          await updatePlanStepStatus(step.id, 'pending_approval', { agentActionId: actionId });
        }
        throw new StepAwaitingApproval(planId, step.step_index);
      }

      if (proposal.policy.outcome === 'reject') {
        if (step.risk_tier === 'low_risk_write') {
          await updatePlanStepStatus(step.id, 'skipped', { errorMessage: proposal.policy.reason });
          budget.recordStepCost(step, 0);
          incStepExecuted({ action: step.action_name, riskTier: step.risk_tier, outcome: 'skipped' });
          observeStepDuration({ riskTier: step.risk_tier }, (Date.now() - stepStart) / 1000);
          return;
        }
        await updatePlanStepStatus(step.id, 'failed', { errorMessage: proposal.policy.reason });
        throw new StepRejected(planId, step.step_index, proposal.policy.reason);
      }

      const result = (proposal.action?.result ?? proposal.result ?? {}) as Record<string, unknown>;
      await updatePlanStepStatus(step.id, 'succeeded', {
        result,
        agentActionId: proposal.action?.id ?? null,
      });
      budget.recordStepCost(step, 0);
      incStepExecuted({ action: step.action_name, riskTier: step.risk_tier, outcome: 'succeeded' });
      observeStepDuration({ riskTier: step.risk_tier }, (Date.now() - stepStart) / 1000);
    } catch (err) {
      if (err instanceof StepAwaitingApproval || err instanceof StepRejected) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('Plan step failed', { planId, stepIndex: step.step_index, error: message });
      await updatePlanStepStatus(step.id, 'failed', { errorMessage: message });
      budget.recordStepCost(step, 0);
      incStepExecuted({ action: step.action_name, riskTier: step.risk_tier, outcome: 'failed' });
      observeStepDuration({ riskTier: step.risk_tier }, (Date.now() - stepStart) / 1000);
      throw new RunnerError('step_failed', message, planId, step.step_index);
    }
  }

  try {
    for (const wave of waves) {
      const executable = wave.filter((s) => s.status === 'pending' || s.status === 'running');
      if (executable.length === 0) {
        continue;
      }

      const results = await Promise.allSettled(executable.map((step) => runStep(step)));

      for (const result of results) {
        if (result.status === 'rejected') {
          if (result.reason instanceof StepAwaitingApproval) {
            await updatePlanStatus(planId, 'paused_for_approval');
            return { planId, status: 'paused_for_approval', errorMessage: null };
          }
          throw result.reason;
        }
      }
    }

    const completedAt = new Date().toISOString();
    const duration = (Date.now() - startTimeMs) / 1000;
    await updatePlanStatus(planId, 'succeeded', { completedAt });
    incPlanSucceeded({ autonomyLevel: plan.autonomy_level ?? 'supervised' });
    observePlanDuration({ autonomyLevel: plan.autonomy_level ?? 'supervised' }, duration);
    return { planId, status: 'succeeded', errorMessage: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err);
    const completedAt = new Date().toISOString();
    const duration = (Date.now() - startTimeMs) / 1000;
    let reason = 'step_failed';
    if (err instanceof RunnerError) {
      reason = err.code;
    } else if (err instanceof StepRejected) {
      reason = 'step_rejected';
    }
    await updatePlanStatus(planId, 'failed', { completedAt, errorMessage: message });
    incPlanFailed({ autonomyLevel: plan.autonomy_level ?? 'supervised', reason });
    observePlanDuration({ autonomyLevel: plan.autonomy_level ?? 'supervised' }, duration);
    return { planId, status: 'failed', errorMessage: message };
  }
}

export async function continuePlanIfReady(planId: string): Promise<PlanRunResult | null> {
  const plan = await findPlanById(planId);
  if (!plan || plan.status !== 'paused_for_approval' || !plan.requested_by) {
    return null;
  }

  await updatePlanStatus(planId, 'running');
  const claimed = await claimPlanForRecovery(planId);
  if (!claimed) {
    return null;
  }

  const actor: AgentActor = {
    id: plan.requested_by,
    role: 'admin',
    email: undefined,
    name: undefined,
    ipAddress: null,
  };

  return executePlan(planId, actor);
}

export async function cancelPlan(planId: string): Promise<PlanRunResult> {
  const completedAt = new Date().toISOString();
  const plan = await updatePlanStatus(planId, 'cancelled', { completedAt });
  return { planId, status: plan.status, errorMessage: plan.error_message };
}

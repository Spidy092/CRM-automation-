import {
  agentPlansCreatedTotal,
  agentPlansSucceededTotal,
  agentPlansFailedTotal,
  agentStepsExecutedTotal,
  agentPlanErrorsTotal,
  agentPlanDurationSeconds,
  agentStepDurationSeconds,
} from '../../shared/utils/metrics';
import type { PlanSource, AutonomyLevel } from './plan.types';
import type { AgentRiskTier, AgentActionName } from '../agent/agent.types';
import type { PlannerErrorCode, RunnerErrorCode } from './errors';

export function incPlanCreated(labels: { source: PlanSource; autonomyLevel: AutonomyLevel }): void {
  agentPlansCreatedTotal.inc({ source: labels.source, autonomy_level: labels.autonomyLevel });
}

export function incPlanSucceeded(labels: { autonomyLevel: AutonomyLevel }): void {
  agentPlansSucceededTotal.inc({ autonomy_level: labels.autonomyLevel });
}

export function incPlanFailed(labels: { autonomyLevel: AutonomyLevel; reason: string }): void {
  agentPlansFailedTotal.inc({ autonomy_level: labels.autonomyLevel, reason: labels.reason });
}

export function incStepExecuted(labels: {
  action: AgentActionName;
  riskTier: AgentRiskTier;
  outcome: string;
}): void {
  agentStepsExecutedTotal.inc({
    action: labels.action,
    risk_tier: labels.riskTier,
    outcome: labels.outcome,
  });
}

export function incPlanError(labels: { code: PlannerErrorCode | RunnerErrorCode }): void {
  agentPlanErrorsTotal.inc({ code: labels.code });
}

export function observePlanDuration(
  labels: { autonomyLevel: AutonomyLevel },
  seconds: number,
): void {
  agentPlanDurationSeconds.observe({ autonomy_level: labels.autonomyLevel }, seconds);
}

export function observeStepDuration(labels: { riskTier: AgentRiskTier }, seconds: number): void {
  agentStepDurationSeconds.observe({ risk_tier: labels.riskTier }, seconds);
}

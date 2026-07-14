import { AppError } from '../../shared/middleware/errorHandler';
import { TeamMetricsQuery } from './teamMetrics.schema';
import { findTeamMetrics } from './teamMetrics.repository';
import { MemberMetrics, TeamMetricsResult, TeamMetricsActor } from './teamMetrics.types';

export async function getTeamMetrics(
  query: TeamMetricsQuery,
  actor: TeamMetricsActor,
): Promise<TeamMetricsResult<MemberMetrics[], AppError>> {
  const filters = {
    from: new Date(query.from),
    to: new Date(query.to),
    stage: query.stage,
  };

  try {
    const rows = await findTeamMetrics(filters, actor.id, actor.role);
    return { ok: true, value: rows };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load team metrics';
    return { ok: false, error: new AppError(message, 500) };
  }
}

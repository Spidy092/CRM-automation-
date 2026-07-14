import { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../shared/utils/response';
import { AppError } from '../../shared/middleware/errorHandler';
import { teamMetricsQuerySchema } from './teamMetrics.schema';
import { getTeamMetrics } from './teamMetrics.service';
import { MemberMetrics, TeamMetricsActor, TeamMetricsResult } from './teamMetrics.types';

export async function getTeamMetricsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = teamMetricsQuerySchema.parse(req.query);
    const actor: TeamMetricsActor = {
      id: req.user!.id,
      role: req.user!.role,
    };

    const result: TeamMetricsResult<MemberMetrics[], AppError> = await getTeamMetrics(
      parsed,
      actor,
    );
    if (!result.ok) {
      throw result.error;
    }

    sendSuccess(res, result.value, 200, { from: parsed.from, to: parsed.to });
  } catch (err) {
    next(err);
  }
}

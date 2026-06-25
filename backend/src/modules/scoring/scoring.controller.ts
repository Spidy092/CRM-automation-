import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../shared/middleware/errorHandler';
import { sendSuccess } from '../../shared/utils/response';
import {
  getConfig,
  updateConfig,
  getAllRules,
  getRuleById,
  createRule,
  updateRuleById,
  deleteRuleById,
  calculateLeadScore,
  recalculateAllScores,
} from './scoring.service';
import {
  createScoringRuleSchema,
  updateScoringRuleSchema,
  updateScoringConfigSchema,
} from './scoring.schema';

function actorFromReq(req: Request) {
  if (!req.user) throw new AppError('Unauthorized', 401);
  return { id: req.user.id, role: req.user.role, ipAddress: req.ip ?? null };
}

export async function getConfigHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const config = await getConfig();
    sendSuccess(res, config);
  } catch (err) {
    next(err);
  }
}

export async function updateConfigHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = updateScoringConfigSchema.parse(req.body);
    const config = await updateConfig(parsed, actorFromReq(req));
    sendSuccess(res, config);
  } catch (err) {
    next(err);
  }
}

export async function listRulesHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const rules = await getAllRules();
    sendSuccess(res, rules);
  } catch (err) {
    next(err);
  }
}

export async function getRuleHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const rule = await getRuleById(req.params.id);
    sendSuccess(res, rule);
  } catch (err) {
    next(err);
  }
}

export async function createRuleHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = createScoringRuleSchema.parse(req.body);
    const rule = await createRule(parsed, actorFromReq(req));
    sendSuccess(res, rule, 201);
  } catch (err) {
    next(err);
  }
}

export async function updateRuleHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = updateScoringRuleSchema.parse(req.body);
    const rule = await updateRuleById(req.params.id, parsed, actorFromReq(req));
    sendSuccess(res, rule);
  } catch (err) {
    next(err);
  }
}

export async function deleteRuleHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await deleteRuleById(req.params.id, actorFromReq(req));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function calculateScoreHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const score = await calculateLeadScore(req.params.leadId);
    sendSuccess(res, score);
  } catch (err) {
    next(err);
  }
}

export async function recalculateAllHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await recalculateAllScores();
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
}

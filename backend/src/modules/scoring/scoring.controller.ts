import { Request, Response } from 'express';
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

export async function getConfigHandler(_req: Request, res: Response): Promise<void> {
  const config = await getConfig();
  res.json({ success: true, data: config });
}

export async function updateConfigHandler(req: Request, res: Response): Promise<void> {
  const parsed = updateScoringConfigSchema.parse(req.body);
  const actor = { id: req.user!.id, role: req.user!.role, ipAddress: req.ip };
  const config = await updateConfig(parsed, actor);
  res.json({ success: true, data: config });
}

export async function listRulesHandler(_req: Request, res: Response): Promise<void> {
  const rules = await getAllRules();
  res.json({ success: true, data: rules });
}

export async function getRuleHandler(req: Request, res: Response): Promise<void> {
  const rule = await getRuleById(req.params.id);
  res.json({ success: true, data: rule });
}

export async function createRuleHandler(req: Request, res: Response): Promise<void> {
  const parsed = createScoringRuleSchema.parse(req.body);
  const actor = { id: req.user!.id, role: req.user!.role, ipAddress: req.ip };
  const rule = await createRule(parsed, actor);
  res.status(201).json({ success: true, data: rule });
}

export async function updateRuleHandler(req: Request, res: Response): Promise<void> {
  const parsed = updateScoringRuleSchema.parse(req.body);
  const actor = { id: req.user!.id, role: req.user!.role, ipAddress: req.ip };
  const rule = await updateRuleById(req.params.id, parsed, actor);
  res.json({ success: true, data: rule });
}

export async function deleteRuleHandler(req: Request, res: Response): Promise<void> {
  const actor = { id: req.user!.id, role: req.user!.role, ipAddress: req.ip };
  await deleteRuleById(req.params.id, actor);
  res.status(204).send();
}

export async function calculateScoreHandler(req: Request, res: Response): Promise<void> {
  const score = await calculateLeadScore(req.params.leadId);
  res.json({ success: true, data: score });
}

export async function recalculateAllHandler(_req: Request, res: Response): Promise<void> {
  const result = await recalculateAllScores();
  res.json({ success: true, data: result });
}

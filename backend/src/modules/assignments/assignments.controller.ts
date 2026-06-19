import { Request, Response } from 'express';
import {
  getConfig,
  updateConfig,
  getEligibleUsers,
  assignManually,
  overrideAssignment,
  getUserAssignments,
} from './assignments.service';
import {
  manualAssignmentSchema,
  overrideAssignmentSchema,
  updateAssignmentConfigSchema,
} from './assignments.schema';

export async function getConfigHandler(_req: Request, res: Response): Promise<void> {
  const config = await getConfig();
  res.json({ success: true, data: config });
}

export async function updateConfigHandler(req: Request, res: Response): Promise<void> {
  const parsed = updateAssignmentConfigSchema.parse(req.body);
  const actor = { id: req.user!.id, role: req.user!.role, ipAddress: req.ip };
  const config = await updateConfig(parsed, actor);
  res.json({ success: true, data: config });
}

export async function listEligibleUsersHandler(_req: Request, res: Response): Promise<void> {
  const users = await getEligibleUsers();
  res.json({ success: true, data: users });
}

export async function manualAssignHandler(req: Request, res: Response): Promise<void> {
  const parsed = manualAssignmentSchema.parse(req.body);
  const actor = { id: req.user!.id, role: req.user!.role, ipAddress: req.ip };
  const assignment = await assignManually(parsed.lead_id, parsed.user_id, actor);
  res.status(201).json({ success: true, data: assignment });
}

export async function overrideAssignHandler(req: Request, res: Response): Promise<void> {
  const parsed = overrideAssignmentSchema.parse(req.body);
  const actor = { id: req.user!.id, role: req.user!.role, ipAddress: req.ip };
  const assignment = await overrideAssignment(
    parsed.lead_id,
    parsed.new_user_id,
    parsed.reason,
    actor,
  );
  res.json({ success: true, data: assignment });
}

export async function getUserAssignmentsHandler(req: Request, res: Response): Promise<void> {
  const assignments = await getUserAssignments(req.params.userId);
  res.json({ success: true, data: assignments });
}

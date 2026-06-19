import { Request, Response } from 'express';
import {
  getAllCampaigns,
  getCampaignById,
  createCampaign,
  updateCampaignById,
  deleteCampaignById,
  launchCampaignById,
  pauseCampaignById,
  resumeCampaignById,
  addLeads,
  removeLead,
  getCampaignLeads,
  getStats,
} from './campaigns.service';
import { createCampaignSchema, updateCampaignSchema, addLeadsSchema } from './campaigns.schema';

export async function listCampaignsHandler(_req: Request, res: Response): Promise<void> {
  const campaigns = await getAllCampaigns();
  res.json({ success: true, data: campaigns });
}

export async function getCampaignHandler(req: Request, res: Response): Promise<void> {
  const campaign = await getCampaignById(req.params.id);
  res.json({ success: true, data: campaign });
}

export async function createCampaignHandler(req: Request, res: Response): Promise<void> {
  const parsed = createCampaignSchema.parse(req.body);
  const actor = { id: req.user!.id, role: req.user!.role, ipAddress: req.ip };
  const campaign = await createCampaign(parsed, actor);
  res.status(201).json({ success: true, data: campaign });
}

export async function updateCampaignHandler(req: Request, res: Response): Promise<void> {
  const parsed = updateCampaignSchema.parse(req.body);
  const actor = { id: req.user!.id, role: req.user!.role, ipAddress: req.ip };
  const campaign = await updateCampaignById(req.params.id, parsed, actor);
  res.json({ success: true, data: campaign });
}

export async function deleteCampaignHandler(req: Request, res: Response): Promise<void> {
  const actor = { id: req.user!.id, role: req.user!.role, ipAddress: req.ip };
  await deleteCampaignById(req.params.id, actor);
  res.status(204).send();
}

export async function launchCampaignHandler(req: Request, res: Response): Promise<void> {
  const actor = { id: req.user!.id, role: req.user!.role, ipAddress: req.ip };
  const campaign = await launchCampaignById(req.params.id, actor);
  res.json({ success: true, data: campaign });
}

export async function pauseCampaignHandler(req: Request, res: Response): Promise<void> {
  const actor = { id: req.user!.id, role: req.user!.role, ipAddress: req.ip };
  const campaign = await pauseCampaignById(req.params.id, actor);
  res.json({ success: true, data: campaign });
}

export async function resumeCampaignHandler(req: Request, res: Response): Promise<void> {
  const actor = { id: req.user!.id, role: req.user!.role, ipAddress: req.ip };
  const campaign = await resumeCampaignById(req.params.id, actor);
  res.json({ success: true, data: campaign });
}

export async function addLeadsHandler(req: Request, res: Response): Promise<void> {
  const parsed = addLeadsSchema.parse(req.body);
  const actor = { id: req.user!.id, role: req.user!.role, ipAddress: req.ip };
  const result = await addLeads(req.params.id, parsed.lead_ids, actor);
  res.json({ success: true, data: result });
}

export async function removeLeadHandler(req: Request, res: Response): Promise<void> {
  const actor = { id: req.user!.id, role: req.user!.role, ipAddress: req.ip };
  await removeLead(req.params.id, req.params.leadId, actor);
  res.status(204).send();
}

export async function listCampaignLeadsHandler(req: Request, res: Response): Promise<void> {
  const leadIds = await getCampaignLeads(req.params.id);
  res.json({ success: true, data: leadIds });
}

export async function getCampaignStatsHandler(req: Request, res: Response): Promise<void> {
  const stats = await getStats(req.params.id);
  res.json({ success: true, data: stats });
}

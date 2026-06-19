import { AppError } from '../../shared/middleware/errorHandler';
import { writeAuditLog } from '../../shared/utils/audit';
import {
  findCampaigns,
  findCampaignById,
  insertCampaign,
  updateCampaign,
  deleteCampaign,
  launchCampaign,
  pauseCampaign,
  resumeCampaign,
  addLeadsToCampaign,
  removeLeadFromCampaign,
  findCampaignLeads,
  getCampaignStats,
} from './campaigns.repository';
import {
  CreateCampaignInput,
  UpdateCampaignInput,
  Campaign,
  CampaignStats,
} from './campaigns.types';

interface Actor {
  id: string;
  role: string;
  ipAddress?: string | null;
}

export async function getAllCampaigns(): Promise<Campaign[]> {
  return findCampaigns();
}

export async function getCampaignById(id: string): Promise<Campaign> {
  const campaign = await findCampaignById(id);
  if (!campaign) {
    throw new AppError('Campaign not found', 404);
  }
  return campaign;
}

export async function createCampaign(input: CreateCampaignInput, actor: Actor): Promise<Campaign> {
  const campaign = await insertCampaign(
    {
      name: input.name,
      tone: input.tone ?? 'professional',
      target_industries: input.target_industries ?? [],
      target_countries: input.target_countries ?? [],
      sequence_id: input.sequence_id,
      pipeline_id: input.pipeline_id,
    },
    actor.id,
  );

  await writeAuditLog({
    userId: actor.id,
    action: 'campaign.created',
    entityType: 'campaign',
    entityId: campaign.id,
    newValue: campaign,
    ipAddress: actor.ipAddress ?? null,
  });

  return campaign;
}

export async function updateCampaignById(
  id: string,
  input: UpdateCampaignInput,
  actor: Actor,
): Promise<Campaign> {
  const existing = await findCampaignById(id);
  if (!existing) {
    throw new AppError('Campaign not found', 404);
  }

  if (existing.status === 'active') {
    throw new AppError('Cannot edit an active campaign. Pause it first.', 400);
  }

  const updated = await updateCampaign(id, input);

  await writeAuditLog({
    userId: actor.id,
    action: 'campaign.updated',
    entityType: 'campaign',
    entityId: id,
    oldValue: existing,
    newValue: updated,
    ipAddress: actor.ipAddress ?? null,
  });

  return updated;
}

export async function deleteCampaignById(id: string, actor: Actor): Promise<void> {
  const existing = await findCampaignById(id);
  if (!existing) {
    throw new AppError('Campaign not found', 404);
  }

  if (existing.status === 'active') {
    throw new AppError('Cannot delete an active campaign. Pause it first.', 400);
  }

  await deleteCampaign(id);

  await writeAuditLog({
    userId: actor.id,
    action: 'campaign.deleted',
    entityType: 'campaign',
    entityId: id,
    oldValue: existing,
    ipAddress: actor.ipAddress ?? null,
  });
}

export async function launchCampaignById(id: string, actor: Actor): Promise<Campaign> {
  const existing = await findCampaignById(id);
  if (!existing) {
    throw new AppError('Campaign not found', 404);
  }

  if (existing.status !== 'draft' && existing.status !== 'paused') {
    throw new AppError('Campaign can only be launched from draft or paused status', 400);
  }

  const launched = await launchCampaign(id);

  await writeAuditLog({
    userId: actor.id,
    action: 'campaign.launched',
    entityType: 'campaign',
    entityId: id,
    oldValue: { status: existing.status },
    newValue: { status: launched.status, launched_at: launched.launched_at },
    ipAddress: actor.ipAddress ?? null,
  });

  return launched;
}

export async function pauseCampaignById(id: string, actor: Actor): Promise<Campaign> {
  const existing = await findCampaignById(id);
  if (!existing) {
    throw new AppError('Campaign not found', 404);
  }

  if (existing.status !== 'active') {
    throw new AppError('Only active campaigns can be paused', 400);
  }

  const paused = await pauseCampaign(id);

  await writeAuditLog({
    userId: actor.id,
    action: 'campaign.paused',
    entityType: 'campaign',
    entityId: id,
    oldValue: { status: existing.status },
    newValue: { status: paused.status },
    ipAddress: actor.ipAddress ?? null,
  });

  return paused;
}

export async function resumeCampaignById(id: string, actor: Actor): Promise<Campaign> {
  const existing = await findCampaignById(id);
  if (!existing) {
    throw new AppError('Campaign not found', 404);
  }

  if (existing.status !== 'paused') {
    throw new AppError('Only paused campaigns can be resumed', 400);
  }

  const resumed = await resumeCampaign(id);

  await writeAuditLog({
    userId: actor.id,
    action: 'campaign.resumed',
    entityType: 'campaign',
    entityId: id,
    oldValue: { status: existing.status },
    newValue: { status: resumed.status },
    ipAddress: actor.ipAddress ?? null,
  });

  return resumed;
}

export async function addLeads(
  campaignId: string,
  leadIds: string[],
  actor: Actor,
): Promise<{ added: number }> {
  const campaign = await findCampaignById(campaignId);
  if (!campaign) {
    throw new AppError('Campaign not found', 404);
  }

  const added = await addLeadsToCampaign(campaignId, leadIds);

  await writeAuditLog({
    userId: actor.id,
    action: 'campaign.leads_added',
    entityType: 'campaign',
    entityId: campaignId,
    newValue: { lead_ids: leadIds, count: added.length },
    ipAddress: actor.ipAddress ?? null,
  });

  return { added: added.length };
}

export async function removeLead(campaignId: string, leadId: string, actor: Actor): Promise<void> {
  const campaign = await findCampaignById(campaignId);
  if (!campaign) {
    throw new AppError('Campaign not found', 404);
  }

  await removeLeadFromCampaign(campaignId, leadId);

  await writeAuditLog({
    userId: actor.id,
    action: 'campaign.lead_removed',
    entityType: 'campaign',
    entityId: campaignId,
    newValue: { lead_id: leadId },
    ipAddress: actor.ipAddress ?? null,
  });
}

export async function getCampaignLeads(campaignId: string): Promise<string[]> {
  const campaign = await findCampaignById(campaignId);
  if (!campaign) {
    throw new AppError('Campaign not found', 404);
  }
  return findCampaignLeads(campaignId);
}

export async function getStats(campaignId: string): Promise<CampaignStats> {
  const campaign = await findCampaignById(campaignId);
  if (!campaign) {
    throw new AppError('Campaign not found', 404);
  }
  return getCampaignStats(campaignId);
}

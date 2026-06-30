import { AppError } from '../../shared/middleware/errorHandler';
import { writeAuditLog } from '../../shared/utils/audit';
import { logger } from '../../shared/utils/logger';
import { cancelPendingOutreachJobs, enqueueOutreachDispatch, enqueueAiCampaignBrief } from '../../workers/queue';
import { findSequenceById } from '../outreach/outreach.repository';
import { findByName as findIntegrationByName } from '../integrations/integrations.repository';
import { findTemplateById } from '../templates/templates.repository';
import { findCampaignBrief } from '../ai-campaign-brain/ai-campaign-brain.repository';
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
  findCampaignLeadRows,
  getCampaignStats,
} from './campaigns.repository';
import {
  CreateCampaignInput,
  UpdateCampaignInput,
  Campaign,
  CampaignStats,
  AutomationPreview,
  LaunchCampaignResult,
} from './campaigns.types';

interface Actor {
  id: string;
  role: string;
  ipAddress?: string | null;
}

class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400);
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
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
      ai_personalization_enabled: input.ai_personalization_enabled ?? false,
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

  if (campaign.ai_personalization_enabled) {
    await enqueueAiCampaignBrief({ campaignId: campaign.id, triggeredBy: actor.id });
  }

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

  if (updated.ai_personalization_enabled) {
    await enqueueAiCampaignBrief({ campaignId: updated.id, triggeredBy: actor.id });
  }

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

type LaunchStep = NonNullable<AutomationPreview['firstStep']>;

type PreviewBuild = AutomationPreview & { firstStep: LaunchStep | null };

function getDestination(
  lead: { email: string; phone: string },
  channel: LaunchStep['channel'],
): string {
  if (channel === 'email') return lead.email;
  return lead.phone;
}

function integrationNamesForChannel(channel: LaunchStep['channel']): string[] {
  if (channel === 'whatsapp') return ['whatsapp'];
  if (channel === 'sms') return ['twilio'];
  if (channel === 'email') return ['sendgrid', 'smtp'];
  return [];
}

async function buildAutomationPreview(campaign: Campaign, mockMode = false): Promise<PreviewBuild> {
  const templateIssues: string[] = [];
  const connectorIssues: string[] = [];
  let firstStep: LaunchStep | null = null;

  if (!campaign.sequence_id) {
    templateIssues.push('Campaign has no outreach sequence.');
  } else {
    const sequence = await findSequenceById(campaign.sequence_id);
    if (!sequence || !Array.isArray(sequence.steps) || sequence.steps.length === 0) {
      templateIssues.push('Outreach sequence has no steps.');
    } else {
      const rawStep = sequence.steps[0];
      firstStep = {
        stepNumber: rawStep.stepNumber,
        channel: rawStep.channel,
        templateId: rawStep.templateId,
        delayHours: rawStep.delayHours ?? 0,
      };

      const template = await findTemplateById(firstStep.templateId);
      if (!template) {
        templateIssues.push('First-step template was not found.');
      } else {
        if (template.approval_status !== 'approved') {
          templateIssues.push('First-step template is not approved.');
        }
        if (template.channel !== firstStep.channel) {
          templateIssues.push('First-step template channel does not match the sequence step.');
        }
      }

      if (!mockMode) {
        const names = integrationNamesForChannel(firstStep.channel);
        if (names.length > 0) {
          const integrations = await Promise.all(names.map((name) => findIntegrationByName(name)));
          const ready = integrations.some(
            (integration) => integration?.is_enabled && integration.last_test_status !== 'failed',
          );
          if (!ready) {
            connectorIssues.push(`No ready connector configured for ${firstStep.channel}.`);
          }
        }
      }
    }
  }

  const leads = await findCampaignLeadRows(campaign.id);
  const eligibleLeads: AutomationPreview['eligibleLeads'] = [];
  const skippedLeads: AutomationPreview['skippedLeads'] = [];

  for (const lead of leads) {
    const reasons: string[] = [];
    if (lead.status !== 'active') reasons.push(`Lead status is ${lead.status}.`);
    if (!firstStep) reasons.push('No dispatchable first step.');
    if (templateIssues.length > 0) reasons.push(...templateIssues);
    if (connectorIssues.length > 0) reasons.push(...connectorIssues);
    const destination = firstStep ? getDestination(lead, firstStep.channel) : '';
    if (firstStep && !destination) reasons.push(`Lead has no ${firstStep.channel} destination.`);

    if (reasons.length > 0) {
      skippedLeads.push({ leadId: lead.id, businessName: lead.business_name, reasons });
    } else {
      eligibleLeads.push({ leadId: lead.id, businessName: lead.business_name, destination });
    }
  }

  return {
    campaignId: campaign.id,
    sequenceId: campaign.sequence_id,
    firstStep,
    eligibleLeads,
    skippedLeads,
    templateIssues,
    connectorIssues,
    expectedJobs: eligibleLeads.length,
    mockMode,
  };
}

export async function getCampaignAutomationPreview(id: string): Promise<AutomationPreview> {
  const campaign = await findCampaignById(id);
  if (!campaign) {
    throw new AppError('Campaign not found', 404);
  }
  return buildAutomationPreview(campaign, false);
}

export async function launchCampaignById(id: string, actor: Actor): Promise<LaunchCampaignResult> {
  const existing = await findCampaignById(id);
  if (!existing) {
    throw new AppError('Campaign not found', 404);
  }

  if (existing.status !== 'draft' && existing.status !== 'paused') {
    throw new AppError('Campaign can only be launched from draft or paused status', 400);
  }

  // AI brief approval is required before launch ONLY if AI is enabled, unless the campaign is explicitly
  // configured as fully supervised with no confidence threshold (manual override).
  const canLaunchWithoutBrief =
    !existing.ai_personalization_enabled ||
    (existing.autonomy_level === 'supervised' && existing.ai_min_confidence === 0);
  if (!canLaunchWithoutBrief) {
    const approvedBrief = await findCampaignBrief(existing.id);
    if (!approvedBrief || approvedBrief.status !== 'approved') {
      throw new ValidationError('AI brief approval required before launch');
    }
  }

  const preview = await buildAutomationPreview(existing, false);
  const launched = await launchCampaign(id);
  let enqueued = 0;

  if (preview.firstStep && launched.sequence_id) {
    for (const lead of preview.eligibleLeads) {
      try {
        await enqueueOutreachDispatch({
          leadId: lead.leadId,
          campaignId: launched.id,
          sequenceId: launched.sequence_id,
          stepNumber: preview.firstStep.stepNumber,
          channel: preview.firstStep.channel,
          templateId: preview.firstStep.templateId,
          mockMode: preview.mockMode,
          aiPersonalizationEnabled: launched.ai_personalization_enabled,
        });
        enqueued += 1;
      } catch (enqueueErr) {
        logger.error('Failed to enqueue outreach dispatch for lead', {
          campaignId: launched.id,
          leadId: lead.leadId,
          error: enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr),
        });
      }
    }
  }

  await writeAuditLog({
    userId: actor.id,
    action: 'campaign.launched',
    entityType: 'campaign',
    entityId: id,
    oldValue: { status: existing.status },
    newValue: {
      status: launched.status,
      launched_at: launched.launched_at,
      automation: { enqueued, skipped: preview.skippedLeads.length, mockMode: preview.mockMode },
    },
    ipAddress: actor.ipAddress ?? null,
  });

  return {
    campaign: launched,
    automation: { enqueued, skipped: preview.skippedLeads.length, mockMode: preview.mockMode },
  };
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
  await cancelPendingOutreachJobs({ campaignId: id });

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

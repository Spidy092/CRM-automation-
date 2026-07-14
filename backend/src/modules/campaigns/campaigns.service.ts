/* eslint-disable @typescript-eslint/no-explicit-any -- TODO: replace with a proper runtime type (legacy debt) */
import { AppError } from '../../shared/middleware/errorHandler';
import { writeAuditLog } from '../../shared/utils/audit';
import { logger } from '../../shared/utils/logger';
import {
  cancelPendingOutreachJobs,
  enqueueOutreachDispatch,
  enqueueAiCampaignBrief,
} from '../../workers/queue';
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
  findCampaignLeadsWithProgress,
  findCampaignLeadRows,
  findLatestOutreachLogForLead,
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
      trigger_stage_id: input.trigger_stage_id ?? null,
      ai_personalization_enabled: input.ai_personalization_enabled ?? false,
      ab_test_enabled: input.ab_test_enabled ?? false,
      ab_test_metric: input.ab_test_metric ?? 'open_rate',
      ab_test_min_samples: input.ab_test_min_samples ?? 100,
      ab_test_confidence: input.ab_test_confidence ?? 95,
      ab_test_auto_promote: input.ab_test_auto_promote ?? true,
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

  const updated = await updateCampaign(id, {
    name: input.name,
    tone: input.tone,
    target_industries: input.target_industries,
    target_countries: input.target_countries,
    sequence_id: input.sequence_id,
    pipeline_id: input.pipeline_id,
    ...('trigger_stage_id' in input ? { trigger_stage_id: input.trigger_stage_id } : {}),
    ai_personalization_enabled: input.ai_personalization_enabled,
    ab_test_enabled: input.ab_test_enabled,
    ab_test_metric: input.ab_test_metric,
    ab_test_min_samples: input.ab_test_min_samples,
    ab_test_confidence: input.ab_test_confidence,
    ab_test_auto_promote: input.ab_test_auto_promote,
  });

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

      // Validate every step, not just the first — an unapproved or mismatched
      // template on step 2+ would otherwise only fail mid-sequence after launch.
      for (const step of sequence.steps) {
        const label = `Step ${step.stepNumber}`;
        if (!step.templateId) {
          templateIssues.push(`${label}: no template selected.`);
          continue;
        }
        const template = await findTemplateById(step.templateId);
        if (!template) {
          templateIssues.push(`${label}: template was not found.`);
          continue;
        }
        if (template.approval_status !== 'approved') {
          templateIssues.push(`${label}: template "${template.name}" is not approved.`);
        }
        if (template.channel !== step.channel) {
          templateIssues.push(
            `${label}: template channel (${template.channel}) does not match the sequence step (${step.channel}).`,
          );
        }
      }

      if (!mockMode) {
        const channels = [...new Set(sequence.steps.map((step) => step.channel))];
        for (const channel of channels) {
          const names = integrationNamesForChannel(channel);
          if (names.length === 0) continue;
          const integrations = await Promise.all(names.map((name) => findIntegrationByName(name)));
          const ready = integrations.some(
            (integration) => integration?.is_enabled && integration.last_test_status !== 'failed',
          );
          if (!ready) {
            connectorIssues.push(`No ready connector configured for ${channel}.`);
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

export async function getCampaignLeads(campaignId: string): Promise<any[]> {
  const campaign = await findCampaignById(campaignId);
  if (!campaign) {
    throw new AppError('Campaign not found', 404);
  }
  return findCampaignLeadsWithProgress(campaignId);
}

/**
 * Re-enqueues the most recent outreach step for a lead after it failed —
 * e.g. a transient connector error (SendGrid down, SMTP timeout) rather than
 * a config problem the user needs to fix first. Only retries when the latest
 * logged attempt actually failed, and re-validates the template is still
 * approved (a rejected/edited template shouldn't be silently retried).
 */
export async function retryLeadOutreachStep(
  campaignId: string,
  leadId: string,
  actor: Actor,
): Promise<{ enqueued: boolean }> {
  const campaign = await findCampaignById(campaignId);
  if (!campaign) throw new AppError('Campaign not found', 404);
  if (!campaign.sequence_id) throw new AppError('Campaign has no outreach sequence', 400);
  if (campaign.status !== 'active' && campaign.status !== 'paused') {
    throw new AppError('Campaign must be active or paused to retry a send', 400);
  }

  const latest = await findLatestOutreachLogForLead(campaignId, leadId);
  if (!latest || latest.status !== 'failed') {
    throw new AppError('No failed send found for this lead', 400);
  }
  if (!latest.template_id) {
    throw new AppError('Original send has no template on record — cannot retry', 400);
  }

  const template = await findTemplateById(latest.template_id);
  if (!template || template.approval_status !== 'approved') {
    throw new AppError('Template is no longer approved — fix the sequence before retrying', 400);
  }

  // Unique jobIdSuffix — the original dispatch job for this step already has a
  // terminal (failed) job under the deterministic id, so re-using it here
  // would make BullMQ silently no-op instead of actually retrying the send.
  await enqueueOutreachDispatch(
    {
      leadId,
      campaignId,
      sequenceId: campaign.sequence_id,
      stepNumber: latest.step_number,
      channel: latest.channel,
      templateId: latest.template_id,
      mockMode: false,
      aiPersonalizationEnabled: campaign.ai_personalization_enabled,
    },
    { jobIdSuffix: `retry-${Date.now()}` },
  );

  await writeAuditLog({
    userId: actor.id,
    action: 'campaign.outreach.retried',
    entityType: 'campaign',
    entityId: campaignId,
    newValue: { leadId, stepNumber: latest.step_number, channel: latest.channel },
    ipAddress: actor.ipAddress ?? null,
  });

  return { enqueued: true };
}

export async function getStats(campaignId: string): Promise<CampaignStats> {
  const campaign = await findCampaignById(campaignId);
  if (!campaign) {
    throw new AppError('Campaign not found', 404);
  }
  return getCampaignStats(campaignId);
}

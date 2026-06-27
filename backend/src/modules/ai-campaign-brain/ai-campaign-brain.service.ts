import { z } from 'zod';
import OpenAI from 'openai';
import { logger } from '../../shared/utils/logger';
import { getAiConfig } from '../ai-settings/ai-settings.service';
import { insertDecisionLog } from '../ai-intelligence/ai-intelligence.repository';
import { incAiTokens } from '../../shared/utils/metrics';
import { enqueueAiCreateInboxItem } from '../../workers/queue';
import {
  upsertCampaignBrief,
  getCampaignLeadStats,
  findBriefByCampaignId,
  approveBrief,
  rejectBrief,
} from './ai-campaign-brain.repository';
import type { CampaignBrief, AiCampaignBriefOutput } from './ai-campaign-brain.types';

const BRIEF_MAX_TOKENS = 1200;

// ── Zod schema ────────────────────────────────────────────────────────────

const BriefSchema = z.object({
  segment_summary: z.string().max(600),
  recommended_offer_angle: z.string().max(400),
  expected_objections: z.array(z.string().max(200)).max(6),
  risk_warnings: z.array(z.string().max(200)).max(6),
  recommended_sequence: z.array(z.object({
    step_number: z.number().int().min(1),
    channel: z.enum(['whatsapp', 'email', 'sms']),
    delay_hours: z.number().int().min(0),
    goal: z.string().max(200),
  })).max(8),
  template_suggestions: z.array(z.object({
    channel: z.enum(['whatsapp', 'email', 'sms']),
    subject: z.string().max(200).nullable(),
    body_preview: z.string().max(300),
  })).max(4),
  recommended_autonomy_level: z.enum(['supervised', 'guarded', 'autopilot']),
  confidence_score: z.number().int().min(0).max(100),
  chain_of_thought: z.string().max(2000),
});

// ── Public API ────────────────────────────────────────────────────────────

/** Read the AI brief for a campaign (null if none generated yet). */
export async function getCampaignBrief(campaignId: string): Promise<CampaignBrief | null> {
  return findBriefByCampaignId(campaignId);
}

/** Approve a campaign brief. Returns the updated brief; throws if none exists. */
export async function approveCampaignBrief(
  campaignId: string,
  approvedBy: string,
): Promise<CampaignBrief> {
  const existing = await findBriefByCampaignId(campaignId);
  if (!existing) throw new Error(`Campaign brief not found: ${campaignId}`);
  await approveBrief(campaignId, approvedBy);
  logger.info('ai campaign brain: brief approved', { campaignId, approvedBy });
  return (await findBriefByCampaignId(campaignId)) as CampaignBrief;
}

/** Reject a campaign brief. Returns the updated brief; throws if none exists. */
export async function rejectCampaignBrief(campaignId: string): Promise<CampaignBrief> {
  const existing = await findBriefByCampaignId(campaignId);
  if (!existing) throw new Error(`Campaign brief not found: ${campaignId}`);
  await rejectBrief(campaignId);
  logger.info('ai campaign brain: brief rejected', { campaignId });
  return (await findBriefByCampaignId(campaignId)) as CampaignBrief;
}

/**
 * Generate an AI campaign brief for the given campaign.
 *
 * Flow:
 *   1. Load campaign + aggregated lead AI profile stats
 *   2. Call OpenAI with segment context
 *   3. Validate with Zod
 *   4. Upsert to campaign_ai_briefs
 *   5. Create `campaign_review` inbox item for the campaign creator/manager
 *   6. Log to ai_decision_log
 */
export async function generateCampaignBrief(
  campaignId: string,
  triggeredBy: string,
): Promise<CampaignBrief> {
  const start = Date.now();

  const stats = await getCampaignLeadStats(campaignId);
  if (!stats) throw new Error(`Campaign not found: ${campaignId}`);

  const aiConfig = await getAiConfig();
  if (!aiConfig) throw new Error('AI not configured — cannot generate campaign brief');

  const client = new OpenAI({
    apiKey: aiConfig.apiKey || process.env.OPENAI_API_KEY,
    baseURL: aiConfig.baseUrl || undefined,
  });

  const systemPrompt = buildBriefSystemPrompt();
  const userPrompt = buildBriefUserPrompt(stats);

  let raw: AiCampaignBriefOutput;
  let tokensUsed = 0;

  try {
    const completion = await client.chat.completions.create({
      model: aiConfig.model,
      max_tokens: BRIEF_MAX_TOKENS,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    tokensUsed = completion.usage?.total_tokens ?? 0;
    incAiTokens('campaign_brief', tokensUsed);

    const content = completion.choices[0]?.message?.content ?? '{}';
    raw = BriefSchema.parse(JSON.parse(content)) as AiCampaignBriefOutput;
  } catch (err) {
    const latencyMs = Date.now() - start;
    logger.error('ai campaign brain: OpenAI call failed', {
      campaignId, latency_ms: latencyMs,
      error: err instanceof Error ? err.message : String(err),
    });
    await insertDecisionLog({
      lead_id: null,
      campaign_id: campaignId,
      decision_type: 'campaign_brief',
      input_context: { campaignId, totalLeads: stats.totalLeads },
      decision: 'failed',
      latency_ms: latencyMs,
      model_used: aiConfig.model,
    }).catch(() => null);
    throw err;
  }

  const latencyMs = Date.now() - start;

  const brief = await upsertCampaignBrief({
    campaign_id: campaignId,
    total_leads_evaluated: stats.totalLeads,
    eligible_leads: stats.eligibleLeads,
    high_fit_leads: stats.highFitLeads,
    segment_summary: raw.segment_summary,
    recommended_offer_angle: raw.recommended_offer_angle,
    expected_objections: raw.expected_objections,
    risk_warnings: raw.risk_warnings,
    recommended_sequence: raw.recommended_sequence,
    template_suggestions: raw.template_suggestions,
    recommended_autonomy_level: raw.recommended_autonomy_level,
    confidence_score: raw.confidence_score,
  });

  // Notify manager via inbox
  await enqueueAiCreateInboxItem({
    assignedTo: triggeredBy,
    campaignId,
    itemType: 'campaign_review',
    title: `AI brief ready: ${stats.campaign.name}`,
    summary: `${stats.highFitLeads} high-fit leads. ${raw.recommended_offer_angle.slice(0, 150)}`,
    urgencyScore: 60,
    expiresInHours: 24,
  });

  await insertDecisionLog({
    lead_id: null,
    campaign_id: campaignId,
    decision_type: 'campaign_brief',
    input_context: {
      campaignId,
      totalLeads: stats.totalLeads,
      eligibleLeads: stats.eligibleLeads,
      highFitLeads: stats.highFitLeads,
    },
    chain_of_thought: raw.chain_of_thought,
    decision: raw.recommended_autonomy_level,
    confidence: raw.confidence_score,
    tokens_used: tokensUsed,
    latency_ms: latencyMs,
    model_used: aiConfig.model,
  }).catch(() => null);

  logger.info('ai campaign brain: brief generated', {
    campaignId,
    totalLeads: stats.totalLeads,
    highFitLeads: stats.highFitLeads,
    confidence: raw.confidence_score,
    autonomy: raw.recommended_autonomy_level,
    tokens_used: tokensUsed,
    latency_ms: latencyMs,
  });

  return brief;
}

// ── Prompt builders ───────────────────────────────────────────────────────

function buildBriefSystemPrompt(): string {
  return (
    'You are an AI campaign strategy analyst. Given a campaign\'s target segment data and lead AI profiles, ' +
    'produce a pre-launch strategy brief. Return ONLY valid JSON — no prose, no markdown.\n\n' +
    'Required JSON fields:\n' +
    '- segment_summary: string (max 400 chars) — who these leads are and their shared characteristics\n' +
    '- recommended_offer_angle: string (max 300 chars) — the strongest offer angle for this segment\n' +
    '- expected_objections: string[] (max 6) — objections reps should be prepared for\n' +
    '- risk_warnings: string[] (max 6) — campaign risks (overlap, churn, regulatory, etc.)\n' +
    '- recommended_sequence: array of {step_number, channel, delay_hours, goal} — up to 5 steps\n' +
    '- template_suggestions: array of {channel, subject, body_preview} — 2-4 templates\n' +
    '- recommended_autonomy_level: "supervised" | "guarded" | "autopilot"\n' +
    '- confidence_score: integer 0–100 — overall campaign readiness confidence\n' +
    '- chain_of_thought: structured reasoning (Segment → Angle → Risks → Sequence → Autonomy Recommendation)'
  );
}

function buildBriefUserPrompt(stats: NonNullable<Awaited<ReturnType<typeof getCampaignLeadStats>>>): string {
  return (
    `Campaign: ${stats.campaign.name}\n` +
    `Tone: ${stats.campaign.tone}\n` +
    `Target industries: ${(stats.campaign.target_industries ?? []).join(', ') || 'all'}\n` +
    `Total leads in campaign: ${stats.totalLeads}\n` +
    `Active / eligible leads: ${stats.eligibleLeads}\n` +
    `High-fit leads (AI scored medium or high intent): ${stats.highFitLeads}\n` +
    `Top pain points across segment: ${stats.topPainPoints.join(', ') || 'not yet analyzed'}\n\n` +
    'Generate a strategy brief that would help a sales manager decide whether to launch and how.'
  );
}

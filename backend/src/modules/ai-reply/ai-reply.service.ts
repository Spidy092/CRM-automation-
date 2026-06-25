import { z } from 'zod';
import OpenAI from 'openai';
import { logger } from '../../shared/utils/logger';
import { getAiConfig } from '../ai-settings/ai-settings.service';
import { findLeadById } from '../leads/leads.repository';
import { findAiProfileByLeadId, insertDecisionLog } from '../ai-intelligence/ai-intelligence.repository';
import { incAiTokens, incAiReplyClassified } from '../../shared/utils/metrics';
import { invalidateProfileCache } from '../ai-intelligence/ai-intelligence.service';
import { cancelPendingOutreachJobs, enqueueAiCreateInboxItem } from '../../workers/queue';
import {
  upsertConversationSummary,
  appendObjectionToProfile,
  appendBuyingSignalToProfile,
  updateProfileNextAction,
  getLeadCampaignContext,
  moveLeadToStageByName,
} from './ai-reply.repository';
import type { ClassifyReplyInput, ReplyClassification, AiReplyOutput } from './ai-reply.types';

const REPLY_MAX_TOKENS = 300;

// ── Zod schema ────────────────────────────────────────────────────────────

const AiReplySchema = z.object({
  intent_class: z.enum([
    'interested', 'objection', 'not_now', 'meeting_request',
    'pricing_question', 'wrong_contact', 'opt_out', 'neutral',
  ]),
  intent_subtype: z.union([
    z.enum(['high', 'medium', 'soft', 'hard', 'price', 'timing', 'trust', 'competitor', 'not_relevant', 'angry', 'unsubscribe']),
    z.null(),
  ]),
  confidence: z.number().int().min(0).max(100),
  draft_response: z.string().max(600).nullable(),
  next_best_action: z.string().max(50),
  update_stage_to: z.string().max(100).nullable(),
  objection_type: z.string().max(50).nullable(),
  buying_signal: z.string().max(200).nullable(),
  chain_of_thought: z.string().max(2000),
  should_stop_sequence: z.boolean(),
});

// ── Sentiment mapping ─────────────────────────────────────────────────────

function intentToSentiment(intentClass: string): 'positive' | 'neutral' | 'negative' {
  if (['interested', 'meeting_request'].includes(intentClass)) return 'positive';
  if (['opt_out', 'wrong_contact'].includes(intentClass)) return 'negative';
  if (['objection'].includes(intentClass)) return 'negative';
  return 'neutral';
}

// ── Main classifier ───────────────────────────────────────────────────────

/**
 * Classify an inbound reply, update lead memory, decide routing.
 *
 * Flow:
 *   1. Load lead + AI profile
 *   2. Call OpenAI → classify intent, generate draft response
 *   3. Append objection / buying signal to lead profile
 *   4. Upsert conversation summary
 *   5. Log decision to ai_decision_log
 *   6. Route: opt_out → stop; autopilot+confident → auto-send; else → inbox item
 */
export async function classifyReply(input: ClassifyReplyInput): Promise<ReplyClassification> {
  const start = Date.now();
  const { leadId, channel, messageText } = input;

  const [lead, aiProfile, context] = await Promise.all([
    findLeadById(leadId),
    findAiProfileByLeadId(leadId),
    getLeadCampaignContext(leadId),
  ]);

  if (!lead) throw new Error(`Lead not found: ${leadId}`);

  const aiConfig = await getAiConfig();
  if (!aiConfig) {
    logger.warn('ai reply: AI not configured, skipping classification', { leadId });
    return buildFallbackClassification(messageText);
  }

  const client = new OpenAI({
    apiKey: aiConfig.apiKey || process.env.OPENAI_API_KEY,
    baseURL: aiConfig.baseUrl || undefined,
  });

  const systemPrompt = buildReplySystemPrompt();
  const userPrompt = buildReplyUserPrompt(lead, aiProfile, channel, messageText);

  let raw: AiReplyOutput;
  let tokensUsed = 0;

  try {
    const completion = await client.chat.completions.create({
      model: aiConfig.model,
      max_tokens: REPLY_MAX_TOKENS,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    tokensUsed = completion.usage?.total_tokens ?? 0;
    incAiTokens('reply_classify', tokensUsed);

    const content = completion.choices[0]?.message?.content ?? '{}';
    raw = AiReplySchema.parse(JSON.parse(content)) as AiReplyOutput;
  } catch (err) {
    const latencyMs = Date.now() - start;
    logger.error('ai reply: OpenAI call failed', {
      leadId, channel, latency_ms: latencyMs,
      error: err instanceof Error ? err.message : String(err),
    });
    await insertDecisionLog({
      lead_id: leadId,
      campaign_id: context?.campaignId ?? null,
      decision_type: 'reply_classify',
      input_context: { leadId, channel, messageLength: messageText.length },
      decision: 'failed',
      latency_ms: latencyMs,
      model_used: aiConfig.model,
    }).catch(() => null);
    return buildFallbackClassification(messageText);
  }

  const latencyMs = Date.now() - start;
  incAiReplyClassified(raw.intent_class);

  // ── Opt-out: immediate hard stop ──────────────────────────────────────
  if (raw.intent_class === 'opt_out' || raw.should_stop_sequence) {
    await cancelPendingOutreachJobs({ leadId });
    logger.info('ai reply: opt_out detected — sequence stopped', { leadId });
  }

  // ── Persist memory updates ────────────────────────────────────────────
  await persistMemoryUpdates(leadId, raw, messageText, context?.campaignId ?? null);

  // ── Stage movement ────────────────────────────────────────────────────
  if (raw.update_stage_to) {
    await moveLeadToStageByName(leadId, raw.update_stage_to).catch((err: unknown) => {
      logger.warn('ai reply: stage move failed', { leadId, stage: raw.update_stage_to, error: String(err) });
    });
  }

  await updateProfileNextAction(leadId, raw.next_best_action, raw.chain_of_thought.slice(0, 300), raw.confidence);
  await invalidateProfileCache(leadId);

  // ── Decision log ──────────────────────────────────────────────────────
  await insertDecisionLog({
    lead_id: leadId,
    campaign_id: context?.campaignId ?? null,
    decision_type: 'reply_classify',
    input_context: { leadId, channel, messageLength: messageText.length },
    chain_of_thought: raw.chain_of_thought,
    decision: raw.intent_class,
    confidence: raw.confidence,
    tokens_used: tokensUsed,
    latency_ms: latencyMs,
    model_used: aiConfig.model,
    autonomy_level: context?.autonomyLevel ?? null,
  }).catch(() => null);

  // ── Routing decision ──────────────────────────────────────────────────
  const requiresHumanReview = shouldRouteToInbox(raw, context);

  if (requiresHumanReview && context?.assignedTo) {
    await routeToInbox(leadId, context, raw);
  }

  logger.info('ai reply: classified', {
    leadId, channel,
    intent: raw.intent_class,
    confidence: raw.confidence,
    requiresHumanReview,
    latency_ms: latencyMs,
  });

  return {
    intent_class: raw.intent_class,
    intent_subtype: raw.intent_subtype,
    confidence: raw.confidence,
    draft_response: raw.draft_response,
    next_best_action: raw.next_best_action,
    update_stage_to: raw.update_stage_to,
    objection_type: raw.objection_type,
    buying_signal: raw.buying_signal,
    chain_of_thought: raw.chain_of_thought,
    should_stop_sequence: raw.should_stop_sequence,
    requires_human_review: requiresHumanReview,
  };
}

// ── Routing logic ─────────────────────────────────────────────────────────

function shouldRouteToInbox(
  raw: AiReplyOutput,
  context: { autonomyLevel: string; aiMinConfidence: number } | null,
): boolean {
  // Always route urgent intents
  if (['meeting_request', 'pricing_question', 'wrong_contact'].includes(raw.intent_class)) return true;
  // Always route opt_out for human awareness
  if (raw.intent_class === 'opt_out') return true;
  // Route if below confidence threshold
  if (raw.confidence < (context?.aiMinConfidence ?? 70)) return true;
  // Route if supervised mode
  if (context?.autonomyLevel === 'supervised') return true;
  return false;
}

async function routeToInbox(
  leadId: string,
  context: { assignedTo: string | null; campaignId: string | null; autonomyLevel: string },
  raw: AiReplyOutput,
): Promise<void> {
  if (!context.assignedTo) return;

  const itemTypeMap: Record<string, import('../../workers/queue').AiInboxItemType> = {
    meeting_request: 'urgent_reply',
    pricing_question: 'pricing_inquiry',
    opt_out: 'urgent_reply',
    interested: 'approve_response',
    objection: 'objection_review',
    not_now: 'approve_response',
    wrong_contact: 'urgent_reply',
    neutral: 'approve_response',
  };

  const itemType = itemTypeMap[raw.intent_class] ?? 'approve_response';
  const expiryMap: Record<string, number> = {
    urgent_reply: 1,
    approve_response: context.autonomyLevel === 'guarded' ? 4 : 0,
    pricing_inquiry: 2,
    objection_review: 4,
  };

  await enqueueAiCreateInboxItem({
    assignedTo: context.assignedTo,
    leadId,
    campaignId: context.campaignId ?? undefined,
    itemType,
    title: buildInboxTitle(raw.intent_class),
    summary: raw.chain_of_thought.slice(0, 300),
    urgencyScore: intentUrgencyScore(raw.intent_class, raw.confidence),
    aiDraftResponse: raw.draft_response ?? undefined,
    aiDraftConfidence: raw.confidence,
    expiresInHours: expiryMap[itemType] ?? 4,
  });
}

function intentUrgencyScore(intentClass: string, confidence: number): number {
  const base: Record<string, number> = {
    meeting_request: 95,
    opt_out: 90,
    pricing_question: 75,
    interested: 70,
    objection: 60,
    not_now: 40,
    wrong_contact: 85,
    neutral: 20,
  };
  return Math.min(100, (base[intentClass] ?? 50) + Math.round(confidence * 0.1));
}

function buildInboxTitle(intentClass: string): string {
  const titles: Record<string, string> = {
    meeting_request: 'Meeting request — respond now',
    pricing_question: 'Pricing question received',
    opt_out: 'Opt-out — review and confirm',
    interested: 'Interested reply — approve response',
    objection: 'Objection logged — review rebuttal',
    not_now: 'Not now reply — approve follow-up',
    wrong_contact: 'Wrong contact — verify lead',
    neutral: 'Reply received — review draft',
  };
  return titles[intentClass] ?? 'Reply received';
}

// ── Memory persistence ────────────────────────────────────────────────────

async function persistMemoryUpdates(
  leadId: string,
  raw: AiReplyOutput,
  messageText: string,
  campaignId: string | null,
): Promise<void> {
  const summaryText = `Intent: ${raw.intent_class}. ${raw.chain_of_thought.slice(0, 400)}`;
  const sentiment = intentToSentiment(raw.intent_class);

  await Promise.allSettled([
    upsertConversationSummary(leadId, summaryText, raw.intent_class, sentiment),
    raw.objection_type
      ? appendObjectionToProfile(leadId, raw.objection_type, messageText)
      : Promise.resolve(),
    raw.buying_signal
      ? appendBuyingSignalToProfile(leadId, raw.buying_signal)
      : Promise.resolve(),
  ]);
}

// ── Prompt builders ───────────────────────────────────────────────────────

function buildReplySystemPrompt(): string {
  return (
    'You are an AI sales reply classifier. Given an inbound message from a lead, classify the intent ' +
    'and generate a concise draft response. Return ONLY valid JSON — no prose, no markdown.\n\n' +
    'Required JSON fields:\n' +
    '- intent_class: one of: interested, objection, not_now, meeting_request, pricing_question, wrong_contact, opt_out, neutral\n' +
    '- intent_subtype: string or null (e.g. "high", "soft", "price", "timing", "trust", "angry")\n' +
    '- confidence: integer 0–100 — how confident you are in the classification\n' +
    '- draft_response: string (max 300 chars) or null — a concise, friendly response draft\n' +
    '- next_best_action: string — recommended CRM action\n' +
    '- update_stage_to: stage name or null — if the lead stage should change\n' +
    '- objection_type: string or null — if objection, classify: price, timing, trust, competitor, not_relevant\n' +
    '- buying_signal: string or null — quote the specific buying signal if detected\n' +
    '- chain_of_thought: your structured reasoning (Context → Intent Options → Reasoning → Decision → Confidence)\n' +
    '- should_stop_sequence: boolean — true ONLY for opt_out or explicitly angry stop requests\n\n' +
    'Rules: If opt_out → should_stop_sequence must be true. Draft response must not reference internal system details.'
  );
}

function buildReplyUserPrompt(
  lead: NonNullable<Awaited<ReturnType<typeof findLeadById>>>,
  aiProfile: Awaited<ReturnType<typeof findAiProfileByLeadId>>,
  channel: string,
  messageText: string,
): string {
  return (
    `Business: ${lead.business_name}\n` +
    `Channel: ${channel}\n` +
    `Lead stage: ${lead.pipeline_stage_id ?? 'unknown'}\n` +
    `AI profile — buying intent: ${aiProfile?.buying_intent ?? 'unknown'}\n` +
    `AI profile — offer angle: ${aiProfile?.offer_angle ?? 'unknown'}\n` +
    `AI profile — objections so far: ${JSON.stringify(aiProfile?.objection_log?.slice(-3) ?? [])}\n` +
    `Conversation summary: ${aiProfile?.conversation_summary ?? 'none'}\n\n` +
    `Inbound message:\n"${messageText.slice(0, 500)}"`
  );
}

function buildFallbackClassification(messageText: string): ReplyClassification {
  const lower = messageText.toLowerCase();
  const isOptOut = ['stop', 'unsubscribe', 'remove me', 'dont contact', "don't contact"].some(w => lower.includes(w));
  return {
    intent_class: isOptOut ? 'opt_out' : 'neutral',
    intent_subtype: null,
    confidence: 30,
    draft_response: null,
    next_best_action: isOptOut ? 'disqualify' : 'request_review',
    update_stage_to: null,
    objection_type: null,
    buying_signal: null,
    chain_of_thought: 'AI classification unavailable — fallback applied.',
    should_stop_sequence: isOptOut,
    requires_human_review: true,
  };
}

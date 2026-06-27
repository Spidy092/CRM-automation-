import { z } from 'zod';
import OpenAI from 'openai';
import { redis } from '../../shared/utils/redis';
import { logger } from '../../shared/utils/logger';
import { getAiConfig } from '../ai-settings/ai-settings.service';
import { findLeadById } from '../leads/leads.repository';
import {
  findAiProfileByLeadId,
  upsertAiProfile,
  setEnrichmentStatus,
  insertDecisionLog,
  listDecisionLogsByLead,
  listDecisionLogs,
} from './ai-intelligence.repository';
import { incAiTokens } from '../../shared/utils/metrics';
import type { LeadAiProfileRow, AiDecisionLogRow, AiResearchOutput, NextBestAction, BuyingIntent, PreferredChannel } from './ai-intelligence.types';

const PROFILE_CACHE_TTL = 60 * 60; // 1 hour — DB is authoritative
const RESEARCH_MAX_TOKENS = 800;

// ── Zod schema for OpenAI JSON output ────────────────────────────────────

const AiResearchSchema = z.object({
  pain_points: z.array(z.string()).max(6),
  offer_angle: z.string().max(300),
  buying_intent: z.enum(['high', 'medium', 'low', 'unknown']),
  reachability_score: z.number().int().min(0).max(100),
  website_quality_score: z.number().int().min(0).max(100),
  inferred_budget_range: z.enum(['low', 'medium', 'high', 'unknown']),
  preferred_channel: z.enum(['whatsapp', 'email', 'sms']),
  ai_notes: z.string().max(500),
  next_best_action: z.enum([
    'send_whatsapp', 'send_email', 'send_sms', 'wait_and_followup',
    'call', 'move_to_nurture', 'escalate_to_rep',
    'request_human_approval', 'disqualify', 'request_review',
  ]),
  next_best_action_reason: z.string().max(300),
  next_best_action_confidence: z.number().int().min(0).max(100),
  chain_of_thought: z.string().max(2000),
});

// ── Cache helpers ─────────────────────────────────────────────────────────

function profileCacheKey(leadId: string): string {
  return `ai:profile:${leadId}`;
}

export async function invalidateProfileCache(leadId: string): Promise<void> {
  await redis.del(profileCacheKey(leadId));
}

// ── Public API ────────────────────────────────────────────────────────────

export async function getAiProfile(leadId: string): Promise<LeadAiProfileRow | null> {
  const cached = await redis.get(profileCacheKey(leadId)).catch(() => null);
  if (cached) {
    try {
      return JSON.parse(cached) as LeadAiProfileRow;
    } catch {
      // ignore malformed cache — fall through to DB
    }
  }

  const profile = await findAiProfileByLeadId(leadId);
  if (profile) {
    await redis.setex(profileCacheKey(leadId), PROFILE_CACHE_TTL, JSON.stringify(profile)).catch(() => null);
  }
  return profile;
}

/** List the AI decision-log entries for a single lead (most recent first). */
export async function getLeadDecisions(
  leadId: string,
  limit: number,
  offset: number,
): Promise<{ items: AiDecisionLogRow[]; total: number }> {
  const { rows, total } = await listDecisionLogsByLead(leadId, limit, offset);
  return { items: rows, total };
}

/** List AI decision-log entries across all leads (admin audit trail). */
export async function getDecisions(opts: {
  decisionType?: string;
  limit: number;
  offset: number;
}): Promise<{ items: AiDecisionLogRow[]; total: number }> {
  const { rows, total } = await listDecisionLogs(opts);
  return { items: rows, total };
}

/**
 * Run the AI research agent for a single lead.
 *
 * Flow:
 *   1. Load lead from DB
 *   2. Get AI config (API key, model)
 *   3. Call OpenAI with a structured research prompt
 *   4. Validate response with Zod
 *   5. Write to lead_ai_profiles + ai_decision_log
 *   6. Invalidate Redis cache
 *
 * Returns the upserted profile. Never throws — marks enrichment_status='failed'
 * and re-throws so the worker can route to DLQ after max retries.
 */
export async function researchLead(leadId: string, force = false): Promise<LeadAiProfileRow> {
  const start = Date.now();

  // Skip if already enriched and not forced
  if (!force) {
    const existing = await findAiProfileByLeadId(leadId);
    if (existing?.enrichment_status === 'done') {
      logger.info('ai research: profile already done, skipping', { leadId });
      return existing;
    }
  }

  await setEnrichmentStatus(leadId, 'running');

  const lead = await findLeadById(leadId);
  if (!lead) {
    await setEnrichmentStatus(leadId, 'failed');
    throw new Error(`Lead not found: ${leadId}`);
  }

  const aiConfig = await getAiConfig();
  if (!aiConfig) {
    await setEnrichmentStatus(leadId, 'failed');
    throw new Error('AI is disabled or not configured — cannot research lead');
  }

  const client = new OpenAI({
    apiKey: aiConfig.apiKey || process.env.OPENAI_API_KEY,
    baseURL: aiConfig.baseUrl || undefined,
  });

  const systemPrompt = buildResearchSystemPrompt();
  const userPrompt = buildResearchUserPrompt(lead);

  let raw: AiResearchOutput;
  let tokensUsed = 0;

  try {
    const completion = await client.chat.completions.create({
      model: aiConfig.model,
      max_tokens: RESEARCH_MAX_TOKENS,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    tokensUsed = completion.usage?.total_tokens ?? 0;
    incAiTokens('research', tokensUsed);

    const content = completion.choices[0]?.message?.content ?? '{}';
    const parsed = AiResearchSchema.parse(JSON.parse(content));
    raw = parsed as AiResearchOutput;
  } catch (err) {
    const latencyMs = Date.now() - start;
    logger.error('ai research: OpenAI call failed', {
      leadId,
      latency_ms: latencyMs,
      error: err instanceof Error ? err.message : String(err),
    });
    await setEnrichmentStatus(leadId, 'failed');

    await insertDecisionLog({
      lead_id: leadId,
      decision_type: 'research',
      input_context: { leadId, business_name: lead.business_name },
      decision: 'failed',
      latency_ms: latencyMs,
      model_used: aiConfig.model,
    }).catch(() => null);

    throw err;
  }

  const latencyMs = Date.now() - start;

  const profile = await upsertAiProfile({
    lead_id: leadId,
    website_quality_score: raw.website_quality_score,
    pain_points: raw.pain_points,
    offer_angle: raw.offer_angle,
    inferred_budget_range: raw.inferred_budget_range,
    buying_intent: raw.buying_intent as BuyingIntent,
    reachability_score: raw.reachability_score,
    preferred_channel: raw.preferred_channel as PreferredChannel,
    ai_notes: raw.ai_notes,
    next_best_action: raw.next_best_action as NextBestAction,
    next_best_action_reason: raw.next_best_action_reason,
    next_best_action_confidence: raw.next_best_action_confidence,
    enrichment_status: 'done',
    last_enriched_at: new Date().toISOString(),
  });

  await insertDecisionLog({
    lead_id: leadId,
    decision_type: 'research',
    input_context: {
      business_name: lead.business_name,
      industry: lead.industry,
      location: lead.location,
      source_platform: lead.source_platform,
    },
    chain_of_thought: raw.chain_of_thought,
    decision: raw.next_best_action,
    confidence: raw.next_best_action_confidence,
    tokens_used: tokensUsed,
    latency_ms: latencyMs,
    model_used: aiConfig.model,
  }).catch((logErr: unknown) => {
    logger.warn('ai research: failed to write decision log', {
      leadId,
      error: logErr instanceof Error ? logErr.message : String(logErr),
    });
  });

  await invalidateProfileCache(leadId);

  logger.info('ai research: complete', {
    leadId,
    buying_intent: raw.buying_intent,
    next_best_action: raw.next_best_action,
    confidence: raw.next_best_action_confidence,
    tokens_used: tokensUsed,
    latency_ms: latencyMs,
  });

  return profile;
}

// ── Prompt builders ───────────────────────────────────────────────────────

function buildResearchSystemPrompt(): string {
  return (
    'You are an AI sales intelligence analyst. Given a business lead, you analyze it and return a ' +
    'JSON object with your research findings. You must respond ONLY with valid JSON — no prose, no markdown.\n\n' +
    'Required JSON fields:\n' +
    '- pain_points: string[] (max 6 items) — likely business pain points based on industry, ratings, web presence\n' +
    '- offer_angle: string — the most compelling offer angle for this specific business\n' +
    '- buying_intent: "high" | "medium" | "low" | "unknown"\n' +
    '- reachability_score: integer 0–100 — how reachable this business is via outreach\n' +
    '- website_quality_score: integer 0–100 — 0 if no website, scale by mobile UX, booking CTA, trust signals\n' +
    '- inferred_budget_range: "low" | "medium" | "high" | "unknown"\n' +
    '- preferred_channel: "whatsapp" | "email" | "sms"\n' +
    '- ai_notes: string (max 300 chars) — concise intel summary for the sales rep\n' +
    '- next_best_action: one of: send_whatsapp, send_email, send_sms, wait_and_followup, call, ' +
    'move_to_nurture, escalate_to_rep, request_human_approval, disqualify, request_review\n' +
    '- next_best_action_reason: string (max 200 chars)\n' +
    '- next_best_action_confidence: integer 0–100\n' +
    '- chain_of_thought: string — your structured reasoning: Context → Options → Reasoning → Decision → Confidence\n\n' +
    'Never mention internal IDs, email addresses, or phone numbers in any text field.'
  );
}

function buildResearchUserPrompt(lead: Awaited<ReturnType<typeof findLeadById>> & {}): string {
  const rating = lead?.google_rating ? `${lead.google_rating}/5 (${lead.review_count ?? 0} reviews)` : 'N/A';
  return (
    `Business: ${lead!.business_name}\n` +
    `Industry: ${lead!.industry}\n` +
    `Location: ${lead!.location}${lead!.country ? ', ' + lead!.country : ''}\n` +
    `Google rating: ${rating}\n` +
    `Website: ${lead!.website ?? 'none'}\n` +
    `Source: ${lead!.source_platform}\n` +
    `Lead score: ${lead!.lead_score}\n` +
    `Tags: ${(lead!.tags ?? []).join(', ') || 'none'}\n` +
    `Notes: ${lead!.notes ?? 'none'}`
  );
}

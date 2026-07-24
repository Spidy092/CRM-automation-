import OpenAI from 'openai';
import { redis } from '../../shared/utils/redis';
import { logger } from '../../shared/utils/logger';
import { type LeadRow } from '../leads/leads.types';
import { type TemplateRow } from '../templates/templates.types';
import { getAiConfig } from '../ai-settings/ai-settings.service';

interface PersonalizeResult {
  message: string;
  tokensUsed: number;
  latencyMs: number;
  cacheHit: boolean;
}

interface PromptContext {
  businessName: string;
  industry: string;
  location: string;
  country: string | null;
  rating: number | null;
  sourcePlatform: string;
  classification: string | null;
  tags: string[];
}

function buildPromptContext(lead: LeadRow): PromptContext {
  return {
    businessName: lead.business_name,
    industry: lead.industry,
    location: lead.location,
    country: lead.country,
    rating: lead.google_rating ? parseFloat(lead.google_rating) : null,
    sourcePlatform: lead.source_platform,
    classification: lead.classification,
    tags: lead.tags ?? [],
  };
}

function buildSystemPrompt(): string {
  return (
    'You are a helpful CRM outreach assistant. ' +
    'Given a business lead and an outreach template, personalize the message ' +
    'by naturally weaving in details about the business name, industry, location, ' +
    'and any notable context (e.g. rating, source platform). ' +
    'Do NOT include placeholders like {business_name} in the final output. ' +
    'Keep the message concise and professional. ' +
    'Do NOT mention internal IDs or personal contact information.'
  );
}

function buildUserPrompt(templateBody: string, ctx: PromptContext): string {
  return (
    `Template:\n${templateBody}\n\n` +
    `Lead context:\n` +
    `- Business: ${ctx.businessName}\n` +
    `- Industry: ${ctx.industry}\n` +
    `- Location: ${ctx.location}${ctx.country ? ', ' + ctx.country : ''}\n` +
    `${ctx.rating !== null ? `- Rating: ${ctx.rating}/5\n` : ''}` +
    `- Source: ${ctx.sourcePlatform}\n` +
    `${ctx.classification ? `- Classification: ${ctx.classification}\n` : ''}` +
    `${ctx.tags.length > 0 ? `- Tags: ${ctx.tags.join(', ')}` : ''}`
  );
}

function cacheKey(leadId: string, templateId: string): string {
  return `ai:msg:${leadId}:${templateId}`;
}

function performFallback(templateBody: string, lead: LeadRow): string {
  let body = templateBody;
  const firstName = lead.contact_name?.split(' ')[0] || lead.contact_name;
  // Keys cover both the scraper-oriented vocabulary ({business_name}, {industry}, …)
  // and the contact-oriented vocabulary templates are actually authored with
  // ({client_name}, {first_name}, …) — both are used across existing templates.
  const safeReplacements: Record<string, string | number | null> = {
    business_name: lead.business_name,
    company_name: lead.business_name,
    industry: lead.industry,
    location: lead.location,
    country: lead.country ?? '',
    rating: lead.google_rating ?? '',
    source_platform: lead.source_platform,
    classification: lead.classification ?? '',
    contact_name: lead.contact_name,
    client_name: lead.contact_name,
    first_name: firstName,
  };
  for (const [key, value] of Object.entries(safeReplacements)) {
    // Match {{key}} before {key} — both forms appear across existing templates.
    const doubleBraceRegex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
    const singleBraceRegex = new RegExp(`\\{${key}\\}`, 'g');
    body = body.replace(doubleBraceRegex, String(value)).replace(singleBraceRegex, String(value));
  }
  // Strip any remaining unmatched placeholders, {{double}} first so a leftover
  // outer brace from an unmatched {{var}} doesn't survive as stray text.
  body = body.replace(/\{\{[^}]+\}\}/g, '').replace(/\{[^}]+\}/g, '');
  return body;
}

export async function personalizeMessage(
  lead: LeadRow,
  template: TemplateRow,
  options?: { enabled?: boolean },
): Promise<PersonalizeResult> {
  const leadId = lead.id;
  const templateId = template.id;
  const key = cacheKey(leadId, templateId);
  const start = Date.now();

  if (options?.enabled === false) {
    const latencyMs = Date.now() - start;
    const message = performFallback(template.body, lead);
    return { message, tokensUsed: 0, latencyMs, cacheHit: false };
  }

  let aiConfig;
  try {
    aiConfig = await getAiConfig();
  } catch (err) {
    logger.warn('Failed to fetch AI settings, falling back', { error: (err as Error).message });
  }

  if (!aiConfig) {
    const latencyMs = Date.now() - start;
    const message = performFallback(template.body, lead);
    return { message, tokensUsed: 0, latencyMs, cacheHit: false };
  }

  // ── Cache lookup ─────────────────────────────────────────────────────
  try {
    const cached = await redis.get(key);
    if (cached) {
      const latencyMs = Date.now() - start;
      logger.info('AI cache hit', {
        lead_id: leadId,
        template_id: templateId,
        tokens_used: 0,
        latency_ms: latencyMs,
        cache_hit: true,
      });
      return { message: cached, tokensUsed: 0, latencyMs, cacheHit: true };
    }
  } catch (cacheErr) {
    logger.warn('AI cache lookup failed', {
      lead_id: leadId,
      template_id: templateId,
      error: (cacheErr as Error).message,
    });
  }

  // ── OpenAI call ──────────────────────────────────────────────────────
  const apiKey = aiConfig.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.warn('OPENAI_API_KEY missing; falling back to template substitution', {
      lead_id: leadId,
      template_id: templateId,
    });
    const latencyMs = Date.now() - start;
    const message = performFallback(template.body, lead);
    return { message, tokensUsed: 0, latencyMs, cacheHit: false };
  }

  const client = new OpenAI({
    apiKey,
    baseURL: aiConfig.baseUrl || undefined,
  });

  const ctx = buildPromptContext(lead);
  const system = aiConfig.systemPromptOverride || buildSystemPrompt();
  const user = buildUserPrompt(template.body, ctx);

  try {
    const completion = await client.chat.completions.create({
      model: aiConfig.model,
      max_tokens: Math.min(aiConfig.maxTokens, 500),
      temperature: aiConfig.temperature,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });

    const message = completion.choices[0]?.message?.content?.trim() ?? '';
    const tokensUsed = completion.usage?.total_tokens ?? 0;
    const latencyMs = Date.now() - start;

    // ── Cache write ───────────────────────────────────────────────────
    try {
      await redis.setex(key, aiConfig.cacheTtlSeconds, message);
    } catch (cacheWriteErr) {
      logger.warn('AI cache write failed', {
        lead_id: leadId,
        template_id: templateId,
        error: (cacheWriteErr as Error).message,
      });
    }

    logger.info('AI personalize success', {
      lead_id: leadId,
      template_id: templateId,
      tokens_used: tokensUsed,
      latency_ms: latencyMs,
      cache_hit: false,
    });

    return { message, tokensUsed, latencyMs, cacheHit: false };
  } catch (openAiErr) {
    const latencyMs = Date.now() - start;
    logger.error('AI personalize failed; falling back to template substitution', {
      lead_id: leadId,
      template_id: templateId,
      latency_ms: latencyMs,
      error: (openAiErr as Error).message,
    });

    const message = performFallback(template.body, lead);
    return { message, tokensUsed: 0, latencyMs, cacheHit: false };
  }
}

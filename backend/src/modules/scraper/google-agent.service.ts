import OpenAI from 'openai';
import { getAiConfig } from '../ai-settings/ai-settings.service';
import { buildGoogleScraperAgentPrompt } from '../outreach/outreach.prompt';
import { AppError } from '../../shared/middleware/errorHandler';
import { logger } from '../../shared/utils/logger';
import { googleAgentToolSchemas, type GoogleAgentCandidate } from './google-agent.schema';

export interface GoogleAgentAdapters {
  search(query: string): Promise<GoogleAgentCandidate[]>;
  details(candidate: GoogleAgentCandidate): Promise<GoogleAgentCandidate>;
  website(candidate: GoogleAgentCandidate): Promise<GoogleAgentCandidate>;
}

type Completion = (
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
) => Promise<OpenAI.Chat.ChatCompletionMessage>;

const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_places',
      description: 'Find businesses in the configured area.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  ...(['get_place_details', 'inspect_website'] as const).map((name) => ({
    type: 'function' as const,
    function: {
      name,
      description:
        name === 'get_place_details'
          ? 'Fetch observed business contacts for a discovered place.'
          : 'Read the discovered business website for public evidence and email.',
      parameters: {
        type: 'object',
        properties: { placeId: { type: 'string' } },
        required: ['placeId'],
        additionalProperties: false,
      },
    },
  })),
  {
    type: 'function',
    function: {
      name: 'select_candidates',
      description: 'Select researched businesses for import when research finishes successfully.',
      parameters: {
        type: 'object',
        properties: {
          placeIds: { type: 'array', items: { type: 'string' }, maxItems: 10 },
          reason: { type: 'string' },
        },
        required: ['placeIds', 'reason'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finish',
      description: 'Finish research, explaining outcomes and limitations.',
      parameters: {
        type: 'object',
        properties: { summary: { type: 'string' } },
        required: ['summary'],
        additionalProperties: false,
      },
    },
  },
];

/** Public business evidence only: contact destinations are not sent to the model. */
function modelEvidence(candidate: GoogleAgentCandidate): Record<string, unknown> {
  const { phone, email, emailSource, detailsFetched, ...evidence } = candidate;
  return {
    ...evidence,
    detailsFetched,
    hasPhone: Boolean(phone),
    hasEmail: Boolean(email),
    emailSource,
  };
}

export async function runGoogleAgentLoop(input: {
  goal: string;
  location: string;
  maxResults: number;
  maxRounds: number;
  adapters: GoogleAgentAdapters;
  complete: Completion;
  assertBudget: () => void;
}): Promise<{
  candidates: GoogleAgentCandidate[];
  summary: string;
  decisions: Array<{ placeId: string; reason: string }>;
  rounds: number;
  toolCalls: number;
}> {
  const observed = new Map<string, GoogleAgentCandidate>();
  const selected = new Map<string, string>();
  const queries = new Set<string>();
  const inspected = new Set<string>();
  let toolCalls = 0;
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: buildGoogleScraperAgentPrompt() },
    {
      role: 'user',
      content: JSON.stringify({
        goal: input.goal,
        area: input.location,
        maxCandidates: input.maxResults,
        maxRounds: input.maxRounds,
      }),
    },
  ];

  for (let round = 0; round < input.maxRounds; round++) {
    input.assertBudget();
    messages.push({
      role: 'system',
      content: JSON.stringify({
        remainingRounds: input.maxRounds - round,
        remainingSelections: input.maxResults - selected.size,
        remainingToolCalls: 64 - toolCalls,
      }),
    });
    if (JSON.stringify(messages).length > 64000) {
      throw new AppError('AI scraper evidence budget exceeded; no leads imported.', 422);
    }
    const message = await input.complete(messages);
    input.assertBudget();
    const calls = message.tool_calls ?? [];
    if (!calls.length)
      throw new AppError('AI scraper did not finish through its tools; no leads imported.', 422);
    if (calls.length > 8 || toolCalls + calls.length > 64) {
      throw new AppError('AI scraper tool-call budget exceeded; no leads imported.', 422);
    }
    messages.push(message);
    for (let index = 0; index < calls.length; index++) {
      input.assertBudget();
      const call = calls[index];
      toolCalls++;
      if (call.type !== 'function') throw new AppError('Unsupported AI scraper tool type', 422);
      const name = call.function.name;
      let args: unknown;
      try {
        args = JSON.parse(call.function.arguments);
      } catch {
        throw new AppError('Malformed AI scraper tool arguments; no leads imported.', 422);
      }
      let result: unknown;
      if (name === 'search_places') {
        const parsed = googleAgentToolSchemas.search_places.parse(args);
        if (queries.has(parsed.query.toLowerCase())) {
          result = { error: 'Search already performed; refine the query or finish.' };
        } else if (observed.size >= 50) {
          result = { error: 'Candidate budget reached; research existing candidates or finish.' };
        } else {
          queries.add(parsed.query.toLowerCase());
          const found = await input.adapters.search(parsed.query);
          for (const candidate of found) {
            if (!observed.has(candidate.placeId) && observed.size < 50)
              observed.set(candidate.placeId, candidate);
          }
          result = {
            candidates: found
              .filter((c) => observed.has(c.placeId))
              .map(modelEvidence)
              .slice(0, 20),
            observedCount: observed.size,
          };
        }
      } else if (name === 'get_place_details' || name === 'inspect_website') {
        const parsed = googleAgentToolSchemas[name].parse(args);
        const candidate = observed.get(parsed.placeId);
        if (!candidate) throw new AppError('AI scraper referenced an unobserved place ID', 422);
        if (name === 'inspect_website' && !candidate.detailsFetched) {
          result = { error: 'Fetch place details before inspecting its website.' };
        } else if (
          (name === 'get_place_details' && candidate.detailsFetched) ||
          (name === 'inspect_website' && inspected.has(candidate.placeId))
        ) {
          result = modelEvidence(candidate);
        } else {
          const updated = await (name === 'get_place_details'
            ? input.adapters.details(candidate)
            : input.adapters.website(candidate));
          if (updated.placeId !== candidate.placeId)
            throw new AppError('Candidate identity changed unexpectedly', 422);
          observed.set(candidate.placeId, updated);
          if (name === 'inspect_website') inspected.add(candidate.placeId);
          result = modelEvidence(updated);
        }
      } else if (name === 'select_candidates') {
        const parsed = googleAgentToolSchemas.select_candidates.parse(args);
        const ids = [...new Set(parsed.placeIds)];
        for (const id of ids) {
          if (!observed.get(id)?.detailsFetched) {
            throw new AppError('AI scraper selected an unobserved or unresearched business', 422);
          }
        }
        if (new Set([...selected.keys(), ...ids]).size > input.maxResults) {
          throw new AppError('AI scraper exceeded the selected lead limit', 422);
        }
        for (const id of ids) selected.set(id, parsed.reason);
        result = { selected: selected.size };
      } else if (name === 'finish') {
        const parsed = googleAgentToolSchemas.finish.parse(args);
        if (!queries.size || index !== calls.length - 1) {
          throw new AppError('AI scraper must search first and finish as its last tool call', 422);
        }
        input.assertBudget();
        return {
          candidates: [...selected.keys()].map((id) => observed.get(id)!),
          summary: parsed.summary,
          decisions: [...selected].map(([placeId, reason]) => ({ placeId, reason })),
          rounds: round + 1,
          toolCalls,
        };
      } else {
        throw new AppError('AI scraper requested a tool outside its catalog', 422);
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  throw new AppError('AI scraper round budget exhausted before finishing; no leads imported.', 422);
}

export async function runConfiguredGoogleAgent(input: {
  goal: string;
  location: string;
  maxResults: number;
  maxRounds: number;
  adapters: GoogleAgentAdapters;
  assertBudget: () => void;
  deadline: number;
  logId: string;
}): Promise<Awaited<ReturnType<typeof runGoogleAgentLoop>>> {
  const config = await getAiConfig();
  if (!config)
    throw new AppError(
      'Enable AI settings and configure a model/key before running the AI scraper.',
      400,
    );
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl || undefined,
    maxRetries: 0,
  });
  return runGoogleAgentLoop({
    ...input,
    complete: async (messages) => {
      const started = Date.now();
      try {
        const completion = await client.chat.completions.create(
          {
            model: config.model,
            temperature: config.temperature,
            max_tokens: 500,
            tools,
            tool_choice: 'required',
            messages,
          },
          { timeout: Math.max(1, Math.min(20000, input.deadline - Date.now())) },
        );
        logger.info('scraper AI call', {
          logId: input.logId,
          model: config.model,
          tokens_used: completion.usage?.total_tokens ?? 0,
          latency_ms: Date.now() - started,
          cache_hit: false,
        });
        const message = completion.choices[0]?.message;
        if (!message || completion.choices[0]?.finish_reason === 'length') {
          throw new AppError('AI scraper returned an incomplete response; no leads imported.', 422);
        }
        return message;
      } catch (error) {
        if (error instanceof AppError) throw error;
        // Vendor exceptions can contain credentials or request URLs; do not persist them.
        throw new AppError(
          'AI scraper model call failed; no leads imported. Retry or use standard mode.',
          502,
        );
      }
    },
  });
}

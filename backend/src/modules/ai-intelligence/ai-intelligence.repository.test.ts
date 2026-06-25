import { pool } from '../../shared/utils/db';
import {
  findAiProfileByLeadId,
  upsertAiProfile,
  setEnrichmentStatus,
  insertDecisionLog,
} from './ai-intelligence.repository';

jest.mock('../../shared/utils/db', () => ({
  pool: { query: jest.fn() },
}));

const mockPoolQuery = pool.query as unknown as jest.Mock;

function mockQueryResult(rows: unknown[]) {
  return Promise.resolve({
    rows,
    command: 'SELECT',
    oid: 0,
    fields: [],
    rowCount: rows.length,
  } as any);
}

const baseProfile = {
  id: 'p1',
  lead_id: 'l1',
  website_quality_score: 80,
  pain_points: ['price'],
  offer_angle: 'Save money',
  inferred_budget_range: 'medium',
  buying_intent: 'high' as const,
  reachability_score: 90,
  buying_signals: [],
  objection_log: [],
  do_not_say: [],
  preferred_channel: 'email' as const,
  preferred_time_of_day: null,
  conversation_summary: null,
  ai_notes: 'notes',
  next_best_action: 'send_email' as const,
  next_best_action_reason: 'reason',
  next_best_action_confidence: 85,
  enrichment_status: 'done' as const,
  last_enriched_at: '2026-06-25T00:00:00Z',
  created_at: '2026-06-25T00:00:00Z',
  updated_at: '2026-06-25T00:00:00Z',
};

describe('ai-intelligence.repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('findAiProfileByLeadId', () => {
    it('returns profile when found', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([baseProfile]));
      const result = await findAiProfileByLeadId('l1');
      expect(result).toEqual(baseProfile);
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM lead_ai_profiles WHERE lead_id = $1'),
        ['l1'],
      );
    });

    it('returns null when not found', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([]));
      const result = await findAiProfileByLeadId('l1');
      expect(result).toBeNull();
    });
  });

  describe('upsertAiProfile', () => {
    it('upserts and returns profile', async () => {
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([baseProfile]));
      const input = {
        lead_id: 'l1',
        enrichment_status: 'done' as const,
        website_quality_score: 80,
        pain_points: ['price'],
        offer_angle: 'Save money',
        inferred_budget_range: 'medium',
        buying_intent: 'high' as const,
        reachability_score: 90,
        preferred_channel: 'email' as const,
        ai_notes: 'notes',
        next_best_action: 'send_email' as const,
        next_best_action_reason: 'reason',
        next_best_action_confidence: 85,
        last_enriched_at: '2026-06-25T00:00:00Z',
      };
      const result = await upsertAiProfile(input);
      expect(result).toEqual(baseProfile);
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO lead_ai_profiles'),
        expect.arrayContaining([
          'l1',
          80,
          JSON.stringify(['price']),
          'Save money',
          'medium',
          'high',
          90,
          'email',
          'notes',
          'send_email',
          'reason',
          85,
          'done',
          '2026-06-25T00:00:00Z',
        ]),
      );
    });
  });

  describe('setEnrichmentStatus', () => {
    it.each(['pending', 'running', 'done', 'failed'] as const)(
      'sets status to %s',
      async (status) => {
        mockPoolQuery.mockResolvedValueOnce(undefined);
        await setEnrichmentStatus('l1', status);
        expect(mockPoolQuery).toHaveBeenCalledWith(
          expect.stringContaining('ON CONFLICT (lead_id) DO UPDATE SET enrichment_status = $2'),
          ['l1', status],
        );
      },
    );
  });

  describe('insertDecisionLog', () => {
    it('inserts decision log with all fields', async () => {
      const row = {
        id: 'd1',
        lead_id: 'l1',
        campaign_id: 'c1',
        decision_type: 'research' as const,
        input_context: { foo: 'bar' },
        chain_of_thought: 'thought',
        decision: 'send_email',
        confidence: 90,
        tokens_used: 100,
        latency_ms: 200,
        model_used: 'gpt-4o',
        autonomy_level: 'high',
        human_approval_required: true,
        human_approved_by: null,
        human_approved_at: null,
        created_at: '2026-06-25T00:00:00Z',
      };
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([row]));
      const input = {
        lead_id: 'l1',
        campaign_id: 'c1',
        decision_type: 'research' as const,
        input_context: { foo: 'bar' },
        chain_of_thought: 'thought',
        decision: 'send_email',
        confidence: 90,
        tokens_used: 100,
        latency_ms: 200,
        model_used: 'gpt-4o',
        autonomy_level: 'high',
        human_approval_required: true,
      };
      const result = await insertDecisionLog(input);
      expect(result).toEqual(row);
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO ai_decision_log'),
        expect.arrayContaining([
          'l1',
          'c1',
          'research',
          JSON.stringify({ foo: 'bar' }),
          'thought',
          'send_email',
          90,
          100,
          200,
          'gpt-4o',
          'high',
          true,
        ]),
      );
    });

    it('inserts with null defaults when optional fields omitted', async () => {
      const row = {
        id: 'd1',
        lead_id: null,
        campaign_id: null,
        decision_type: 'research' as const,
        input_context: {},
        chain_of_thought: null,
        decision: 'failed',
        confidence: null,
        tokens_used: null,
        latency_ms: null,
        model_used: null,
        autonomy_level: null,
        human_approval_required: false,
        human_approved_by: null,
        human_approved_at: null,
        created_at: '2026-06-25T00:00:00Z',
      };
      mockPoolQuery.mockResolvedValueOnce(mockQueryResult([row]));
      const input = {
        decision_type: 'research' as const,
        input_context: {},
        decision: 'failed',
      };
      const result = await insertDecisionLog(input);
      expect(result).toEqual(row);
    });
  });
});

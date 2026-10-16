/**
 * Durable execution repository — SQL contract coverage.
 *
 * Asserts the safety-critical query shapes with a mocked pool: atomic
 * claims, conditional capacity reservation, idempotent inserts, pause
 * freeze semantics, and bounded keyset pagination. No live database needed.
 */
import { pool } from '../../shared/utils/db';

jest.mock('../../shared/utils/db', () => ({
  pool: { query: jest.fn(), connect: jest.fn() },
  // Mirrors the real withTransaction (BEGIN/fn/COMMIT, ROLLBACK on error)
  // over the mocked pool so transaction composition is exercised.
  withTransaction: async (fn: (client: unknown) => Promise<unknown>) => {
    const mocked = jest.requireMock('../../shared/utils/db') as {
      pool: { connect: jest.Mock };
    };
    const client = await mocked.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
}));

const mockPoolQuery = pool.query as unknown as jest.Mock;

function mockQueryResult(rows: unknown[]) {
  return Promise.resolve({
    rows,
    command: 'SELECT',
    oid: 0,
    fields: [],
    rowCount: rows.length,
  } as never);
}

beforeEach(() => {
  jest.clearAllMocks();
});

  function mockTxClient(queries: Array<{ rows: unknown[] }>) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    let step = 0;
    const client = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        if (/^(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql.trim())) return { rows: [], rowCount: 0 };
        calls.push({ sql, params });
        const next = queries[Math.min(step, queries.length - 1)];
        step += 1;
        const rows = next?.rows ?? [];
        return { rows, rowCount: rows.length };
      }),
    };
    return { client, calls };
  }

function mockPoolConnect(client: { query: jest.Mock }) {
    (pool as unknown as { connect: jest.Mock }).connect = jest.fn(async () => ({
      query: client.query,
      release: jest.fn(),
    }));
    // withTransaction issues BEGIN/COMMIT around the scripted statements; the
    // fake client answers transaction control without consuming the script.
  }

describe('claimDueStepExecutionTx', () => {
  it('locks execution, campaign, and enrollment rows in shared order before claiming', async () => {
    const { claimDueStepExecutionTx } = await import('./campaigns.execution.repository');
    const duePast = new Date(Date.now() - 60_000).toISOString();
    const { client, calls } = mockTxClient([
      { rows: [{ dedupe_key: 'k-1', generation: 2, state: 'scheduled', due_at: duePast, lease_expires_at: null, campaign_id: 'c1', lead_id: 'l1' }] },
      { rows: [{ status: 'active' }] },
      { rows: [{ enrollment_status: 'active', scheduling_generation: 2 }] },
      { rows: [{ dedupe_key: 'k-1', state: 'claimed' }] },
    ]);
    mockPoolConnect(client);
    // withTransaction issues BEGIN/COMMIT around the scripted statements.
    const claimed = await claimDueStepExecutionTx({
      dedupeKey: 'k-1',
      expectedGeneration: 2,
      workerId: 'w-1',
      leaseMs: 300000,
    });
    expect(claimed).toEqual({ dedupe_key: 'k-1', state: 'claimed' });
    const statements = calls.map((c) => c.sql);
    const lockOrder = statements
      .map((sql) => {
        if (sql.includes('campaign_step_executions') && sql.includes('FOR UPDATE')) return 'execution';
        if (sql.includes('FROM campaigns') && sql.includes('FOR UPDATE')) return 'campaign';
        if (sql.includes('FROM campaign_leads') && sql.includes('FOR UPDATE')) return 'enrollment';
        return null;
      })
      .filter(Boolean);
    expect(lockOrder).toEqual(['execution', 'campaign', 'enrollment']);
  });

  it('returns null when pause committed first (paused campaign or bumped generation)', async () => {
    const { claimDueStepExecutionTx } = await import('./campaigns.execution.repository');
    const duePast = new Date(Date.now() - 60_000).toISOString();
    const { client } = mockTxClient([
      { rows: [{ dedupe_key: 'k-1', generation: 2, state: 'scheduled', due_at: duePast, lease_expires_at: null, campaign_id: 'c1', lead_id: 'l1' }] },
      { rows: [{ status: 'paused' }] },
    ]);
    mockPoolConnect(client);
    await expect(
      claimDueStepExecutionTx({ dedupeKey: 'k-1', expectedGeneration: 2, workerId: 'w-1', leaseMs: 300000 }),
    ).resolves.toBeNull();
  });

  it('returns null for terminal rows, future dues, and live leases', async () => {
    const { claimDueStepExecutionTx } = await import('./campaigns.execution.repository');
    const future = new Date(Date.now() + 60_000).toISOString();
    for (const execution of [
      { dedupe_key: 'k', generation: 0, state: 'sent', due_at: null, lease_expires_at: null, campaign_id: 'c', lead_id: 'l' },
      { dedupe_key: 'k', generation: 0, state: 'scheduled', due_at: future, lease_expires_at: null, campaign_id: 'c', lead_id: 'l' },
      { dedupe_key: 'k', generation: 0, state: 'scheduled', due_at: null, lease_expires_at: future, campaign_id: 'c', lead_id: 'l' },
    ]) {
      const { client } = mockTxClient([{ rows: [execution] }]);
      mockPoolConnect(client);
      await expect(
        claimDueStepExecutionTx({ dedupeKey: 'k', expectedGeneration: 0, workerId: 'w', leaseMs: 1 }),
      ).resolves.toBeNull();
    }
  });
});

describe('reserveDailyCapacity', () => {
  it('reserves only when the day is under its limit', async () => {
    const { reserveDailyCapacity } = await import('./campaigns.execution.repository');
    mockPoolQuery
      .mockResolvedValueOnce(mockQueryResult([{ reserved: 0 }]))
      .mockResolvedValueOnce(mockQueryResult([{ ok: '1' }]));
    await expect(reserveDailyCapacity('camp-1', '2026-10-13', 50)).resolves.toBe(true);
    const [, secondParams] = mockPoolQuery.mock.calls[1];
    expect(mockPoolQuery.mock.calls[1][0]).toContain('AND reserved < send_limit');
    expect(secondParams).toEqual(['camp-1', '2026-10-13']);

    mockPoolQuery
      .mockResolvedValueOnce(mockQueryResult([{ reserved: 50 }]))
      .mockResolvedValueOnce(mockQueryResult([]));
    await expect(reserveDailyCapacity('camp-1', '2026-10-13', 50)).resolves.toBe(false);
    expect(mockPoolQuery.mock.calls[2][0]).toContain('DO UPDATE SET send_limit = EXCLUDED.send_limit');
  });

  it('completes a final phone-task enrollment only when its current step and generation match', async () => {
    const { completeEnrollmentAfterPhoneTaskTx } = await import('./campaigns.execution.repository');
    mockPoolQuery.mockResolvedValueOnce(mockQueryResult([{ lead_id: 'lead-1' }]));
    await expect(
      completeEnrollmentAfterPhoneTaskTx({
        campaignId: 'camp-1',
        leadId: 'lead-1',
        completedStepNumber: 3,
        expectedGeneration: 4,
        completedSteps: 3,
      }),
    ).resolves.toBe(true);
    expect(mockPoolQuery.mock.calls[0][0]).toContain("enrollment_status IN ('active', 'paused')");
    expect(mockPoolQuery.mock.calls[0][0]).toContain('scheduling_generation = $4');
    expect(mockPoolQuery.mock.calls[0][0]).toContain('next_step_number = $3');
  });

  it('releases a slot after a definite failure', async () => {
    const { releaseDailyCapacity } = await import('./campaigns.execution.repository');
    mockPoolQuery.mockResolvedValueOnce(mockQueryResult([]));
    await releaseDailyCapacity('camp-1', '2026-10-13');
    expect(mockPoolQuery.mock.calls[0][0]).toContain('GREATEST(0, reserved - 1)');
  });
});

describe('insertStepExecution', () => {
  it('inserts idempotently on the dedupe key with an explicit dispatch mode', async () => {
    const { insertStepExecution } = await import('./campaigns.execution.repository');
    mockPoolQuery.mockResolvedValueOnce(mockQueryResult([{ id: 'exec-1' }]));
    const row = await insertStepExecution({
      campaignId: 'camp-1',
      leadId: 'lead-1',
      snapshotId: 'snap-1',
      stepNumber: 1,
      channel: 'email',
      templateId: 'tmpl-1',
      generation: 0,
      attempt: 0,
      dueAt: null,
      mockMode: true,
    });
    expect(row).toEqual({ id: 'exec-1' });
    const [sql, params] = mockPoolQuery.mock.calls[0];
    expect(sql).toContain('ON CONFLICT (dedupe_key) DO NOTHING');
    expect(sql).toContain('mock_mode');
    expect(params).toContain(true);
  });

  it('returns null for a duplicate request instead of scheduling twice', async () => {
    const { insertStepExecution } = await import('./campaigns.execution.repository');
    mockPoolQuery.mockResolvedValueOnce(mockQueryResult([]));
    await expect(
      insertStepExecution({
        campaignId: 'camp-1',
        leadId: 'lead-1',
        snapshotId: 'snap-1',
        stepNumber: 1,
        channel: 'email',
        templateId: 'tmpl-1',
        generation: 0,
        attempt: 0,
        dueAt: null,
        mockMode: false,
      }),
    ).resolves.toBeNull();
  });
});

describe('pause / resume persistence', () => {
  it('flips status and freezes delays atomically, locking campaigns before enrollments', async () => {
    const { pauseCampaignTx } = await import('./campaigns.execution.repository');
    const { client, calls } = mockTxClient([
      { rows: [{ id: 'camp-1', status: 'paused' }] },
      { rows: [{ id: 'a' }, { id: 'b' }] },
    ]);
    mockPoolConnect(client);
    const result = await pauseCampaignTx('camp-1', new Date().toISOString());
    expect(result?.campaign.status).toBe('paused');
    expect(result?.frozen).toBe(2);
    const statements = calls.map((c) => c.sql);
    expect(statements[0]).toContain("status = 'paused'");
    expect(statements[0]).toContain("status = 'active'");
    expect(statements[1]).toContain('delay_remaining_ms');
    expect(statements[1]).toContain('scheduling_generation + 1');
  });

  it('reports a conflict instead of partial state when already paused', async () => {
    const { pauseCampaignTx } = await import('./campaigns.execution.repository');
    const { client } = mockTxClient([{ rows: [] }]);
    mockPoolConnect(client);
    await expect(pauseCampaignTx('camp-1', new Date().toISOString())).resolves.toBeNull();
  });

  it('pauses one enrollment only on the expected generation (optimistic concurrency)', async () => {
    const { pauseEnrollmentState } = await import('./campaigns.execution.repository');
    mockPoolQuery.mockResolvedValueOnce(mockQueryResult([]));
    await expect(
      pauseEnrollmentState('camp-1', 'lead-1', 'break', 4, new Date().toISOString()),
    ).resolves.toBeNull();
    const [sql, params] = mockPoolQuery.mock.calls[0];
    expect(sql).toContain("enrollment_status = 'active'");
    expect(sql).toContain('scheduling_generation = $4');
    expect(params[3]).toBe(4);
  });

  it('resumes one enrollment atomically with its current-generation execution', async () => {
    const { resumeEnrollmentTx } = await import('./campaigns.execution.repository');
    const { client, calls } = mockTxClient([
      { rows: [{ enrollment_status: 'active', scheduling_generation: 6, next_step_number: 2, next_due_at: '2026-10-20T09:00:00.000Z' }] },
      { rows: [{ id: 'exec-1' }] },
    ]);
    mockPoolConnect(client);
    const result = await resumeEnrollmentTx({
      campaignId: 'camp-1',
      leadId: 'lead-1',
      expectedGeneration: 5,
      computedDueAt: '2026-10-20T09:00:00.000Z',
      clearTimingUnknown: true,
      execution: {
        stepNumber: 2,
        channel: 'email',
        templateId: 'tmpl-2',
        snapshotId: 'snap-1',
        mockMode: true,
      },
    });
    expect(result?.enrollment.enrollment_status).toBe('active');
    expect(result?.enrollment.scheduling_generation).toBe(6);
    expect(result?.nextDedupeKey).toContain('camp-1');
    const statements = calls.map((c) => c.sql);
    expect(statements[0]).toContain("enrollment_status = 'paused'");
    expect(statements[0]).toContain('scheduling_generation + 1');
    expect(statements[1]).toContain('ON CONFLICT (dedupe_key) DO NOTHING');
    expect(statements[1]).toContain('mock_mode');
  });

  it('reports a conflict when the version moved', async () => {
    const { resumeEnrollmentTx } = await import('./campaigns.execution.repository');
    const { client } = mockTxClient([{ rows: [] }]);
    mockPoolConnect(client);
    await expect(
      resumeEnrollmentTx({
        campaignId: 'camp-1',
        leadId: 'lead-1',
        expectedGeneration: 4,
        computedDueAt: '2026-10-20T09:00:00.000Z',
        clearTimingUnknown: false,
        execution: null,
      }),
    ).resolves.toBeNull();
  });
});

describe('recordAcceptanceTx', () => {
  it('commits acceptance, advancement, and the next intent together', async () => {
    const { recordAcceptanceTx } = await import('./campaigns.execution.repository');
    const { client, calls } = mockTxClient([
      { rows: [{ dedupe_key: 'exec-1', mock_mode: false, step_number: 1 }] },
      { rows: [{ status: 'active' }] },
      { rows: [{ enrollment_status: 'active', next_step_number: 1, scheduling_generation: 0 }] },
      { rows: [] },
      { rows: [{ id: 'exec-2' }] },
    ]);
    mockPoolConnect(client);
    const result = await recordAcceptanceTx({
      dedupeKey: 'exec-1',
      providerMsgId: 'ext-1',
      campaignId: 'camp-1',
      leadId: 'lead-1',
      snapshotId: 'snap-1',
      completedSteps: 1,
      terminalStopReason: 'sequence_completed',
      next: {
        stepNumber: 2,
        channel: 'email',
        templateId: 'tmpl-2',
        attempt: 0,
        dueAt: '2026-10-14T10:00:00.000Z',
        delayRemainingMs: 3_600_000,
      },
    });
    expect(result.advanced).toBe(true);
    expect(result.nextDedupeKey).toContain('camp-1');
    expect(result.nextGeneration).toBe(0);
    const statements = calls.map((c) => c.sql);
    expect(statements[0]).toContain("state = 'claimed'");
    expect(statements[1]).toContain('FROM campaigns');
    expect(statements[2]).toContain('FROM campaign_leads');
    expect(statements[3]).toContain('UPDATE campaign_leads');
    expect(statements[4]).toContain('ON CONFLICT (dedupe_key) DO NOTHING');
    // The next intent inherits the accepted execution's dispatch mode.
    expect(calls[4].params).toContain(false);
  });

  it('keeps the next step frozen when acceptance observes a paused campaign', async () => {
    const { recordAcceptanceTx } = await import('./campaigns.execution.repository');
    const { client, calls } = mockTxClient([
      { rows: [{ dedupe_key: 'exec-1', mock_mode: false, step_number: 1 }] },
      { rows: [{ status: 'paused' }] },
      { rows: [{ enrollment_status: 'active', next_step_number: 1, scheduling_generation: 1 }] },
      { rows: [] },
    ]);
    mockPoolConnect(client);
    const result = await recordAcceptanceTx({
      dedupeKey: 'exec-1',
      providerMsgId: 'ext-1',
      campaignId: 'camp-1',
      leadId: 'lead-1',
      snapshotId: 'snap-1',
      completedSteps: 1,
      terminalStopReason: 'sequence_completed',
      next: {
        stepNumber: 2,
        channel: 'email',
        templateId: 'tmpl-2',
        attempt: 0,
        dueAt: '2026-10-14T10:00:00.000Z',
        delayRemainingMs: 3_600_000,
      },
    });

    expect(result).toEqual({ advanced: true, nextDedupeKey: null, nextGeneration: null });
    expect(calls).toHaveLength(4);
    expect(calls[3].sql).toContain('CASE WHEN $6 THEN NULL');
    expect(calls[3].sql).toContain('CASE WHEN $6 THEN $7::bigint ELSE NULL END');
    expect(calls[3].params).toEqual([
      'camp-1',
      'lead-1',
      2,
      '2026-10-14T10:00:00.000Z',
      1,
      true,
      3_600_000,
    ]);
  });

  it('advances nothing when the claim was lost', async () => {
    const { recordAcceptanceTx } = await import('./campaigns.execution.repository');
    const { client, calls } = mockTxClient([{ rows: [] }]);
    mockPoolConnect(client);
    const result = await recordAcceptanceTx({
      dedupeKey: 'exec-1',
      providerMsgId: 'ext-1',
      campaignId: 'camp-1',
      leadId: 'lead-1',
      snapshotId: null,
      completedSteps: 1,
      terminalStopReason: 'sequence_completed',
      next: null,
    });
    expect(result).toEqual({ advanced: false, nextDedupeKey: null, nextGeneration: null });
    expect(calls).toHaveLength(1);
  });

  it('completes the enrollment when no steps remain', async () => {
    const { recordAcceptanceTx } = await import('./campaigns.execution.repository');
    const { client, calls } = mockTxClient([
      { rows: [{ dedupe_key: 'exec-1', mock_mode: false, step_number: 3 }] },
      { rows: [{ status: 'active' }] },
      { rows: [{ enrollment_status: 'active', next_step_number: 3, scheduling_generation: 0 }] },
      { rows: [] },
    ]);
    mockPoolConnect(client);
    const result = await recordAcceptanceTx({
      dedupeKey: 'exec-1',
      providerMsgId: 'ext-1',
      campaignId: 'camp-1',
      leadId: 'lead-1',
      snapshotId: null,
      completedSteps: 3,
      terminalStopReason: 'sequence_completed',
      next: null,
    });
    expect(result.advanced).toBe(true);
    expect(calls[3].sql).toContain("enrollment_status = 'completed'");
  });
});

describe('enrollIntentTx', () => {
  it('commits enrollment and first intent together with the dispatch mode', async () => {
    const { enrollIntentTx } = await import('./campaigns.execution.repository');
    const { client, calls } = mockTxClient([{ rows: [] }, { rows: [{ id: 'exec-1' }] }]);
    mockPoolConnect(client);
    const result = await enrollIntentTx({
      campaignId: 'camp-1',
      leadId: 'lead-1',
      snapshotId: 'snap-1',
      firstStepNumber: 1,
      firstDueAt: '2026-10-13T10:00:00.000Z',
      channel: 'email',
      templateId: 'tmpl-1',
      generation: 0,
      mockMode: true,
    });
    expect(result.inserted).toBe(true);
    expect(result.dedupeKey).toContain('camp-1');
    expect(calls[0].sql).toContain('ON CONFLICT (campaign_id, lead_id) DO UPDATE');
    expect(calls[1].params).toContain(true);
  });
});

describe('restoreIntentTx', () => {
  it('distinguishes duplicates from inactive enrollments', async () => {
    const { restoreIntentTx } = await import('./campaigns.execution.repository');
    const base = {
      campaignId: 'camp-1',
      leadId: 'lead-1',
      nextDueAt: '2026-10-14T10:00:00.000Z',
      execution: {
        stepNumber: 2,
        channel: 'email',
        templateId: 'tmpl-2',
        snapshotId: 'snap-1',
        mockMode: false,
        generation: 1,
      },
    };
    const dup = mockTxClient([{ rows: [{ id: 'x' }] }, { rows: [] }]);
    mockPoolConnect(dup.client);
    await expect(restoreIntentTx(base)).resolves.toBeNull();

    const skipped = mockTxClient([{ rows: [] }]);
    mockPoolConnect(skipped.client);
    await expect(restoreIntentTx(base)).resolves.toEqual({ skipped: 'inactive' });
  });
});

describe('uncertain outcomes', () => {  it('marks expired-lease executions uncertain for review', async () => {
    const { markExecutionUncertain, findExpiredLeaseExecutions } = await import(
      './campaigns.execution.repository'
    );
    mockPoolQuery.mockResolvedValueOnce(mockQueryResult([{ id: 'exec-1', state: 'uncertain' }]));
    await markExecutionUncertain('k-1', 'lease expired');
    const [sql] = mockPoolQuery.mock.calls[0];
    expect(sql).toContain("state = 'claimed'");
    expect(sql).toContain("'uncertain'");

    mockPoolQuery.mockResolvedValueOnce(mockQueryResult([]));
    await findExpiredLeaseExecutions(100);
    expect(mockPoolQuery.mock.calls[1][0]).toContain('lease_expires_at <= NOW()');
  });
});

describe('operations reads', () => {
  it('pages enrollments with a stable keyset cursor in one bounded query', async () => {
    const { findEnrollmentsPage } = await import('./campaigns.execution.repository');
    mockPoolQuery.mockResolvedValueOnce(
      mockQueryResult([
        { lead_id: 'a', added_at: '2026-10-01T00:00:00Z' },
        { lead_id: 'b', added_at: '2026-09-01T00:00:00Z' },
      ]),
    );
    const page = await findEnrollmentsPage('camp-1', {
      limit: 1,
      cursorAddedAt: '2026-10-02T00:00:00Z',
      cursorLeadId: 'z',
      search: 'acme',
    });
    expect(page.hasMore).toBe(true);
    expect(page.rows).toHaveLength(1);
    const [sql] = mockPoolQuery.mock.calls[0];
    expect(sql).toContain('(cl.added_at, cl.lead_id) < ');
    expect(sql).toContain('ILIKE');
  });

  it('summarizes campaigns in a single grouped query', async () => {
    const { summarizeCampaigns } = await import('./campaigns.execution.repository');
    mockPoolQuery.mockResolvedValueOnce(
      mockQueryResult([{ campaign_id: 'c1', scheduled: '2', failed: '1', uncertain: '0', next_due_at: null }]),
    );
    const rows = await summarizeCampaigns(['c1', 'c2']);
    expect(rows).toHaveLength(1);
    expect(mockPoolQuery.mock.calls[0][0]).toContain('GROUP BY c.id');
    await expect(summarizeCampaigns([])).resolves.toEqual([]);
  });

  it('builds opaque dedupe keys without PII', () => {
    const { buildDedupeKey } = jest.requireActual('./campaigns.execution.repository') as {
      buildDedupeKey: (input: object) => string;
    };
    const key = buildDedupeKey({
      campaignId: 'camp-1',
      leadId: 'lead-1',
      snapshotId: null,
      stepNumber: 1,
      generation: 0,
      attempt: 0,
    });
    expect(key).not.toMatch(/@/);
    expect(key).toContain('camp-1');
  });
});

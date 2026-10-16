/**
 * Isolated campaign-durability integration tests.
 *
 * Runs against scratch PostgreSQL + Redis started explicitly for this suite
 * (see TESTING block below) — never production, never `.env` credentials.
 * Persistence uses the real repositories, the transport uses a real BullMQ
 * queue, and the provider uses a recording connector double that never sends
 * real campaign messages.
 *
 * TESTING (explicit; no .env read):
 *   docker run -d --rm --name crm-test-pg -e POSTGRES_PASSWORD=crmtest \
 *     -e POSTGRES_USER=crmtest -e POSTGRES_DB=crm_test -p 5433:5432 postgres:16-alpine
 *   docker run -d --rm --name crm-test-redis -p 6380:6379 redis:7-alpine
 *   TEST_PG_URL=postgres://localhost:5433/crm_test TEST_PG_USER=crmtest \
 *   TEST_PG_PASSWORD=crmtest TEST_REDIS_URL=redis://localhost:6380 \
 *   npx jest src/modules/campaigns/campaigns.durable.integration.test.ts --runInBand
 *
 * If the scratch services are unreachable, every test fails loudly with the
 * exact blocker instead of passing vacuously.
 */
const TEST_PG_URL = process.env.TEST_PG_URL ?? 'postgres://localhost:5433/crm_test';
const TEST_PG_USER = process.env.TEST_PG_USER;
const TEST_PG_PASSWORD = process.env.TEST_PG_PASSWORD;
const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6380';

// Validate before importing the pools/queues: cleanup truncates tables and
// removes queue records, so a caller-supplied application URL must fail first.
function assertScratchServices(pgValue: string, redisValue: string): void {
  const pg = new URL(pgValue);
  const redis = new URL(redisValue);
  const localHosts = ['localhost', '127.0.0.1'];
  if (
    pg.protocol !== 'postgres:' ||
    !localHosts.includes(pg.hostname) ||
    pg.port !== '5433' ||
    pg.pathname !== '/crm_test' ||
    pg.search !== '' ||
    pg.username !== '' ||
    pg.password !== '' ||
    redis.protocol !== 'redis:' ||
    !localHosts.includes(redis.hostname) ||
    redis.port !== '6380' ||
    !['', '/', '/0'].includes(redis.pathname) ||
    redis.search !== ''
  ) {
    throw new Error(
      'Refusing destructive integration cleanup: use scratch PostgreSQL localhost:5433/crm_test and Redis localhost:6380/0.',
    );
  }
}

assertScratchServices(TEST_PG_URL, TEST_REDIS_URL);
if (!TEST_PG_USER || !TEST_PG_PASSWORD) {
  throw new Error(
    'Set TEST_PG_USER and TEST_PG_PASSWORD for the isolated campaign integration tests.',
  );
}
const authenticatedTestPgUrl = new URL(TEST_PG_URL);
authenticatedTestPgUrl.username = TEST_PG_USER;
authenticatedTestPgUrl.password = TEST_PG_PASSWORD;

process.env.DATABASE_URL = authenticatedTestPgUrl.toString();
process.env.REDIS_URL = TEST_REDIS_URL;
process.env.CAMPAIGN_OPERATIONS_V2_ENABLED = 'true';

jest.mock('../integrations/dispatch', () => ({
  dispatchOutbound: jest.fn(async () => ({ ok: true, externalId: 'rec-ext-1', latencyMs: 1 })),
}));

jest.setTimeout(60000);

// Requires load after the env assignments above (pool/queue read env at import).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { pool } = require('../../shared/utils/db') as typeof import('../../shared/utils/db');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const execRepo =
  require('./campaigns.execution.repository') as typeof import('./campaigns.execution.repository');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const campaignRepo =
  require('./campaigns.repository') as typeof import('./campaigns.repository');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const execService =
  require('./campaigns.execution.service') as typeof import('./campaigns.execution.service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const opsService =
  require('./campaigns.operations.service') as typeof import('./campaigns.operations.service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { retryLeadOutreachStep } =
  require('./campaigns.service') as typeof import('./campaigns.service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { handleDurableDispatch, startOutreachWorker } =
  require('../../workers/outreach.worker') as typeof import('../../workers/outreach.worker');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { outreachQueue, buildTransportJobId } =
  require('../../workers/queue') as typeof import('../../workers/queue');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { dispatchOutbound } = require('../integrations/dispatch') as {
  dispatchOutbound: jest.Mock;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { randomUUID } = require('crypto') as typeof import('crypto');

async function checkInfra(): Promise<void> {
  try {
    await pool.query('SELECT 1');
    await outreachQueue.getJob('infra-probe-no-such-job');
  } catch (err) {
    throw new Error(
      'INTEGRATION INFRA BLOCKER: scratch PostgreSQL (5433) or Redis (6380) unreachable. ' +
        `Start them per the TESTING block, then rerun. Cause: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN
  CREATE TYPE message_channel AS ENUM ('whatsapp', 'email', 'sms', 'phone_call');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE outreach_status AS ENUM ('queued', 'sent', 'delivered', 'opened', 'clicked', 'replied', 'failed', 'bounced');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'draft',
  sequence_id uuid,
  ai_personalization_enabled boolean NOT NULL DEFAULT false,
  send_window_enabled boolean NOT NULL DEFAULT false,
  send_window_start_hour integer NOT NULL DEFAULT 9,
  send_window_end_hour integer NOT NULL DEFAULT 18,
  send_window_days integer[] NOT NULL DEFAULT '{1,2,3,4,5}',
  send_window_timezone varchar(64) NOT NULL DEFAULT 'UTC',
  daily_send_limit integer,
  deleted_at timestamptz
);
CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name text, contact_name text, phone text, email text, website text,
  industry text, location text, country text, google_rating numeric, review_count integer,
  social_links jsonb, source_platform text, lead_score integer, classification text,
  status text NOT NULL DEFAULT 'active', assigned_to uuid, pipeline_stage_id uuid,
  custom_fields jsonb, tags text[], notes text, deal_value numeric, won_at timestamptz,
  lost_at timestamptz, next_follow_up_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW(),
  deleted_at timestamptz, scraper_log_id uuid, google_place_id text, google_contact_provenance text
);
CREATE TABLE IF NOT EXISTS outreach_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text, description text, is_active boolean NOT NULL DEFAULT true,
  steps jsonb NOT NULL DEFAULT '[]', created_by uuid,
  created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW(),
  deleted_at timestamptz
);
CREATE TABLE IF NOT EXISTS templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text, collection text, tags text[], channel text, subject text, body text,
  variables jsonb, attachments jsonb, approval_status text NOT NULL DEFAULT 'pending',
  approved_by uuid, approved_at timestamptz, rejection_reason text, editor_mode text,
  design jsonb, html_body text, text_body text, preheader text, archived_at timestamptz,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL, display_name text, is_enabled boolean NOT NULL DEFAULT false,
  last_tested_at timestamptz, last_test_status text, updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS outreach_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL, campaign_id uuid, channel message_channel NOT NULL, template_id uuid,
  step_number integer, status outreach_status NOT NULL DEFAULT 'queued', external_msg_id text,
  message_body text, sent_at timestamptz, delivered_at timestamptz, opened_at timestamptz,
  clicked_at timestamptz, replied_at timestamptz, click_url text, error_message text,
  created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS campaign_sequence_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL, sequence_id uuid NOT NULL, version integer NOT NULL,
  steps jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_campaign_snapshot_version UNIQUE (campaign_id, version)
);
CREATE TABLE IF NOT EXISTS campaign_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL, lead_id uuid NOT NULL,
  added_at timestamptz NOT NULL DEFAULT NOW(),
  enrollment_status varchar(20) NOT NULL DEFAULT 'active',
  sequence_snapshot_id uuid,
  next_step_number integer, next_due_at timestamptz, delay_remaining_ms bigint,
  completed_steps integer NOT NULL DEFAULT 0, pause_reason text, stop_reason text,
  scheduling_generation integer NOT NULL DEFAULT 0, timing_unknown boolean NOT NULL DEFAULT false,
  mock_mode boolean NOT NULL DEFAULT false,
  execution_updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_campaign_lead UNIQUE (campaign_id, lead_id),
  CONSTRAINT campaign_leads_enrollment_status_check
    CHECK (enrollment_status IN ('active', 'paused', 'completed', 'stopped'))
);
CREATE TABLE IF NOT EXISTS campaign_step_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL, lead_id uuid NOT NULL, snapshot_id uuid,
  step_number integer NOT NULL, channel varchar(20) NOT NULL, template_id uuid,
  generation integer NOT NULL DEFAULT 0, dedupe_key varchar(255) NOT NULL UNIQUE,
  state varchar(20) NOT NULL DEFAULT 'unscheduled', attempts integer NOT NULL DEFAULT 0,
  due_at timestamptz, transport_job_id varchar(255), provider_msg_id varchar(255),
  lease_expires_at timestamptz, claimed_by varchar(100), error_category varchar(50),
  error_message text, manual_override boolean NOT NULL DEFAULT false,
  override_provenance text, mock_mode boolean NOT NULL DEFAULT false,
  sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT campaign_step_executions_state_check
    CHECK (state IN ('unscheduled', 'scheduled', 'claimed', 'sent', 'failed', 'uncertain', 'skipped'))
);
CREATE TABLE IF NOT EXISTS campaign_day_capacity (
  campaign_id uuid NOT NULL, local_date date NOT NULL, send_limit integer NOT NULL,
  reserved integer NOT NULL DEFAULT 0,
  CONSTRAINT unique_campaign_day UNIQUE (campaign_id, local_date)
);
CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL, campaign_id uuid, sequence_id uuid, step_number integer,
  assigned_to uuid, type text NOT NULL DEFAULT 'follow_up', title text,
  description text, due_at timestamptz, status text NOT NULL DEFAULT 'pending',
  completed_at timestamptz, created_by uuid,
  created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid, action varchar(100), entity_type varchar(100), entity_id uuid,
  old_value jsonb, new_value jsonb, ip_address text,
  created_at timestamptz DEFAULT NOW()
);`;

async function resetTables(): Promise<void> {
  await pool.query(
    'TRUNCATE campaign_step_executions, campaign_day_capacity, campaign_leads, campaign_sequence_snapshots, outreach_logs, tasks, leads, campaigns, templates, integrations, outreach_sequences, audit_logs',
  );
}

async function seedCampaign(overrides: Record<string, unknown> = {}): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO campaigns (id, status, send_window_enabled, daily_send_limit, send_window_timezone, sequence_id, ai_personalization_enabled)
     VALUES ($1, $2, false, $3, 'UTC', $4, false)`,
    [
      id,
      overrides.status ?? 'active',
      overrides.daily_send_limit ?? null,
      overrides.sequence_id ?? null,
    ],
  );
  return id;
}

async function seedLead(status = 'active'): Promise<string> {
  const id = randomUUID();
  await pool.query(`INSERT INTO leads (id, status, email) VALUES ($1, $2, 'lead@example.com')`, [
    id,
    status,
  ]);
  return id;
}

async function seedTemplate(approval = 'approved'): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO templates (id, channel, approval_status, subject, body) VALUES ($1, 'email', $2, 'Hi', 'Hello')`,
    [id, approval],
  );
  return id;
}

const twoSteps = (t1: string, t2: string) => [
  { stepNumber: 1, channel: 'email' as const, delayHours: 0, templateId: t1 },
  { stepNumber: 2, channel: 'email' as const, delayHours: 24, templateId: t2 },
];

beforeAll(async () => {
  await checkInfra();
  await pool.query(SCHEMA_SQL);
  await pool.query('ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS sequence_id uuid');
  await pool.query(
    'ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS ai_personalization_enabled boolean NOT NULL DEFAULT false',
  );
  await pool.query(
    `INSERT INTO integrations (name, display_name, is_enabled, last_test_status)
     VALUES ('sendgrid', 'SendGrid', true, 'ok'), ('smtp', 'SMTP', true, 'ok')
     ON CONFLICT (name) DO NOTHING`,
  );
});

beforeEach(async () => {
  await checkInfra();
  try {
    await outreachQueue.obliterate({ force: true });
  } catch {
    // Scratch-only cleanup; ignore
  }
  await resetTables();
  await pool.query(
    `INSERT INTO integrations (name, display_name, is_enabled, last_test_status)
     VALUES ('sendgrid', 'SendGrid', true, 'ok'), ('smtp', 'SMTP', true, 'ok')
     ON CONFLICT (name) DO NOTHING`,
  );
  dispatchOutbound.mockClear();
  dispatchOutbound.mockResolvedValue({ ok: true, externalId: 'rec-ext-1', latencyMs: 1 });
});

afterAll(async () => {
  try {
    await outreachQueue.obliterate({ force: true });
  } catch {
    // Scratch-only cleanup; never fail the suite on it.
  }
});

describe('pause/claim interleaving on separate connections', () => {
  it('serializes pause and claims; post-pause claims are blocked, in-flight survives', async () => {
    const campaignId = await seedCampaign();
    const leadId = await seedLead();
    await execRepo.upsertEnrollmentState(campaignId, leadId, {
      enrollmentStatus: 'active',
      nextStepNumber: 1,
    });
    const pastDue = new Date(Date.now() - 60_000).toISOString();
    const first = await execRepo.insertStepExecution({
      campaignId,
      leadId,
      snapshotId: null,
      stepNumber: 1,
      channel: 'email',
      templateId: null,
      generation: 0,
      attempt: 0,
      dueAt: pastDue,
      mockMode: false,
    });
    expect(first).not.toBeNull();

    // Hold the enrollment lock on a separate backend while pause races it.
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(
        'SELECT * FROM campaign_leads WHERE campaign_id = $1 AND lead_id = $2 FOR UPDATE',
        [campaignId, leadId],
      );
      let pauseDone = false;
      const pausePromise = execRepo
        .pauseCampaignTx(campaignId, new Date().toISOString())
        .then((result) => {
          pauseDone = true;
          return result;
        });
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(pauseDone).toBe(false);
      await holder.query('COMMIT');
      const paused = await pausePromise;
      expect(paused?.campaign.status).toBe('paused');
      expect(paused?.frozen).toBe(1);
    } catch (err) {
      await holder.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      holder.release();
    }

    // The old generation is unclaimable after the pause boundary.
    await expect(
      execRepo.claimDueStepExecutionTx({
        dedupeKey: first?.dedupe_key ?? '',
        expectedGeneration: 0,
        workerId: 'racer',
        leaseMs: 300000,
      }),
    ).resolves.toBeNull();
  });

  it('preserves an already-claimed send across the pause boundary', async () => {
    const campaignId = await seedCampaign();
    const leadId = await seedLead();
    await execRepo.upsertEnrollmentState(campaignId, leadId, {
      enrollmentStatus: 'active',
      nextStepNumber: 1,
    });
    const execution = await execRepo.insertStepExecution({
      campaignId,
      leadId,
      snapshotId: null,
      stepNumber: 1,
      channel: 'email',
      templateId: null,
      generation: 0,
      attempt: 0,
      dueAt: new Date(Date.now() - 60_000).toISOString(),
      mockMode: false,
    });
    const claimed = await execRepo.claimDueStepExecutionTx({
      dedupeKey: execution?.dedupe_key ?? '',
      expectedGeneration: 0,
      workerId: 'in-flight',
      leaseMs: 300000,
    });
    expect(claimed?.state).toBe('claimed');

    const paused = await execRepo.pauseCampaignTx(campaignId, new Date().toISOString());
    expect(paused?.campaign.status).toBe('paused');

    // In-flight claims are not revoked by pause.
    const row = await execRepo.findExecutionByDedupeKey(execution?.dedupe_key ?? '');
    expect(row?.state).toBe('claimed');
  });
});

describe('transactional acceptance', () => {
  it('advances exactly once under concurrent acceptance attempts', async () => {
    const campaignId = await seedCampaign();
    const leadId = await seedLead();
    const templateId = await seedTemplate();
    await execRepo.upsertEnrollmentState(campaignId, leadId, {
      enrollmentStatus: 'active',
      nextStepNumber: 1,
      completedSteps: 0,
    });
    const execution = await execRepo.insertStepExecution({
      campaignId,
      leadId,
      snapshotId: null,
      stepNumber: 1,
      channel: 'email',
      templateId,
      generation: 0,
      attempt: 0,
      dueAt: new Date(Date.now() - 60_000).toISOString(),
      mockMode: false,
    });
    const base = {
      dedupeKey: execution?.dedupe_key ?? '',
      providerMsgId: 'ext-1',
      campaignId,
      leadId,
      snapshotId: null,
      completedSteps: 1,
      terminalStopReason: 'sequence_completed',
      next: {
        stepNumber: 2,
        channel: 'email',
        templateId,
        attempt: 0,
        dueAt: new Date(Date.now() + 3_600_000).toISOString(),
        delayRemainingMs: 3_600_000,
      },
    };
    // Acceptance follows a successful claim, as in the worker path.
    const claimed = await execRepo.claimDueStepExecutionTx({
      dedupeKey: execution?.dedupe_key ?? '',
      expectedGeneration: 0,
      workerId: 'test',
      leaseMs: 300000,
    });
    expect(claimed?.state).toBe('claimed');
    const [first, second] = await Promise.all([
      execRepo.recordAcceptanceTx(base),
      execRepo.recordAcceptanceTx(base),
    ]);
    expect([first.advanced, second.advanced].sort()).toEqual([false, true]);
    const nextRows = await pool.query(
      'SELECT COUNT(*)::text AS count FROM campaign_step_executions WHERE campaign_id = $1 AND lead_id = $2 AND step_number = 2',
      [campaignId, leadId],
    );
    expect(nextRows.rows[0].count).toBe('1');
    const enrollment = await execRepo.getEnrollmentState(campaignId, leadId);
    expect(enrollment?.completed_steps).toBe(1);
  });

  it('preserves a paused enrollment delay when an in-flight send is accepted', async () => {
    const campaignId = await seedCampaign();
    const leadId = await seedLead();
    const templateId = await seedTemplate();
    await execRepo.upsertEnrollmentState(campaignId, leadId, {
      enrollmentStatus: 'active',
      nextStepNumber: 1,
      completedSteps: 0,
    });
    const execution = await execRepo.insertStepExecution({
      campaignId,
      leadId,
      snapshotId: null,
      stepNumber: 1,
      channel: 'email',
      templateId,
      generation: 0,
      attempt: 0,
      dueAt: new Date(Date.now() - 60_000).toISOString(),
      mockMode: false,
    });
    const claimed = await execRepo.claimDueStepExecutionTx({
      dedupeKey: execution?.dedupe_key ?? '',
      expectedGeneration: 0,
      workerId: 'in-flight-before-pause',
      leaseMs: 300000,
    });
    expect(claimed?.state).toBe('claimed');

    const paused = await execRepo.pauseCampaignTx(campaignId, new Date().toISOString());
    expect(paused?.campaign.status).toBe('paused');
    const acceptance = await execRepo.recordAcceptanceTx({
      dedupeKey: execution?.dedupe_key ?? '',
      providerMsgId: 'accepted-before-pause-finished',
      campaignId,
      leadId,
      snapshotId: null,
      completedSteps: 1,
      terminalStopReason: 'sequence_completed',
      next: {
        stepNumber: 2,
        channel: 'email',
        templateId,
        attempt: 0,
        dueAt: new Date(Date.now() + 3_600_000).toISOString(),
        delayRemainingMs: 3_600_000,
      },
    });

    expect(acceptance).toEqual({ advanced: true, nextDedupeKey: null, nextGeneration: null });
    const enrollment = await execRepo.getEnrollmentState(campaignId, leadId);
    expect(enrollment).toMatchObject({
      enrollment_status: 'active',
      next_step_number: 2,
      next_due_at: null,
      delay_remaining_ms: '3600000',
      completed_steps: 1,
      scheduling_generation: 1,
    });
    const pending = await pool.query(
      'SELECT COUNT(*)::text AS count FROM campaign_step_executions WHERE campaign_id = $1 AND lead_id = $2 AND step_number = 2',
      [campaignId, leadId],
    );
    expect(pending.rows[0].count).toBe('0');
  });

  it('rolls back the whole acceptance when the next intent cannot persist', async () => {
    const campaignId = await seedCampaign();
    const leadId = await seedLead();
    await execRepo.upsertEnrollmentState(campaignId, leadId, {
      enrollmentStatus: 'active',
      nextStepNumber: 1,
      completedSteps: 0,
    });
    const execution = await execRepo.insertStepExecution({
      campaignId,
      leadId,
      snapshotId: null,
      stepNumber: 1,
      channel: 'email',
      templateId: null,
      generation: 0,
      attempt: 0,
      dueAt: new Date(Date.now() - 60_000).toISOString(),
      mockMode: false,
    });
    await execRepo.claimDueStepExecutionTx({
      dedupeKey: execution?.dedupe_key ?? '',
      expectedGeneration: 0,
      workerId: 'test',
      leaseMs: 300000,
    });
    await expect(
      execRepo.recordAcceptanceTx({
        dedupeKey: execution?.dedupe_key ?? '',
        providerMsgId: 'ext-1',
        campaignId,
        leadId,
        snapshotId: null,
        completedSteps: 1,
        terminalStopReason: 'sequence_completed',
        next: {
          stepNumber: 2,
          channel: 'email',
          templateId: null,
          attempt: 0,
          dueAt: 'not-a-timestamp',
          delayRemainingMs: 0,
        },
      }),
    ).rejects.toThrow();
    // Nothing advanced: the execution is still claimed for lease recovery,
    // and no stranded partial state exists.
    const row = await execRepo.findExecutionByDedupeKey(execution?.dedupe_key ?? '');
    expect(row?.state).toBe('claimed');
    const enrollment = await execRepo.getEnrollmentState(campaignId, leadId);
    expect(enrollment?.completed_steps).toBe(0);
  });
});

describe('atomic daily capacity under concurrency', () => {
  it('grants at most the limit across parallel reservations', async () => {
    const campaignId = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => execRepo.reserveDailyCapacity(campaignId, '2026-10-13', 2)),
    );
    expect(results.filter(Boolean)).toHaveLength(2);
    const stored = await pool.query(
      'SELECT reserved FROM campaign_day_capacity WHERE campaign_id = $1',
      [campaignId],
    );
    expect(stored.rows[0].reserved).toBe(2);
  });

  it('honors a lower same-day limit without revoking existing reservations', async () => {
    const campaignId = randomUUID();
    await Promise.all(
      Array.from({ length: 3 }, () => execRepo.reserveDailyCapacity(campaignId, '2026-10-13', 10)),
    );

    await expect(execRepo.reserveDailyCapacity(campaignId, '2026-10-13', 2)).resolves.toBe(false);
    const stored = await pool.query(
      'SELECT send_limit, reserved FROM campaign_day_capacity WHERE campaign_id = $1',
      [campaignId],
    );
    expect(stored.rows[0]).toMatchObject({ send_limit: 2, reserved: 3 });
  });

  it('counts sends made before durable capacity tracking was enabled', async () => {
    const campaignId = await seedCampaign();
    const leadId = await seedLead();
    await pool.query(
      `INSERT INTO outreach_logs (lead_id, campaign_id, channel, status, sent_at)
       SELECT $1, $2, 'email', 'sent', NOW() - (n || ' minutes')::interval
       FROM generate_series(1, 9) AS n`,
      [leadId, campaignId],
    );
    const sentToday = await campaignRepo.countSentTodayForCampaign(campaignId, 'UTC');
    expect(sentToday).toBe(9);

    const localDate = new Date().toISOString().slice(0, 10);
    await expect(execRepo.reserveDailyCapacity(campaignId, localDate, 10, sentToday)).resolves.toBe(true);
    await expect(execRepo.reserveDailyCapacity(campaignId, localDate, 10, sentToday + 1)).resolves.toBe(false);
    const stored = await pool.query(
      'SELECT send_limit, reserved FROM campaign_day_capacity WHERE campaign_id = $1',
      [campaignId],
    );
    expect(stored.rows[0]).toMatchObject({ send_limit: 10, reserved: 10 });
  });
});

describe('real BullMQ publication with permitted IDs', () => {
  it('adds, reads back, and dedupes a durable dispatch job', async () => {
    const dedupeKey = `cmp:${randomUUID()}:lead:snap:s1:g0:a0`;
    const transportId = buildTransportJobId(dedupeKey);
    const job = await outreachQueue.add(
      'outreach:dispatch-step',
      { executionId: dedupeKey, generation: 0, leadId: 'lead-1', campaignId: 'camp-1' },
      { jobId: `outreach-dispatch-camp-1-lead-1-step-1-${transportId}` },
    );
    expect(job.id).toBeDefined();
    const fetched = await outreachQueue.getJob(job.id as string);
    expect(fetched?.data.executionId).toBe(dedupeKey);
    // Republishing the same intent dedupes instead of doubling the queue.
    const again = await outreachQueue.add(
      'outreach:dispatch-step',
      { executionId: dedupeKey, generation: 0, leadId: 'lead-1', campaignId: 'camp-1' },
      { jobId: `outreach-dispatch-camp-1-lead-1-step-1-${transportId}` },
    );
    expect(again.id).toBe(job.id);
    await job.remove().catch(() => undefined);
  });
});

describe('durable publish → park → recover → dispatch', () => {
  it('parks while the flag is off and recovers after re-enable without legacy sends', async () => {
    const campaignId = await seedCampaign();
    const leadId = await seedLead();
    const t1 = await seedTemplate();
    const t2 = await seedTemplate();
    const snapshot = await execRepo.ensureSequenceSnapshot(
      campaignId,
      randomUUID(),
      twoSteps(t1, t2),
    );
    await execRepo.upsertEnrollmentState(campaignId, leadId, {
      enrollmentStatus: 'active',
      sequenceSnapshotId: snapshot.id,
      nextStepNumber: 1,
      completedSteps: 0,
      mockMode: false,
    });
    const due = new Date(Date.now() - 60_000).toISOString();
    const execution = await execRepo.insertStepExecution({
      campaignId,
      leadId,
      snapshotId: snapshot.id,
      stepNumber: 1,
      channel: 'email',
      templateId: t1,
      generation: 0,
      attempt: 0,
      dueAt: due,
      mockMode: false,
    });
    const payload = {
      leadId,
      campaignId,
      sequenceId: snapshot.sequence_id,
      stepNumber: 1,
      channel: 'email' as const,
      templateId: t1,
      mockMode: false,
      executionId: execution?.dedupe_key ?? '',
      generation: 0,
    };

    process.env.CAMPAIGN_OPERATIONS_V2_ENABLED = 'false';
    try {
      await handleDurableDispatch(payload);
    } finally {
      process.env.CAMPAIGN_OPERATIONS_V2_ENABLED = 'true';
    }
    // Parked: no provider contact, no legacy follow-up, durable row retained.
    expect(dispatchOutbound).not.toHaveBeenCalled();
    const parked = await execRepo.findExecutionByDedupeKey(execution?.dedupe_key ?? '');
    expect(parked?.state).toBe('unscheduled');

    // Recovery republishes the parked intent with a permitted transport ID.
    const sweep = await execService.sweepRecovery({ limit: 10 });
    expect(sweep.republished).toBe(1);
    const republished = await execRepo.findExecutionByDedupeKey(execution?.dedupe_key ?? '');
    expect(republished?.state).toBe('scheduled');
    expect(republished?.transport_job_id).not.toContain(':');
    const queued = await outreachQueue.getJobs(['waiting', 'delayed', 'prioritized']);
    const job = queued.find((candidate) => candidate.data?.executionId === execution?.dedupe_key);
    expect(job?.id).toContain(republished?.transport_job_id ?? 'missing-suffix');
    expect(job?.id).not.toContain(':');
    await job?.remove().catch(() => undefined);
  });
});

describe('mock dispatch mode is preserved end to end', () => {
  it('simulated work stays simulated through dispatch and resume', async () => {
    const campaignId = await seedCampaign();
    const leadId = await seedLead();
    const t1 = await seedTemplate();
    const t2 = await seedTemplate();
    const snapshot = await execRepo.ensureSequenceSnapshot(
      campaignId,
      randomUUID(),
      twoSteps(t1, t2),
    );

    // Enroll in mock mode through the real service path.
    const intent = await execService.enrollWithIntent({
      campaign: (await pool.query('SELECT * FROM campaigns WHERE id = $1', [campaignId])).rows[0],
      leadId,
      steps: twoSteps(t1, t2),
      sequenceId: snapshot.sequence_id,
      mockMode: true,
    });
    expect(intent.durable).toBe(true);
    const enrollment = await execRepo.getEnrollmentState(campaignId, leadId);
    expect(enrollment?.mock_mode).toBe(true);

    // Dispatch the mock execution: no provider contact, next intent stays mock.
    const first = await execRepo.findLatestStepExecution(campaignId, leadId, 1);
    await handleDurableDispatch({
      leadId,
      campaignId,
      sequenceId: snapshot.sequence_id,
      stepNumber: 1,
      channel: 'email',
      templateId: t1,
      mockMode: true,
      executionId: first?.dedupe_key ?? '',
      generation: 0,
    } as never);
    expect(dispatchOutbound).not.toHaveBeenCalled();
    const sent = await execRepo.findExecutionByDedupeKey(first?.dedupe_key ?? '');
    expect(sent?.state).toBe('sent');
    // The accepted send must have produced a persisted next intent to avoid stranding.
    const second = await execRepo.findLatestStepExecution(campaignId, leadId, 2);
    expect(second?.mock_mode).toBe(true);

    // Campaign pause/resume keeps the mode.
    await execRepo.pauseCampaignTx(campaignId, new Date().toISOString());
    await pool.query("UPDATE campaigns SET status = 'active' WHERE id = $1", [campaignId]);
    const resumed = await execService.restoreForResume({
      campaign: (await pool.query('SELECT * FROM campaigns WHERE id = $1', [campaignId])).rows[0],
      enrollments: await execRepo.listActiveEnrollments(campaignId),
    });
    expect(resumed.restored).toBeGreaterThan(0);
    const jobs = await outreachQueue.getJobs(['waiting', 'delayed', 'prioritized']);
    const mockJobs = jobs.filter((job) => job.data?.mockMode === true);
    expect(mockJobs.length).toBeGreaterThan(0);
    const realJobs = jobs.filter(
      (job) => job.data?.campaignId === campaignId && job.data?.mockMode !== true,
    );
    expect(realJobs).toHaveLength(0);
    for (const job of jobs.filter((job) => job.data?.campaignId === campaignId)) {
      await job.remove().catch(() => undefined);
    }
  });
});

describe('enrollment pause → resume → dispatch', () => {
  it('restores timing, publishes a current-generation execution, and sends', async () => {
    const campaignId = await seedCampaign();
    const leadId = await seedLead();
    const t1 = await seedTemplate();
    const t2 = await seedTemplate();
    const snapshot = await execRepo.ensureSequenceSnapshot(
      campaignId,
      randomUUID(),
      twoSteps(t1, t2),
    );
    await execRepo.upsertEnrollmentState(campaignId, leadId, {
      enrollmentStatus: 'active',
      sequenceSnapshotId: snapshot.id,
      nextStepNumber: 2,
      nextDueAt: new Date(Date.now() - 60_000).toISOString(),
      completedSteps: 1,
      mockMode: true,
    });

    const paused = await execRepo.pauseEnrollmentState(
      campaignId,
      leadId,
      'rep request',
      0,
      new Date().toISOString(),
    );
    expect(paused?.enrollment_status).toBe('paused');
    // The seeded due time was overdue, so nothing remained frozen.
    expect(Number(paused?.delay_remaining_ms)).toBe(0);

    const campaign = (await pool.query('SELECT * FROM campaigns WHERE id = $1', [campaignId]))
      .rows[0];
    const current = await execRepo.getEnrollmentState(campaignId, leadId);
    const result = await execService.resumeSingleEnrollment({
      campaign,
      enrollment: current as never,
      sequenceId: snapshot.sequence_id,
    });
    expect(result.status).toBe('active');
    expect(result.nextDedupeKey).toBeTruthy();

    // A duplicate resume with the old version conflicts instead of rescheduling.
    await expect(
      execService.resumeSingleEnrollment({
        campaign,
        enrollment: current as never,
        sequenceId: snapshot.sequence_id,
      }),
    ).rejects.toThrow();

    // The restored execution dispatches through the real worker path.
    // The frozen remainder was zero (overdue), so the restored due time is
    // already eligible; settle briefly to pass the due threshold.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const execution = await execRepo.findExecutionByDedupeKey(result.nextDedupeKey ?? '');
    await handleDurableDispatch({
      leadId,
      campaignId,
      sequenceId: snapshot.sequence_id,
      stepNumber: 2,
      channel: 'email',
      templateId: t2,
      mockMode: true,
      executionId: execution?.dedupe_key ?? '',
      generation: execution?.generation ?? 0,
    } as never);
    expect(dispatchOutbound).not.toHaveBeenCalled();
    const sent = await execRepo.findExecutionByDedupeKey(result.nextDedupeKey ?? '');
    expect(sent?.state).toBe('sent');
  });

  it('requires an explicit schedule when timing was lost', async () => {
    const campaignId = await seedCampaign();
    const leadId = await seedLead();
    await execRepo.upsertEnrollmentState(campaignId, leadId, {
      enrollmentStatus: 'paused',
      timingUnknown: true,
    });
    const campaign = (await pool.query('SELECT * FROM campaigns WHERE id = $1', [campaignId]))
      .rows[0];
    const current = await execRepo.getEnrollmentState(campaignId, leadId);
    await expect(
      execService.resumeSingleEnrollment({ campaign, enrollment: current as never }),
    ).rejects.toMatchObject({ statusCode: 422 });
    const explicit = await execService.resumeSingleEnrollment({
      campaign,
      enrollment: current as never,
      explicitDueAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(explicit.status).toBe('active');
  });
});

describe('final phone-task completion', () => {
  it('marks a durable enrollment complete and clears its pending timing', async () => {
    const campaignId = await seedCampaign();
    const leadId = await seedLead();
    const sequenceId = randomUUID();
    const templateId = await seedTemplate();
    const snapshot = await execRepo.ensureSequenceSnapshot(campaignId, sequenceId, [
      { stepNumber: 1, channel: 'phone_call', delayHours: 0, templateId },
    ]);
    await execRepo.upsertEnrollmentState(campaignId, leadId, {
      enrollmentStatus: 'active',
      sequenceSnapshotId: snapshot.id,
      nextStepNumber: 1,
      nextDueAt: new Date(Date.now() + 60_000).toISOString(),
      completedSteps: 0,
    });
    const campaign = (await pool.query('SELECT * FROM campaigns WHERE id = $1', [campaignId])).rows[0];

    await expect(
      execService.scheduleAfterPhoneTask({
        campaign,
        leadId,
        sequenceId,
        completedStepNumber: 1,
      }),
    ).resolves.toEqual({ owned: true, scheduled: false, duplicate: false });
    const enrollment = await execRepo.getEnrollmentState(campaignId, leadId);
    expect(enrollment).toMatchObject({
      enrollment_status: 'completed',
      next_step_number: null,
      next_due_at: null,
      delay_remaining_ms: null,
      completed_steps: 1,
      stop_reason: 'sequence_completed',
    });
  });
});

describe('reservation failure blocks the send', () => {
  it('records nothing and keeps pre-send state when capacity storage fails', async () => {
    const campaignId = await seedCampaign({ daily_send_limit: 10 });
    const leadId = await seedLead();
    const t1 = await seedTemplate();
    const snapshot = await execRepo.ensureSequenceSnapshot(campaignId, randomUUID(), [
      { stepNumber: 1, channel: 'email' as const, delayHours: 0, templateId: t1 },
    ]);
    await execRepo.upsertEnrollmentState(campaignId, leadId, {
      enrollmentStatus: 'active',
      sequenceSnapshotId: snapshot.id,
      nextStepNumber: 1,
      completedSteps: 0,
    });
    const execution = await execRepo.insertStepExecution({
      campaignId,
      leadId,
      snapshotId: snapshot.id,
      stepNumber: 1,
      channel: 'email',
      templateId: t1,
      generation: 0,
      attempt: 0,
      dueAt: new Date(Date.now() - 60_000).toISOString(),
      mockMode: true,
    });
    await pool.query('ALTER TABLE campaign_day_capacity RENAME TO campaign_day_capacity_broken');
    try {
      await handleDurableDispatch({
        leadId,
        campaignId,
        sequenceId: snapshot.sequence_id,
        stepNumber: 1,
        channel: 'email',
        templateId: t1,
        mockMode: true,
        executionId: execution?.dedupe_key ?? '',
        generation: 0,
      } as never);
    } finally {
      await pool.query('ALTER TABLE campaign_day_capacity_broken RENAME TO campaign_day_capacity');
    }
    // Fail closed: the connector never ran and the execution is retryable,
    // never failed or uncertain (the failure happened before any network use).
    expect(dispatchOutbound).not.toHaveBeenCalled();
    const row = await execRepo.findExecutionByDedupeKey(execution?.dedupe_key ?? '');
    expect(row?.state).toBe('scheduled');
    const logs = await pool.query('SELECT COUNT(*)::text AS count FROM outreach_logs');
    expect(logs.rows[0].count).toBe('0');
  });
});

describe('campaign-wide aggregates over all enrollments', () => {
  it('reconciles totals across 120 enrollments with mixed snapshots', async () => {
    const campaignId = await seedCampaign();
    const snap4 = await execRepo.ensureSequenceSnapshot(
      campaignId,
      randomUUID(),
      [1, 2, 3, 4].map((n) => ({
        stepNumber: n,
        channel: 'email' as const,
        delayHours: 0,
        templateId: randomUUID(),
      })),
    );
    const snap2 = await execRepo.ensureSequenceSnapshot(
      campaignId,
      randomUUID(),
      [1, 2].map((n) => ({
        stepNumber: n,
        channel: 'email' as const,
        delayHours: 0,
        templateId: randomUUID(),
      })),
    );
    for (let i = 0; i < 70; i += 1) {
      const leadId = await seedLead();
      await execRepo.upsertEnrollmentState(campaignId, leadId, {
        enrollmentStatus: 'active',
        sequenceSnapshotId: snap4.id,
        nextStepNumber: 2,
        nextDueAt: new Date(Date.now() + 3_600_000).toISOString(),
        completedSteps: 1,
      });
    }
    for (let i = 0; i < 50; i += 1) {
      const leadId = await seedLead();
      await execRepo.upsertEnrollmentState(campaignId, leadId, {
        enrollmentStatus: 'active',
        sequenceSnapshotId: snap2.id,
        nextStepNumber: 1,
        nextDueAt: new Date(Date.now() + 3_600_000).toISOString(),
        completedSteps: 0,
      });
    }
    const overview = await opsService.getCampaignOperations(campaignId, {
      id: randomUUID(),
      role: 'admin',
    });
    // 70 × (4−1) + 50 × (2−0) = 310 across all rows with pinned snapshots.
    expect(overview.potentialRemaining).toBe(310);
    const reasonTotal = overview.waitingReasons.reduce((sum, entry) => sum + entry.count, 0);
    expect(reasonTotal).toBe(120);
    expect(overview.attention).toEqual([]);
  });
});

describe('finding 2: recovery reuses an already-completed BullMQ job ID', () => {
  it('re-enqueues consumed completed transport job and dispatches exactly once without duplicates', async () => {
    // a. Publishes a durable execution.
    process.env.CAMPAIGN_OPERATIONS_V2_ENABLED = 'true';
    const campaignId = await seedCampaign();
    const leadId = await seedLead();
    const t1 = await seedTemplate();
    const snapshot = await execRepo.ensureSequenceSnapshot(campaignId, randomUUID(), [
      { stepNumber: 1, channel: 'email' as const, delayHours: 0, templateId: t1 },
    ]);
    await execRepo.upsertEnrollmentState(campaignId, leadId, {
      enrollmentStatus: 'active',
      sequenceSnapshotId: snapshot.id,
      nextStepNumber: 1,
      completedSteps: 0,
      mockMode: false,
    });
    const pastDue = new Date(Date.now() - 60_000).toISOString();
    const execution = await execRepo.insertStepExecution({
      campaignId,
      leadId,
      snapshotId: snapshot.id,
      stepNumber: 1,
      channel: 'email',
      templateId: t1,
      generation: 0,
      attempt: 0,
      dueAt: pastDue,
      mockMode: false,
    });
    expect(execution).not.toBeNull();

    const published = await execService.publishExecution({
      dedupeKey: execution!.dedupe_key,
      leadId,
      campaignId,
      sequenceId: snapshot.sequence_id,
      stepNumber: 1,
      channel: 'email',
      templateId: t1,
      generation: 0,
      delayMs: 0,
      mockMode: false,
    });
    expect(published.published).toBe(true);

    const execAfterPub = await execRepo.findExecutionByDedupeKey(execution!.dedupe_key);
    expect(execAfterPub?.state).toBe('scheduled');
    const transportJobId = execAfterPub!.transport_job_id!;
    expect(transportJobId).toBeDefined();

    // b. Uses a real BullMQ worker to consume it with the flag off.
    process.env.CAMPAIGN_OPERATIONS_V2_ENABLED = 'false';
    const worker1 = startOutreachWorker();
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await worker1.close();

    // c. Confirms the transport job reaches completed while the execution remains pending.
    const transportJob1 = await outreachQueue.getJob(transportJobId);
    expect(transportJob1).not.toBeNull();
    const state1 = await transportJob1!.getState();
    expect(state1).toBe('completed');

    const execAfterConsume = await execRepo.findExecutionByDedupeKey(execution!.dedupe_key);
    expect(execAfterConsume?.state).toBe('scheduled');
    expect(dispatchOutbound).not.toHaveBeenCalled();

    // d. Re-enables the flag and runs recovery.
    process.env.CAMPAIGN_OPERATIONS_V2_ENABLED = 'true';
    const sweep1 = await execService.sweepRecovery({ limit: 10 });
    expect(sweep1.republished).toBe(1);

    const transportJobAfterRecovery = await outreachQueue.getJob(transportJobId);
    expect(transportJobAfterRecovery).not.toBeNull();
    const stateAfterRecovery = await transportJobAfterRecovery!.getState();
    expect(['waiting', 'delayed']).toContain(stateAfterRecovery);

    // e. Confirms the recording connector receives exactly one send.
    const worker2 = startOutreachWorker();
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await worker2.close();

    expect(dispatchOutbound).toHaveBeenCalledTimes(1);
    const execAfterSend = await execRepo.findExecutionByDedupeKey(execution!.dedupe_key);
    expect(execAfterSend?.state).toBe('sent');

    // f. Repeats recovery and verifies no duplicate send.
    const sweep2 = await execService.sweepRecovery({ limit: 10 });
    expect(sweep2.republished).toBe(0);
    expect(dispatchOutbound).toHaveBeenCalledTimes(1);
  });
});

describe('finding 3: second manual retry and idempotency lifecycle', () => {
  const actor = { id: randomUUID(), role: 'admin' };

  it('original failure → retry 1 failure → retry 2 success', async () => {
    process.env.CAMPAIGN_OPERATIONS_V2_ENABLED = 'true';
    const sequenceId = randomUUID();
    const campaignId = await seedCampaign({ sequence_id: sequenceId });
    const leadId = await seedLead();
    const t1 = await seedTemplate();
    const snapshot = await execRepo.ensureSequenceSnapshot(campaignId, sequenceId, [
      { stepNumber: 1, channel: 'email' as const, delayHours: 0, templateId: t1 },
    ]);
    await execRepo.upsertEnrollmentState(campaignId, leadId, {
      enrollmentStatus: 'active',
      sequenceSnapshotId: snapshot.id,
      nextStepNumber: 1,
      completedSteps: 0,
    });

    const exec0 = await execRepo.insertStepExecution({
      campaignId,
      leadId,
      snapshotId: snapshot.id,
      stepNumber: 1,
      channel: 'email',
      templateId: t1,
      generation: 0,
      attempt: 0,
      dueAt: new Date().toISOString(),
      mockMode: false,
    });
    await pool.query(
      `UPDATE campaign_step_executions SET state = 'failed', error_message = 'Provider down' WHERE id = $1`,
      [exec0!.id],
    );
    await pool.query(
      `INSERT INTO outreach_logs (lead_id, campaign_id, channel, template_id, step_number, status, error_message)
       VALUES ($1, $2, 'email', $3, 1, 'failed', 'Provider down')`,
      [leadId, campaignId, t1],
    );

    // Retry 1: schedules attempt 1
    const res1 = await retryLeadOutreachStep(campaignId, leadId, actor);
    expect(res1).toEqual({ enqueued: true, duplicate: false, attempt: 1 });

    const exec1 = await execRepo.findExecutionByDedupeKey(
      execRepo.buildDedupeKey({
        campaignId,
        leadId,
        snapshotId: snapshot.id,
        stepNumber: 1,
        generation: 0,
        attempt: 1,
      }),
    );
    expect(exec1).not.toBeNull();
    expect(exec1?.state).toBe('scheduled');
    expect(exec1?.attempts).toBe(1);

    // Fail attempt 1
    await pool.query(
      `UPDATE campaign_step_executions SET state = 'failed', error_message = 'Timeout' WHERE id = $1`,
      [exec1!.id],
    );
    await pool.query(
      `INSERT INTO outreach_logs (lead_id, campaign_id, channel, template_id, step_number, status, error_message)
       VALUES ($1, $2, 'email', $3, 1, 'failed', 'Timeout')`,
      [leadId, campaignId, t1],
    );

    // Retry 2: schedules attempt 2
    const res2 = await retryLeadOutreachStep(campaignId, leadId, actor);
    expect(res2).toEqual({ enqueued: true, duplicate: false, attempt: 2 });

    const exec2 = await execRepo.findExecutionByDedupeKey(
      execRepo.buildDedupeKey({
        campaignId,
        leadId,
        snapshotId: snapshot.id,
        stepNumber: 1,
        generation: 0,
        attempt: 2,
      }),
    );
    expect(exec2).not.toBeNull();
    expect(exec2?.state).toBe('scheduled');
    expect(exec2?.attempts).toBe(2);

    // Succeed attempt 2
    await pool.query(
      `UPDATE campaign_step_executions SET state = 'sent', sent_at = NOW() WHERE id = $1`,
      [exec2!.id],
    );
    await pool.query(
      `INSERT INTO outreach_logs (lead_id, campaign_id, channel, template_id, step_number, status)
       VALUES ($1, $2, 'email', $3, 1, 'sent')`,
      [leadId, campaignId, t1],
    );

    const latest = await execRepo.findLatestStepExecution(campaignId, leadId, 1, 0);
    expect(latest?.state).toBe('sent');
    expect(latest?.attempts).toBe(2);
  });

  it('concurrent retry requests yield only one pending attempt', async () => {
    process.env.CAMPAIGN_OPERATIONS_V2_ENABLED = 'true';
    const sequenceId = randomUUID();
    const campaignId = await seedCampaign({ sequence_id: sequenceId });
    const leadId = await seedLead();
    const t1 = await seedTemplate();
    const snapshot = await execRepo.ensureSequenceSnapshot(campaignId, sequenceId, [
      { stepNumber: 1, channel: 'email' as const, delayHours: 0, templateId: t1 },
    ]);
    await execRepo.upsertEnrollmentState(campaignId, leadId, {
      enrollmentStatus: 'active',
      sequenceSnapshotId: snapshot.id,
      nextStepNumber: 1,
      completedSteps: 0,
    });

    const exec0 = await execRepo.insertStepExecution({
      campaignId,
      leadId,
      snapshotId: snapshot.id,
      stepNumber: 1,
      channel: 'email',
      templateId: t1,
      generation: 0,
      attempt: 0,
      dueAt: new Date().toISOString(),
      mockMode: false,
    });
    await pool.query(
      `UPDATE campaign_step_executions SET state = 'failed', error_message = 'Fail' WHERE id = $1`,
      [exec0!.id],
    );
    await pool.query(
      `INSERT INTO outreach_logs (lead_id, campaign_id, channel, template_id, step_number, status, error_message)
       VALUES ($1, $2, 'email', $3, 1, 'failed', 'Fail')`,
      [leadId, campaignId, t1],
    );

    const results = await Promise.all([
      retryLeadOutreachStep(campaignId, leadId, actor),
      retryLeadOutreachStep(campaignId, leadId, actor),
      retryLeadOutreachStep(campaignId, leadId, actor),
      retryLeadOutreachStep(campaignId, leadId, actor),
      retryLeadOutreachStep(campaignId, leadId, actor),
    ]);

    const enqueuedCount = results.filter((r) => r.enqueued && !r.duplicate).length;
    const duplicateCount = results.filter((r) => !r.enqueued && r.duplicate).length;

    expect(enqueuedCount).toBe(1);
    expect(duplicateCount).toBe(4);

    const pending = await execRepo.findPendingExecution(campaignId, leadId, 1, 0);
    expect(pending).not.toBeNull();
    expect(pending?.attempts).toBe(1);

    const allAttempts = await pool.query(
      'SELECT dedupe_key, state, attempts FROM campaign_step_executions WHERE campaign_id = $1 AND lead_id = $2',
      [campaignId, leadId],
    );
    expect(allAttempts.rows).toHaveLength(2);
  });

  it('repeated requests while an attempt is pending report duplicate without scheduling work', async () => {
    process.env.CAMPAIGN_OPERATIONS_V2_ENABLED = 'true';
    const sequenceId = randomUUID();
    const campaignId = await seedCampaign({ sequence_id: sequenceId });
    const leadId = await seedLead();
    const t1 = await seedTemplate();
    const snapshot = await execRepo.ensureSequenceSnapshot(campaignId, sequenceId, [
      { stepNumber: 1, channel: 'email' as const, delayHours: 0, templateId: t1 },
    ]);
    await execRepo.upsertEnrollmentState(campaignId, leadId, {
      enrollmentStatus: 'active',
      sequenceSnapshotId: snapshot.id,
      nextStepNumber: 1,
      completedSteps: 0,
    });

    const exec0 = await execRepo.insertStepExecution({
      campaignId,
      leadId,
      snapshotId: snapshot.id,
      stepNumber: 1,
      channel: 'email',
      templateId: t1,
      generation: 0,
      attempt: 0,
      dueAt: new Date().toISOString(),
      mockMode: false,
    });
    await pool.query(
      `UPDATE campaign_step_executions SET state = 'failed', error_message = 'Fail' WHERE id = $1`,
      [exec0!.id],
    );
    await pool.query(
      `INSERT INTO outreach_logs (lead_id, campaign_id, channel, template_id, step_number, status, error_message)
       VALUES ($1, $2, 'email', $3, 1, 'failed', 'Fail')`,
      [leadId, campaignId, t1],
    );

    const first = await retryLeadOutreachStep(campaignId, leadId, actor);
    expect(first).toEqual({ enqueued: true, duplicate: false, attempt: 1 });

    const second = await retryLeadOutreachStep(campaignId, leadId, actor);
    expect(second).toEqual({ enqueued: false, duplicate: true, attempt: null });

    const third = await retryLeadOutreachStep(campaignId, leadId, actor);
    expect(third).toEqual({ enqueued: false, duplicate: true, attempt: null });
  });

  it('refuses retry while paused, opted out, or uncertain', async () => {
    process.env.CAMPAIGN_OPERATIONS_V2_ENABLED = 'true';
    const sequenceId = randomUUID();
    const campaignId = await seedCampaign({ sequence_id: sequenceId });
    const leadId = await seedLead();
    const t1 = await seedTemplate();
    const snapshot = await execRepo.ensureSequenceSnapshot(campaignId, sequenceId, [
      { stepNumber: 1, channel: 'email' as const, delayHours: 0, templateId: t1 },
    ]);
    await execRepo.upsertEnrollmentState(campaignId, leadId, {
      enrollmentStatus: 'active',
      sequenceSnapshotId: snapshot.id,
      nextStepNumber: 1,
      completedSteps: 0,
    });
    const exec0 = await execRepo.insertStepExecution({
      campaignId,
      leadId,
      snapshotId: snapshot.id,
      stepNumber: 1,
      channel: 'email',
      templateId: t1,
      generation: 0,
      attempt: 0,
      dueAt: new Date().toISOString(),
      mockMode: false,
    });
    await pool.query(
      `UPDATE campaign_step_executions SET state = 'failed', error_message = 'Fail' WHERE id = $1`,
      [exec0!.id],
    );
    await pool.query(
      `INSERT INTO outreach_logs (lead_id, campaign_id, channel, template_id, step_number, status, error_message)
       VALUES ($1, $2, 'email', $3, 1, 'failed', 'Fail')`,
      [leadId, campaignId, t1],
    );

    // 1. Paused campaign
    await pool.query(`UPDATE campaigns SET status = 'paused' WHERE id = $1`, [campaignId]);
    await expect(retryLeadOutreachStep(campaignId, leadId, actor)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringMatching(/Campaign is paused/i),
    });
    await pool.query(`UPDATE campaigns SET status = 'active' WHERE id = $1`, [campaignId]);

    // 2. Paused enrollment
    await pool.query(
      `UPDATE campaign_leads SET enrollment_status = 'paused' WHERE campaign_id = $1 AND lead_id = $2`,
      [campaignId, leadId],
    );
    await expect(retryLeadOutreachStep(campaignId, leadId, actor)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringMatching(/Enrollment is paused/i),
    });
    await pool.query(
      `UPDATE campaign_leads SET enrollment_status = 'active' WHERE campaign_id = $1 AND lead_id = $2`,
      [campaignId, leadId],
    );

    // 3. Opted out lead
    await pool.query(`UPDATE leads SET status = 'opted_out' WHERE id = $1`, [leadId]);
    await expect(retryLeadOutreachStep(campaignId, leadId, actor)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/opted out/i),
    });
    await pool.query(`UPDATE leads SET status = 'active' WHERE id = $1`, [leadId]);

    // 4. Uncertain state
    await pool.query(`UPDATE campaign_step_executions SET state = 'uncertain' WHERE id = $1`, [
      exec0!.id,
    ]);
    await expect(retryLeadOutreachStep(campaignId, leadId, actor)).rejects.toMatchObject({
      statusCode: 422,
      message: expect.stringMatching(/uncertain/i),
    });
  });

  it('preserves mock mode across every attempt', async () => {
    process.env.CAMPAIGN_OPERATIONS_V2_ENABLED = 'true';
    const sequenceId = randomUUID();
    const campaignId = await seedCampaign({ sequence_id: sequenceId });
    const leadId = await seedLead();
    const t1 = await seedTemplate();
    const snapshot = await execRepo.ensureSequenceSnapshot(campaignId, sequenceId, [
      { stepNumber: 1, channel: 'email' as const, delayHours: 0, templateId: t1 },
    ]);
    await execRepo.upsertEnrollmentState(campaignId, leadId, {
      enrollmentStatus: 'active',
      sequenceSnapshotId: snapshot.id,
      nextStepNumber: 1,
      completedSteps: 0,
      mockMode: true,
    });

    const exec0 = await execRepo.insertStepExecution({
      campaignId,
      leadId,
      snapshotId: snapshot.id,
      stepNumber: 1,
      channel: 'email',
      templateId: t1,
      generation: 0,
      attempt: 0,
      dueAt: new Date().toISOString(),
      mockMode: true,
    });
    expect(exec0?.mock_mode).toBe(true);

    await pool.query(
      `UPDATE campaign_step_executions SET state = 'failed', error_message = 'Fail 0' WHERE id = $1`,
      [exec0!.id],
    );
    await pool.query(
      `INSERT INTO outreach_logs (lead_id, campaign_id, channel, template_id, step_number, status, error_message)
       VALUES ($1, $2, 'email', $3, 1, 'failed', 'Fail 0')`,
      [leadId, campaignId, t1],
    );

    // Retry 1
    const res1 = await retryLeadOutreachStep(campaignId, leadId, actor);
    expect(res1.enqueued).toBe(true);
    const exec1 = await execRepo.findExecutionByDedupeKey(
      execRepo.buildDedupeKey({
        campaignId,
        leadId,
        snapshotId: snapshot.id,
        stepNumber: 1,
        generation: 0,
        attempt: 1,
      }),
    );
    expect(exec1?.mock_mode).toBe(true);

    await pool.query(
      `UPDATE campaign_step_executions SET state = 'failed', error_message = 'Fail 1' WHERE id = $1`,
      [exec1!.id],
    );
    await pool.query(
      `INSERT INTO outreach_logs (lead_id, campaign_id, channel, template_id, step_number, status, error_message)
       VALUES ($1, $2, 'email', $3, 1, 'failed', 'Fail 1')`,
      [leadId, campaignId, t1],
    );

    // Retry 2
    const res2 = await retryLeadOutreachStep(campaignId, leadId, actor);
    expect(res2.enqueued).toBe(true);
    const exec2 = await execRepo.findExecutionByDedupeKey(
      execRepo.buildDedupeKey({
        campaignId,
        leadId,
        snapshotId: snapshot.id,
        stepNumber: 1,
        generation: 0,
        attempt: 2,
      }),
    );
    expect(exec2?.mock_mode).toBe(true);
  });
});


describe('review regression: concurrent snapshot allocation', () => {
  it('reuses an equivalent winner and allocates distinct changed versions', async () => {
    const campaignId = await seedCampaign();
    const sequenceId = randomUUID();
    const steps = twoSteps(await seedTemplate(), await seedTemplate());
    const snapshots = await Promise.all(Array.from({ length: 12 }, () =>
      execRepo.ensureSequenceSnapshot(campaignId, sequenceId, steps)));
    expect(new Set(snapshots.map((snapshot) => snapshot.id)).size).toBe(1);
    const changed = await Promise.all([1, 2].map((delay) =>
      execRepo.ensureSequenceSnapshot(campaignId, sequenceId, [steps[0], { ...steps[1], delayHours: delay }])));
    expect(changed.map((snapshot) => snapshot.version).sort()).toEqual([2, 3]);
    const latest = changed.reduce((a, b) => a.version > b.version ? a : b);
    const reused = await execRepo.ensureSequenceSnapshot(campaignId, sequenceId, latest.steps);
    expect(reused.id).toBe(latest.id);
  });
});

describe('review regression: deferred due time', () => {
  it('persists the deferral so recovery cannot immediately republish or reclaim it', async () => {
    const campaignId = await seedCampaign();
    const leadId = await seedLead();
    await execRepo.upsertEnrollmentState(campaignId, leadId, {
      nextStepNumber: 1, nextDueAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const execution = await execRepo.insertStepExecution({ campaignId, leadId, snapshotId: null,
      stepNumber: 1, channel: 'email', templateId: null, generation: 0, attempt: 0,
      dueAt: new Date(Date.now() - 60_000).toISOString(), mockMode: true });
    const dedupeKey = execution!.dedupe_key;
    await execRepo.claimDueStepExecutionTx({ dedupeKey, expectedGeneration: 0, workerId: 'test', leaseMs: 300000 });
    const dueAt = new Date(Date.now() + 3_600_000).toISOString();
    await execService.releaseClaimForRetry(dedupeKey, dueAt);
    const stored = await execRepo.findExecutionByDedupeKey(dedupeKey);
    expect(new Date(stored!.due_at!).toISOString()).toBe(dueAt);
    const enrollment = await execRepo.getEnrollmentState(campaignId, leadId);
    expect(new Date(enrollment!.next_due_at!).toISOString()).toBe(dueAt);
    expect(await execRepo.findStaleScheduledExecutions(100)).toHaveLength(0);
    expect(await execRepo.claimDueStepExecutionTx({ dedupeKey, expectedGeneration: 0, workerId: 'test2', leaseMs: 300000 })).toBeNull();
  });
});

describe('review regression: campaign-wide SQL aggregates', () => {
  it('counts every enrollment using its pinned snapshot and returns only reason buckets', async () => {
    const campaignId = await seedCampaign();
    const sequenceId = randomUUID();
    const steps = twoSteps(await seedTemplate(), await seedTemplate());
    const short = await execRepo.ensureSequenceSnapshot(campaignId, sequenceId, steps);
    const long = await execRepo.ensureSequenceSnapshot(campaignId, sequenceId,
      [...steps, { ...steps[1], stepNumber: 3 }, { ...steps[1], stepNumber: 4 }]);
    const leads = await pool.query<{ id: string }>(
      "INSERT INTO leads (business_name, status) SELECT 'Aggregate fixture', 'active' FROM generate_series(1, 120) RETURNING id");
    await Promise.all(leads.rows.map((lead, index) => execRepo.upsertEnrollmentState(campaignId, lead.id, {
      sequenceSnapshotId: index < 70 ? long.id : short.id,
      nextStepNumber: index < 70 ? 2 : 1, completedSteps: index < 70 ? 1 : 0,
      nextDueAt: new Date(Date.now() + 3_600_000).toISOString(),
    })));
    const buckets = await execRepo.summarizeEnrollmentStates({ campaignId, campaignPaused: false,
      liveSteps: steps, unavailableChannels: [], deferralReason: null, now: new Date().toISOString() });
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({ reason: 'sequence_delay', count: '120', potential_remaining: '310', unknown_timing: '0' });
    const paused = await execRepo.summarizeEnrollmentStates({ campaignId, campaignPaused: true,
      liveSteps: steps, unavailableChannels: ['email'], deferralReason: 'daily_cap', now: new Date().toISOString() });
    expect(paused[0]).toMatchObject({ reason: 'campaign_paused', count: '120', potential_remaining: '310' });
  });
});

describe('review regression: activity event pagination', () => {
  it('returns message statuses and operator actions with the production enum types', async () => {
    const campaignId = await seedCampaign();
    const leadId = await seedLead();
    await pool.query(
      `INSERT INTO outreach_logs (lead_id, campaign_id, channel, status, sent_at)
       VALUES ($1, $2, 'email', 'sent', '2026-10-13T10:00:00Z')`,
      [leadId, campaignId],
    );
    await pool.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, created_at)
       VALUES ('campaign', $1, 'campaign.pause', '2026-10-13T11:00:00Z')`,
      [campaignId],
    );
    const activity = await execRepo.findCampaignActivity(campaignId, 25);
    expect(activity.rows).toEqual([
      expect.objectContaining({ kind: 'operator', status: 'campaign.pause', channel: null }),
      expect.objectContaining({ kind: 'send', status: 'sent', channel: 'email', lead_id: leadId }),
    ]);
    expect(activity.hasMore).toBe(false);
  });

  it('paginates a send and reply with the same ID/time without dropping either', async () => {
    const campaignId = await seedCampaign();
    const leadId = await seedLead();
    const at = '2026-10-13T10:00:00.000Z';
    await pool.query(`INSERT INTO outreach_logs (lead_id, campaign_id, channel, status, sent_at, replied_at, created_at)
      VALUES ($1, $2, 'email', 'replied', $3, $3, '2026-10-12')`, [leadId, campaignId, at]);
    await pool.query(`INSERT INTO outreach_logs (lead_id, campaign_id, channel, status, updated_at, created_at)
      VALUES ($1, $2, 'email', 'failed', '2026-10-14', '2026-10-12')`, [leadId, campaignId]);
    const first = await execRepo.findCampaignActivity(campaignId, 1);
    expect(first.rows[0].kind).toBe('failure');
    const row1 = first.rows[0];
    const second = await execRepo.findCampaignActivity(campaignId, 1, new Date(row1.created_at).toISOString(), row1.id, row1.kind);
    expect(second.rows[0].kind).toBe('send');
    const row2 = second.rows[0];
    const third = await execRepo.findCampaignActivity(campaignId, 1, new Date(row2.created_at).toISOString(), row2.id, row2.kind);
    expect(third.rows[0].kind).toBe('reply');
    expect(new Date(third.rows[0].created_at).toISOString()).toBe(at);
    expect(third.hasMore).toBe(false);
  });
});

async function seedPendingPhoneTask(): Promise<{ campaignId: string; leadId: string; sequenceId: string }> {
  const campaignId = await seedCampaign();
  const leadId = await seedLead();
  const sequenceId = randomUUID();
  const templateId = await seedTemplate();
  const steps = [{ stepNumber: 1, channel: 'phone_call' as const, delayHours: 0, templateId },
    { stepNumber: 2, channel: 'email' as const, delayHours: 2, templateId }];
  const snapshot = await execRepo.ensureSequenceSnapshot(campaignId, sequenceId, steps);
  await execRepo.upsertEnrollmentState(campaignId, leadId, { sequenceSnapshotId: snapshot.id,
    nextStepNumber: 1, nextDueAt: new Date(Date.now() - 60_000).toISOString() });
  const execution = await execRepo.insertStepExecution({ campaignId, leadId, snapshotId: snapshot.id,
    stepNumber: 1, channel: 'phone_call', templateId, generation: 0, attempt: 0,
    dueAt: new Date(Date.now() - 60_000).toISOString(), mockMode: true });
  await execRepo.claimDueStepExecutionTx({ dedupeKey: execution!.dedupe_key,
    expectedGeneration: 0, workerId: 'phone-test', leaseMs: 300000 });
  await execRepo.markExecutionSent(execution!.dedupe_key, null);
  return { campaignId, leadId, sequenceId };
}

describe('review regression: phone tasks across pause', () => {
  it.each(['campaign', 'enrollment'])('advances a completed call during %s pause without replaying it', async (scope) => {
    const { campaignId, leadId, sequenceId } = await seedPendingPhoneTask();
    if (scope === 'campaign') await execRepo.pauseCampaignTx(campaignId, new Date().toISOString());
    else await execRepo.pauseEnrollmentState(campaignId, leadId, null, 0, new Date().toISOString());
    let campaign = (await pool.query('SELECT * FROM campaigns WHERE id = $1', [campaignId])).rows[0];
    const complete = await execService.scheduleAfterPhoneTask({ campaign, leadId, sequenceId, completedStepNumber: 1 });
    expect(complete).toEqual({ owned: true, scheduled: false, duplicate: false });
    const frozen = await execRepo.getEnrollmentState(campaignId, leadId);
    expect(frozen).toMatchObject({ next_step_number: 2, completed_steps: 1, next_due_at: null, delay_remaining_ms: '7200000' });
    const duplicate = await execService.scheduleAfterPhoneTask({ campaign, leadId, sequenceId, completedStepNumber: 1 });
    expect(duplicate.duplicate).toBe(true);
    if (scope === 'campaign') {
      await pool.query("UPDATE campaigns SET status = 'active' WHERE id = $1", [campaignId]);
      campaign = (await pool.query('SELECT * FROM campaigns WHERE id = $1', [campaignId])).rows[0];
      await execService.restoreForResume({ campaign, enrollments: [frozen!] });
    } else await execService.resumeSingleEnrollment({ campaign, enrollment: frozen!, sequenceId });
    const next = await execRepo.getEnrollmentState(campaignId, leadId);
    expect(next?.next_step_number).toBe(2);
    expect(new Date(next!.next_due_at!).getTime() - Date.now()).toBeGreaterThan(7_190_000);
    const executions = await pool.query('SELECT step_number, state FROM campaign_step_executions WHERE campaign_id = $1 ORDER BY step_number', [campaignId]);
    expect(executions.rows).toEqual([{ step_number: 1, state: 'sent' }, { step_number: 2, state: 'scheduled' }]);
  });

  it.each(['campaign', 'enrollment'])('leaves an open call task alone on %s resume', async (scope) => {
    const { campaignId, leadId, sequenceId } = await seedPendingPhoneTask();
    const pending = await execRepo.getEnrollmentState(campaignId, leadId);
    expect(pending).toMatchObject({ next_due_at: null, delay_remaining_ms: null });
    if (scope === 'campaign') await execRepo.pauseCampaignTx(campaignId, new Date().toISOString());
    else await execRepo.pauseEnrollmentState(campaignId, leadId, null, 0, new Date().toISOString());
    const enrollment = await execRepo.getEnrollmentState(campaignId, leadId);
    await pool.query("UPDATE campaigns SET status = 'active' WHERE id = $1", [campaignId]);
    const campaign = (await pool.query('SELECT * FROM campaigns WHERE id = $1', [campaignId])).rows[0];
    if (scope === 'campaign') {
      const restored = await execService.restoreForResume({ campaign, enrollments: [enrollment!] });
      expect(restored).toEqual({ restored: 0, unknownTiming: 0 });
    } else await execService.resumeSingleEnrollment({ campaign, enrollment: enrollment!, sequenceId });
    const executions = await pool.query('SELECT step_number, state FROM campaign_step_executions WHERE campaign_id = $1', [campaignId]);
    expect(executions.rows).toEqual([{ step_number: 1, state: 'sent' }]);
  });
});

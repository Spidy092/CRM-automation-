/**
 * Real checked-in migration-chain regression tests. Only isolated local test
 * services are allowed; each test creates a fresh uniquely named database.
 * No application database is dropped and no migration source is rewritten.
 */
import { Client, type QueryResult } from 'pg';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import MigrationBuilderImpl from 'node-pg-migrate/dist/migrationBuilder';

describe('checked-in campaign migration defaults', () => {
  it('compiles plain defaults that satisfy the enrollment and execution constraints', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const migration =
      require('../../../../migrations/1750000000085_campaign-operations-execution.js') as {
        up: (builder: MigrationBuilderImpl) => void;
      };
    const builder = new MigrationBuilderImpl({} as never, undefined, false, {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    });
    migration.up(builder);
    const sql = builder.getSql();
    expect(sql).toContain('DEFAULT $pga$active$pga$');
    expect(sql).toContain('DEFAULT $pga$unscheduled$pga$');
    expect(sql).not.toContain("DEFAULT $pga$'active'$pga$");
    expect(sql).not.toContain("DEFAULT $pga$'unscheduled'$pga$");
  });
});

const TEST_PG_URL = process.env.TEST_PG_URL ?? 'postgres://localhost:5433/crm_test';
const TEST_PG_USER = process.env.TEST_PG_USER;
const TEST_PG_PASSWORD = process.env.TEST_PG_PASSWORD;
const migrationsDir = path.join(process.cwd(), '..', 'migrations');
jest.setTimeout(120000);

function assertIsolated(value: string): void {
  const url = new URL(value);
  if (
    url.protocol !== 'postgres:' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.port !== '5433' ||
    url.pathname !== '/crm_test' ||
    url.search !== '' ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw new Error('Refusing migration-chain tests: use isolated localhost:5433/crm_test.');
  }
}

function withTestCredentials(value: string): string {
  if (!TEST_PG_USER || !TEST_PG_PASSWORD) {
    throw new Error('Set TEST_PG_USER and TEST_PG_PASSWORD for the isolated migration tests.');
  }
  const url = new URL(value);
  url.username = TEST_PG_USER;
  url.password = TEST_PG_PASSWORD;
  return url.toString();
}

async function freshDatabase(): Promise<string> {
  assertIsolated(TEST_PG_URL);
  const admin = new Client({
    connectionString: withTestCredentials(TEST_PG_URL),
    connectionTimeoutMillis: 5000,
  });
  const name = `crm_test_mig_${randomUUID().replace(/-/g, '')}`;
  try {
    await admin.connect();
    // Name consists solely of this fixed prefix and a generated UUID.
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  const url = new URL(TEST_PG_URL);
  url.pathname = `/${name}`;
  return withTestCredentials(url.toString());
}

async function runMigrations(databaseUrl: string, beforeCampaignExecution = false): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { runner } = require('node-pg-migrate') as {
    runner: (options: Record<string, unknown>) => Promise<unknown>;
  };
  const count = fs
    .readdirSync(migrationsDir)
    .filter(
      (name) =>
        /^\d.*\.js$/.test(name) && name < '1750000000085_campaign-operations-execution.js',
    ).length;
  await runner({
    databaseUrl,
    dir: migrationsDir,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    ...(beforeCampaignExecution ? { count } : {}),
    log: () => undefined,
  });
}

async function seedEnrollment(client: Client): Promise<{ campaignId: string; leadId: string }> {
  const campaign = await client.query<{ id: string }>(
    `INSERT INTO campaigns (name, tone, created_by)
     VALUES ('Migration regression', 'professional', '00000000-0000-0000-0000-000000000001')
     RETURNING id`,
  );
  const lead = await client.query<{ id: string }>(
    `INSERT INTO leads
       (business_name, contact_name, phone, email, industry, location, source_platform, status)
     VALUES ('Migration Co', 'Test', '+10000000000', 'migration@example.com', 'retail', 'Austin', 'manual', 'active')
     RETURNING id`,
  );
  const campaignId = campaign.rows[0].id;
  const leadId = lead.rows[0].id;
  await client.query('INSERT INTO campaign_leads (campaign_id, lead_id) VALUES ($1, $2)', [
    campaignId,
    leadId,
  ]);
  return { campaignId, leadId };
}

async function verifyExecutionOperations(
  client: Client,
  campaignId: string,
  leadId: string,
): Promise<void> {
  const enrollment = await client.query<{ enrollment_status: string; mock_mode: boolean }>(
    `INSERT INTO campaign_leads (campaign_id, lead_id) VALUES ($1, $2)
     ON CONFLICT (campaign_id, lead_id) DO UPDATE SET completed_steps = 0
     RETURNING enrollment_status, mock_mode`,
    [campaignId, leadId],
  );
  expect(enrollment.rows).toEqual([{ enrollment_status: 'active', mock_mode: false }]);

  const sequenceId = randomUUID();
  const snapshot = await client.query<{ id: string }>(
    `INSERT INTO campaign_sequence_snapshots (campaign_id, sequence_id, version, steps)
     VALUES ($1, $2, 1, '[]') ON CONFLICT (campaign_id, version) DO UPDATE SET steps = EXCLUDED.steps
     RETURNING id`,
    [campaignId, sequenceId],
  );
  const execution = await client.query<{ state: string; mock_mode: boolean }>(
    `INSERT INTO campaign_step_executions
       (campaign_id, lead_id, snapshot_id, step_number, channel, dedupe_key)
     VALUES ($1, $2, $3, 1, 'email', $4) RETURNING state, mock_mode`,
    [campaignId, leadId, snapshot.rows[0].id, randomUUID()],
  );
  expect(execution.rows).toEqual([{ state: 'unscheduled', mock_mode: false }]);
  await client.query(
    `INSERT INTO campaign_day_capacity (campaign_id, local_date, send_limit, reserved)
     VALUES ($1, CURRENT_DATE, 1, 0) ON CONFLICT (campaign_id, local_date) DO NOTHING`,
    [campaignId],
  );
  const reserve = (): Promise<QueryResult<{ reserved: number }>> =>
    client.query(
      `UPDATE campaign_day_capacity SET reserved = reserved + 1
     WHERE campaign_id = $1 AND local_date = CURRENT_DATE AND reserved < send_limit RETURNING reserved`,
      [campaignId],
    );
  expect((await reserve()).rowCount).toBe(1);
  expect((await reserve()).rowCount).toBe(0);
  await expect(
    client.query(
      `INSERT INTO campaign_sequence_snapshots (campaign_id, sequence_id, version, steps)
     VALUES ($1, $2, 2, '{}')`,
      [campaignId, sequenceId],
    ),
  ).rejects.toThrow(/steps_array_check/);
  await expect(
    client.query(`UPDATE campaign_step_executions SET state = 'invalid' WHERE campaign_id = $1`, [
      campaignId,
    ]),
  ).rejects.toThrow(/state_check/);
}

describe('actual checked-in migration chain', () => {
  it('upgrades populated pre-0085 rows and supports execution upserts and capacity', async () => {
    const url = await freshDatabase();
    await runMigrations(url, true);
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      const { campaignId, leadId } = await seedEnrollment(client);
      await runMigrations(url);
      await verifyExecutionOperations(client, campaignId, leadId);
      const applied = await client.query<{ name: string }>('SELECT name FROM pgmigrations');
      for (const suffix of ['0085', '0086', '0087']) {
        expect(applied.rows.some((row) => row.name.includes(suffix))).toBe(true);
      }
    } finally {
      await client.end();
    }
  });

  it('upgrades an empty database and supplies valid enrollment and execution defaults', async () => {
    const url = await freshDatabase();
    await runMigrations(url);
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      const { campaignId, leadId } = await seedEnrollment(client);
      await verifyExecutionOperations(client, campaignId, leadId);
    } finally {
      await client.end();
    }
  });
});

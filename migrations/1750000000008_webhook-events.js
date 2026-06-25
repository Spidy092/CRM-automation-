/* eslint-disable camelcase */

/**
 * Migration: Webhook Events Table
 *
 * Why: Inbound webhooks (Google Ads lead forms, Website contact forms, Custom
 * scraping sources) must be idempotent on the provider's event ID so retries
 * from upstream do not create duplicate leads. The lead table's existing
 * partial-unique index on (lower(email), source_platform) and
 * (phone, source_platform) catches duplicates at the row level, but does not
 * protect against replays that contain *different* payloads for the same
 * upstream event. This table records every accepted webhook with its
 * provider-supplied event_id and idempotency_key so handlers can short-circuit
 * on the second POST.
 *
 * Scope:
 *   - `webhook_events` table:
 *       id, provider, event_id, idempotency_key (UNIQUE), raw_payload (jsonb),
 *       signature_header, headers (jsonb), received_at, processed_at,
 *       lead_id (nullable FK -> leads), status (received|processed|failed),
 *       error_message.
 *   - UNIQUE index on (provider, event_id) for dedupe lookup.
 *   - UNIQUE index on idempotency_key (provider-supplied dedupe key, when present).
 *   - Indexes on lead_id, status, received_at for ops queries.
 *
 * Safety:
 *   - Append-only — does not modify any prior migration.
 *   - Idempotent: every DDL guarded with IF NOT EXISTS or DO $$ ... $$.
 *   - No destructive operations; no row data touched.
 *
 * NOTE: This file is presented for approval. It must NOT be run autonomously.
 *       Run via: npm run migrate   (after backup + approval).
 */

exports.up = (pgm) => {
  // ── ENUM: webhook_event_status ─────────────────────────────────────────────
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'webhook_event_status'
      ) THEN
        CREATE TYPE webhook_event_status AS ENUM ('received', 'processed', 'failed');
      END IF;
    END$$;
  `);

  // ── TABLE: webhook_events ──────────────────────────────────────────────────
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS webhook_events (
      id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
      provider          VARCHAR(50)     NOT NULL,
      event_id          VARCHAR(255)    NOT NULL,
      idempotency_key   VARCHAR(255),
      raw_payload       JSONB           NOT NULL,
      signature_header  TEXT,
      headers           JSONB           NOT NULL DEFAULT '{}'::jsonb,
      status            webhook_event_status NOT NULL DEFAULT 'received',
      lead_id           UUID            REFERENCES leads(id) ON DELETE SET NULL,
      error_message     TEXT,
      received_at       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
      processed_at      TIMESTAMPTZ,
      CONSTRAINT webhook_events_provider_event_uk UNIQUE (provider, event_id)
    );
  `);

  // ── Indexes ────────────────────────────────────────────────────────────────
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_events_idempotency_key
      ON webhook_events (idempotency_key)
      WHERE idempotency_key IS NOT NULL;
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_webhook_events_lead_id
      ON webhook_events (lead_id);
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_webhook_events_status
      ON webhook_events (status);
  `);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_webhook_events_received_at
      ON webhook_events (received_at DESC);
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS webhook_events;');
  pgm.sql('DROP TYPE IF EXISTS webhook_event_status;');
};
/* eslint-disable camelcase */

/**
 * Migration: Scraper Tables
 *
 * Why: Sprint 4 requires a configurable scraper framework that ingests leads
 * from Google Business/Places, Facebook Business Pages, YouTube Channels,
 * and custom Web scraping sources. Each source is defined by a row in
 * `scraper_configs` and each run is recorded in `scraper_logs`.
 *
 * Tables:
 *   1. `scraper_configs` — One row per scraper source definition (name,
 *      source_type, config JSONB, schedule, active flag).
 *   2. `scraper_logs` — One row per scraper run (status, record counts,
 *      error info, optional raw_response for debugging).
 *
 * Scope:
 *   - ENUM `scraper_source_type`: google_places, facebook, youtube, web_scrape
 *   - ENUM `scraper_log_status`: running, completed, failed, partially_completed
 *   - TABLE `scraper_configs` with unique (name, source_type)
 *   - TABLE `scraper_logs` with FK → scraper_configs, ON DELETE CASCADE
 *   - Indexes for ops queries (config_id, status, created_at DESC)
 *
 * Safety:
 *   - Append-only — does not modify any prior migration.
 *   - Idempotent: every DDL guarded with IF NOT EXISTS or DO $$ ... $$.
 *   - No destructive operations; no row data touched.
 */

exports.up = (pgm) => {
  // ── ENUM: scraper_source_type ────────────────────────────────────────────
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'scraper_source_type'
      ) THEN
        CREATE TYPE scraper_source_type AS ENUM (
          'google_places', 'facebook', 'youtube', 'web_scrape'
        );
      END IF;
    END$$;
  `);

  // ── ENUM: scraper_log_status ─────────────────────────────────────────────
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'scraper_log_status'
      ) THEN
        CREATE TYPE scraper_log_status AS ENUM (
          'running', 'completed', 'failed', 'partially_completed'
        );
      END IF;
    END$$;
  `);

  // ── TABLE: scraper_configs ───────────────────────────────────────────────
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS scraper_configs (
      id              UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
      name            VARCHAR(255)        NOT NULL,
      source_type     scraper_source_type NOT NULL,
      is_active       BOOLEAN             NOT NULL DEFAULT true,
      config          JSONB               NOT NULL DEFAULT '{}'::jsonb,
      schedule_cron   VARCHAR(100),
      last_run_at     TIMESTAMPTZ,
      created_by      UUID                NOT NULL REFERENCES users(id),
      created_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
      CONSTRAINT scraper_configs_name_source_uk UNIQUE (name, source_type)
    );
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_scraper_configs_source_type
      ON scraper_configs (source_type);
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_scraper_configs_active
      ON scraper_configs (is_active)
      WHERE is_active = true;
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_scraper_configs_config_gin
      ON scraper_configs USING GIN (config);
  `);

  // ── TABLE: scraper_logs ──────────────────────────────────────────────────
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS scraper_logs (
      id                UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
      config_id         UUID                    NOT NULL REFERENCES scraper_configs(id) ON DELETE CASCADE,
      status            scraper_log_status      NOT NULL DEFAULT 'running',
      started_at        TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
      completed_at      TIMESTAMPTZ,
      records_found     INTEGER                 NOT NULL DEFAULT 0,
      records_imported  INTEGER                 NOT NULL DEFAULT 0,
      records_failed    INTEGER                 NOT NULL DEFAULT 0,
      error_message     TEXT,
      raw_response      JSONB,
      created_at        TIMESTAMPTZ             NOT NULL DEFAULT NOW()
    );
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_scraper_logs_config_id
      ON scraper_logs (config_id);
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_scraper_logs_status
      ON scraper_logs (status);
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_scraper_logs_created_at
      ON scraper_logs (created_at DESC);
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TABLE IF EXISTS scraper_logs;');
  pgm.sql('DROP TABLE IF EXISTS scraper_configs;');
  pgm.sql('DROP TYPE IF EXISTS scraper_log_status;');
  pgm.sql('DROP TYPE IF EXISTS scraper_source_type;');
};

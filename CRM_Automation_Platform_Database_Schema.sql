-- =============================================================
-- CRM Automation Platform — Database Schema
-- PostgreSQL 16
-- Prepared By: Chethan Gowda | 18 June 2026 | v1.0
-- Reference: TRD v1.0 | Architecture v1.0
-- =============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================
-- ENUM TYPES
-- =============================================================

CREATE TYPE user_role AS ENUM ('admin', 'manager', 'sales_rep', 'marketing');

CREATE TYPE lead_classification AS ENUM ('hot', 'warm', 'cold');

CREATE TYPE lead_status AS ENUM ('active', 'paused', 'won', 'lost', 'opted_out');

CREATE TYPE campaign_status AS ENUM ('draft', 'active', 'paused', 'completed', 'archived');

CREATE TYPE outreach_tone AS ENUM ('formal', 'professional', 'conversational');

CREATE TYPE message_channel AS ENUM ('whatsapp', 'email', 'sms', 'phone_call');

CREATE TYPE outreach_status AS ENUM (
    'queued', 'sent', 'delivered', 'opened', 'replied', 'failed', 'bounced'
);

CREATE TYPE template_approval_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TYPE custom_field_type AS ENUM ('text', 'number', 'date', 'dropdown', 'checkbox');

CREATE TYPE task_type AS ENUM ('phone_call', 'follow_up', 'meeting_prep', 'other');

CREATE TYPE task_status AS ENUM ('pending', 'in_progress', 'completed', 'cancelled');

-- =============================================================
-- TABLE: users
-- =============================================================

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    role            user_role NOT NULL DEFAULT 'sales_rep',
    is_available    BOOLEAN NOT NULL DEFAULT TRUE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_users_role ON users (role);
CREATE INDEX idx_users_is_available ON users (is_available) WHERE is_active = TRUE;

-- =============================================================
-- TABLE: refresh_tokens
-- =============================================================

CREATE TABLE refresh_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash  VARCHAR(255) UNIQUE NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens (user_id);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens (expires_at);

-- =============================================================
-- TABLE: pipelines
-- =============================================================

CREATE TABLE pipelines (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(255) NOT NULL,
    is_default  BOOLEAN NOT NULL DEFAULT FALSE,
    created_by  UUID NOT NULL REFERENCES users (id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one default pipeline allowed
CREATE UNIQUE INDEX idx_pipelines_default ON pipelines (is_default) WHERE is_default = TRUE;

-- =============================================================
-- TABLE: pipeline_stages
-- =============================================================

CREATE TABLE pipeline_stages (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pipeline_id      UUID NOT NULL REFERENCES pipelines (id) ON DELETE CASCADE,
    name             VARCHAR(255) NOT NULL,
    position         INTEGER NOT NULL,
    is_terminal_won  BOOLEAN NOT NULL DEFAULT FALSE,
    is_terminal_lost BOOLEAN NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_stage_position UNIQUE (pipeline_id, position),
    CONSTRAINT one_won_per_pipeline EXCLUDE USING btree (pipeline_id WITH =) WHERE (is_terminal_won = TRUE),
    CONSTRAINT one_lost_per_pipeline EXCLUDE USING btree (pipeline_id WITH =) WHERE (is_terminal_lost = TRUE)
);

CREATE INDEX idx_pipeline_stages_pipeline_id ON pipeline_stages (pipeline_id);

-- =============================================================
-- TABLE: custom_field_definitions
-- =============================================================

CREATE TABLE custom_field_definitions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    label       VARCHAR(255) NOT NULL,
    field_key   VARCHAR(100) UNIQUE NOT NULL,
    field_type  custom_field_type NOT NULL,
    options     JSONB,
    is_required BOOLEAN NOT NULL DEFAULT FALSE,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_by  UUID NOT NULL REFERENCES users (id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================
-- TABLE: leads
-- =============================================================

CREATE TABLE leads (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_name     VARCHAR(255) NOT NULL,
    contact_name      VARCHAR(255) NOT NULL,
    phone             VARCHAR(50) NOT NULL,
    email             VARCHAR(255) NOT NULL,
    website           VARCHAR(500),
    industry          VARCHAR(100) NOT NULL,
    location          VARCHAR(255) NOT NULL,
    country           VARCHAR(100),
    google_rating     DECIMAL(2, 1) CHECK (google_rating >= 0 AND google_rating <= 5),
    review_count      INTEGER CHECK (review_count >= 0),
    social_links      JSONB,
    source_platform   VARCHAR(100) NOT NULL,
    lead_score        INTEGER NOT NULL DEFAULT 0 CHECK (lead_score >= 0 AND lead_score <= 100),
    classification    lead_classification,
    status            lead_status NOT NULL DEFAULT 'active',
    assigned_to       UUID REFERENCES users (id) ON DELETE SET NULL,
    pipeline_stage_id UUID REFERENCES pipeline_stages (id) ON DELETE SET NULL,
    custom_fields     JSONB NOT NULL DEFAULT '{}',
    tags              TEXT[] NOT NULL DEFAULT '{}',
    notes             TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_leads_email ON leads (email);
CREATE INDEX idx_leads_phone ON leads (phone);
CREATE INDEX idx_leads_assigned_to ON leads (assigned_to);
CREATE INDEX idx_leads_status ON leads (status);
CREATE INDEX idx_leads_classification ON leads (classification);
CREATE INDEX idx_leads_source_platform ON leads (source_platform);
CREATE INDEX idx_leads_country ON leads (country);
CREATE INDEX idx_leads_industry ON leads (industry);
CREATE INDEX idx_leads_created_at ON leads (created_at DESC);
CREATE INDEX idx_leads_pipeline_stage ON leads (pipeline_stage_id);
CREATE INDEX idx_leads_tags ON leads USING GIN (tags);
CREATE INDEX idx_leads_custom_fields ON leads USING GIN (custom_fields);

-- Deduplication: same email+source OR same phone+source is a duplicate.
-- Email comparison is case-insensitive via lower(email).
-- Phone MUST be stored in E.164 normalized form by the application before insert,
-- otherwise variants of the same number will not match the phone-based dedup index.
CREATE UNIQUE INDEX idx_leads_dedup_email ON leads (lower(email), source_platform);
CREATE UNIQUE INDEX idx_leads_dedup_phone ON leads (phone, source_platform);

-- =============================================================
-- TABLE: scoring_config
-- =============================================================

CREATE TABLE scoring_config (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    hot_min_score        INTEGER NOT NULL DEFAULT 70 CHECK (hot_min_score >= 0 AND hot_min_score <= 100),
    warm_min_score       INTEGER NOT NULL DEFAULT 40 CHECK (warm_min_score >= 0 AND warm_min_score <= 100),
    assignment_threshold INTEGER NOT NULL DEFAULT 70 CHECK (assignment_threshold >= 0 AND assignment_threshold <= 100),
    updated_by           UUID REFERENCES users (id),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT single_config CHECK (id = id)
);

-- Only one scoring config row
CREATE UNIQUE INDEX idx_scoring_config_singleton ON scoring_config ((TRUE));

-- =============================================================
-- TABLE: scoring_rules
-- =============================================================

CREATE TABLE scoring_rules (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    factor      VARCHAR(100) NOT NULL,
    weight      INTEGER NOT NULL CHECK (weight >= 0 AND weight <= 100),
    condition   JSONB NOT NULL,
    score_value INTEGER NOT NULL CHECK (score_value >= 0 AND score_value <= 100),
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_by  UUID NOT NULL REFERENCES users (id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_scoring_rules_is_active ON scoring_rules (is_active);

-- =============================================================
-- TABLE: templates
-- =============================================================

CREATE TABLE templates (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name             VARCHAR(255) NOT NULL,
    channel          message_channel NOT NULL,
    subject          VARCHAR(500),
    body             TEXT NOT NULL,
    variables        TEXT[] NOT NULL DEFAULT '{}',
    approval_status  template_approval_status NOT NULL DEFAULT 'pending',
    approved_by      UUID REFERENCES users (id) ON DELETE SET NULL,
    approved_at      TIMESTAMPTZ,
    rejection_reason TEXT,
    created_by       UUID NOT NULL REFERENCES users (id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_templates_channel ON templates (channel);
CREATE INDEX idx_templates_approval_status ON templates (approval_status);
CREATE INDEX idx_templates_created_by ON templates (created_by);

-- =============================================================
-- TABLE: outreach_sequences
-- =============================================================

CREATE TABLE outreach_sequences (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(255) NOT NULL,
    -- steps: [{step_number, channel, delay_hours, template_id}]
    steps       JSONB NOT NULL DEFAULT '[]',
    created_by  UUID NOT NULL REFERENCES users (id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================
-- TABLE: campaigns
-- =============================================================

CREATE TABLE campaigns (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name               VARCHAR(255) NOT NULL,
    status             campaign_status NOT NULL DEFAULT 'draft',
    tone               outreach_tone NOT NULL DEFAULT 'professional',
    target_industries  TEXT[] NOT NULL DEFAULT '{}',
    target_countries   TEXT[] NOT NULL DEFAULT '{}',
    sequence_id        UUID REFERENCES outreach_sequences (id) ON DELETE SET NULL,
    pipeline_id        UUID REFERENCES pipelines (id) ON DELETE SET NULL,
    created_by         UUID NOT NULL REFERENCES users (id),
    launched_at        TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaigns_status ON campaigns (status);
CREATE INDEX idx_campaigns_created_by ON campaigns (created_by);
CREATE INDEX idx_campaigns_target_industries ON campaigns USING GIN (target_industries);
CREATE INDEX idx_campaigns_target_countries ON campaigns USING GIN (target_countries);

-- =============================================================
-- TABLE: campaign_leads
-- Junction table linking leads to campaigns
-- =============================================================

CREATE TABLE campaign_leads (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
    lead_id     UUID NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_campaign_lead UNIQUE (campaign_id, lead_id)
);

CREATE INDEX idx_campaign_leads_campaign_id ON campaign_leads (campaign_id);
CREATE INDEX idx_campaign_leads_lead_id ON campaign_leads (lead_id);

-- =============================================================
-- TABLE: outreach_logs
-- =============================================================

CREATE TABLE outreach_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id         UUID NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
    campaign_id     UUID REFERENCES campaigns (id) ON DELETE SET NULL,
    channel         message_channel NOT NULL,
    template_id     UUID REFERENCES templates (id) ON DELETE SET NULL,
    step_number     INTEGER,
    status          outreach_status NOT NULL DEFAULT 'queued',
    external_msg_id VARCHAR(255),
    message_body    TEXT,
    sent_at         TIMESTAMPTZ,
    delivered_at    TIMESTAMPTZ,
    opened_at       TIMESTAMPTZ,
    replied_at      TIMESTAMPTZ,
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_outreach_logs_lead_id ON outreach_logs (lead_id);
CREATE INDEX idx_outreach_logs_campaign_id ON outreach_logs (campaign_id);
CREATE INDEX idx_outreach_logs_status ON outreach_logs (status);
CREATE INDEX idx_outreach_logs_channel ON outreach_logs (channel);
CREATE INDEX idx_outreach_logs_sent_at ON outreach_logs (sent_at DESC);
CREATE INDEX idx_outreach_logs_external_msg_id ON outreach_logs (external_msg_id) WHERE external_msg_id IS NOT NULL;

-- Partition hint: partition by month on sent_at in Phase 2
-- PARTITION BY RANGE (sent_at)

-- =============================================================
-- TABLE: integrations
-- Stores encrypted credentials for all third-party integrations
-- =============================================================

CREATE TABLE integrations (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                   VARCHAR(100) UNIQUE NOT NULL,
    display_name           VARCHAR(255) NOT NULL,
    is_enabled             BOOLEAN NOT NULL DEFAULT FALSE,
    encrypted_credentials  TEXT,
    last_tested_at         TIMESTAMPTZ,
    last_test_status       VARCHAR(50),
    updated_by             UUID REFERENCES users (id),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================
-- TABLE: report_schedules
-- =============================================================

CREATE TABLE report_schedules (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         VARCHAR(255) NOT NULL,
    report_type  VARCHAR(100) NOT NULL,
    frequency    VARCHAR(50) NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
    target_roles user_role[] NOT NULL DEFAULT '{}',
    recipients   TEXT[] NOT NULL DEFAULT '{}',
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    last_run_at  TIMESTAMPTZ,
    next_run_at  TIMESTAMPTZ,
    created_by   UUID NOT NULL REFERENCES users (id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_report_schedules_next_run ON report_schedules (next_run_at) WHERE is_active = TRUE;

-- =============================================================
-- TABLE: audit_logs
-- =============================================================

CREATE TABLE audit_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users (id) ON DELETE SET NULL,
    action      VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id   UUID,
    old_value   JSONB,
    new_value   JSONB,
    ip_address  INET,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user_id ON audit_logs (user_id);
CREATE INDEX idx_audit_logs_entity ON audit_logs (entity_type, entity_id);
CREATE INDEX idx_audit_logs_action ON audit_logs (action);
CREATE INDEX idx_audit_logs_created_at ON audit_logs (created_at DESC);

-- =============================================================
-- TABLE: tasks
-- =============================================================
-- Manual tasks created by the outreach engine (e.g. phone_call sequence steps) and
-- assigned to a sales rep. A phone_call step inserts a row here instead of
-- auto-dispatching a message.

CREATE TABLE tasks (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id       UUID NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
    campaign_id   UUID REFERENCES campaigns (id) ON DELETE SET NULL,
    sequence_id   UUID REFERENCES outreach_sequences (id) ON DELETE SET NULL,
    step_number   INTEGER,
    assigned_to   UUID REFERENCES users (id) ON DELETE SET NULL,
    type          task_type NOT NULL DEFAULT 'phone_call',
    title         VARCHAR(255) NOT NULL,
    description   TEXT,
    due_at        TIMESTAMPTZ,
    status        task_status NOT NULL DEFAULT 'pending',
    completed_at  TIMESTAMPTZ,
    created_by    UUID REFERENCES users (id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tasks_lead_id ON tasks (lead_id);
CREATE INDEX idx_tasks_status ON tasks (status);
CREATE INDEX idx_tasks_assigned_to ON tasks (assigned_to) WHERE status IN ('pending', 'in_progress');
CREATE INDEX idx_tasks_due_at ON tasks (due_at) WHERE status IN ('pending', 'in_progress');

-- =============================================================
-- UPDATED_AT TRIGGER FUNCTION
-- =============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to all tables with updated_at
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_leads_updated_at
    BEFORE UPDATE ON leads
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_campaigns_updated_at
    BEFORE UPDATE ON campaigns
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_templates_updated_at
    BEFORE UPDATE ON templates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_outreach_sequences_updated_at
    BEFORE UPDATE ON outreach_sequences
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_outreach_logs_updated_at
    BEFORE UPDATE ON outreach_logs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_pipelines_updated_at
    BEFORE UPDATE ON pipelines
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_pipeline_stages_updated_at
    BEFORE UPDATE ON pipeline_stages
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_scoring_rules_updated_at
    BEFORE UPDATE ON scoring_rules
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_custom_field_definitions_updated_at
    BEFORE UPDATE ON custom_field_definitions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_report_schedules_updated_at
    BEFORE UPDATE ON report_schedules
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_tasks_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================
-- SEED DATA: Default Pipeline
-- =============================================================

INSERT INTO users (id, name, email, password_hash, role)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'System',
    'system@crm.internal',
    'not-a-real-hash',
    'admin'
);

INSERT INTO pipelines (id, name, is_default, created_by)
VALUES (
    '00000000-0000-0000-0000-000000000010',
    'Default Sales Pipeline',
    TRUE,
    '00000000-0000-0000-0000-000000000001'
);

INSERT INTO pipeline_stages (pipeline_id, name, position, is_terminal_won, is_terminal_lost)
VALUES
    ('00000000-0000-0000-0000-000000000010', 'New Lead',            1, FALSE, FALSE),
    ('00000000-0000-0000-0000-000000000010', 'Contacted',           2, FALSE, FALSE),
    ('00000000-0000-0000-0000-000000000010', 'Follow-Up Required',  3, FALSE, FALSE),
    ('00000000-0000-0000-0000-000000000010', 'Interested',          4, FALSE, FALSE),
    ('00000000-0000-0000-0000-000000000010', 'Meeting Scheduled',   5, FALSE, FALSE),
    ('00000000-0000-0000-0000-000000000010', 'Proposal Sent',       6, FALSE, FALSE),
    ('00000000-0000-0000-0000-000000000010', 'Negotiation',         7, FALSE, FALSE),
    ('00000000-0000-0000-0000-000000000010', 'Won',                 8, TRUE,  FALSE),
    ('00000000-0000-0000-0000-000000000010', 'Lost',                9, FALSE, TRUE);

-- =============================================================
-- SEED DATA: Default Scoring Config
-- =============================================================

INSERT INTO scoring_config (hot_min_score, warm_min_score, assignment_threshold, updated_by)
VALUES (70, 40, 70, '00000000-0000-0000-0000-000000000001');

-- =============================================================
-- SEED DATA: Default Scoring Rules
-- =============================================================

INSERT INTO scoring_rules (factor, weight, condition, score_value, created_by)
VALUES
    ('industry_relevance',  20, '{"match": "target_industry"}',          20, '00000000-0000-0000-0000-000000000001'),
    ('google_rating',       15, '{"gte": 4.0}',                          15, '00000000-0000-0000-0000-000000000001'),
    ('review_count',        10, '{"gte": 50}',                           10, '00000000-0000-0000-0000-000000000001'),
    ('has_website',         10, '{"exists": "website"}',                 10, '00000000-0000-0000-0000-000000000001'),
    ('social_presence',     10, '{"exists": "social_links"}',            10, '00000000-0000-0000-0000-000000000001'),
    ('source_reliability',  15, '{"source": ["google_business", "google_ads"]}', 15, '00000000-0000-0000-0000-000000000001'),
    ('previous_engagement', 20, '{"replied": true}',                     20, '00000000-0000-0000-0000-000000000001');

-- =============================================================
-- SEED DATA: Integration Registry
-- =============================================================

INSERT INTO integrations (name, display_name, is_enabled)
VALUES
    ('whatsapp',        'WhatsApp Cloud API',    FALSE),
    ('twilio',          'Twilio SMS',            FALSE),
    ('sendgrid',        'SendGrid Email',        FALSE),
    ('smtp',            'SMTP Server',           FALSE),
    ('google_sheets',   'Google Sheets',         FALSE),
    ('google_calendar', 'Google Calendar',       FALSE),
    ('outlook',         'Microsoft Outlook',     FALSE),
    ('slack',           'Slack',                 FALSE),
    ('teams',           'Microsoft Teams',       FALSE),
    ('crm',             'External CRM Platform', FALSE);

-- =============================================================
-- ENTITY RELATIONSHIP SUMMARY
-- =============================================================
--
-- users
--   ├── leads.assigned_to → users.id
--   ├── campaigns.created_by → users.id
--   ├── templates.created_by → users.id
--   ├── templates.approved_by → users.id
--   ├── outreach_sequences.created_by → users.id
--   ├── pipelines.created_by → users.id
--   ├── scoring_rules.created_by → users.id
--   ├── custom_field_definitions.created_by → users.id
--   ├── report_schedules.created_by → users.id
--   ├── refresh_tokens.user_id → users.id
--   └── audit_logs.user_id → users.id
--
-- pipelines
--   └── pipeline_stages.pipeline_id → pipelines.id
--
-- pipeline_stages
--   └── leads.pipeline_stage_id → pipeline_stages.id
--
-- campaigns
--   ├── campaigns.sequence_id → outreach_sequences.id
--   ├── campaigns.pipeline_id → pipelines.id
--   └── campaign_leads.campaign_id → campaigns.id
--
-- leads
--   ├── campaign_leads.lead_id → leads.id
--   └── outreach_logs.lead_id → leads.id
--
-- templates
--   └── outreach_logs.template_id → templates.id
--
-- outreach_sequences
--   └── campaigns.sequence_id → outreach_sequences.id
--       (steps JSONB references template_id values)
--
-- =============================================================

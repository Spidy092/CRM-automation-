/* eslint-disable camelcase */

/**
 * Migration: Initial Schema
 * Creates all ENUM types, tables, indexes, trigger function, and triggers
 * for the CRM Automation Platform (PostgreSQL 16).
 */

exports.up = (pgm) => {
  // ── Extensions ──────────────────────────────────────────────────────────────
  pgm.sql('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
  pgm.sql('CREATE EXTENSION IF NOT EXISTS "btree_gist"');

  // ── ENUM Types ───────────────────────────────────────────────────────────────
  pgm.createType('user_role', ['admin', 'manager', 'sales_rep', 'marketing']);
  pgm.createType('lead_classification', ['hot', 'warm', 'cold']);
  pgm.createType('lead_status', ['active', 'paused', 'won', 'lost', 'opted_out']);
  pgm.createType('campaign_status', ['draft', 'active', 'paused', 'completed', 'archived']);
  pgm.createType('outreach_tone', ['formal', 'professional', 'conversational']);
  pgm.createType('message_channel', ['whatsapp', 'email', 'sms', 'phone_call']);
  pgm.createType('outreach_status', [
    'queued', 'sent', 'delivered', 'opened', 'replied', 'failed', 'bounced',
  ]);
  pgm.createType('template_approval_status', ['pending', 'approved', 'rejected']);
  pgm.createType('custom_field_type', ['text', 'number', 'date', 'dropdown', 'checkbox']);
  pgm.createType('task_type', ['phone_call', 'follow_up', 'meeting_prep', 'other']);
  pgm.createType('task_status', ['pending', 'in_progress', 'completed', 'cancelled']);

  // ── TABLE: users ─────────────────────────────────────────────────────────────
  pgm.createTable('users', {
    id:            { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name:          { type: 'varchar(255)', notNull: true },
    email:         { type: 'varchar(255)', unique: true, notNull: true },
    password_hash: { type: 'varchar(255)', notNull: true },
    role:          { type: 'user_role', notNull: true, default: 'sales_rep' },
    is_available:  { type: 'boolean', notNull: true, default: true },
    is_active:     { type: 'boolean', notNull: true, default: true },
    created_at:    { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at:    { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.createIndex('users', 'email', { name: 'idx_users_email' });
  pgm.createIndex('users', 'role',  { name: 'idx_users_role' });
  pgm.sql(`
    CREATE INDEX idx_users_is_available ON users (is_available) WHERE is_active = TRUE
  `);

  // ── TABLE: refresh_tokens ────────────────────────────────────────────────────
  pgm.createTable('refresh_tokens', {
    id:         { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id:    { type: 'uuid', notNull: true, references: '"users"', onDelete: 'CASCADE' },
    token_hash: { type: 'varchar(255)', unique: true, notNull: true },
    expires_at: { type: 'timestamptz', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.createIndex('refresh_tokens', 'user_id',    { name: 'idx_refresh_tokens_user_id' });
  pgm.createIndex('refresh_tokens', 'expires_at', { name: 'idx_refresh_tokens_expires_at' });

  // ── TABLE: pipelines ─────────────────────────────────────────────────────────
  pgm.createTable('pipelines', {
    id:         { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name:       { type: 'varchar(255)', notNull: true },
    is_default: { type: 'boolean', notNull: true, default: false },
    created_by: { type: 'uuid', notNull: true, references: '"users"' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.sql(`
    CREATE UNIQUE INDEX idx_pipelines_default ON pipelines (is_default) WHERE is_default = TRUE
  `);

  // ── TABLE: pipeline_stages ───────────────────────────────────────────────────
  pgm.createTable('pipeline_stages', {
    id:               { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    pipeline_id:      { type: 'uuid', notNull: true, references: '"pipelines"', onDelete: 'CASCADE' },
    name:             { type: 'varchar(255)', notNull: true },
    position:         { type: 'integer', notNull: true },
    is_terminal_won:  { type: 'boolean', notNull: true, default: false },
    is_terminal_lost: { type: 'boolean', notNull: true, default: false },
    created_at:       { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at:       { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  }, {
    constraints: {
      unique_stage_position: 'UNIQUE (pipeline_id, position)',
    },
  });
  pgm.sql(`
    ALTER TABLE pipeline_stages
      ADD CONSTRAINT one_won_per_pipeline
        EXCLUDE USING btree (pipeline_id WITH =) WHERE (is_terminal_won = TRUE),
      ADD CONSTRAINT one_lost_per_pipeline
        EXCLUDE USING btree (pipeline_id WITH =) WHERE (is_terminal_lost = TRUE)
  `);
  pgm.createIndex('pipeline_stages', 'pipeline_id', { name: 'idx_pipeline_stages_pipeline_id' });

  // ── TABLE: custom_field_definitions ─────────────────────────────────────────
  pgm.createTable('custom_field_definitions', {
    id:          { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    label:       { type: 'varchar(255)', notNull: true },
    field_key:   { type: 'varchar(100)', unique: true, notNull: true },
    field_type:  { type: 'custom_field_type', notNull: true },
    options:     { type: 'jsonb' },
    is_required: { type: 'boolean', notNull: true, default: false },
    is_active:   { type: 'boolean', notNull: true, default: true },
    created_by:  { type: 'uuid', notNull: true, references: '"users"' },
    created_at:  { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at:  { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });

  // ── TABLE: leads ─────────────────────────────────────────────────────────────
  pgm.createTable('leads', {
    id:                { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    business_name:     { type: 'varchar(255)', notNull: true },
    contact_name:      { type: 'varchar(255)', notNull: true },
    phone:             { type: 'varchar(50)', notNull: true },
    email:             { type: 'varchar(255)', notNull: true },
    website:           { type: 'varchar(500)' },
    industry:          { type: 'varchar(100)', notNull: true },
    location:          { type: 'varchar(255)', notNull: true },
    country:           { type: 'varchar(100)' },
    google_rating:     { type: 'decimal(2,1)', check: 'google_rating >= 0 AND google_rating <= 5' },
    review_count:      { type: 'integer', check: 'review_count >= 0' },
    social_links:      { type: 'jsonb' },
    source_platform:   { type: 'varchar(100)', notNull: true },
    lead_score:        { type: 'integer', notNull: true, default: 0, check: 'lead_score >= 0 AND lead_score <= 100' },
    classification:    { type: 'lead_classification' },
    status:            { type: 'lead_status', notNull: true, default: 'active' },
    assigned_to:       { type: 'uuid', references: '"users"', onDelete: 'SET NULL' },
    pipeline_stage_id: { type: 'uuid', references: '"pipeline_stages"', onDelete: 'SET NULL' },
    custom_fields:     { type: 'jsonb', notNull: true, default: '{}' },
    tags:              { type: 'text[]', notNull: true, default: '{}' },
    notes:             { type: 'text' },
    created_at:        { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at:        { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.createIndex('leads', 'email',             { name: 'idx_leads_email' });
  pgm.createIndex('leads', 'phone',             { name: 'idx_leads_phone' });
  pgm.createIndex('leads', 'assigned_to',       { name: 'idx_leads_assigned_to' });
  pgm.createIndex('leads', 'status',            { name: 'idx_leads_status' });
  pgm.createIndex('leads', 'classification',    { name: 'idx_leads_classification' });
  pgm.createIndex('leads', 'source_platform',   { name: 'idx_leads_source_platform' });
  pgm.createIndex('leads', 'country',           { name: 'idx_leads_country' });
  pgm.createIndex('leads', 'industry',          { name: 'idx_leads_industry' });
  pgm.createIndex('leads', 'pipeline_stage_id', { name: 'idx_leads_pipeline_stage' });
  pgm.sql(`CREATE INDEX idx_leads_created_at ON leads (created_at DESC)`);
  pgm.sql(`CREATE INDEX idx_leads_tags ON leads USING GIN (tags)`);
  pgm.sql(`CREATE INDEX idx_leads_custom_fields ON leads USING GIN (custom_fields)`);
  // Dedup: email OR phone within the same source_platform (see TRD §8.3).
  // Email compared case-insensitively; phone must be E.164-normalized by the app.
  pgm.sql(`CREATE UNIQUE INDEX idx_leads_dedup_email ON leads (lower(email), source_platform)`);
  pgm.sql(`CREATE UNIQUE INDEX idx_leads_dedup_phone ON leads (phone, source_platform)`);

  // ── TABLE: scoring_config ────────────────────────────────────────────────────
  pgm.createTable('scoring_config', {
    id:                   { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    hot_min_score:        { type: 'integer', notNull: true, default: 70, check: 'hot_min_score >= 0 AND hot_min_score <= 100' },
    warm_min_score:       { type: 'integer', notNull: true, default: 40, check: 'warm_min_score >= 0 AND warm_min_score <= 100' },
    assignment_threshold: { type: 'integer', notNull: true, default: 70, check: 'assignment_threshold >= 0 AND assignment_threshold <= 100' },
    updated_by:           { type: 'uuid', references: '"users"' },
    updated_at:           { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.sql(`CREATE UNIQUE INDEX idx_scoring_config_singleton ON scoring_config ((TRUE))`);

  // ── TABLE: scoring_rules ─────────────────────────────────────────────────────
  pgm.createTable('scoring_rules', {
    id:          { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    factor:      { type: 'varchar(100)', notNull: true },
    weight:      { type: 'integer', notNull: true, check: 'weight >= 0 AND weight <= 100' },
    condition:   { type: 'jsonb', notNull: true },
    score_value: { type: 'integer', notNull: true, check: 'score_value >= 0 AND score_value <= 100' },
    is_active:   { type: 'boolean', notNull: true, default: true },
    created_by:  { type: 'uuid', notNull: true, references: '"users"' },
    created_at:  { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at:  { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.createIndex('scoring_rules', 'is_active', { name: 'idx_scoring_rules_is_active' });

  // ── TABLE: templates ─────────────────────────────────────────────────────────
  pgm.createTable('templates', {
    id:               { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name:             { type: 'varchar(255)', notNull: true },
    channel:          { type: 'message_channel', notNull: true },
    subject:          { type: 'varchar(500)' },
    body:             { type: 'text', notNull: true },
    variables:        { type: 'text[]', notNull: true, default: '{}' },
    approval_status:  { type: 'template_approval_status', notNull: true, default: 'pending' },
    approved_by:      { type: 'uuid', references: '"users"', onDelete: 'SET NULL' },
    approved_at:      { type: 'timestamptz' },
    rejection_reason: { type: 'text' },
    created_by:       { type: 'uuid', notNull: true, references: '"users"' },
    created_at:       { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at:       { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.createIndex('templates', 'channel',         { name: 'idx_templates_channel' });
  pgm.createIndex('templates', 'approval_status', { name: 'idx_templates_approval_status' });
  pgm.createIndex('templates', 'created_by',      { name: 'idx_templates_created_by' });

  // ── TABLE: outreach_sequences ────────────────────────────────────────────────
  pgm.createTable('outreach_sequences', {
    id:         { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name:       { type: 'varchar(255)', notNull: true },
    steps:      { type: 'jsonb', notNull: true, default: '[]' },
    created_by: { type: 'uuid', notNull: true, references: '"users"' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });

  // ── TABLE: campaigns ─────────────────────────────────────────────────────────
  pgm.createTable('campaigns', {
    id:                 { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name:               { type: 'varchar(255)', notNull: true },
    status:             { type: 'campaign_status', notNull: true, default: 'draft' },
    tone:               { type: 'outreach_tone', notNull: true, default: 'professional' },
    target_industries:  { type: 'text[]', notNull: true, default: '{}' },
    target_countries:   { type: 'text[]', notNull: true, default: '{}' },
    sequence_id:        { type: 'uuid', references: '"outreach_sequences"', onDelete: 'SET NULL' },
    pipeline_id:        { type: 'uuid', references: '"pipelines"', onDelete: 'SET NULL' },
    created_by:         { type: 'uuid', notNull: true, references: '"users"' },
    launched_at:        { type: 'timestamptz' },
    created_at:         { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at:         { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.createIndex('campaigns', 'status',     { name: 'idx_campaigns_status' });
  pgm.createIndex('campaigns', 'created_by', { name: 'idx_campaigns_created_by' });
  pgm.sql(`CREATE INDEX idx_campaigns_target_industries ON campaigns USING GIN (target_industries)`);
  pgm.sql(`CREATE INDEX idx_campaigns_target_countries ON campaigns USING GIN (target_countries)`);

  // ── TABLE: campaign_leads ────────────────────────────────────────────────────
  pgm.createTable('campaign_leads', {
    id:          { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    campaign_id: { type: 'uuid', notNull: true, references: '"campaigns"', onDelete: 'CASCADE' },
    lead_id:     { type: 'uuid', notNull: true, references: '"leads"', onDelete: 'CASCADE' },
    added_at:    { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  }, {
    constraints: {
      unique_campaign_lead: 'UNIQUE (campaign_id, lead_id)',
    },
  });
  pgm.createIndex('campaign_leads', 'campaign_id', { name: 'idx_campaign_leads_campaign_id' });
  pgm.createIndex('campaign_leads', 'lead_id',     { name: 'idx_campaign_leads_lead_id' });

  // ── TABLE: outreach_logs ─────────────────────────────────────────────────────
  pgm.createTable('outreach_logs', {
    id:              { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    lead_id:         { type: 'uuid', notNull: true, references: '"leads"', onDelete: 'CASCADE' },
    campaign_id:     { type: 'uuid', references: '"campaigns"', onDelete: 'SET NULL' },
    channel:         { type: 'message_channel', notNull: true },
    template_id:     { type: 'uuid', references: '"templates"', onDelete: 'SET NULL' },
    step_number:     { type: 'integer' },
    status:          { type: 'outreach_status', notNull: true, default: 'queued' },
    external_msg_id: { type: 'varchar(255)' },
    message_body:    { type: 'text' },
    sent_at:         { type: 'timestamptz' },
    delivered_at:    { type: 'timestamptz' },
    opened_at:       { type: 'timestamptz' },
    replied_at:      { type: 'timestamptz' },
    error_message:   { type: 'text' },
    created_at:      { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at:      { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.createIndex('outreach_logs', 'lead_id',     { name: 'idx_outreach_logs_lead_id' });
  pgm.createIndex('outreach_logs', 'campaign_id', { name: 'idx_outreach_logs_campaign_id' });
  pgm.createIndex('outreach_logs', 'status',      { name: 'idx_outreach_logs_status' });
  pgm.createIndex('outreach_logs', 'channel',     { name: 'idx_outreach_logs_channel' });
  pgm.sql(`CREATE INDEX idx_outreach_logs_sent_at ON outreach_logs (sent_at DESC)`);
  pgm.sql(`
    CREATE INDEX idx_outreach_logs_external_msg_id
      ON outreach_logs (external_msg_id) WHERE external_msg_id IS NOT NULL
  `);

  // ── TABLE: integrations ──────────────────────────────────────────────────────
  pgm.createTable('integrations', {
    id:                    { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name:                  { type: 'varchar(100)', unique: true, notNull: true },
    display_name:          { type: 'varchar(255)', notNull: true },
    is_enabled:            { type: 'boolean', notNull: true, default: false },
    encrypted_credentials: { type: 'text' },
    last_tested_at:        { type: 'timestamptz' },
    last_test_status:      { type: 'varchar(50)' },
    updated_by:            { type: 'uuid', references: '"users"' },
    updated_at:            { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });

  // ── TABLE: report_schedules ──────────────────────────────────────────────────
  pgm.createTable('report_schedules', {
    id:           { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name:         { type: 'varchar(255)', notNull: true },
    report_type:  { type: 'varchar(100)', notNull: true },
    frequency:    { type: 'varchar(50)', notNull: true, check: "frequency IN ('daily', 'weekly', 'monthly')" },
    target_roles: { type: 'user_role[]', notNull: true, default: '{}' },
    recipients:   { type: 'text[]', notNull: true, default: '{}' },
    is_active:    { type: 'boolean', notNull: true, default: true },
    last_run_at:  { type: 'timestamptz' },
    next_run_at:  { type: 'timestamptz' },
    created_by:   { type: 'uuid', notNull: true, references: '"users"' },
    created_at:   { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at:   { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.sql(`
    CREATE INDEX idx_report_schedules_next_run
      ON report_schedules (next_run_at) WHERE is_active = TRUE
  `);

  // ── TABLE: audit_logs ────────────────────────────────────────────────────────
  pgm.createTable('audit_logs', {
    id:          { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id:     { type: 'uuid', references: '"users"', onDelete: 'SET NULL' },
    action:      { type: 'varchar(100)', notNull: true },
    entity_type: { type: 'varchar(100)', notNull: true },
    entity_id:   { type: 'uuid' },
    old_value:   { type: 'jsonb' },
    new_value:   { type: 'jsonb' },
    ip_address:  { type: 'inet' },
    created_at:  { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.createIndex('audit_logs', 'user_id',                    { name: 'idx_audit_logs_user_id' });
  pgm.createIndex('audit_logs', ['entity_type', 'entity_id'], { name: 'idx_audit_logs_entity' });
  pgm.createIndex('audit_logs', 'action',                     { name: 'idx_audit_logs_action' });
  pgm.sql(`CREATE INDEX idx_audit_logs_created_at ON audit_logs (created_at DESC)`);

  // ── TABLE: tasks ─────────────────────────────────────────────────────────────
  // Manual tasks (e.g. phone_call sequence steps) assigned to a sales rep.
  pgm.createTable('tasks', {
    id:           { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    lead_id:      { type: 'uuid', notNull: true, references: '"leads"', onDelete: 'CASCADE' },
    campaign_id:  { type: 'uuid', references: '"campaigns"', onDelete: 'SET NULL' },
    sequence_id:  { type: 'uuid', references: '"outreach_sequences"', onDelete: 'SET NULL' },
    step_number:  { type: 'integer' },
    assigned_to:  { type: 'uuid', references: '"users"', onDelete: 'SET NULL' },
    type:         { type: 'task_type', notNull: true, default: 'phone_call' },
    title:        { type: 'varchar(255)', notNull: true },
    description:  { type: 'text' },
    due_at:       { type: 'timestamptz' },
    status:       { type: 'task_status', notNull: true, default: 'pending' },
    completed_at: { type: 'timestamptz' },
    created_by:   { type: 'uuid', references: '"users"', onDelete: 'SET NULL' },
    created_at:   { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at:   { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.createIndex('tasks', 'lead_id', { name: 'idx_tasks_lead_id' });
  pgm.createIndex('tasks', 'status',  { name: 'idx_tasks_status' });
  pgm.sql(`CREATE INDEX idx_tasks_assigned_to ON tasks (assigned_to) WHERE status IN ('pending', 'in_progress')`);
  pgm.sql(`CREATE INDEX idx_tasks_due_at ON tasks (due_at) WHERE status IN ('pending', 'in_progress')`);

  // ── Trigger Function: set_updated_at ─────────────────────────────────────────
  pgm.sql(`
    CREATE OR REPLACE FUNCTION set_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);

  const tablesWithUpdatedAt = [
    'users', 'leads', 'campaigns', 'templates', 'outreach_sequences',
    'outreach_logs', 'pipelines', 'pipeline_stages', 'scoring_rules',
    'custom_field_definitions', 'report_schedules', 'tasks',
  ];

  for (const table of tablesWithUpdatedAt) {
    pgm.sql(`
      CREATE TRIGGER trg_${table}_updated_at
        BEFORE UPDATE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    `);
  }
};

exports.down = (pgm) => {
  // Drop triggers first
  const tablesWithUpdatedAt = [
    'users', 'leads', 'campaigns', 'templates', 'outreach_sequences',
    'outreach_logs', 'pipelines', 'pipeline_stages', 'scoring_rules',
    'custom_field_definitions', 'report_schedules', 'tasks',
  ];
  for (const table of tablesWithUpdatedAt) {
    pgm.sql(`DROP TRIGGER IF EXISTS trg_${table}_updated_at ON ${table}`);
  }

  pgm.sql('DROP FUNCTION IF EXISTS set_updated_at()');

  // Drop tables in reverse dependency order
  pgm.dropTable('audit_logs');
  pgm.dropTable('tasks');
  pgm.dropTable('report_schedules');
  pgm.dropTable('integrations');
  pgm.dropTable('outreach_logs');
  pgm.dropTable('campaign_leads');
  pgm.dropTable('campaigns');
  pgm.dropTable('outreach_sequences');
  pgm.dropTable('templates');
  pgm.dropTable('scoring_rules');
  pgm.dropTable('scoring_config');
  pgm.dropTable('leads');
  pgm.dropTable('custom_field_definitions');
  pgm.dropTable('pipeline_stages');
  pgm.dropTable('pipelines');
  pgm.dropTable('refresh_tokens');
  pgm.dropTable('users');

  // Drop ENUMs
  pgm.dropType('task_status');
  pgm.dropType('task_type');
  pgm.dropType('custom_field_type');
  pgm.dropType('template_approval_status');
  pgm.dropType('outreach_status');
  pgm.dropType('message_channel');
  pgm.dropType('outreach_tone');
  pgm.dropType('campaign_status');
  pgm.dropType('lead_status');
  pgm.dropType('lead_classification');
  pgm.dropType('user_role');

  pgm.sql('DROP EXTENSION IF EXISTS "btree_gist"');
  pgm.sql('DROP EXTENSION IF EXISTS "pgcrypto"');
};

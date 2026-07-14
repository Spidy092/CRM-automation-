/**
 * Migration 0035: Email tracking, website forms, and A/B testing.
 *
 * - Adds click_url column to outreach_logs (email click tracking).
 * - Creates forms table (configurable web form capture).
 * - Creates form_submissions table (submission log + analytics).
 * - Creates campaign_variants table (A/B test variants).
 * - Creates variant_assignments table (lead→variant mapping).
 * - Creates variant_snapshots table (periodic metric snapshots for significance testing).
 */

exports.up = async (pgm) => {
  // ── 1. Email tracking: click_url on outreach_logs ──────────────────────
  pgm.addColumn('outreach_logs', {
    click_url: { type: 'text', notNull: false, default: null },
  });

  // ── 2. Website form capture ───────────────────────────────────────────
  pgm.createTable('forms', {
    id:              { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    name:            { type: 'varchar(255)', notNull: true },
    slug:            { type: 'varchar(100)', notNull: true, unique: true },
    description:     { type: 'text' },
    fields:          { type: 'jsonb', notNull: true, default: '[]' },
    submit_action:   { type: 'varchar(50)', notNull: true, default: 'create_lead' },
    submit_message:  { type: 'text', notNull: true, default: 'Thank you for your submission!' },
    redirect_url:    { type: 'varchar(500)' },
    is_active:       { type: 'boolean', notNull: true, default: true },
    theme:           { type: 'jsonb', notNull: true, default: '{}' },
    created_by:      { type: 'uuid', notNull: true, references: '"users"', onDelete: 'SET NULL' },
    created_at:      { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at:      { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });

  pgm.createIndex('forms', 'slug', { unique: true });
  pgm.createIndex('forms', 'is_active');
  pgm.createIndex('forms', 'created_by');

  pgm.createTable('form_submissions', {
    id:              { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    form_id:         { type: 'uuid', notNull: true, references: '"forms"', onDelete: 'CASCADE' },
    lead_id:         { type: 'uuid', references: '"leads"', onDelete: 'SET NULL' },
    data:            { type: 'jsonb', notNull: true, default: '{}' },
    ip_address:      { type: 'varchar(45)' },
    user_agent:      { type: 'text' },
    referrer:        { type: 'varchar(500)' },
    status:          { type: 'varchar(20)', notNull: true, default: 'submitted' },
    created_at:      { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });

  pgm.createIndex('form_submissions', 'form_id');
  pgm.createIndex('form_submissions', 'lead_id');
  pgm.createIndex('form_submissions', 'created_at');
  pgm.createIndex('form_submissions', ['form_id', 'created_at']);

  // ── 3. A/B testing for campaigns ──────────────────────────────────────
  pgm.createTable('campaign_variants', {
    id:              { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    campaign_id:     { type: 'uuid', notNull: true, references: '"campaigns"', onDelete: 'CASCADE' },
    name:            { type: 'varchar(100)', notNull: true },
    variant_key:     { type: 'varchar(10)', notNull: true },
    template_id:     { type: 'uuid', references: '"templates"', onDelete: 'SET NULL' },
    split_pct:       { type: 'integer', notNull: true, default: 50, check: 'split_pct >= 1 AND split_pct <= 100' },
    is_winner:       { type: 'boolean', notNull: true, default: false },
    status:          { type: 'varchar(20)', notNull: true, default: 'active' },
    created_at:      { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at:      { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });

  pgm.createIndex('campaign_variants', 'campaign_id');
  pgm.createIndex('campaign_variants', ['campaign_id', 'variant_key'], { unique: true });

  pgm.createTable('variant_assignments', {
    id:              { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    variant_id:      { type: 'uuid', notNull: true, references: '"campaign_variants"', onDelete: 'CASCADE' },
    lead_id:         { type: 'uuid', notNull: true, references: '"leads"', onDelete: 'CASCADE' },
    assigned_at:     { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });

  pgm.createIndex('variant_assignments', 'variant_id');
  pgm.createIndex('variant_assignments', 'lead_id');
  pgm.createIndex('variant_assignments', ['variant_id', 'lead_id'], { unique: true });

  pgm.createTable('variant_snapshots', {
    id:              { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    variant_id:      { type: 'uuid', notNull: true, references: '"campaign_variants"', onDelete: 'CASCADE' },
    sent:            { type: 'integer', notNull: true, default: 0 },
    delivered:       { type: 'integer', notNull: true, default: 0 },
    opened:          { type: 'integer', notNull: true, default: 0 },
    clicked:         { type: 'integer', notNull: true, default: 0 },
    replied:         { type: 'integer', notNull: true, default: 0 },
    failed:          { type: 'integer', notNull: true, default: 0 },
    open_rate:       { type: 'numeric(5,2)', notNull: true, default: 0 },
    click_rate:      { type: 'numeric(5,2)', notNull: true, default: 0 },
    reply_rate:      { type: 'numeric(5,2)', notNull: true, default: 0 },
    snapshot_at:     { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });

  pgm.createIndex('variant_snapshots', 'variant_id');
  pgm.createIndex('variant_snapshots', ['variant_id', 'snapshot_at']);

  // ── 4. Add ab_test_enabled to campaigns ───────────────────────────────
  pgm.addColumn('campaigns', {
    ab_test_enabled:      { type: 'boolean', notNull: true, default: false },
    ab_test_metric:       { type: 'varchar(30)', notNull: true, default: 'open_rate' },
    ab_test_min_samples:  { type: 'integer', notNull: true, default: 100 },
    ab_test_confidence:   { type: 'numeric(4,2)', notNull: true, default: 95.00 },
    ab_test_auto_promote: { type: 'boolean', notNull: true, default: true },
  });
};

exports.down = async (pgm) => {
  pgm.dropColumn('campaigns', 'ab_test_auto_promote');
  pgm.dropColumn('campaigns', 'ab_test_confidence');
  pgm.dropColumn('campaigns', 'ab_test_min_samples');
  pgm.dropColumn('campaigns', 'ab_test_metric');
  pgm.dropColumn('campaigns', 'ab_test_enabled');
  pgm.dropTable('variant_snapshots');
  pgm.dropTable('variant_assignments');
  pgm.dropTable('campaign_variants');
  pgm.dropTable('form_submissions');
  pgm.dropTable('forms');
  pgm.dropColumn('outreach_logs', 'click_url');
};

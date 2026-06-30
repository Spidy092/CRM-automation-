/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = function (pgm) {
  pgm.createTable('agent_plans', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    conversation_id: { type: 'text' },
    goal: { type: 'text', notNull: true },
    status: { type: 'varchar(40)', notNull: true },
    autonomy_level: { type: 'varchar(20)' },
    confidence: { type: 'integer' },
    source: { type: 'varchar(50)', notNull: true },
    requested_by: { type: 'uuid', references: '"users"', onDelete: 'SET NULL' },
    source_message: { type: 'text' },
    cost_cap_cents: { type: 'integer', notNull: true, default: 50 },
    step_cap: { type: 'integer', notNull: true, default: 8 },
    cost_used_cents: { type: 'integer', notNull: true, default: 0 },
    deadline_at: { type: 'timestamptz' },
    started_at: { type: 'timestamptz' },
    completed_at: { type: 'timestamptz' },
    expires_at: { type: 'timestamptz' },
    error_message: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    idempotency_key: { type: 'varchar(255)', notNull: true, unique: true },
  });

  pgm.createTable('agent_plan_steps', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    plan_id: { type: 'uuid', notNull: true, references: '"agent_plans"', onDelete: 'CASCADE' },
    step_index: { type: 'integer', notNull: true },
    action_name: { type: 'varchar(100)', notNull: true },
    action_args: { type: 'jsonb', notNull: true, default: '{}' },
    risk_tier: { type: 'varchar(40)', notNull: true },
    depends_on: { type: 'integer[]', notNull: true, default: '{}' },
    rationale: { type: 'text', notNull: true },
    status: { type: 'varchar(40)', notNull: true, default: 'pending' },
    agent_action_id: { type: 'uuid', references: '"agent_actions"', onDelete: 'SET NULL' },
    result: { type: 'jsonb' },
    error_message: { type: 'text' },
    started_at: { type: 'timestamptz' },
    completed_at: { type: 'timestamptz' },
  });

  pgm.addConstraint('agent_plans', 'agent_plans_status_check',
    "CHECK (status IN ('proposed', 'approved', 'running', 'paused_for_approval', 'succeeded', 'failed', 'cancelled', 'expired'))");
  pgm.addConstraint('agent_plan_steps', 'agent_plan_steps_status_check',
    "CHECK (status IN ('pending', 'running', 'pending_approval', 'succeeded', 'failed', 'skipped', 'cancelled'))");
  pgm.addConstraint('agent_plan_steps', 'agent_plan_steps_risk_tier_check',
    "CHECK (risk_tier IN ('read', 'low_risk_write', 'sensitive_write', 'customer_facing_write'))");
  pgm.addConstraint('agent_plan_steps', 'agent_plan_steps_step_index_check',
    'CHECK (step_index >= 0)');

  pgm.createIndex('agent_plans', 'status');
  pgm.createIndex('agent_plans', ['status', 'created_at'], { order: { created_at: 'DESC' } });
  pgm.createIndex('agent_plans', 'requested_by');
  pgm.createIndex('agent_plans', 'conversation_id');
  pgm.createIndex('agent_plan_steps', 'plan_id');

  pgm.addColumn('agent_actions', {
    agent_plan_id: { type: 'uuid', references: '"agent_plans"', onDelete: 'SET NULL' },
    agent_plan_step_id: { type: 'uuid', references: '"agent_plan_steps"', onDelete: 'SET NULL' },
  });
  pgm.createIndex('agent_actions', 'agent_plan_id');
  pgm.createIndex('agent_actions', 'agent_plan_step_id');

  pgm.addColumn('ai_inbox_items', {
    agent_plan_id: { type: 'uuid', references: '"agent_plans"', onDelete: 'SET NULL' },
    agent_plan_step_id: { type: 'uuid', references: '"agent_plan_steps"', onDelete: 'SET NULL' },
  });
  pgm.createIndex('ai_inbox_items', 'agent_plan_id');
  pgm.createIndex('ai_inbox_items', 'agent_plan_step_id');
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = function (pgm) {
  // Reverse step 5: ai_inbox_items indexes + columns
  pgm.dropIndex('ai_inbox_items', 'agent_plan_step_id');
  pgm.dropIndex('ai_inbox_items', 'agent_plan_id');
  pgm.dropColumns('ai_inbox_items', ['agent_plan_id', 'agent_plan_step_id']);

  // Reverse step 4: agent_actions indexes + columns
  pgm.dropIndex('agent_actions', 'agent_plan_step_id');
  pgm.dropIndex('agent_actions', 'agent_plan_id');
  pgm.dropColumns('agent_actions', ['agent_plan_id', 'agent_plan_step_id']);

  // Reverse step 3: agent_plans and agent_plan_steps indexes
  pgm.dropIndex('agent_plan_steps', 'plan_id');
  pgm.dropIndex('agent_plans', 'conversation_id');
  pgm.dropIndex('agent_plans', 'requested_by');
  pgm.dropIndex('agent_plans', ['status', 'created_at']);
  pgm.dropIndex('agent_plans', 'status');

  // Reverse step 1: tables (constraints drop automatically with tables)
  pgm.dropTable('agent_plan_steps');
  pgm.dropTable('agent_plans');
};

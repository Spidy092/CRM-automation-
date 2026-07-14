/**
 * Migration 0031 — Add trigger_stage_id to campaigns
 *
 * Adds a nullable FK from campaigns → pipeline_stages so that a campaign
 * can declare a specific pipeline stage that auto-triggers lead enrollment.
 *
 * Campaigns with trigger_stage_id = NULL and a pipeline_id set retain the
 * existing behaviour: enroll on ANY stage move within that pipeline.
 */
exports.up = async (pgm) => {
  pgm.addColumn('campaigns', {
    trigger_stage_id: {
      type: 'uuid',
      notNull: false,
      default: null,
      references: '"pipeline_stages"',
      onDelete: 'SET NULL',
    },
  });

  pgm.createIndex('campaigns', 'trigger_stage_id', {
    name: 'idx_campaigns_trigger_stage',
    where: 'trigger_stage_id IS NOT NULL',
  });
};

exports.down = async (pgm) => {
  pgm.dropIndex('campaigns', 'trigger_stage_id', {
    name: 'idx_campaigns_trigger_stage',
    ifExists: true,
  });
  pgm.dropColumn('campaigns', 'trigger_stage_id');
};

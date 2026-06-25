exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE pipeline_stages
      DROP CONSTRAINT IF EXISTS one_won_per_pipeline,
      DROP CONSTRAINT IF EXISTS one_lost_per_pipeline;
    ALTER TABLE pipeline_stages
      ADD CONSTRAINT one_won_per_pipeline
        EXCLUDE USING gist (pipeline_id WITH =) WHERE (is_terminal_won = TRUE),
      ADD CONSTRAINT one_lost_per_pipeline
        EXCLUDE USING gist (pipeline_id WITH =) WHERE (is_terminal_lost = TRUE);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE pipeline_stages
      DROP CONSTRAINT IF EXISTS one_won_per_pipeline,
      DROP CONSTRAINT IF EXISTS one_lost_per_pipeline;
  `);
};

/* eslint-disable camelcase */

/**
 * Migration: Add `webhook_url` and `group_name` to scraper_configs.
 *
 * Why: `scraper.repository.ts` selects both columns unconditionally (CONFIG_COLS),
 * and the scraper service fires an outbound webhook on run completion, so every
 * /api/v1/scraper request fails with `column "webhook_url" does not exist` until
 * these exist.
 *
 * Note: this file previously used the sequelize-cli shape
 * (`module.exports = { async up(queryInterface, Sequelize) }`), which
 * node-pg-migrate cannot execute — it looks for an exported `up`. The migration
 * therefore never applied and the columns were never created. Rewritten here in
 * the node-pg-migrate style used by every other migration in this directory
 * (see 1750000000066 / 1750000000067). Safe to rewrite rather than supersede
 * because it has never run successfully against any database.
 *
 * Both columns are nullable with no default: existing sources have no webhook
 * and no group, and both are optional features.
 */

exports.up = (pgm) => {
  pgm.addColumns('scraper_configs', {
    webhook_url: { type: 'varchar(2048)', notNull: false, default: null },
    group_name: { type: 'varchar(255)', notNull: false, default: null },
  });

  // Grouping is used to filter/sort the source list; index only the rows that
  // actually carry a group.
  pgm.createIndex('scraper_configs', 'group_name', {
    where: 'group_name IS NOT NULL',
    name: 'idx_scraper_configs_group_name',
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('scraper_configs', 'group_name', {
    name: 'idx_scraper_configs_group_name',
    ifExists: true,
  });
  pgm.dropColumns('scraper_configs', ['webhook_url', 'group_name']);
};

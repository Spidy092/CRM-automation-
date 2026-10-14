/**
 * Migration 0073: template design system.
 *
 * Extends `templates` with the email design-system columns. All columns are
 * nullable / defaulted so existing simple templates keep working unchanged:
 *
 *   - editor_mode  — 'simple' (legacy default) | 'visual' | 'html'.
 *                    Non-email channels always use 'simple'.
 *   - design       — versioned visual-design document (JSONB, visual mode
 *                    only). The editable source of truth; reopening a template
 *                    never depends on reverse-engineering HTML.
 *   - html_body    — deterministic rendered email HTML (visual) or sanitized
 *                    custom HTML (html mode). Consumed by the delivery path.
 *   - text_body    — plain-text alternative generated alongside html_body.
 *   - preheader    — email preheader text (email channel only).
 *   - archived_at  — soft archive for the gallery (archived templates are
 *                    hidden from pickers but remain readable).
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = function (pgm) {
  pgm.addColumn('templates', {
    editor_mode: { type: 'varchar(16)', notNull: true, default: 'simple' },
    design: { type: 'jsonb' },
    html_body: { type: 'text' },
    text_body: { type: 'text' },
    preheader: { type: 'varchar(300)' },
    archived_at: { type: 'timestamptz' },
  });

  pgm.createIndex('templates', 'editor_mode', { name: 'idx_templates_editor_mode' });
  pgm.createIndex('templates', 'archived_at', { name: 'idx_templates_archived_at' });

  pgm.sql(`
    ALTER TABLE templates
    ADD CONSTRAINT templates_editor_mode_check
    CHECK (editor_mode IN ('simple', 'visual', 'html'))
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = function (pgm) {
  pgm.sql('ALTER TABLE templates DROP CONSTRAINT IF EXISTS templates_editor_mode_check');
  pgm.dropIndex('templates', undefined, { name: 'idx_templates_archived_at' });
  pgm.dropIndex('templates', undefined, { name: 'idx_templates_editor_mode' });
  pgm.dropColumn('templates', 'archived_at');
  pgm.dropColumn('templates', 'preheader');
  pgm.dropColumn('templates', 'text_body');
  pgm.dropColumn('templates', 'html_body');
  pgm.dropColumn('templates', 'design');
  pgm.dropColumn('templates', 'editor_mode');
};

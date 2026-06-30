/**
 * Migration: 1750000000028 — AI Decision Log Agent Types
 *
 * Extends the append-only AI decision audit trail to include chat/tool routing
 * and agent action proposal/execution decisions.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = function (pgm) {
  pgm.dropConstraint('ai_decision_log', 'ai_decision_log_decision_type_check');
  pgm.addConstraint('ai_decision_log', 'ai_decision_log_decision_type_check',
    "CHECK (decision_type IN ('research', 'next_action', 'reply_classify', 'campaign_brief', 'chat', 'agent_action'))");
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = function (pgm) {
  pgm.dropConstraint('ai_decision_log', 'ai_decision_log_decision_type_check');
  pgm.addConstraint('ai_decision_log', 'ai_decision_log_decision_type_check',
    "CHECK (decision_type IN ('research', 'next_action', 'reply_classify', 'campaign_brief'))");
};

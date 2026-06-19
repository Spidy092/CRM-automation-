/* eslint-disable camelcase */

/**
 * Migration: Seed — Scoring Config & Scoring Rules
 * Inserts the default lead scoring configuration and the 7 default scoring rules.
 *
 * Scoring thresholds:
 *   Hot  >= 70 | Warm >= 40 | Assignment threshold >= 70
 *
 * Scoring rules total max: 100 points
 *   industry_relevance  20 pts
 *   google_rating       15 pts
 *   review_count        10 pts
 *   has_website         10 pts
 *   social_presence     10 pts
 *   source_reliability  15 pts
 *   previous_engagement 20 pts
 */

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000001';

exports.up = (pgm) => {
  // Scoring config (singleton row)
  pgm.sql(`
    INSERT INTO scoring_config (hot_min_score, warm_min_score, assignment_threshold, updated_by)
    VALUES (70, 40, 70, '${SYSTEM_USER_ID}')
    ON CONFLICT DO NOTHING
  `);

  // Default scoring rules
  pgm.sql(`
    INSERT INTO scoring_rules (factor, weight, condition, score_value, created_by)
    VALUES
      ('industry_relevance',  20, '{"match": "target_industry"}',                    20, '${SYSTEM_USER_ID}'),
      ('google_rating',       15, '{"gte": 4.0}',                                    15, '${SYSTEM_USER_ID}'),
      ('review_count',        10, '{"gte": 50}',                                     10, '${SYSTEM_USER_ID}'),
      ('has_website',         10, '{"exists": "website"}',                           10, '${SYSTEM_USER_ID}'),
      ('social_presence',     10, '{"exists": "social_links"}',                      10, '${SYSTEM_USER_ID}'),
      ('source_reliability',  15, '{"source": ["google_business", "google_ads"]}',   15, '${SYSTEM_USER_ID}'),
      ('previous_engagement', 20, '{"replied": true}',                               20, '${SYSTEM_USER_ID}')
    ON CONFLICT DO NOTHING
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM scoring_rules
    WHERE created_by = '${SYSTEM_USER_ID}'
      AND factor IN (
        'industry_relevance', 'google_rating', 'review_count',
        'has_website', 'social_presence', 'source_reliability', 'previous_engagement'
      )
  `);

  pgm.sql(`DELETE FROM scoring_config`);
};

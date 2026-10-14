/** Missing contacts are empty, not invented email addresses. Review before applying. */
exports.up = (pgm) => {
  pgm.sql("DROP INDEX idx_leads_dedup_email");
  pgm.sql("DROP INDEX idx_leads_dedup_phone");
  pgm.sql(`CREATE UNIQUE INDEX idx_leads_dedup_email ON leads (lower(email), source_platform)
    WHERE deleted_at IS NULL AND google_place_id IS NULL AND length(trim(email)) > 0`);
  pgm.sql(`CREATE UNIQUE INDEX idx_leads_dedup_phone ON leads (phone, source_platform)
    WHERE deleted_at IS NULL AND google_place_id IS NULL AND length(trim(phone)) > 0`);
};

// Reintroducing uniqueness on empty contacts can fail after valid captures.
// Deliberately require an explicit data review instead of a destructive rollback.
exports.down = () => {
  throw new Error(
    "Review empty contact records before restoring the old unique indexes.",
  );
};

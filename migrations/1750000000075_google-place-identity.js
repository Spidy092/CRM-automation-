/** Google business identity and contact provenance. Review before applying. */
exports.up = (pgm) => {
  pgm.addColumns("leads", {
    google_place_id: { type: "varchar(255)" },
    google_contact_provenance: { type: "jsonb" },
  });
  pgm.sql(`ALTER TABLE leads ADD CONSTRAINT leads_google_identity_source
    CHECK (google_place_id IS NULL OR (source_platform = 'google_business' AND length(google_place_id) > 0))`);
  pgm.sql(`CREATE UNIQUE INDEX idx_leads_google_place_id ON leads (google_place_id)
    WHERE deleted_at IS NULL AND google_place_id IS NOT NULL`);
  // Contact uniqueness still applies to every lead without a provider identity.
  pgm.sql("DROP INDEX idx_leads_dedup_email");
  pgm.sql("DROP INDEX idx_leads_dedup_phone");
  pgm.sql(`CREATE UNIQUE INDEX idx_leads_dedup_email ON leads (lower(email), source_platform)
    WHERE deleted_at IS NULL AND google_place_id IS NULL`);
  pgm.sql(`CREATE UNIQUE INDEX idx_leads_dedup_phone ON leads (phone, source_platform)
    WHERE deleted_at IS NULL AND google_place_id IS NULL`);
};

exports.down = () => {
  // Shared-contact branches make restoring the old indexes unsafe without reconciliation.
  throw new Error(
    "Forward-only migration: reconcile shared contacts before preparing a rollback.",
  );
};

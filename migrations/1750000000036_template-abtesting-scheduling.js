/**
 * Migration 0036: Template A/B Testing + Meeting Scheduling
 *
 * Template A/B Testing:
 *   - template_variants: A/B test variants attached to individual templates
 *   - template_variant_assignments: lead-to-variant assignments for template tests
 *
 * Meeting Scheduling:
 *   - user_availability: weekly availability slots per user
 *   - booking_urls: public booking pages per user
 *   - bookings: scheduled meetings
 */

exports.up = async function up(pgm) {
  // ── Template A/B Testing ──────────────────────────────────────────────

  await pgm.sql(`
    CREATE TABLE IF NOT EXISTS template_variants (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      template_id UUID NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      name VARCHAR(100) NOT NULL,
      variant_key VARCHAR(10) NOT NULL,
      subject VARCHAR(200),
      body TEXT NOT NULL,
      split_pct INTEGER NOT NULL DEFAULT 50,
      is_winner BOOLEAN NOT NULL DEFAULT false,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(template_id, variant_key)
    );

    CREATE INDEX IF NOT EXISTS idx_template_variants_template_id ON template_variants(template_id);
  `);

  await pgm.sql(`
    CREATE TABLE IF NOT EXISTS template_variant_assignments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      variant_id UUID NOT NULL REFERENCES template_variants(id) ON DELETE CASCADE,
      lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(variant_id, lead_id)
    );

    CREATE INDEX IF NOT EXISTS idx_template_variant_assignments_variant ON template_variant_assignments(variant_id);
    CREATE INDEX IF NOT EXISTS idx_template_variant_assignments_lead ON template_variant_assignments(lead_id);
  `);

  // ── Meeting Scheduling ────────────────────────────────────────────────

  await pgm.sql(`
    CREATE TABLE IF NOT EXISTS user_availability (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
      start_time VARCHAR(5) NOT NULL,
      end_time VARCHAR(5) NOT NULL,
      slot_duration_min INTEGER NOT NULL DEFAULT 30,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_user_availability_user ON user_availability(user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_availability_unique_slot
      ON user_availability(user_id, day_of_week, start_time);
  `);

  await pgm.sql(`
    CREATE TABLE IF NOT EXISTS booking_urls (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      slug VARCHAR(100) NOT NULL UNIQUE,
      title VARCHAR(200) NOT NULL,
      description TEXT,
      location_type VARCHAR(20) NOT NULL DEFAULT 'google_meet',
      location_details TEXT,
      buffer_before_min INTEGER NOT NULL DEFAULT 0,
      buffer_after_min INTEGER NOT NULL DEFAULT 0,
      max_advance_days INTEGER NOT NULL DEFAULT 30,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_booking_urls_user ON booking_urls(user_id);
  `);

  await pgm.sql(`
    CREATE TABLE IF NOT EXISTS bookings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      booking_url_id UUID NOT NULL REFERENCES booking_urls(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
      booker_name VARCHAR(200) NOT NULL,
      booker_email VARCHAR(200) NOT NULL,
      booker_phone VARCHAR(30),
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'confirmed',
      meeting_url TEXT,
      notes TEXT,
      google_event_id VARCHAR(200),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
    CREATE INDEX IF NOT EXISTS idx_bookings_url ON bookings(booking_url_id);
    CREATE INDEX IF NOT EXISTS idx_bookings_lead ON bookings(lead_id);
    CREATE INDEX IF NOT EXISTS idx_bookings_starts ON bookings(starts_at);
    CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
  `);
};

exports.down = async function down(pgm) {
  await pgm.sql(`DROP TABLE IF EXISTS bookings CASCADE`);
  await pgm.sql(`DROP TABLE IF EXISTS booking_urls CASCADE`);
  await pgm.sql(`DROP TABLE IF EXISTS user_availability CASCADE`);
  await pgm.sql(`DROP TABLE IF EXISTS template_variant_assignments CASCADE`);
  await pgm.sql(`DROP TABLE IF EXISTS template_variants CASCADE`);
};

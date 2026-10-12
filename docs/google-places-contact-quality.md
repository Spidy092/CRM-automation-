# Google Places contact quality and identity

Google search imports persist `google_place_id` and `google_contact_provenance`.
The provenance describes contact sources at import time: standard-mode email is
`placeholder`; AI agent mode can record an observed `website` email. Phone is
`google_places` or `placeholder`. These are internal
fields, excluded from public lead create/update schemas, and exposed in lead
responses. A provider phone is observed contact data, not verified ownership.

Missing email uses a SHA-256-derived address under `google-scraped.local`,
including when a website exists. Missing phone remains clearly synthetic (`+0…`)
to preserve the existing required contact fields. Outreach blocks these values.
It also blocks legacy `no-reply@…` emails for `google_business` leads in both
sequence dispatch and AI reply dispatch.

Identified Google businesses deduplicate by place ID instead of contacts.
Branches may share phones or domains. All other leads retain email/phone
uniqueness. A partial unique place-ID index protects concurrent imports;
its uniqueness violation is reported as a duplicate, rather than a failed item.
The scraper resolves duplicate IDs through the leads service boundary.

## Migration review and rollout

Review `migrations/1750000000075_google-place-identity.js` before applying it.
It adds nullable identity/provenance columns, constrains provider identities to
Google business leads, adds a partial unique place-ID index, and replaces the
contact uniqueness indexes with indexes for leads without a provider identity.
It does not rewrite or delete lead data. Index changes may lock the table;
plan an appropriate maintenance window. Apply the migration before starting
the updated API and workers because lead queries select the new columns.
No migration was run during implementation.

This migration is forward-only: shared-contact branches could prevent safe
restoration of the old indexes. A rollback requires reconciliation and a new
reviewed migration.

Historical leads remain without identity/provenance. A new identified import
can coexist with a historical unidentified lead. Review historical Google leads
before scheduling new imports; do not infer place identity from a shared phone
or domain. No automatic historical merge/backfill is included.

## Validation

Focused tests cover placeholder generation, distinct shared-contact branches,
place-ID lookups despite changed contacts, concurrent unique violations, and
outreach rejection of new and legacy synthetic emails. These are unit tests;
actual PostgreSQL index behavior and Google API calls require staging validation
following migration approval. No credential files or live vendor APIs were used.

# Google Places scraper AI agent

The AI agent runs inside the existing Google Places scraper. It uses the same
Run Now button, BullMQ worker, schedules, admin permissions, run history, and
lead-import service. No separate chat agent or agent framework is required.

## Configure and run

1. Apply reviewed migration 0075 before deploying this code. That migration adds
   Google place identity and contact provenance; it remains unrun by this agent.
2. Enable AI settings and configure a Chat Completions model with function calling,
   using the existing AI settings screen. The implementation uses the installed
   OpenAI SDK and the configured model/base URL. GPT-4o matches the project stack;
   it does not change your configured model.
3. Add or edit a Google Places source. New sources enable **AI research agent** by
   default; existing source configurations remain in standard mode until enabled.
4. Enter search queries, an optional natural-language research goal, location,
   radius, and maximum results. Location is required in AI mode. Coordinates work
   without geocoding; a place name requires Google Geocoding to resolve successfully.
5. Set AI rounds and external-request limits, then save and use the existing run
   controls. Disable the agent toggle to use the deterministic scraper.

Example goal: “Find dental clinics with public business contacts and evidence of
online appointment booking.” Search queries can be “dentist” and “dental clinic.”
Use the intended city/neighborhood or coordinates and a radius for the search area.

## Agent workflow

The model can call five allowlisted tools:

- `search_places`: chooses keyword variations and observes businesses returned by
  Google. Code filters results to the configured geographic radius.
- `get_place_details`: fetches observed phone and website data for a previously
  discovered place ID.
- `inspect_website`: reads the observed website homepage and `/contact` page when
  permitted by the website's robots rules; extracts public emails from links/text.
- `select_candidates`: chooses previously observed and researched IDs with a short
  qualification reason. It cannot provide arbitrary lead records or contact values.
- `finish`: supplies the final assessment and completes discovery.

The model receives tool results, can refine searches, and can select businesses
in batches. Phone/email destinations stay out of model tool results; the model
sees whether they exist. Public business names, addresses, ratings, and bounded
website evidence are used for qualification. Website evidence may itself include
public contact text. Reasons and summary are model assessments, not verified facts.

Import starts only after successful finish. The deterministic import service
uses observed contacts, generates clearly synthetic placeholders where needed,
validates email domains, and deduplicates by place ID. Import failures remain
per-item failures under the existing importer; this is not an atomic all-or-nothing
transaction across the selected leads. Research/model failures never start import.

## Limits and diagnostics

Defaults: 12 AI rounds, 80 external requests, 20 selected leads, and a three-minute
research deadline. Configurable caps: 20 rounds, 150 requests, and 50 selected leads.
There is also a 64-tool-call ceiling, a 50-observed-candidate ceiling, and a bounded
64,000-character conversation context. Each completion uses at most 500 output
tokens. Model SDK retries are disabled; existing worker transient-failure retries
still apply and may repeat billable requests. Limits apply per attempt, not per
logical job across all retries, and are not a dollar-spend guarantee.

Each keyword search uses the first Google result page (up to 20 businesses).
The agent can refine keywords; it does not promise exhaustive area coverage or
paginate the entire Google directory. Website inspection handles HTML without
JavaScript execution, and declines redirects rather than following them. This
can leave evidence unavailable on sites that redirect or require browser rendering.

Run history displays the AI assessment. `scraper_logs.raw_response.agent` records
rounds, tool-call count, external requests, selection reasons, and email evidence
page URLs. Model calls log token usage and latency with the scraper log ID. Website
failures are reported as missing evidence; provider/model failures and exhausted
budgets fail the run without importing partial research.

## Security and rollout

- The model cannot change credentials, tools, search radius, limits, or permissions.
- Tool arguments are Zod-validated. Unknown tools, invented IDs, and unresearched
  selections fail closed.
- Website URLs originate from Google details, never arbitrary model input. Fetches
  validate public destinations, pin DNS results, reject private/mapped/multicast
  addresses and credentials, enforce time/body-size limits, and do not follow redirects.
- Robots handling is conservative: matching disallow rules block inspection even
  when written for another bot. Unavailable robots policy prevents inspection.
- Website text is untrusted evidence, not authority to run commands or send outreach.
- Model/vendor failures are sanitized before persistence. Google API keys are never
  part of model messages or generated photo URLs.
- Existing import/outreach protections remain. Public write schemas cannot supply
  Google provenance; contact provenance describes what was observed at import time.
- Historical Google leads need reconciliation because older records lack place IDs.
  See `google-places-contact-quality.md` before scheduling new imports.
- Review Google Places storage/attribution requirements before production rollout.
  The implementation keeps existing legacy Places endpoints; projects unable to use
  that API need a separately reviewed Places API (New) migration.

## Validation

Unit tests cover adaptive searches, observed contact extraction, geographic
filtering, DNS pinning, robots exclusions, blocked redirects, credential redaction,
invalid tools/IDs, duplicate requests, failure before import, and resource limits.
Frontend tests cover the new-source default and switching to standard mode.
Live Google/model calls and PostgreSQL index behavior must be verified in staging
following migration approval; no live vendor calls or migrations were run here.

References:
- OpenAI function calling: https://developers.openai.com/api/docs/guides/function-calling
- Google legacy Text Search: https://developers.google.com/maps/documentation/places/web-service/legacy/search-text
- Google legacy Place Details: https://developers.google.com/maps/documentation/places/web-service/legacy/details
- Google Places policies: https://developers.google.com/maps/documentation/places/web-service/policies

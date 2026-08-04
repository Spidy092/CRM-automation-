# Scraper Module — Audit Report

**Date:** 2026-08-03
**Scope:** `backend/src/modules/scraper/`, `backend/src/workers/scraper.worker.ts`, `backend/src/workers/scraper` queue + scheduler, `frontend/src/pages/ScraperConfigPage.tsx`, `frontend/src/api/scraper.ts`, migrations `…0012/0040–0044/0048`
**Method:** read-only inspection of the current working tree (uncommitted changes included). Every finding below was re-opened and confirmed at the cited line before being written down.
**Deliverable:** report only — no code was changed.

---

## 1. Executive summary

The scraper is the most feature-dense module in the CRM: 9 source types, a Cheerio fetcher and a puppeteer-core deep crawler, robots.txt + SSRF + captcha guards, BullMQ cron scheduling, run logs with duplicate/failure drilldown, and a retry-failed path. In breadth it already exceeds what a typical in-house CRM ships. The frontend has recently matured — `AlertDialog`, Escape-to-close, client-side form validation, search/source filtering, and role-permission gating are all present.

The weaknesses are not in breadth, they are in **fault handling and post-scrape control**. Three structural issues dominate:

1. **A failed scrape is indistinguishable from a successful one at the queue layer.** `runScrapeCore` catches every error and *returns* a result object. The worker therefore sees a clean return, increments `crm_jobs_processed_total{status:"success"}`, and BullMQ never retries. The `attempts: 3` / exponential backoff / DLQ machinery configured on the scraper queue is effectively dead code for the failure mode it was built for.
2. **Config validation is declared but never enforced.** Nine carefully written per-source Zod schemas exist in `scraper.schema.ts` and none of them are wired into create/update. `config` is `z.record(z.unknown())`. Every cap — `maxResults ≤ 50`, `maxPages ≤ 100`, `maxDepth ≤ 5`, `waitMs ≤ 15000` — is advisory only.
3. **Import is fire-and-forget.** Scraped rows go straight into `leads` with a hardcoded field layout, `industry: 'Unknown'`, `location: 'Unknown'`, placeholder emails/phones, and a dedup key scoped *per source platform*. There is no mapping layer and no import policy, so the same business found by two sources becomes two leads and the operator has no lever to change that.

**Verdict:** solid acquisition engine, weak operational contract. The Tier 1 fixes below are small and contained (most are 1–20 lines). The three feature investments you selected — scheduling UX, field mapping + import policy, and proxy support — are what close the remaining distance to Apify/PhantomBuster/Clay.

### Top findings by severity

| # | Sev | Finding | Location |
|---|-----|---------|----------|
| C1 | **High** | Failed runs return normally → no BullMQ retry, no DLQ, counted as worker success | `scraper.service.ts:354-379`, `scraper.worker.ts:44-48` |
| S1 | **High** | Google Places API key embedded in `photoUrls` and persisted to `scraper_logs.raw_response` | `scraper.service.ts:830-833` |
| S2 | **High** | SSRF guard `validateSafeUrl` applied on `scrapeWeb` but **not** on `scrapeBrowser` | `scraper.service.ts:1214-1437` |
| C2 | **High** | Per-source Zod config schemas defined but never applied; all caps unenforced | `scraper.schema.ts:108-121` |
| C3 | Med | `schedule_cron` never validated; `syncSchedule` throws *after* the row is committed | `scraper.schema.ts:112`, `scraper.scheduler.ts:33-47` |
| C7 | Med | Cross-source dedup impossible — `findExistingForDedup` filters on `source_platform` | `leads.repository.ts:154-168` |
| C4 | Med | YouTube imports without `logId` → leads invisible in run drilldown | `scraper.service.ts:1572` |
| R1 | Med | No `AbortController`/timeout on any `web_scrape` or Places `fetch` | throughout `scraper.service.ts` |
| C6 | Med | `enqueueScraperRun` sets no `jobId` → double-click "Run Now" = two concurrent runs | `queue.ts:453-456` |
| C5 | Low | `web_scrape` mode default is `'selectors'` in service, `'smart'` in schema | `scraper.service.ts:2103` vs `scraper.schema.ts:62` |

---

## 2. Architecture map

```
POST /api/v1/scraper/:configId/scrape          (admin, authenticatedLimiter)
  └─ scraper.controller.triggerScrapeHandler   → 202 Accepted
       └─ scraper.service.queueScrapeRun
            ├─ getConfigById + is_active check      (throws 400 if inactive)
            ├─ insertScraperLog(status:'running')   ← UI polls this immediately
            └─ enqueueScraperRun({configId, triggeredBy, logId})
                 └─ [BullMQ 'scraper' queue, concurrency 2]
                      └─ scraper.worker.handleScraperJob
                           └─ runScrapeForJob(configId, logId)
                                └─ runScrapeCore  ◄── swallows all errors (C1)
                                     ├─ executeScraper  → 9-way switch on source_type
                                     └─ finalizeSuccessfulRun → updateScraperLog + last_run_at

executeScraper → importLeads(leads, logId)
  └─ per lead: placeholder phone/email → leads.service.createLead(systemActor)
       ├─ findExistingForDedup(email, phone, source_platform)  → 409 ⇒ counted duplicate
       └─ enqueueLeadEvent('lead.created')
            └─ events.worker → scoring · aiResearch · campaign auto-enrol by source/tag
```

**Two run entry points, different log semantics:**
- `runScrape(configId, actor)` — synchronous; **creates** its own log row. Used by the scheduler branch of the worker (cron jobs carry no `logId`).
- `runScrapeForJob(configId, logId)` — reuses a log row created up front by `queueScrapeRun`, so the UI sees `running` the instant the button is clicked. Note it does **not** re-check `is_active` (`scraper.service.ts:398-401`) — a config paused between enqueue and execution still runs.

**Scheduler lifecycle** (`scraper.scheduler.ts`): repeatable BullMQ jobs keyed `scraper-schedule-<configId>`; `syncSchedule` is remove-then-add; `reconcileSchedules()` re-registers everything at worker boot (`workers/index.ts:66-72`) to survive a Redis flush. Cron jobs enqueue **without** `logId`, so they take the `runScrape` path.

**Source-type support matrix:**

| Source | Engine | State |
|---|---|---|
| `google_places` | Places Text Search + Details + Geocoding (`fetch`) | Full |
| `web_scrape` | `fetch` + Cheerio, `smart` or `selectors` mode, deep crawl | Full |
| `browser_scrape` | puppeteer-core headless Chrome + Cheerio on rendered DOM | Full |
| `apify_actor` | Apify `run-sync-get-dataset-items` | Full |
| `facebook` | Graph API v18.0 | Full |
| `youtube` | YouTube Data API v3 | Full (but see C4) |
| `meta_lead_forms` | Graph API via `facebook.connector.fetchFormLeads` | Full |
| `google_ads_lead_forms` | — | **Stub**, returns zeros, `mode:'webhook_only'` (`:950`) |
| `linkedin_lead_forms` | — | **Stub**, `manual_import` returns zeros, `api` throws 400 (`:981`) |

Two of nine advertised source types do nothing. They are selectable in the UI and will produce a `completed` run with 0 records and no explanation to the operator.

---

## 3. Correctness findings

### C1 — Failed runs are swallowed *(High)*
`backend/src/modules/scraper/scraper.service.ts:354-379`

```ts
} catch (err) {
  const message = err instanceof Error ? err.message : 'Unknown error';
  await updateScraperLog(logId, { status: 'failed', ... });
  logger.error('scraper run failed', {...});
  return { logId, recordsFound: 0, ..., status: 'failed', errorMessage: message };
}
```

The comment above the return explains the intent — surface the reason to the HTTP layer instead of a silent success. That intent was correct for the *old* synchronous path. Since runs moved to the worker (`queueScrapeRun`), the caller is `handleScraperJob`, and a normal return there means:

- `incJobsProcessed({ status:'success' })` fires (`scraper.worker.ts:45`) — Prometheus reports a healthy scraper while every run fails.
- BullMQ sees success. `attempts: 3` and `backoff: {type:'exponential', delay:2000}` (`queue.ts:135`) never engage.
- `moveToDLQ` (`scraper.worker.ts:80-88`) is unreachable for scrape failures. Only infrastructure errors *outside* `runScrapeCore` (a 404 from `getConfigById`, DB down) reach it.

A transient 503 from a target site therefore permanently fails the run with no retry, and nothing in the metrics says so.

**Recommended fix:** keep the log-write and result-shaping for the HTTP path, but re-throw on the worker path. Cleanest split: have `runScrapeCore` take a `{ rethrow: boolean }` option, or have `runScrapeForJob` inspect the returned `status === 'failed'` and throw an `AppError` carrying `errorMessage` after the log has been written. Classify errors first — a 400 (bad selectors, missing API key) should *not* be retried; a 429/5xx/network error should.

### C2 — Per-source config schemas are never applied *(High)*
`backend/src/modules/scraper/scraper.schema.ts:108-121`

```ts
export const createScraperConfigSchema = z.object({
  name: z.string().min(1).max(255),
  source_type: sourceTypeEnum,
  is_active: z.boolean().optional().default(true),
  config: z.record(z.unknown()),        // ← every per-source schema bypassed
  schedule_cron: z.string().nullable().optional(),
});
```

`googlePlacesConfigSchema` (`:21`), `webScrapeConfigSchema` (`:58`), `browserScrapeConfigSchema` (`:72`), `apifyActorConfigSchema` (`:89`) and `deepCrawlFields` (`:49`) are all defined and all unreachable. The service then re-reads the raw values defensively — `Number(_config.crawlDelayMs) || 3000` (`:2100`) — which papers over the gap but means an admin can set `maxPages: 100000` or `maxDepth: 50` and the only thing stopping a runaway crawl is the page budget the service happens to read.

This directly violates the project rule that all request bodies must be validated with Zod in `<module>.schema.ts` before any service call.

**Recommended fix:** discriminate on `source_type` — `z.discriminatedUnion('source_type', [...])`, or a `.superRefine` on the existing object that dispatches `config` to the matching per-source schema. The schemas already exist; this is wiring, not new design.

### C3 — `schedule_cron` unvalidated, and written before it is used *(Medium)*
`scraper.schema.ts:112` accepts any string. `scraper.service.createConfig` inserts the row, *then* calls `syncSchedule` (`scraper.scheduler.ts:33-47`), which passes the string to `scraperQueue.add(..., { repeat: { pattern: cron } })`. An invalid pattern throws there — after the DB commit. Result: a saved config that appears scheduled in the UI (`ScraperConfigPage.tsx:1493` renders `· Cron: <string>`) but has no repeatable job behind it, and the API returns a 500.

**Recommended fix:** validate at the Zod layer with a cron parser, and reorder so the schedule is registered before (or in the same transaction boundary as) the row write — or roll back / mark the config inactive if `syncSchedule` throws. See §8.2.1.

### C4 — YouTube imports lose their run association *(Medium)*
`scraper.service.ts:1572` — `const stats = await importLeads(leads);`

Every other source passes `logId`. Without it, `createLead` receives `scraper_log_id: null`, so:
- YouTube leads never appear in `GET /scraper/logs/:logId/leads` (the "View leads" drilldown returns empty).
- `duplicateLeadIds` is not populated for that run.
- The `leads.scraper_log_id` FK added in migration `…0043` is pointless for this source.

**Recommended fix:** one-word change — `importLeads(leads, logId)`. `scrapeYouTube` already receives `logId` in the `executeScraper` dispatch.

### C5 — `web_scrape` mode default disagrees with itself *(Low)*
`scraper.service.ts:2103`: `const mode = _config.mode === 'smart' ? 'smart' : 'selectors';` (comment: backward compatible).
`scraper.schema.ts:62`: `mode: z.enum(['smart','selectors']).default('smart')`.

Because C2 means the schema never runs, the service default wins today — so a config saved without an explicit `mode` requires selectors and throws `'CSS selectors are required for web scraping'` (`:2106`). The moment C2 is fixed, that same config silently flips to `smart` and starts producing different leads. **Fix C2 and C5 together**, and pick one default explicitly.

### C6 — "Run Now" is not idempotent *(Medium)*
`queue.ts:453-456` — `scraperQueue.add(SCRAPER_RUN, payload)` with no `jobId`. Each click of Run Now creates a fresh log row (`queueScrapeRun` inserts before enqueueing) and a fresh job. Two clicks = two concurrent crawls of the same target, doubling the request rate against a site you are already rate-limiting yourself for, and two `running` rows in the UI.

**Recommended fix:** pass `jobId: logId` (already unique per run) and disable the button while a log for that config is `running` — the logs query already knows this, it drives the 3 s poll.

### C7 — Dedup cannot span sources *(Medium)*
`backend/src/modules/leads/leads.repository.ts:154-168`

```sql
WHERE source_platform = $1
  AND deleted_at IS NULL
  AND (lower(email) = lower($2) OR phone = $3)
```

The same restaurant found via `google_places` and then via `web_scrape` produces two leads, because the source is part of the key. There is also **no website/domain-based key**, which is the field most reliably present across sources (email and phone are frequently placeholders — see below).

Compounding this, `dedupeScrapedLeads` (`scraper.service.ts:1129`) — the within-run merge — is only called by `scrapeWeb` and `scrapeBrowser`. Places, Facebook, YouTube and Apify have no within-run dedup at all (Places dedupes by `place_id`, which catches the same listing but not the same business listed twice).

Placeholders make this worse: `generatePlaceholderPhone` (`:2308`) and `generatePlaceholderEmail` (`:2310`) synthesise deterministic values from name/location, so two records for the same business *do* collide — but two genuinely different businesses with a colliding hash also collide, and a business whose real email appears in run 2 but not run 1 will not match its own placeholder row.

**Recommended fix:** part of the import-policy work in §8.2.2.

### C8 — URL/query textarea discards the first line *(Low, frontend)*
`ScraperConfigPage.tsx:224-226` (URLs) and `:450-452` (Places queries):

```ts
const lines = e.target.value.split('\n').map((l) => l.trimStart());
const urls = lines.filter((l) => l.trim().length > 0);
onChange('url', urls.length > 1 ? urls : (lines[0] ?? ''));
```

If line 1 is blank and the user types on line 2, `urls.length === 1`, so the stored value is `lines[0]` — the empty string. The typed URL is discarded and the textarea visibly clears itself mid-typing.

**Recommended fix:** `onChange('url', urls.length > 1 ? urls : (urls[0] ?? ''))`.

*(Note: the array-vs-string bug in auto-detect reported in earlier notes is already fixed — `handleAutoDetect:1061-1063` correctly unwraps arrays.)*

### C9 — Invalid JSON is silently dropped *(Low, frontend)*
`ScraperConfigPage.tsx:302-315` — `handleChange` parses on every keystroke and, on failure, `catch { /* invalid JSON, do not call onChange */ }`. The textarea keeps showing the user's text while `config.selectors` retains the last valid value. Save then persists something different from what is on screen, with no indication. The page has a `formErrors` mechanism (`:990`) that is not used here.

**Recommended fix:** surface a parse error into `formErrors` and block submit while it is set.

### C10 — Stats cards go stale after a run *(Low, frontend)*
`api/scraper.ts:113-120` — `useTriggerScrape.onSuccess` invalidates `logs`, `configs`, `leads`, `reports` but **not** `['scraper','stats-summary']` (contrast `useRetryFailedScrape:215`, which does). More significantly, "Run Now" returns *before the scrape happens* (202 Accepted), so all of those invalidations fire against pre-run state. Only `useScraperLogs` polls (`:163-166`, 3 s while `status === 'running'`); when the run completes nothing re-invalidates configs or stats, so `last_run_at`, `health`, and all four 24 h counters stay wrong until a manual reload.

**Recommended fix:** in the logs `refetchInterval` predicate, detect the `running → terminal` transition and invalidate `configs` + `stats-summary` + `leads` at that point.

---

## 4. Security findings

### S1 — Google API key persisted into the database *(High)*
`scraper.service.ts:825-833`

```ts
.map((ref) =>
  `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${ref}&key=${apiKey}`)
```

These URLs are pushed into `placesEnrichment` and written to `scraper_logs.raw_response` (`:899`). The key is then readable by anyone who can read a log row — including via `GET /scraper/:configId/logs`, which is open to **manager** as well as admin (`scraper.routes.ts:60`). It is also permanently at rest in the DB and in any backup.

This violates the project rule against exposing API credentials, and the key in question is billable.

**Recommended fix:** store `photo_reference` only, and mint the signed URL on read in the API layer (or proxy the image through the backend). Also audit existing `raw_response` rows for leaked keys and rotate the key.

### S2 — SSRF guard skipped on the browser path *(High)*
`validateSafeUrl` is imported at `scraper.service.ts:10` and called at `:2128`, `:2186`, `:2191` — all three inside `scrapeWeb` (starts `:2076`). `scrapeBrowser` (`:1214-1437`) never calls it.

So `web_scrape` refuses `http://169.254.169.254/latest/meta-data/` and `http://localhost:5432`, while `browser_scrape` — which drives a real Chrome with `--no-sandbox` — will happily load them, render them, and extract text into a lead. An admin-only endpoint, but admin ≠ infrastructure operator, and this is a cloud-metadata read primitive.

**Recommended fix:** call `await validateSafeUrl(url)` on every URL entering `scrapeBrowser`, including deep-crawl discovered links (`:1281-1360`), matching what `scrapeWeb` does at `:2128`.

### S3 — robots.txt fetch failure is treated as permission *(Medium)*
`scraper.service.ts:1918-1931` — on a fetch error, `text = null`, and `if (text === null) return;` (`:1931`) means allow. A site that blocks or rate-limits `/robots.txt` is therefore crawled as if unrestricted. Additionally, `Crawl-delay` is parsed out of robots.txt but ignored; the crawler uses its own `crawlDelayMs` default of 3000 (`:2100`).

The `respectRobotsTxt: false` escape hatch (`:2099`) exists, which is the right design — but the default should fail closed, not open.

**Recommended fix:** on fetch failure, either fail closed (throw 403) or fall back to a conservative crawl delay and log prominently. Honour a parsed `Crawl-delay` when it exceeds the configured value. At minimum, document the current behaviour as an accepted risk with sign-off, since this carries ToS exposure.

### S4 — Scraped leads have no actor attribution *(Medium)*
`scraper.service.ts:2318-2323` — every lead is created as
`{ id: '00000000-0000-0000-0000-000000000000', role: 'admin' }`.

Consequences: the audit trail cannot distinguish a scheduled run from a manual one or say who triggered it; that UUID must exist in `users` for the audit FK; and `queueScrapeRun` receives a real `actor` (`scraper.controller.ts:91`) and discards it. There is also **no audit log entry for triggering a run at all** — `createConfig`/`updateConfig`/`removeConfig` write audit rows (`:213`, `:239`, `:256`) but running one only calls `logger.info` (`:422`).

**Recommended fix:** thread the triggering actor (or `'scheduler'`) through `queueScrapeRun → job payload → runScrapeForJob → importLeads`, and add a `scraper_run.triggered` audit entry.

### S5 — Route-level RBAC drift *(Low)*
`frontend/src/App.tsx:212` mounts `/scraper` with no `RoleRoute`, unlike `admin/ai-decisions` (`:194`). Any authenticated user can load the page. In-page gating is now correct — `canRead`/`canWrite` derive from `ROLE_PERMISSIONS[role].Integrations` (`ScraperConfigPage.tsx:969-971`) and are applied consistently (`:1222`, `:1448`, `:1499`, `:1550`, `:1564`, `:1609`) — and the backend enforces per-route RBAC properly, so this is defence-in-depth rather than an active hole. It is worth aligning so the nav entry (`Layout.tsx:47`, shown to everyone) does not lead viewers to a page with nothing on it.

---

## 5. Reliability & operations findings

**R1 — No request timeouts.** No `AbortController` anywhere in `scrapeWeb`, `scrapeGooglePlaces`, `scrapeFacebook`, or `scrapeYouTube`. A target that accepts a connection and never responds pins one of only **2** worker slots (`scraper.worker.ts:70`) indefinitely. Apify's connector does this correctly (`APIFY_RUN_TIMEOUT_MS = 305_000` with `AbortController`) and `scrapeBrowser` has `DEFAULT_BROWSER_TIMEOUT_MS = 30_000` — the plain-`fetch` paths are the gap.

**R2 — No per-page retry inside a crawl.** Deep crawl catches per-page errors and continues (`:1973-2074`), which is right, but a transient 500 loses that page for the whole run with no second attempt.

**R3 — Unbounded log growth.** `scraper_logs.raw_response` is unbounded JSONB (Places enrichment can hold 3 reviews + 3 photo URLs × 20 results per run), `failed_items` is unbounded JSONB (`…0044`), and there is **no retention or pruning job** for `scraper_logs`. A daily-cron config will grow this table forever.

**R4 — Missing composite index.** `findScraperLogsByConfig` (`scraper.repository.ts:190-201`) filters `config_id` and orders `created_at DESC`. Migration `…0012:110-121` creates separate single-column indexes on `config_id`, `status`, and `created_at DESC` — no composite `(config_id, created_at DESC)`. Fine at current volume, will degrade with R3.

**R5 — Declared-but-unfired signals.** `'scraper_complete'` is a valid notification type (`notifications.emitter.ts:23`) and is never emitted anywhere in `src/`. `lead.scraped` is declared in `shared/events/ai.events.ts:10` and only ever appears in `eventBus.test.ts` — never fired by the scraper. Operators get no notification when a scheduled overnight run fails.

**R6 — `runScrapeForJob` skips the active check.** `runScrape` validates `is_active` (`:384`); `runScrapeForJob` (`:398-401`) does not. A config paused after enqueue still runs.

**R7 — Silent no-op.** `updateScraperLog` returns `null` when passed no fields (`scraper.repository.ts:117`) rather than signalling. Harmless today, a trap later.

**R8 — Code hygiene.** CommonJS `require('crypto')` inside an otherwise-ESM module (`scraper.service.ts:1047`); a dynamic `await import('../../shared/utils/phone')` inside the per-lead loop (`:2314`) despite `normalizePhone` being statically imported at `:9`; `useScraperConfig` (`api/scraper.ts:28`) is dead code.

---

## 6. Test coverage gaps

Backend coverage is genuinely good — ~94 service cases across 22 describes, plus controller/repository/routes/scheduler/worker suites. The gaps are concentrated in the security-relevant and stub paths:

| Untested | Why it matters |
|---|---|
| `detectSelectors` (`:1700`) | Zero cases. LLM call, JSON-fence stripping, both 502 paths. Admin-only, calls out to OpenAI. |
| `meta_lead_forms`, `google_ads_lead_forms`, `linkedin_lead_forms` | No service tests. Two are stubs that silently return zeros. |
| `assertRobotsAllowed` parsing (`:1902`) | UA matching, `Disallow: /`, comment stripping, fetch-failure-allows (S3) — only exercised indirectly via the cache test. |
| `validateSafeUrl` in the scraper path | S2 would have been caught by a test asserting `scrapeBrowser` rejects `169.254.169.254`. |
| `smartExtract` (`:1597`) in isolation | Email regex false positives, `tel:` fallback, asset-email filtering. |
| `assertNoCaptcha` / `CAPTCHA_RE` (`:1583`) | No dedicated case. |
| Cron validation / `syncSchedule` failure rollback | C3. |
| Per-route RBAC | `scraper.routes.test.ts` mocks `authenticate`/`authorize`; nothing asserts a `viewer` gets 403 on `POST /`. |
| Worker metrics on the failed-scrape-returns-normally case | C1 — a test asserting `incJobsFailed` fires on a failed run would have caught it. |

**Frontend is effectively untested.** `ScraperConfigPage.test.tsx` (80 lines) renders and asserts `expect(container).toBeTruthy()` — no text assertions, no interaction, and with `useAuthStore().user` undefined, `canWrite` is false, so the entire write branch (modal, Run/Edit/Delete, logs, retry) is never exercised. `api/__tests__/scraper.test.tsx` (49 lines) calls `useScraperConfigs({} as any)` and `useScraperLogs({} as any)` — arguments the hooks do not accept; the latter builds a URL of `/scraper/[object Object]/logs`, which the mock silently accepts. Nothing verifies endpoint URLs, request bodies, `ApiResponse` unwrapping, invalidation keys, or the running-poll predicate.

---

## 7. Competitor gap analysis

Compared against **Apify** (crawler platform), **PhantomBuster** (social scraping), **Clay** (enrichment/waterfall), **Apollo** (B2B data + sequencing).

| Capability | This CRM | Apify | PhantomBuster | Clay | Apollo |
|---|---|---|---|---|---|
| Multi-source scraping | ✅ 7 working, 2 stubs | ✅ | ✅ | ✅ | ✅ |
| Headless-browser rendering | ✅ puppeteer | ✅ | ✅ | ➖ | ➖ |
| Deep crawl w/ depth + patterns | ✅ | ✅ | ➖ | ➖ | ➖ |
| robots.txt / SSRF guards | ✅ (S2/S3 gaps) | ✅ | ➖ | — | — |
| **Dry-run / preview before import** | ❌ | ✅ | ✅ | ✅ | ✅ |
| **Field mapping → CRM fields** | ❌ hardcoded | ✅ | ✅ | ✅ core feature | ✅ |
| **Import policy (dedupe key, skip/update)** | ❌ | ✅ dataset dedup | ➖ | ✅ | ✅ |
| **Proxy pool / IP rotation** | ❌ | ✅ residential+DC | ✅ | ✅ | ✅ |
| **Cron builder + next-run + timezone** | ⚠️ raw string | ✅ | ✅ | ✅ | ✅ |
| Live run console / log tail | ❌ 3 s counter poll | ✅ | ✅ | ✅ | ➖ |
| Cancel a running job | ❌ | ✅ | ✅ | ✅ | — |
| Retry failed items | ✅ | ✅ | ➖ | ✅ | ➖ |
| Export run results (CSV/JSON) | ❌ | ✅ | ✅ | ✅ | ✅ |
| Bulk actions on sources | ❌ | ✅ | ✅ | ➖ | ➖ |
| Cost/quota visibility | ❌ | ✅ per-run CU | ✅ credits | ✅ credits | ✅ |
| Built-in enrichment waterfall | ⚠️ Hunter.io only | ➖ | ➖ | ✅ core | ✅ |
| Native CRM/pipeline integration | ✅ **advantage** | ❌ | ❌ | ➖ | ✅ |
| Autonomous downstream (scoring, AI, campaign enrol) | ✅ **advantage** | ❌ | ❌ | ❌ | ⚠️ |

**Where this platform genuinely wins:** a scraped lead lands in the pipeline and immediately triggers scoring, AI research, and campaign auto-enrolment via `lead.created` (`events.worker.ts:115-120, 205`). Apify and PhantomBuster hand you a CSV; the round-trip back into a CRM is the customer's problem. That integration is the moat and it is already built.

**Where it loses hardest, in order:**
1. **No proxy support.** Single-IP crawling at a fixed 3 s delay gets blocked by any site with real bot defences. This is the hard ceiling on `web_scrape`/`browser_scrape` viability.
2. **No dry-run.** Every "Run Now" writes to `leads`. Iterating on selectors means polluting the lead table and cleaning up afterwards. Every competitor lets you test first.
3. **No field mapping or import policy.** Output shape is fixed (`industry: 'Unknown'`, `location: 'Unknown'`, placeholder contacts) with no operator control over dedup or routing.
4. **Cron as a raw string.** No validation, no next-run preview, no timezone.
5. **No cancel.** A misconfigured 100-page deep crawl runs to completion; the only recourse is restarting the worker.

---

## 8. Prioritized recommendations

### 8.1 Tier 1 — correctness & security (do first; small and contained)

| Item | Effort | Notes |
|---|---|---|
| **C1** re-throw retryable failures from the worker path | ~20 LOC | Classify 4xx (no retry) vs 429/5xx/network (retry). Unblocks the existing DLQ + backoff config. |
| **S1** stop persisting the Places API key | ~10 LOC + data audit | Store `photo_reference`; sign on read. Audit existing rows; rotate key. |
| **S2** call `validateSafeUrl` in `scrapeBrowser` | ~5 LOC | Including deep-crawl links. |
| **C2** wire per-source schemas via discriminated union | ~40 LOC | Schemas already written. Do **C5** in the same change. |
| **C3** validate cron at the Zod layer + order the write | ~15 LOC | Rolls into 8.2.1. |
| **C4** pass `logId` in `scrapeYouTube` | 1 word | |
| **C6** `jobId: logId` on `enqueueScraperRun` + disable button while running | ~10 LOC | |
| **R1** `AbortController` on all `fetch` calls | ~30 LOC | Mirror the Apify connector's pattern. |
| **R6** `is_active` check in `runScrapeForJob` | ~3 LOC | |
| **S4/R5** thread actor through; emit `scraper_complete` + audit the run trigger | ~30 LOC | Both the notification type and the event type already exist. |
| **C8/C9/C10** frontend: first-line fix, JSON parse error, invalidate on run completion | ~40 LOC | |
| Tests for the above, esp. S2, S3 parsing, and C1's metric labels | — | |

### 8.2 Tier 2 — the three chosen feature investments

#### 8.2.1 Cron builder + next-run preview + schedule visibility

*Current state:* a bare text input (`ScraperConfigPage.tsx:1397-1403`), no validation, and the raw string rendered on the list row (`:1493`, `· Cron: 0 3 * * *`). No timezone, no next-run.

**Backend**
- Validate `schedule_cron` in `scraper.schema.ts` with a cron parser (`cron-parser` is the conventional choice — **new dependency, requires approval** per the project's no-unapproved-packages rule; alternatively a strict regex covering the 5-field subset avoids the dep).
- Add `schedule_timezone` (IANA string, default `Asia/Kolkata` given the Bangalore context) — new migration, additive column on `scraper_configs`. Pass through as BullMQ `repeat: { pattern, tz }`, which is natively supported.
- Reorder `createConfig`/`updateConfig` so `syncSchedule` failure does not leave an orphaned row (fixes C3).
- Expose `next_run_at` on the config read model. Derive from `scraperQueue.getRepeatableJobs()` (each entry carries `next`), joined by the existing `scraper-schedule-<configId>` jobId convention — no new storage needed.

**Frontend**
- Replace the text input with a small preset picker (Hourly / Daily at HH:MM / Weekly on D at HH:MM / Custom cron) that emits a cron string, keeping the raw field available under "Custom".
- Inline validation error via the existing `formErrors` mechanism.
- Show "Next run: <relative + absolute>" under the field and on each list row, replacing the raw cron string with a human phrase ("Daily at 03:00 IST").

#### 8.2.2 Field mapping + import policy

*Current state:* `importLeads` (`scraper.service.ts:2282-2385`) hardcodes the lead shape and always dedupes on `(source_platform, email|phone)` via `findExistingForDedup`.

**Config shape** — both stored in the existing `scraper_configs.config` JSONB, so **no migration needed**, and both validated by the per-source schemas once C2 lands:

```ts
mapping?: {
  // scraped field  →  lead field or custom_field_definitions key
  [scrapedField: string]: { target: LeadField | `custom:${string}` };
};
importPolicy?: {
  dedupeKey: ('email' | 'phone' | 'website_domain')[];   // ordered waterfall
  crossSource: boolean;          // ignore source_platform in the dedup query
  onDuplicate: 'skip' | 'update' | 'merge_empty';
  defaults?: { owner_id?, stage_id?, tags?: string[], campaign_id? };
};
```

**Backend**
- Add a `resolveLeadFromMapping(scraped, mapping)` step in `importLeads` before `createLead`, falling back to today's hardcoded behaviour when `mapping` is absent (backward compatible).
- Custom-field targets must be validated against `custom_field_definitions` before write — this is an existing project rule and the `custom-fields` module already provides the validator; reuse it rather than writing a new one.
- Extend `findExistingForDedup` (`leads.repository.ts:154`) with an optional `crossSource` flag and a `website_domain` key. Domain is the highest-value addition — it is the one field present across Places, web scrape, and Apify, and unlike email/phone it is never a synthesised placeholder.
- Honour `onDuplicate`: today the 409 handler only tags the existing lead (`:2345-2385`). `update` and `merge_empty` are new branches there.
- Apply `defaults` at `createLead` time; `campaign_id` should reuse the existing enrolment service rather than writing the join directly (no cross-module DB access).
- Extend `dedupeScrapedLeads` (`:1129`) to *all* sources, not just web/browser (fixes C7's within-run half).

**Frontend**
- A "Mapping & Import" section in the config modal: two columns (detected/known scraped fields → lead field dropdown incl. custom fields), plus dedupe-key chips, an on-duplicate radio, and default owner/stage/tag/campaign pickers. The `detectSelectors` endpoint already returns discovered field names and can seed the left column.

This is the highest-leverage of the three: it fixes C7, closes the largest structural gap versus Clay/Apollo, and requires no schema migration.

#### 8.2.3 Proxy support

*Current state:* none. Single IP, one static UA (`DEFAULT_CRAWLER_USER_AGENT`, `:1582`), fixed 3 s delay. `assertNotBlockedResponse` (`:1958`) detects 401/403/429 and `assertNoCaptcha` (`:1967`) detects challenge pages — so the system already knows when it is blocked, it just cannot do anything about it.

**Config shape** (JSONB, follows the existing `apiKeyRef` indirection — the proxy list is a credential and must never be stored inline):

```ts
proxy?: {
  poolRef: string;              // env var NAME holding a newline/comma list of proxy URLs
  rotation: 'per_request' | 'per_page' | 'sticky_per_run';
  maxFailuresPerProxy?: number; // default 3, then cool down
};
```

Reuse `assertEnvVarConfigured` (`:118`) — the same guard that stops raw API keys being stored in config — so the audit posture is unchanged.

**Backend**
- A `src/modules/scraper/scraper.proxy.ts` helper owning pool parsing, round-robin/sticky selection, and per-proxy failure counts (in-memory per worker is sufficient; Redis if you want cross-worker state).
- `fetch` path: Node's built-in `fetch` (undici) needs a `dispatcher`. **`undici` ProxyAgent is the natural fit and is already a transitive dependency of Node 20's fetch — but adding it as a direct dependency requires approval.** No third-party proxy library is needed.
- puppeteer path: `--proxy-server=<url>` in the launch args (`:1254-1260`). Note this is per-*browser*, so `sticky_per_run` is the natural mode there; per-request rotation would require relaunching Chrome or using per-context proxies.
- Feed `assertNotBlockedResponse`/`assertNoCaptcha` outcomes back as proxy failures so a burned IP is rotated out automatically.
- Pair with a small realistic User-Agent pool rotated alongside the proxy — rotating IP while broadcasting `CRMLeadCrawler/1.0` defeats the purpose.
- Surface the proxy used and its failure count in `raw_response` for diagnosis (**not** the credentials — mask to host only).

**Frontend**
- Proxy fields in the config modal (pool env-var name, rotation mode), with the same "must be an env var name" helper text the API-key fields use.
- Show block/captcha reasons in the run log rows so operators can tell "site blocked us" from "selectors matched nothing" — today both surface as 0 records.

**Dependency approval needed:** `undici` (direct), and `cron-parser` if you take that route in 8.2.1. Both should be raised explicitly before install.

### 8.3 Tier 3 — deferred, with estimates

| Item | Est. | Rationale for deferring |
|---|---|---|
| Dry-run / preview before import | 3–4 d | Highest user-facing value of the deferred set. Needs a `?dryRun=true` path through `executeScraper` that skips `importLeads` and returns rows, plus a results table UI. Recommend promoting to Tier 2 in the next cycle. |
| Run console: live progress + cancel | 4–5 d | Progress events via the existing SSE `notifications` module; cancel needs a Redis abort flag checked between pages. |
| Export run results (CSV/JSON) | 1 d | `reportExport.worker.ts` already does async CSV export — reuse it. |
| Bulk actions (run/pause/delete multiple) | 1–2 d | Search + source filter already exist (`:986-1000`); selection state is the missing piece. |
| Log retention job + composite index (R3/R4) | 0.5 d | Do before volume grows. |
| Finish or remove the two lead-form stubs | 1–2 d | Currently misleading — they are selectable and silently do nothing. |
| Dark mode (`0` `dark:` classes in a 1682-line page) | 1 d | Page is a white slab while `Layout.tsx` supports dark. |
| A11y: `aria-label` on icon buttons (0 present), `role="dialog"`/focus trap, status not by colour alone | 1–2 d | Escape-to-close and `AlertDialog` are already done (`:1197-1211`, `:1425`). |
| Pagination on config list and logs | 1 d | Logs hard-capped at 25 with no "load more"; `limit` is not in the query key. `TablePagination` component already exists. |
| Frontend test suite worth the name | 2–3 d | Both existing suites are no-ops (§6). |
| Split the 2400-line service / 1682-line page | 2–3 d | Per-source scrapers into `scraper.sources/*`; modal and log panel out of the page. |

---

## 9. Appendix — findings index

| ID | Sev | Area | File:line |
|---|---|---|---|
| C1 | High | Failed runs swallowed | `backend/src/modules/scraper/scraper.service.ts:354-379`; `backend/src/workers/scraper.worker.ts:44-48` |
| C2 | High | Config schemas unapplied | `backend/src/modules/scraper/scraper.schema.ts:108-121` (schemas at `:21,:29,:36,:49,:58,:72,:89`) |
| C3 | Med | Cron unvalidated / written first | `scraper.schema.ts:112`; `scraper.scheduler.ts:33-47` |
| C4 | Med | YouTube import missing `logId` | `scraper.service.ts:1572` |
| C5 | Low | Mode default disagreement | `scraper.service.ts:2103` vs `scraper.schema.ts:62` |
| C6 | Med | Run Now not idempotent | `backend/src/workers/queue.ts:453-456` |
| C7 | Med | Dedup source-scoped, no domain key | `backend/src/modules/leads/leads.repository.ts:154-168`; `scraper.service.ts:1129` |
| C8 | Low | Textarea drops first line | `frontend/src/pages/ScraperConfigPage.tsx:224-226`, `:450-452` |
| C9 | Low | Invalid JSON silently dropped | `ScraperConfigPage.tsx:302-315` |
| C10 | Low | Stats stale after run | `frontend/src/api/scraper.ts:113-120`, `:163-166` |
| S1 | High | API key persisted in `raw_response` | `scraper.service.ts:825-833`, `:899` |
| S2 | High | SSRF guard skipped in browser path | `scraper.service.ts:1214-1437` (cf. `:2128`, `:2186`, `:2191`) |
| S3 | Med | robots.txt failure = allow; `Crawl-delay` ignored | `scraper.service.ts:1918-1931` |
| S4 | Med | Hardcoded system actor; no run audit | `scraper.service.ts:2318-2323`, `:422` |
| S5 | Low | No `RoleRoute` on `/scraper` | `frontend/src/App.tsx:212` (cf. `:194`) |
| R1 | Med | No fetch timeouts | `scraper.service.ts` (all `fetch` call sites) |
| R2 | Low | No per-page retry in crawl | `scraper.service.ts:1973-2074` |
| R3 | Med | No log retention | `migrations/1750000000012_scraper-tables.js:92-121` |
| R4 | Low | Missing composite index | `scraper.repository.ts:190-201` |
| R5 | Med | `scraper_complete` / `lead.scraped` never fired | `notifications.emitter.ts:23`; `shared/events/ai.events.ts:10` |
| R6 | Med | `runScrapeForJob` skips `is_active` | `scraper.service.ts:398-401` |
| R7 | Low | `updateScraperLog` silent no-op | `scraper.repository.ts:117` |
| R8 | Low | `require()` in ESM; loop-scoped dynamic import; dead hook | `scraper.service.ts:1047`, `:2314`; `frontend/src/api/scraper.ts:28` |

**Migrations reviewed** (note: they live in `/migrations/`, **not** `backend/migrations/` as CLAUDE.md states — worth correcting in that file):
`1750000000012_scraper-tables.js`, `…0040_add-apify-and-browser-scraper-source-types.js`, `…0041_add-lead-form-scraper-source-types.js`, `…0042_add-scraper-log-duplicate-count.js`, `…0043_add-scraper-log-id-to-leads.js`, `…0044_add-scraper-log-failed-items.js`, `…0048_add-scraper-log-duplicate-lead-ids.js`.

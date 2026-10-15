# Campaign operations: research and implementation plan

Date: 2026-10-15 · Status: phases 0–2 implemented in the accompanying PR; migrations 0084–0086 are additive and await rollout approval.

## Summary

Make campaign operation understandable and recoverable after launch. Every campaign should answer: what happens next, when, for how many recipients, and why anything is waiting. First correct execution and reporting; then expose trustworthy scheduling information; add more advanced automation afterward.

Keep the existing modular monolith, PostgreSQL, BullMQ, React, and TanStack Query. No replacement marketing platform, new npm dependency, or microservice is proposed for the first release.

## What I Found

### Verified baseline before implementation

| Finding | Source evidence | Consequence |
|---|---|---|
| Launch queues the first step; a successful message schedules the next step using its `delayHours`. | `backend/src/modules/campaigns/campaigns.service.ts`, `backend/src/workers/outreach.worker.ts`, `backend/src/workers/queue.ts` | Follow-up timing is relative to the preceding successful send, not the campaign launch. The launch path does not apply the first step's delay. |
| Send windows and campaign-local daily limits already defer dispatch. | `campaigns.sendWindow.ts`, outreach worker | Extend the existing scheduling rules; do not build a second calculation in the browser. |
| Pause removes waiting/delayed jobs; resume changes campaign status without restoring them. | Campaign service and `cancelPendingOutreachJobs` | Pending work can be stranded. Persist next-step state before cancelling transport jobs. |
| Worker stop checks inspect lead pause status, but do not enforce campaign active status. Manual retry accepts paused campaigns. | Outreach worker and `retryLeadOutreachStep` | Add an authoritative campaign/enrollment gate before sending, including retries and work already picked up by a worker. |
| Campaign summary groups current log statuses; step statistics use timestamps. | Campaign repository | A message that becomes opened disappears from the summary's sent bucket. Use consistent event-based reporting. |
| Campaign lead progress returns latest outreach history, without a durable next due time. | Campaign repository and frontend API | The current API cannot reliably answer when the next email will go. |
| Daily-cap checking counts sent messages before the network send; dispatch concurrency is 10. | Campaign repository and outreach worker | Concurrent workers can observe the same remaining capacity. Add atomic reservation and a concurrency regression test. This is a source-level risk, not a reproduced production incident. |
| Sequences are loaded again at dispatch/follow-up time. | Outreach worker | Shared sequence edits can affect existing enrollments. Pin the enrolled version. |
| Delays currently validate as integer hours. | `backend/src/modules/outreach/outreach.schema.ts` | A campaign name containing “5 min” does not configure a five-minute delay. Minute support requires a deliberate schema/API/editor extension. |
| A durable event outbox and recovery sweep exist, but the publisher accepts lead-event types. | `backend/src/shared/events/*`, `backend/src/workers/outbox.worker.ts` | Reuse the persistence pattern; campaign scheduling needs an explicit supported publisher path, not an unsupported event dropped into the current worker. |
| Phone-call task completion already schedules the next sequence step. | Outreach service | Preserve manual-task progression in the new execution model. |

These observations describe the pre-implementation baseline. The implementation in this PR addresses the operational gaps described below. No live database, queue, deployed commit, provider configuration, or production incident was inspected.

### Web and GitHub research

| Source | Observed pattern | Proposed application |
|---|---|---|
| [HubSpot: pause/resume sequences](https://knowledge.hubspot.com/sequences/pause-or-resume-your-sequences?product=service) | Paused delays retain their unelapsed portion; individual contact enrollments can be paused. | Preserve remaining delay and provide campaign-level and enrollment-level controls. |
| [HubSpot: unenrollment](https://knowledge.hubspot.com/sequences/unenroll-from-sequence?isappinstalled=0) | Reply and meeting events can automatically end sequence enrollment. | Keep reply/opt-out stops mandatory; add meeting-booked handling after verifying this CRM's event integration. |
| [Instantly: campaign settings](https://help.instantly.ai/en/articles/6222396-campaign-settings) | Schedules, timezones, daily limits, sender selection, and stop-on-reply are explicit settings. | Put timing and limits together; show their effect on the next send. Sender rotation is later scope. |
| [Instantly: not-sending diagnostics](https://help.instantly.ai/en/articles/5975337-campaign-not-sending-complete-troubleshooting-guide) | Explains sending delays through diagnostics and limit/schedule checks. | Display specific waiting reasons with useful recovery actions. |
| [Instantly: out-of-office handling](https://help.instantly.ai/en/articles/9713093-ai-smart-pause-resume-for-out-of-office-replies) | Lead-level pause-until dates with manual correction. | Later enhancement: reviewable out-of-office snoozing. Do not depend on AI to determine basic scheduling. |
| [listmonk manager source](https://github.com/knadh/listmonk/blob/master/internal/manager/manager.go) | Manager scans pending campaigns, processes batches, checks stopped pipes, and tracks send rate. | Use bounded recovery/batching, recheck stopped state, and expose execution health. This is a broadcast reference, not a complete drip-sequence implementation. |
| [Mautic scheduled execution source, 7.x](https://github.com/mautic/mautic/blob/7.x/app/bundles/CampaignBundle/Executioner/ScheduledExecutioner.php) | Loads scheduled event logs, validates scheduling again, reschedules, and checks campaign publication before executing. | Persist scheduled execution state and revalidate eligibility at execution time. |
| [listmonk issue #2591](https://github.com/knadh/listmonk/issues/2591) | User reported early completion after pausing and changing a limit; closed as not planned after inactivity. | Regression scenario only; not evidence of a confirmed root cause or a fixed upstream solution. |
| [Mautic issue #11634](https://github.com/mautic/mautic/issues/11634) | Report describes manual rescheduling conflicting with automatic delay calculation. | Record whether a time was manually overridden; prevent recalculation silently undoing it. Issue report, not a verified current defect. |
| [BullMQ delayed jobs](https://docs.bullmq.io/guide/jobs/delayed), [idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs), [rate limiting](https://docs.bullmq.io/guide/rate-limiting) | Delay is an eligibility threshold, not an exact execution guarantee; retries require idempotent handlers; queue limiting has a defined scope. | Label times estimated, persist execution identity, and reserve campaign capacity separately. Verify APIs against the installed lockfile version before implementation. |

These are design references and source observations, not recommendations to copy code. Recheck licenses before reusing upstream implementation.

## Assumptions Made (list any — must be zero for production tasks)

No assumptions about live state. The implementation status below is verified against this PR's source. No live database, queue, deployment, or provider state was inspected.

## Skill Used (which skill was applied, or why none matched)

The local `.agents/skills` tree and configured global skills tree contained no campaign or documentation implementation skill. The plan informed the implementation in this PR; no formal engineering-review skill clearance is claimed.

## Fix / Changes

### 1. Target user experience

After launch, show a launch result: eligible, skipped with reasons, scheduled, and any scheduling failures. An active badge must not imply that all eligible leads were successfully queued.

Campaign detail should have these tabs:

- **Overview:** status, next activity, recipients due soon, sent today, capacity remaining, and attention items.
- **Sequence:** readable ordered steps, channel/template preview, explicit delay units, and version.
- **Leads:** searchable, server-paginated enrollment progress and next action.
- **Activity:** chronological scheduling, sending, replies, failures, pause/resume, and operator actions.
- **Settings:** sending days/hours/timezone, limits, stop rules, and audience entry controls.

Example overview, with illustrative values only:

> Next: Test-2 · Estimated today at 12:30 PM IST · 3 recipients scheduled
>
> 9 potential email sends remaining · 3 next-step sends scheduled
>
> Sent today: 3 / 50 · 0 failed · Last updated just now

Do not conflate recipients, next-step scheduled messages, all future potential sends, and attempts. Future steps are conditional: replies and opt-outs reduce the eventual total. Separate email counts from SMS, WhatsApp, and manual tasks.

Lead columns: name, enrollment state, completed steps/total, next action, estimated time with timezone, waiting reason, last activity, permitted actions. Open a row to see history and future sequence steps. Future times beyond the next committed action are projections.

Waiting reasons: sequence delay, outside sending hours, daily limit, campaign paused, enrollment paused, manual task pending, retry backoff, sender unavailable, scheduling unavailable, or review required. Completed/stopped enrollments show their terminal reason rather than a countdown.

The campaign list gets search, status/attention filters, table/card modes, progress, next send, and waiting/failed totals. Server aggregation must avoid a separate request per campaign.

### 2. Proposed scheduling policies

- First release preserves immediate first-step behavior within the allowed sending window. Reject or clearly disable a nonzero first-step delay until scheduled-first-step support is implemented; never silently ignore the configured delay.
- Later-step delay starts from successful provider acceptance, not opens or delivery callbacks. Manual-call steps start the next delay after task completion.
- Retain integer-hour behavior for existing sequences. Add explicit minute/hour/day duration support as a later compatible extension; do not infer timing from campaign names.
- Pause freezes remaining sequence/retry delay. Resume reapplies sending windows and available capacity without restarting completed steps. Recompute capacity deferrals rather than freezing an old daily-cap reset date.
- Track campaign pause and individual enrollment pause independently. Resuming a campaign must not resume a manually paused lead.
- A paused campaign cannot send through manual retry. Retry records intent or is rejected with an explanation until resumed.
- Stop for reply, opt-out, removed enrollment, deleted/inactive campaign, or ineligible lead. Apply existing template approval checks at execution time.
- Changes create a new immutable sequence snapshot for future enrollments; existing enrollments retain their snapshot. Moving existing leads to a new version is a separate reviewed action.
- A one-time campaign completes only when all enrollments are terminal and no unresolved dispatch remains. A campaign accepting future triggered enrollments may remain active while showing “Waiting for new leads.”
- Pause acknowledges a boundary: messages already accepted by the provider cannot be recalled. Return an in-flight count and explain it. Do not promise zero sends after a click without defining this boundary.

### 3. Proposed durable execution design

PostgreSQL owns campaign enrollment/execution state. BullMQ wakes workers; Redis job presence is not the source of truth for progress or counts.

Proposed new structures, final schemas to be reviewed before any migration runs:

| Structure | Minimum purpose |
|---|---|
| Enrollment execution state linked to existing `campaign_leads` | Enrollment status, pinned sequence snapshot, next step, due time, delay remaining, pause reasons, stop reason, scheduling generation, timestamps. |
| Immutable sequence snapshots | Ordered step definitions at enrollment, preserving which instructions apply. Template content revision policy must be explicit; approval is always rechecked. |
| Step execution records | Unique enrollment + snapshot + step identity; state, scheduled/eligible timestamps, transport job reference, attempts, provider reference, lease, error category, timing override provenance. |
| Campaign-day capacity reservations | Atomic reservations for a campaign-local date; prevent concurrent overshoot; track accepted, releasable failure, and uncertain outcomes. |

Use repository transactions and unique constraints for atomic transitions. Services own scheduling decisions and downstream scheduling; worker processors call services rather than embedding cross-module queries or directly scheduling the next job.

Execution flow:

1. Validate campaign and enrollment; persist a step execution and durable scheduling intent in one transaction.
2. A bounded publisher schedules the BullMQ wake-up using an opaque stable execution ID plus generation.
3. The worker asks the service to claim a valid due execution; stale/duplicate generations exit without sending.
4. Recheck campaign, enrollment, stop rules, template approval, and timing; atomically reserve daily capacity.
5. Persist sending intent, invoke the connector, then record accepted, definite failure, or uncertain outcome.
6. On acceptance, record the send and next-step intent transactionally. On failure, apply retry policy or require review. A recovery sweep republishes due unscheduled work and detects expired leases.

The current outbox publisher only routes lead events. Add an explicit campaign/outreach scheduling dispatcher or a dedicated scheduling-intent publisher using the same transaction/recovery pattern. Never assume the existing event allowlist accepts new scheduling messages.

Do not claim exactly-once email delivery. If a provider accepts a send but the process dies before recording it, use connector-supported idempotency/reconciliation where available; otherwise mark the result uncertain and require review instead of blindly resending. Provider-by-provider capability verification is an implementation task.

Campaign pause invalidates unclaimed generations and freezes pending delay state. Active dispatch claims are surfaced as in-flight. Removal and opt-out invalidate future executions. Recovery cannot revive terminal or paused enrollments.

### 4. Target API and frontend contract

This is the design target recorded before implementation, not a claim that
every item shipped. The implemented routes and UI are documented in
`docs/CAMPAIGNS_MODULE.md` §14a. In particular, the committed schedule endpoint
is not cursor-paginated, and future-step projections remain indicative rather
than using pinned snapshots and shared send-window calculations.

Preserve existing `/api/v1/campaigns` routes and response envelope. Add Zod-validated contracts; the following paths are proposals:

- `GET /api/v1/campaigns/:id/operations`: next activity, counts by state/channel, campaign-local capacity, diagnostic reasons, freshness time.
- `GET /api/v1/campaigns/:id/schedule`: cursor-paginated committed upcoming work; separate projected steps from scheduled executions.
- `GET /api/v1/campaigns/:id/activity`: cursor-paginated operational history.
- Add a paginated enrollment endpoint or an explicitly versioned response so existing `/:id/leads` array consumers continue working.
- Enrollment pause/resume and reschedule mutations: validate ownership, allowed transitions, reason, and optimistic version. Return conflicts for stale state.
- Existing campaign pause/resume responses gain operational results compatibly: affected, in-flight, restored, and blocked counts.

New routes receive explicit role authorization and object-level access checks consistent with the product's RBAC policy. Frontend calls stay in `frontend/src/api/campaigns.ts` through `apiClient` and TanStack Query. Start with bounded polling while the campaign screen is visible, stop while hidden, and invalidate after mutations. SSE can follow if measured freshness needs justify it.

The overview, lead rows, previews, and actual scheduler use the same backend timing calculation. Never create a browser-only countdown from the last activity timestamp.

### 5. Reporting definitions

- Sent = distinct accepted step executions with a recorded sent event, even if their status later advances.
- Attempts and failed attempts are separate from messages and unresolved failed steps. A retry that succeeds must not leave the lead counted as unresolved failure.
- Delivered/opened/replied = recorded events with consistent distinct execution identities. Preserve timestamps under duplicate/out-of-order callbacks.
- Missing tracking data means unknown; do not invent delivery events from opens. Show unavailable denominators as unavailable rather than misleading 0%.
- Remaining potential steps exclude terminal enrollments; scheduled counts include only committed next executions.
- Partition email metrics from other channels and manual tasks. Reporting must reconcile summary and step totals under the same filters.

### 6. Delivery phases and acceptance gates

| Phase | Deliverables | Exit gate |
|---|---|---|
| 0 — Reproduce and specify | Reproduce pause/resume, paused retry, summary mismatch, cap race; lock reporting and pause semantics; inspect deployed/migration state read-only with approved access. | Regression cases and proposed schema/API reviewed; no unverified production claims. |
| 1 — Execution correctness | Consistent stats, execution-time campaign gate, durable enrollment/step state, atomic capacity, pause/resume, pinned sequence, retry/uncertain-send rules, bounded recovery. | No completed step repeats; paused jobs cannot initiate new sends; all due work is recoverable; concurrent sends respect the cap. |
| 2 — Operational visibility | Operations API, next-send panel, lead progress, schedule, activity, waiting reasons, list summaries, preview and launch result. | A user can determine next email, estimated time, recipient count, and waiting reason without opening logs. UI agrees with backend scheduling. |
| 3 — Operator controls | Per-enrollment pause/resume, reviewed rescheduling, selected retries, schedule-change impact preview, explicit stop/completion states. | Bulk operations are permission checked, idempotent, and report partial failures; paused leads remain paused after campaign resume. |
| 4 — Advanced outreach | Explicit minute-based delays, sender capacity, cross-campaign contact frequency, meeting stops, OOO snoozing, conditional steps and experimentation where needed. | Each addition has verified integration contracts and measurable value; it cannot bypass stops or capacity checks. |

Phases 0–2 are the recommended first release. Do not add a visual branching builder or AI timing optimization before scheduling is reliable. A/B configuration already exists in campaign types; audit the actual experiment implementation before proposing another subsystem.

### 7. Migration and rollout

Use a new append-only migration after verifying current migration numbering. Never edit or run existing migrations. Present the new migration for approval before execution.

Ship additive readers/state structures first. Introduce a reviewed rollout flag (name to be chosen and documented, default off), initially scoped to new campaigns. Run a read-only shadow scheduler comparison that cannot enqueue or dispatch.

For existing active campaigns, inventory logs and queued work, stop legacy scheduling at a controlled boundary, and backfill conservatively. Old paused campaigns may have lost their due time when jobs were removed; mark timing as unknown and require an operator-selected resume schedule. Never manufacture a historical due time from the latest activity.

Assign one scheduling owner per campaign and generation. Never let legacy and new schedulers both send for the same enrollment. Reconcile after cutover before enabling dispatch.

Rollback disables new dispatch while retaining durable state and records. Do not automatically route migrated campaigns back to legacy sending. Resume only through a reconciled owner; do not drop tables as a rollback shortcut.

## Files Changed

The implementation is in this PR. Migrations `0084`–`0086` are additive and have not been run. The implementation covers durable campaign execution, pause/resume and recovery, operational APIs, and campaign detail/list visibility. The following planned items remain outside this PR:

- Cursor pagination for the committed schedule endpoint.
- Projection based on pinned sequence snapshots and the shared send-window/delay calculation; current projections are indicative and use the live sequence and configured delays.
- Legacy campaign enrollment backfill and guided recovery for old paused campaigns whose due time was lost.
- Minute-based delays, sender rotation, meeting-based stops, and out-of-office snoozing.

## Commands to Run

For this PR, the following targeted validation was run; full repository test suites remain a CI check:

```bash
npm --prefix backend run typecheck
npm --prefix backend run lint
npm --prefix backend run test -- --runInBand
npm --prefix backend run build
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run test
npm --prefix frontend run test:coverage
npm --prefix frontend run build
```

Integration tests use isolated PostgreSQL and Redis with a recording connector; they do not send real outreach. No production database was accessed and no migration was run.

## Verification Steps

1. Three leads × four email steps: report three committed first sends and twelve initial potential sends; after three accepted first sends, report nine potential remaining sends. Replies reduce the potential total.
2. A one-hour delay paused after forty minutes resumes with twenty minutes remaining, then applies the sending window. Repeated pause/resume does not duplicate or reset work.
3. Pause while dispatch is being claimed; assert no new claims after the committed pause boundary and accurately report already in-flight sends.
4. Manual retry on a paused campaign cannot initiate delivery; double-click retry/resume is idempotent.
5. With one daily slot and ten simultaneous workers, at most one new send is accepted under the reservation policy. Verify reservation recovery for definite failures versus uncertain outcomes.
6. Crash before queue publication, after publication, after provider acceptance, and before next-step persistence. Assert recovery or explicit uncertainty without silent loss or blind duplicate delivery.
7. Opt-out, reply, lead removal, deleted campaign, and sequence/template changes invalidate the appropriate pending work. Replayed jobs never restart terminal enrollment.
8. Verify DST transitions, half-hour timezones including Asia/Kolkata, weekends, midnight boundaries, cap resets, provider throttling, and worker downtime. Never send earlier than eligible time.
9. Repeated and out-of-order tracking events preserve event timestamps; campaign and step metrics reconcile; absent delivery tracking is labelled unknown.
10. Phone-call completion schedules exactly one next step; duplicate completion cannot advance twice.
11. Screen coverage: loading, empty, error, stale/offline, no recipients, all stopped, partial launch, mobile, keyboard navigation, readable timezone, and countdown accessibility.
12. Integration tests use real isolated PostgreSQL/Redis and a recording connector. Meet 70% coverage for changed modules; retain required auth/RBAC coverage if touched.

Proposed operational targets: scheduler reconciliation every minute, visible due-work backlog and oldest-overdue age, no queue-wide scan per page request, and server pagination with bounded query counts. Establish load targets from measured campaign volume before committing latency or scale claims.

## Risks / Edge Cases

- Network side effects cannot be rolled back with a database transaction. Uncertain delivery needs explicit handling.
- Existing paused campaigns may lack recoverable timing; manual reconciliation is required.
- A daily cap is not a smooth sending rate. Capacity reservation and pacing are separate controls.
- Booking/OOO/cross-campaign limits require additional policy decisions and source verification; they are later scope.
- Shared sequence/template edits need version semantics; copying only template IDs does not freeze message content.
- Proposed state names require migration/schema/type alignment; do not reuse current enums without verification.
- The pre-existing working tree changes may overlap planned modules; isolate edits and inspect again before implementation.

## Security Considerations

Retries, resumes, and reschedules cannot bypass opt-out, campaign/enrollment state, template approval, or permissions. IDs in job keys must be opaque; do not include email addresses or message content in queue keys, metrics, or logs. Audit operator identity and action with minimal necessary data.

This work may later touch webhook event integration and RBAC rules, which are security-sensitive and require explicit review. No auth/RBAC middleware edits are proposed. Message bodies and recipient details must follow existing access checks. Production migrations require the project's approval process.

# AI Copilot Agent Gaps and Improvement Plan

**Last updated:** 2026-06-29

This document captures the gap between the current CRM Copilot behavior and the expected agentic CRM command surface.

The immediate symptom is visible on the Scrapers page: the UI shows scraper sources such as `my web scrapper` and `places`, but Copilot still asks the user for a raw scraper config ID. That means the Copilot is not reliably using screen context or resolving visible names to internal IDs.

---

## 1. Current Problem

Current user prompt:

```text
can you ran the scrapper
```

Current Copilot reply:

```text
I can run the scraper, but I need the config ID to proceed.
Please provide the scraper configuration ID you'd like to run.
```

Expected Copilot behavior when the user is on `/scraper` and two scraper sources are visible:

```text
I can see 2 scraper sources: my web scrapper and places. Which one should I run?
```

Expected behavior after the user says `run places`:

```text
I prepared scraper run for places for approval in AI Inbox.
```

The user should never need to know or paste an internal UUID when the current screen already contains the relevant record names.

---

## 2. Root Cause

The current Copilot is still too close to a plain chatbot with function calling.

It has a tool/action catalog, but it lacks a strong runtime context layer:

1. It does not consistently receive the current page route and visible records.
2. It does not reliably resolve names like `places` to internal IDs.
3. The AI tool schema requires IDs, so when context resolution fails the model asks the user for those IDs.
4. It gives generic tool-completion replies such as `I ran lead.list successfully` instead of summarizing the returned CRM data.
5. It has no robust typo handling for commands such as `ran`, `scrapper`, or partial names.
6. It does not expose enough state to explain whether an action is pending approval, executed, rejected, or blocked by RBAC.

---

## 3. Gaps To Fix

| Gap | Current behavior | Required behavior | Priority |
|---|---|---|---|
| Screen context | Partially fixed: Copilot now receives route, page title, visible records, available actions, page capabilities, and safe page metrics for major CRM screens. | Keep adding records/actions as new pages are introduced. | P0 |
| Entity resolution | Copilot asks for raw IDs. | Resolve visible names to IDs internally before proposing tools. | P0 |
| Scraper command handling | `run scraper` asks for config ID even when sources are visible. | If one source is visible, prepare approval; if multiple sources are visible, list names and ask which one. | P0 |
| Generic context | Fixed for current major pages: leads, campaigns, pipelines, templates, sequences/outreach, scraper, reports, dashboard, settings, integrations, users, AI settings, scoring, assignments, custom fields, AI Inbox, and AI Decisions. | Add coverage for any future pages and page-specific workflows. | P0 |
| Typo tolerance | Misses prompts like `ran the scrapper`. | Normalize common misspellings and use fuzzy matching for visible record names. | P1 |
| Result summaries | Partially fixed for dashboard, lead list, campaign list/stats, lead detail, and AI Inbox actions. | Add summarizers for every action result shape. | P1 |
| Approval visibility | Says action prepared but not enough operational detail. | Show approval state, linked AI Inbox item, and action status. | P1 |
| Action safety | Depends on model arguments when IDs are missing. | Backend resolver must validate all context-derived IDs and enforce RBAC/policy gates. | P0 |
| Observability | Hard to trace why Copilot asked for an ID. | Log resolver decisions: route, entity type, match count, chosen ID, action name, policy result. | P1 |
| Tests | Backend resolver tests now cover scraper ambiguity/name resolution, typo prompts, campaign context, lead list summaries, AI Inbox actions, and screen-awareness replies. | Add frontend context-builder tests and browser-level chat flow tests. | P0 |

---

### Implemented screen-awareness improvements

Current implementation progress:

- Frontend sends route, page title, visible records, available actions, page capabilities, and safe page metrics.
- Backend validates the generic page context payload.
- Backend deterministically answers `what page am I on?` and `what can you do here?` without calling the LLM.
- Context resolver maps visible names to IDs for scrapers, campaigns, leads, pipeline stages, and AI Inbox items.
- AI Inbox items can be approved, rejected, or snoozed from Copilot through the typed `ai.inbox.action` catalog action.
- Read replies are summarized for several common actions instead of returning only a tool status.
- Lead list prompts now honor explicit requested limits such as 25 or 75 and list all returned lead names instead of only top 5 matches.

Remaining work:

- Add frontend unit tests for the context builder.
- Add Playwright coverage for real chat flows on Scraper, AI Inbox, and Settings pages.
- Lead list pagination beyond the first requested page still needs a follow-up flow for `next page` / `continue` when `meta.hasMore` is true.
- Add result summarizers for all remaining action result shapes.
- Add page-specific typed tools for safe integration tests, report exports, and campaign brief approval if product policy allows them.

---

## 4. Required Architecture

The Copilot should use this flow:

```text
User message
  -> frontend sends page context
  -> backend validates page context
  -> deterministic resolver checks visible records
  -> action proposal uses internal IDs
  -> RBAC + policy gate
  -> execute read action OR create approval item
  -> response summarizer explains the result/status
  -> decision/action log records what happened
```

Do not rely on the LLM to discover internal IDs. The backend should resolve IDs from trusted app context or service-layer lookups.

---

## 5. Page Context Contract

Frontend should send a compact context object with every chat request:

```ts
interface ChatVisibleRecord {
  type:
    | 'lead'
    | 'campaign'
    | 'scraper'
    | 'pipeline'
    | 'pipeline_stage'
    | 'template'
    | 'sequence'
    | 'outreach_task'
    | 'ai_inbox_item'
    | 'ai_decision';
  id: string;
  name: string;
  status?: string;
  subtitle?: string;
  meta?: Record<string, string | number | boolean | null>;
}

interface ChatPageContext {
  route: string;
  pageTitle?: string;
  visibleRecords?: ChatVisibleRecord[];
  availableActions?: string[];
}
```

Rules:

- Cap visible records to a small number, such as 25.
- Send only IDs, names, status, short subtitle, and safe scalar metadata.
- Do not send secrets, API keys, full message bodies, raw notes, or arbitrary DOM text.
- Treat frontend context as a convenience, not authority. Backend services and RBAC still decide whether the action is allowed.

---

## 6. Resolver Behavior

The backend should run a resolver before calling the LLM tool path.

Examples:

| Prompt | Page context | Resolver action |
|---|---|---|
| `run scraper` | One visible scraper | Propose `scraper.run` with that config ID. |
| `run scraper` | Multiple visible scrapers | Ask which source by name. |
| `run places` | Visible scraper named `places` | Propose `scraper.run` for `places`. |
| `pause this lead` | Lead detail page | Propose `lead.pause` for current visible lead. |
| `launch this campaign` | Campaign detail page | Propose `campaign.launch` for current visible campaign. |
| `stats for this campaign` | Campaign detail page | Run `campaign.stats`. |
| `move this lead to qualified` | Lead/pipeline context has lead and stage | Propose `pipeline.move_lead`. |

If the resolver sees multiple possible matches, it should ask a name-based clarification, never an ID-based clarification.

---

## 7. Current Copilot Tools

The in-app Copilot currently works through the CRM agent action catalog, not arbitrary tools.

Current action catalog (57 actions as of 2026-07-15 — see `backend/src/modules/agent/agent.actions.ts`):

| Action | Purpose | Risk |
|---|---|---|
| `lead.list` | List leads with filters. | Read |
| `lead.get` | Get one lead. | Read |
| `lead.create` | Create lead. | Sensitive write |
| `lead.update` | Update lead fields. | Sensitive write |
| `lead.pause` | Pause or resume lead. | Sensitive write |
| `pipeline.move_lead` | Move lead to a pipeline stage. | Sensitive write |
| `campaign.list` | List campaigns. | Read |
| `campaign.pause` | Pause campaign. | Customer-facing write |
| `campaign.resume` | Resume campaign. | Customer-facing write |
| `campaign.launch` | Launch campaign. | Customer-facing write |
| `campaign.stats` | Get campaign statistics. | Read |
| `assignment.override` | Override lead assignment. | Sensitive write |
| `report.dashboard` | Get dashboard metrics. | Read |
| `scraper.run` | Run a scraper config. | Sensitive write |
| `outreach.send_manual` | Enqueue manual outreach. | Customer-facing write |
| `ai.decision.recompute` | Recompute next best action for a lead. | Low-risk write |
| `ai.inbox.action` | Approve, reject, or snooze a visible AI Inbox item. | Compliance-critical |
| `template.list` / `template.create` | List / create message templates. | Read / Sensitive write |
| `sequence.create` / `sequence.list` | Create / list outreach sequences. | Sensitive write / Read |
| `campaign.create` / `campaign.add_leads` | Create a draft campaign / add leads to a campaign. | Sensitive write |
| `pipeline.list` | List pipelines and stages. | Read |
| `scraper.list` | List scraper source configs. | Read |

### Gap-closing actions added 2026-07-15

The action catalog originally covered 8 of 28 backend modules end-to-end. The actions below close that gap — every module now has at least a read action, and modules with meaningful write workflows (activities, templates approval, custom fields, scoring, campaign briefs) also get scoped write actions. All follow the same pattern: Zod-validated args, RBAC via `allowedRoles`, a `riskTier` evaluated by `agent.policy.ts`, and (for writes) audit logging / AI Inbox approval where the risk tier requires it.

| Action | Module | Purpose | Risk |
|---|---|---|---|
| `activity.list` | activities | List a lead's activity timeline. | Read |
| `activity.log` | activities | Log a manual call/whatsapp/email/note activity. | Low-risk write |
| `team.metrics` | team-metrics | Per-rep performance and response-time metrics for a date range. | Read |
| `ai.reply.classify` | ai-reply | Enqueue AI classification of an inbound reply. | Low-risk write |
| `ai.reply.history` | ai-reply | List past reply classification decisions. | Read |
| `campaign.brief.get` | ai-campaign-brain | Read a campaign's AI pre-launch brief. | Read |
| `campaign.brief.generate` | ai-campaign-brain | Enqueue generation of a campaign AI brief. | Low-risk write |
| `campaign.brief.approve` | ai-campaign-brain | Approve or reject a generated campaign brief. | Compliance-critical |
| `lead.ai_profile.get` | ai-intelligence | Read a lead's AI memory profile. | Read |
| `lead.research.trigger` | ai-intelligence | Enqueue AI research for a lead. | Low-risk write |
| `ai.decision_log.list` | ai-intelligence | Global AI decision-log audit trail (admin only). | Read |
| `ai.settings.get` | ai-settings | Read AI provider settings (never exposes the API key). | Read |
| `scoring.rules.list` | scoring | List lead scoring rules. | Read |
| `lead.rescore` | scoring | Recalculate score/classification for one lead. | Low-risk write |
| `scoring.recalculate_all` | scoring | Recalculate scores for every lead (admin only). | Sensitive write |
| `template.get` | templates | Get a single template. | Read |
| `template.approve` | templates | Approve or reject a pending template. | Sensitive write |
| `report.get` | reports | Get any of the 6 report types (lead_generation, outreach, pipeline, sales_rep, campaign_analytics, integration_health). | Read |
| `report.export` | reports | Enqueue a CSV/XLSX/PDF export job. | Low-risk write |
| `integration.list` | integrations | List connector status. | Read |
| `integration.test` | integrations | Test a connector's credentials (admin only, never returns decrypted secrets). | Low-risk write |
| `custom_field.list` | custom-fields | List custom field definitions. | Read |
| `custom_field.create` | custom-fields | Create a new custom field definition (admin only). | Sensitive write |
| `user.list` | users | List active users for assignment targets (admin/manager only). | Read |
| `ab_test.list` | ab-testing | List A/B variants for a template. | Read |
| `ab_test.results` | ab-testing | Get the statistical significance report for a template's variants. | Read |
| `form.list` | forms | List lead-capture forms. | Read |
| `form.analytics` | forms | Get conversion analytics for a form. | Read |
| `scheduling.bookings.list` | scheduling | List the requesting user's own bookings. | Read |
| `scheduling.slots` | scheduling | Get available booking slots for a user/date. | Read |
| `outreach.tasks.list` | outreach | List follow-up tasks (admin/manager/sales). | Read |
| `assignment.eligible_users` | assignments | List users eligible for round-robin assignment (admin/manager). | Read |

Not exposed as Copilot actions (by design, per `CLAUDE.md` Absolute Rules and the AI Architecture Rules): auth/session/RBAC management, migrations, `.env`/API-key reads, hard deletes, and `researchLead`/`generateCampaignBrief`/reply-classification synchronous execution — these route through the existing event-driven BullMQ workers (`enqueueAiResearch`, `enqueueAiCampaignBrief`, `enqueueAiClassifyReply`) rather than being called directly from the action executor, preserving the "AI workers must be purely event-reactive" rule.

Important files:

| Area | File |
|---|---|
| Frontend widget | `frontend/src/components/ChatWidget.tsx` |
| Frontend chat API | `frontend/src/api/chat.ts` |
| Backend chat service | `backend/src/modules/chat/chat.service.ts` |
| Backend chat schema | `backend/src/modules/chat/chat.schema.ts` |
| Chat tools | `backend/src/modules/chat/chat.actions.ts` |
| Action catalog | `backend/src/modules/agent/agent.actions.ts` |
| Policy gate | `backend/src/modules/agent/agent.policy.ts` |
| Action service | `backend/src/modules/agent/agent.service.ts` |
| AI Inbox | `backend/src/modules/ai-inbox/` |
| AI decision log | `backend/src/modules/ai-intelligence/ai-intelligence.repository.ts` |

---

## 8. Skills vs MCP vs In-App Copilot Tools

These are different layers and should not be mixed up.

### Skills

Skills are reusable procedural knowledge for coding agents. The Skills directory describes them as reusable capabilities that enhance agents with procedural knowledge and can be installed with the skills CLI. The Codex page says the CLI installs `SKILL.md` files into the repository for Codex to reference across sessions.

Use Skills for this repository's developer workflow, for example:

- how to debug the Copilot resolver,
- how to add a new CRM action safely,
- how to write tests for chat tools,
- how to verify a frontend context-builder change,
- how to maintain the agent harness architecture.

Skills do not automatically make the production CRM Copilot smarter at runtime unless we build equivalent logic into the application.

### MCP servers

MCP servers connect AI clients to external tools and services. MCP Market describes MCP servers as connectors that let clients such as Claude and Cursor connect to favorite tools, and its leaderboard ranks servers by GitHub stars.

Use MCP for developer tooling or future runtime integrations when there is a clear need, for example:

- browser automation for QA,
- up-to-date docs lookup,
- GitHub issue/PR automation,
- observability investigation,
- safe database inspection in non-production environments.

Do not connect the production Copilot directly to broad MCP tools without a strict allowlist, RBAC, audit logging, and approval gates.

### In-app Copilot tools

The CRM Copilot should keep using the typed CRM action catalog. That is the safest production interface because every action has:

- Zod argument validation,
- RBAC checks,
- policy/risk tier,
- service-layer execution,
- audit/decision logging,
- AI Inbox approval when needed.

---

## 9. Recommended Skills To Add For Developer Agent Harness

Based on the Skills directory and the current CRM codebase, install skills only for developer workflow, not as direct production runtime tools.

Recommended first set:

| Skill | Why it helps |
|---|---|
| `find-skills` | Discover relevant skills from inside an agent session. |
| `systematic-debugging` | Useful for Copilot resolver bugs and tool-call failures. |
| `writing-plans` | Keeps larger agent-harness changes scoped before editing. |
| `executing-plans` | Forces checkpointed implementation instead of broad rewrites. |
| `test-driven-development` | Good fit for resolver behavior: write failing tests first, then fix. |
| `verification-before-completion` | Prevents claiming Copilot works without backend/frontend verification. |
| `webapp-testing` or `playwright-best-practices` | Useful for validating the chat widget in the browser. |

The Skills site lists agent workflow skills for planning, debugging, browser automation, skill discovery, and autonomous task loops. It also lists testing skills for TDD, Playwright automation, React component testing, and final verification passes.

Install command pattern from the Skills site:

```bash
npx skills add <owner>/<repo>
```

Do not install skills blindly. Review each `SKILL.md` before use, and avoid skills that request broad filesystem, credential, browser, or network access without a clear reason.

---

## 10. MCP Tools To Consider Later

MCP Market currently highlights categories relevant to this project: developer tools, browser automation, testing, documentation, database management, observability, and workflow automation.

Possible MCP candidates for development only:

| MCP category/tool | Possible use | Risk note |
|---|---|---|
| Context/docs MCP such as Context7 | Fetch current framework/library docs. | Read-only preferred. |
| Playwright or Chrome DevTools MCP | Verify chat widget and page context in browser. | Should run only against local/dev. |
| GitHub MCP | Create issues/PRs for Copilot gaps. | Requires scoped token and approval. |
| Observability MCP such as Phoenix/Sentry-style tools | Debug LLM/action failures. | Must not expose secrets or PII. |
| Database MCP | Inspect dev/test data while debugging resolvers. | Never use broad production DB access from Copilot. |

For production, prefer internal CRM actions over external MCP tools.

---

## 11. Implementation Plan

### Phase 1: Fix scraper context bug

1. Send visible scraper records from `ChatWidget`.
2. Validate page context in `chat.schema.ts`.
3. Add backend resolver for `scraper.run`.
4. If one scraper is visible, prepare approval.
5. If multiple scrapers are visible, list names and ask which one.
6. Add tests for `scrapper`, `scraper`, `ran`, `run`, and named source prompts.

### Phase 2: Generalize screen awareness

1. Add visible records for leads, campaigns, pipelines, templates, sequences, outreach tasks, AI Inbox, and AI Decisions.
2. Add resolver helpers:
   - `recordsByType`
   - `findVisibleRecord`
   - `resolveCurrentRecord`
   - `resolveActionTarget`
3. Pass compact page context into the LLM prompt for non-deterministic requests.
4. Ensure the model is instructed not to ask for raw IDs when context contains visible names.

### Phase 3: Improve answer quality

1. Add result summarizers per action.
2. Replace `I ran lead.list successfully` with useful summaries.
3. Include counts, names, statuses, and next action when appropriate.
4. Keep replies short for the small widget.

### Phase 4: Add observability and tests

1. Log resolver match decisions.
2. Add unit tests for context resolver behavior.
3. Add frontend tests for context construction.
4. Add Playwright coverage for the Scrapers page chat flow.
5. Add regression tests for no raw ID prompts when visible names exist.

---

## 12. Acceptance Criteria

The fix is complete when:

- On `/scraper`, `run scraper` lists visible scraper names instead of asking for a config ID.
- On `/scraper`, `run places` prepares `scraper.run` with the internal `places` config ID.
- On lead detail, `pause this lead` resolves the current lead without asking for a lead ID.
- On campaign detail, `launch this campaign` resolves the current campaign without asking for a campaign ID.
- Read requests return useful summaries, not generic tool status.
- All write requests still go through RBAC, policy gate, and AI Inbox approval when required.
- Tests cover typo variants and ambiguous visible records.

---

## 13. Sources Reviewed

- Skills directory: https://www.skills.sh/
- Skills for Codex: https://www.skills.sh/agent/codex
- Agent workflow skills: https://www.skills.sh/topic/agent-workflows
- Testing skills: https://www.skills.sh/topic/testing
- MCP Market leaderboard: https://mcpmarket.com/leaderboards

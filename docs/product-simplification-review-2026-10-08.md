# CRM simplification review — 8 October 2026

## Summary

Simplify the work users must understand before completing a task. The strongest immediate opportunity is navigation and workflow consolidation, rather than deleting backend capabilities.

This review combines direct source inspection and an independent GPT-6 Luna assessment. It is a product review, not a runtime usability test. Recommendations are proposals, not measured improvements.

## What I Found

The code supports a practical sales journey: capture or import a lead, identify who needs attention, contact them, record the result, schedule follow-up, and manage their pipeline stage. It also supports a marketing journey: choose an audience, configure messages, review readiness, launch, and handle resulting tasks.

Useful foundations to keep:

- Leads has triage tabs and bulk actions (`frontend/src/pages/LeadsPage.tsx`). Keep bulk actions available when records are selected.
- Lead detail offers quick responses, outcomes, notes, activity history, message history, and a follow-up picker (`frontend/src/pages/LeadDetailPage.tsx:481`, `:571`, `:602`). Follow-up persistence is implemented in `frontend/src/components/ui/FollowUpPicker.tsx`.
- Dashboard already includes a work queue (`frontend/src/pages/DashboardPage.tsx:629`). Keep the action-oriented idea. Its suggestions use individual examples from loaded lists, including a 20-lead query at line 719; do not represent this as a complete operational backlog.
- Campaign setup already permits sequence selection or creation inline (`frontend/src/pages/CampaignFormPage.tsx:755`). Preserve that convenience and launch readiness checks.
- Inbox groups tasks and approvals (`frontend/src/pages/AIInboxPage.tsx:203`). This is useful, but it is currently an AI task feed, not a verified unified customer conversation inbox.

Specific complexity:

- The sidebar declares 17 destinations across six groups (`frontend/src/components/Layout.tsx:32`). The navigation list is rendered without role filtering, including the admin destination. Some routes have role guards; navigation visibility and authorization are separate concerns.
- The app starts at Dashboard while Inbox leads navigation (`frontend/src/App.tsx:199`, `frontend/src/components/Layout.tsx:33`). Dashboard also offers a work queue that points to AI Inbox. Two places compete to explain what to do next.
- Campaign creation has five stages: Basics, Pipeline, Sequence, Leads, Review & Launch (`frontend/src/pages/CampaignFormPage.tsx:67`). The Pipeline stage includes optional auto-enrollment configuration. Manual outreach users must pass through an advanced concept.
- Campaign triggers is another view of campaigns. Its metrics count campaigns and its Create Rule action links to campaign creation (`frontend/src/pages/AutomationRulesPage.tsx:305`). This is a navigation consolidation opportunity, not proof of redundant execution engines.
- Content groups Sequences, Messages, Files, and Pages, while Templates is a separate navigation item (`frontend/src/components/ContentTabs.tsx:4`, `frontend/src/components/Layout.tsx:38`). Users must understand storage categories before choosing a message.
- Workflow cards expose underlying event keys alongside readable trigger names (`frontend/src/pages/WorkflowsPage.tsx:103`). The page also states that customer-facing actions remain guarded pending consent and idempotency checks (`:293`). That wording alone does not establish the current backend readiness.
- Lead outcome buttons record note metadata (`frontend/src/pages/LeadDetailPage.tsx:481`). “Interested” does not change pipeline stage in that handler, and “No answer” does not schedule follow-up there. Keep the recorded outcome distinct from changes users must still make.
- “Sprint 4 active” is development context displayed in the application header (`frontend/src/components/Layout.tsx:210`). It does not help a CRM user decide what to do.

## Assumptions Made

No production changes were made. The primary commercial outcome and actual feature usage have not been confirmed. Sales-first and marketing-first options below remain conditional. Source evidence does not establish adoption, real user confusion, or task completion speed.

## Skill Used

Impeccable, using its distill playbook, informed the simplification strategy. The local `.agents` directory has no matching skill files. The globally available skill was read from `/home/sr-user91/.agents/skills/impeccable/SKILL.md`, with `reference/distill.md`. This was a source-based product simplification review, not the skill's separate visual critique command.

## Fix / Changes

### Priority 1: Make the daily work obvious

Propose four primary destinations for a sales workspace: Today, Leads, Pipeline, Outreach. Put Reports and Settings in secondary navigation. For a marketing workspace, prioritize Campaigns, Responses/Approvals, Leads, and Results. Do not implement either default before confirming the intended primary outcome.

Today should show due or overdue follow-ups, leads requiring attention, and approvals with an obvious next action. Combine presentation of relevant tasks; do not assume the existing dashboard and AI feed are a complete task system. A comprehensive queue may require backend work.

Tradeoff: fewer direct links for experts. Preserve contextual links and an Advanced entry for authorized users.

### Priority 2: Make contacting a lead a single understandable loop

Proposed flow: open lead → choose contact action → record result → choose next follow-up → return to work list.

Show contact details, owner, stage, last activity, and next follow-up first. Keep one prominent contact action. Place enrichment, AI profile, deletion, and less common actions behind clearly labeled secondary controls. Keep notes and history easy to access.

Keep outcomes and stage updates explicit. A useful confirmation might say “Interested recorded. Move to Qualified?” rather than silently interpreting intent. Follow-up timing must remain editable.

Tradeoff: defaults can be wrong for some leads. Allow users to override them and distinguish proposed actions from executed changes.

### Priority 3: Make outreach one setup experience

Propose three stages: Audience → Messages & timing → Review & launch. Keep templates and sequences as reusable internal objects, but let users select or create them inside this flow.

Move pipeline, source/tag enrollment, detailed targeting, and specialized AI settings into optional advanced configuration. Retain visibility of enabled triggers in the final review. Consolidate Campaign triggers into the campaign's automation settings; preserve links for existing users.

Tradeoff: advanced settings become less discoverable. Show a concise summary when configured, and keep a direct edit path.

### Priority 4: Defer promotion of peripheral capabilities

| Capability | Proposed treatment | Reason | Tradeoff / evidence needed |
| --- | --- | --- | --- |
| Visual workflow builder | Advanced admin area | Branching and event configuration are unnecessary for basic follow-up | Power users may rely on custom automation; verify execution readiness and usage |
| AI planner and plan diagnostics | Optional advanced capability | Multi-step plans add approval and recovery concepts | Can help complex recurring work; measure completed tasks and corrections |
| AI profile / campaign brief | Contextual assistance | Users need a useful suggestion more often than another destination | Detailed research remains valuable for some teams |
| Newsletter | Optional marketing area | A separate broadcast job from everyday sales follow-up | Keep prominent if newsletters are the primary customer use case |
| Page builder / A/B tests | Optional marketing tools | Publishing and experimentation introduce additional learning | Could be essential for acquisition-focused teams |
| Scrapers | Lead acquisition tools | Lead discovery is different from working existing leads | Essential if outbound prospecting is the main job |
| Forms / scheduling | Contextual acquisition and booking tools | Useful when needed, not necessarily daily destinations | Could merit primary visibility for inbound or appointment-led teams |
| Reports / team dashboard | One Results entry with role-specific views | Avoid making every user choose between reporting destinations | Managers still need deeper reporting |

These are candidates to move or defer, not confirmed unused features. No backend deletion is recommended on source inspection alone.

Engineering complexity is justified when it protects users: validation, permissions, consent, approval gates, idempotency, background processing, retries, and budget limits should remain. The inspected planner budget tracker enforces step, cost, and deadline limits (`backend/src/modules/agent-planner/runner.budget.ts`). A simpler interface must preserve these protections.

## Files Changed

Only this review document. Application code and configuration were not changed.

## Commands to Run

None required for this document. Before later implementation, read the applicable module skill and source, then use the actual package scripts for affected builds, lint, and tests.

## Verification Steps

Source observations were cross-checked against navigation, routes, campaign setup, lead outcomes, follow-up persistence, dashboard data loading, and automation pages. Luna provided an independent read-only assessment. No browser session, running backend, customer usage data, or automated tests were used to establish usability.

For a later prototype, test these tasks with representative users: add a lead, find a due follow-up, contact a lead and record an outcome, launch a small campaign, and approve or reject a proposed action. Record completion, wrong turns, assistance needed, time, and whether users can explain what happened. Establish a baseline before claiming improvement. Specifically verify keyboard/mobile access, preserved drafts, accurate task counts, and the advanced-feature access path.

## Risks / Edge Cases

- Simplification must account for sales, marketing, managers, and admins; one navigation layout may not fit all.
- Hiding a capability can disrupt existing users. Preserve routes and active configuration before considering retirement.
- A merged task display must avoid duplicates, misleading urgency, and omission of tasks outside the loaded page.
- Fewer wizard screens must not obscure audience, message, timing, or trigger consequences.
- Do not equate number of backend modules with overengineering. Architectural consolidation needs separate dependency and operational evidence.

## Security Considerations

Preserve RBAC, validation, opt-out/consent checks, launch safeguards, audit history, and approval boundaries. Hiding navigation does not authorize or secure a route. Avoid broad “approve all” interactions without understandable consequences and item details. No authentication, RBAC, webhook, migration, environment, or production deployment files were changed or read for secrets.

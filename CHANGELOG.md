# Changelog

## [0.8.0.0] - 2026-10-21

### Added
- Filter leads using existing tags and combine tag selection with contact status and other filters.
- Save named lead filter groups for your account in the current browser.
- Suggest existing tags during bulk tagging and reuse their spelling.

## [0.7.0.0] - 2026-10-21

### Added
- Let each lead keep optional additional email addresses and phone numbers while retaining the required primary contacts.
- Show and edit additional contacts on the lead form and detail page.

## [0.6.0.2] - 2026-10-16

### Fixed
- Give campaign and manual email sends a personal unsubscribe link after personalization, repair hardcoded local opt-out links, and warn when a template has no recipient link.
- Insert personalization variables without typing tokens by using **Variables** beside custom HTML email subjects, preheaders, and content. The HTML editor also shows the `{{unsubscribe_link}}` markup.

## [0.6.0.1] - 2026-10-16

### Fixed
- Keep entered lead details visible after a save error and show the server’s explanation in the form.

## [0.6.0.0] - 2026-10-16

### Changed
- Make newsletter audience eligibility and subscriber preferences easier to understand, including topic targeting, frequency limits, send holds, and next-eligible times in India Standard Time.
- Let admins update a subscriber’s newsletter topics and maximum sending frequency from subscriber details.
- Show clear explanations when contacts cannot receive a newsletter, and prevent sending when no recipients are eligible or the eligibility check is unavailable.

### Fixed
- Default subscriptions with no selected topics to all newsletter topics when the email address is confirmed, while preserving explicit topic choices.
- Provide retry and unsubscribe guidance on public preference links, and show each recipient’s current subscription state.

## [0.5.0.0] - 2026-10-15

### Added
- Campaign operations with durable enrollment snapshots, scheduled step execution, pause/resume controls, recovery, and per-enrollment progress.
- Campaign sequence previews and operational metrics for delivery, engagement, failures, and funnel progress.
- Append-only migrations 0085–0087 for durable campaign execution; apply these migrations before enabling `CAMPAIGN_OPERATIONS_V2_ENABLED`.
- Persist newsletter composer drafts on the server, with revision-safe editing, duplication, deletion, and retryable sends.
- Enforce rolling 24-hour, 7-day, and 30-day newsletter send limits per subscriber.
- Default newsletter scheduling to India Standard Time and select all three newsletter topics after email confirmation.

### Fixed
- Keep phone-task follow-ups under durable enrollment ownership and use each enrollment's pinned sequence snapshot.
- Run campaign migration-chain and execution integration tests against isolated PostgreSQL and Redis services in CI.

## [0.4.0.1] - 2026-10-15

### Fixed
- Clear notification timers on dismissal and unmount to prevent a frontend test teardown error from blocking deployment of newsletter contact enrollment.

## [0.4.0.0] - 2026-10-15

### Added
- Admins can select CRM leads and add them directly to the newsletter audience, with immediate enrollment and unsubscribe links in future emails.

## [0.3.2.1] - 2026-10-14

### Added
- Newsletter workspace with audience filters, CSV export, broadcast history, draft composition, previews, test sends, and timezone-aware scheduling.
- Reviewable AI digests and targeted recovery for failed or uncertain recipients.
- Append-only migrations 0079, 0081, 0082, and 0083 for broadcast history and compatible subscriber tokens; database application requires approval.

### Fixed
- Preserve older unsubscribe links and enforce current topic/frequency preferences before dispatch.
- Persist digest status and make broadcast retries idempotent with provider-acceptance accounting.

## [0.3.2.0] - 2026-10-14

### Changed
- Simplified template actions by removing the redundant working-copy action and making duplication explicit.
- Hide the Saved snippets tab when the library is empty while preserving access to search and error states.

### Fixed
- Campaign sequence previews render HTML email templates in a sandboxed preview instead of showing raw markup.

## [0.3.1.0] - 2026-10-14

### Changed
- Templates is now the single library for reusable messages; existing saved snippets remain searchable there as reference material.
- Old Messages links open Templates, and Content retains Sequences, Files, and Landing pages.

### Fixed
- Content stays highlighted when browsing Files or Landing pages.

## [0.3.0.0] - 2026-10-14

### Added
- Review-first scraper research with target scoring, candidate assessment, and explicit import selection.
- Scraper source capability and credential requirement guidance in the configuration UI.

### Changed
- Browser requests now validate DNS answers before continuing, including subresources.
- Research settings are validated on save, and malformed stored settings fail closed to review.
- Review staging retains every fetched candidate and pending counts exclude completed imports.

## [0.2.0.0] - 2026-10-13

### Changed
- Copilot now groups Chat, Approvals, and admin-only recent AI Activity in the right-side workspace.
- Approval counts refresh automatically and pagination keeps all pending items accessible.

### Fixed
- Approval notifications and old Inbox links open the Copilot Approvals tab.
- The Copilot panel fits shorter screens.

## [0.1.0.0] - 2026-10-13

### Added
- Admins can enable or disable multi-step AI Copilot plans from AI Settings.
- Copilot approvals are available from the right-side panel, keeping the navigation focused on CRM work areas.

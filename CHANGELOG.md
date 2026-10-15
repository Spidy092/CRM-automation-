# Changelog

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

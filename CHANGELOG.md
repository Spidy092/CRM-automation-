# Changelog

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

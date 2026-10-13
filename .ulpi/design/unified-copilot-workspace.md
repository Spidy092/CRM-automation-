# Unified Copilot Workspace

Every screen must read as the same product if placed side by side.

## Goal

Replace the ambiguous former AI Inbox surface with one right-side Copilot workspace. A user can talk to Copilot, resolve the AI work assigned to them, and, if they are an admin, inspect recent AI activity without leaving the page.

## Scope and permission boundary

- Keep the sidebar free of an AI Inbox item.
- The `GET /ai-inbox` API already returns only the current user's items. The workspace must use that endpoint for approvals.
- The existing `GET /ai-intelligence/decisions` endpoint is admin-only. Only an admin sees the Activity tab and it must call that existing endpoint. Do not change backend authorization or expose chain-of-thought to non-admin users.
- Do not add packages, routes, migrations, or a second inbox page.

## Information architecture

The open panel is 25rem wide on desktop and fills the viewport width minus 2rem on smaller screens.

1. **Chat** (default): existing conversation and input.
2. **Approvals**: all currently loaded pending inbox items. The tab label includes the API `total`, so the badge stays correct even if the compact list is limited. Each work item keeps Approve and Reject controls.
3. **Activity** (admin only): the ten most recent decision-log entries. Show decision type, decision result, failure state, model or fallback label, and local timestamp. Do not show chain-of-thought or input context in this compact workspace.

The circular launcher is the panel's only persistent entry point. When closed, it displays the pending total. When a user opens the panel with outstanding work, default to **Approvals**; otherwise default to **Chat**.

## Flow: Resolve AI work

**User story:** As a CRM user, I want all AI approvals assigned to me in one panel so that I can act before the task blocks.

```
[Copilot launcher / badge]
          |
          v
 [Approvals when total > 0]
          |
          v
 [Approve or Reject item]
          |
          v
 [invalidate inbox, update count and show resolution]
```

- Refresh the current user's pending approvals every 15 seconds and on window focus.
- A loading tab shows a simple text/skeleton state. An error explains that approvals could not be refreshed and provides a Retry control.
- An empty approvals state says `No approvals waiting for you.`
- During approval mutation, disable both action buttons for that item; success remains visible in place until the query refreshes.

## Flow: Review AI activity (admin)

**User story:** As an admin, I want to see recent AI outcomes in Copilot so I can notice failures without opening a separate audit page.

- Refresh the decision log every 30 seconds and on window focus while the user is an admin.
- Show a compact error state with Retry if the audit request fails.
- Empty state: `No recent AI activity.`
- The detailed administrative audit route remains available; this panel is a concise monitor, not a duplicate full audit tool.

## Components

### `CopilotWorkspaceTabs`

- Native button tablist with `Chat`, `Approvals (N)`, and conditional `Activity`.
- `aria-selected`, `role=tab`, and keyboard focus use existing accessible button styling.
- Primary interaction: selected tab uses the locked dark primary color; others remain quiet.

### `ApprovalWorkItem`

- Uses existing `AiInboxItem` and existing action mutation.
- Displays title, summary, urgency only when supplied, action buttons, pending and error states.
- Long text wraps; only the tab body scrolls.

### `ActivityFeed`

- Admin-only. Uses existing `useDecisionLog({ limit: 10, offset: 0 })` query with a 30-second refetch option.
- Each row is a divider-led list entry, not a nested card: decision type, result, metadata/time, and a red status treatment when `decision === 'failed'`.

## Acceptance criteria

- [ ] No AI Inbox item appears in the sidebar.
- [ ] Chat, approvals, and admin activity live under the one Copilot launcher.
- [ ] Pending badge uses inbox `total`, not loaded item count.
- [ ] Pending items refresh every 15 seconds and upon focus; admin activity refreshes every 30 seconds and upon focus.
- [ ] Approve/reject preserves current mutation and query invalidation behavior.
- [ ] Non-admin users do not request or see the admin decision log.
- [ ] Panel has loading, empty and error states for each networked workspace view.
- [ ] Existing Copilot chat and planner preview remain usable.
- [ ] Tests cover badge total, default tab selection, admin-only activity, and error/empty states.

## Design preflight

- Identity lock: pass. Uses existing product tokens, Outfit type, shadcn controls and Lucide icons.
- Anti-slop: pass. A dense tabbed work surface and divider-led activity list fit operational CRM use; no new gradients, decorative cards, fake metrics, or generic marketing copy.
- State coverage: pass. Loading, empty, error, disabled mutation, focus refresh, and role restriction are specified.
- Accessibility: pass. Tab buttons are labeled, support keyboard focus, use 44px touch targets where practical, and use existing semantic colors with text labels rather than color alone.
- Self-critique: distinctiveness 3, hierarchy 4, consistency 4, accessibility 3, state coverage 4, copy 4, restraint 4, motion 3. Total 29/32. Changes after review: keep activity as a list and restrict it to admins so the panel remains focused and honors the audit endpoint's permission model.

## Engineering handoff

Target: `react-vite-tailwind-engineer`.

Update the existing `frontend/src/components/ChatWidget.tsx` and query hooks only as needed. Use existing Radix/shadcn Button/Input and Lucide icons. Do not recreate components, add packages, change APIs, or alter RBAC.

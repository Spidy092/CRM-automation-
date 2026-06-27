# Phase 2 API Reference

**Base path:** `/api/v1`

## Authentication

All Phase 2 endpoints require a valid JWT Bearer token. Some endpoints also require specific RBAC roles.

- `Bearer` — a JWT access token must be supplied in the `Authorization: Bearer <token>` header.
- `Roles` — the minimum role(s) that may access the endpoint. The application enforces roles via `authorize(...)` middleware.

---

## ai-intelligence

Mount point: `/api/v1/ai-intelligence`

| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| GET | `/api/v1/ai-intelligence/leads/:leadId/profile` | Bearer | admin, manager, sales, marketing, viewer | Get a lead's AI-generated profile (research summary, buying intent, offer angle, objections, buying signals, conversation summary, next best action) |
| GET | `/api/v1/ai-intelligence/leads/:leadId/decisions` | Bearer | admin, manager, sales, marketing, viewer | Get a lead's AI decision log entries |
| GET | `/api/v1/ai-intelligence/decisions` | Bearer | admin | Get the global AI decision audit trail |

---

## ai-reply

Mount point: `/api/v1/ai-reply` (planned — not yet wired)

The `ai-reply` module currently exists as a service layer only (`ai-reply.service.ts`, `ai-reply.repository.ts`, `ai-reply.types.ts`). No Express routes or controller are registered in the root router.

The service classifies inbound lead replies by intent, generates draft responses, updates lead memory, and routes high-uncertainty or urgent replies to the AI inbox. Planned HTTP endpoints:

| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| POST | `/api/v1/ai-reply/classify` | Bearer | admin, manager, sales, marketing | Classify an inbound reply from a lead and optionally return a draft response *(planned — not yet wired)* |

Payload shape for the planned classify endpoint is defined in `ai-reply.types.ts`:

```ts
interface ClassifyReplyInput {
  leadId: string;
  channel: 'whatsapp' | 'email' | 'sms';
  messageText: string;
  externalMessageId?: string;
}
```

Response shape:

```ts
interface ReplyClassification {
  intent_class: 'interested' | 'objection' | 'not_now' | 'meeting_request' | 'pricing_question' | 'wrong_contact' | 'opt_out' | 'neutral';
  intent_subtype: string | null;
  confidence: number;
  draft_response: string | null;
  next_best_action: string;
  update_stage_to: string | null;
  objection_type: string | null;
  buying_signal: string | null;
  chain_of_thought: string;
  should_stop_sequence: boolean;
  requires_human_review: boolean;
}
```

> Note: In the current implementation, reply classification is invoked internally by webhook handlers / workers rather than via a public HTTP endpoint.

---

## ai-campaign-brain

Mount point: `/api/v1/ai-campaign-brain`

| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| GET | `/api/v1/ai-campaign-brain/campaigns/:campaignId/brief` | Bearer | admin, manager, marketing, sales, viewer | Get the AI-generated strategy brief for a campaign |
| POST | `/api/v1/ai-campaign-brain/campaigns/:campaignId/brief/approve` | Bearer | admin, manager | Approve a campaign AI brief |
| POST | `/api/v1/ai-campaign-brain/campaigns/:campaignId/brief/reject` | Bearer | admin, manager | Reject a campaign AI brief |

---

## ai-inbox

Mount point: `/api/v1/ai-inbox`

| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| GET | `/api/v1/ai-inbox` | Bearer | admin, manager, sales, marketing | List AI inbox items assigned to the current user (or all items for admin/manager) |
| PATCH | `/api/v1/ai-inbox/:id/action` | Bearer | admin, manager, sales, marketing | Perform an action on an inbox item (approve / reject / snooze) |

---

## ai-settings

Mount point: `/api/v1/ai-settings`

All routes in this module apply `authenticate` and `authenticatedLimiter` globally via `router.use(...)`.

| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| GET | `/api/v1/ai-settings` | Bearer | admin, manager, sales, marketing, viewer | Get AI provider settings (model, base URL, temperature, max tokens, autonomy defaults) |
| PATCH | `/api/v1/ai-settings` | Bearer | admin | Update AI provider settings |

---

## Event Bus (internal)

Internal AI events use `backend/src/shared/events/eventBus.ts` and are not exposed via HTTP. Downstream workers such as `aiResearch.worker.ts`, `aiReply.worker.ts`, `aiCampaignBrain.worker.ts`, and `aiInbox.worker.ts` consume these internal events.

---

## Last verified

2026-06-27 — extracted from the Phase 2 route files and `backend/src/index.ts`.

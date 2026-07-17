# MCP Connection — AI Sales Operator CRM

This CRM exposes a Model Context Protocol (MCP) server so external MCP clients
(Claude Desktop, Claude Code, other MCP-compatible agents) can operate the CRM
through the **same 57-action agent catalog** the in-app Copilot uses —
`backend/src/modules/agent/agent.actions.ts`. There is no separate tool
surface: MCP is a second front door onto the existing action pipeline.

## What this is (and isn't)

- **Is**: a thin JSON-RPC 2.0 / MCP Streamable HTTP adapter
  (`backend/src/modules/mcp/`) in front of `proposeAgentAction`.
- **Isn't**: a new permission model. Every MCP call still goes through:
  JWT authentication → per-action `allowedRoles` (RBAC) → `agent.policy.ts`
  risk-tier gate → (for writes) an AI Inbox approval item → audit log
  (`agent_actions`, `ai_decision_log`).
- Read actions execute immediately and return data. Every write action —
  regardless of client — is treated exactly like a chat-originated request:
  it is recorded and requires human approval before it runs. MCP gets no
  special trust; it is deliberately weaker than autopilot mode, per the
  Autonomous Operation Rules in `CLAUDE.md`.

## Endpoint

```
POST /api/v1/mcp
```

- Stateless: no `Mcp-Session-Id`, no SSE stream. Every request is a single
  POST with a JSON-RPC message (or a batch array) and gets a JSON response.
- Auth: same JWT bearer token as the REST API (`Authorization: Bearer <token>`).
  Get one via `POST /api/v1/auth/login` (see `docs/API.md`).
- Rate limited by the existing `authenticatedLimiter`
  (`RATE_LIMIT_WINDOW_MS`, default 60s window — see `.env.example`).
- `GET /api/v1/mcp` returns `405` — this server does not offer an SSE stream.

## Supported methods

| Method | Behavior |
|---|---|
| `initialize` | Returns `protocolVersion`, `capabilities: { tools: {} }`, `serverInfo`. Supports `2024-11-05`, `2025-03-26`, `2025-06-18`; unknown versions fall back to `2025-03-26`. |
| `ping` | Returns `{}`. |
| `tools/list` | Returns every catalog action the caller's role is allowed to use, as an MCP tool (`inputSchema` reused verbatim from `chat.actions.ts` so MCP and the in-app Copilot can never drift apart). |
| `tools/call` | Routes to `proposeAgentAction` with `source: 'chat'`. Returns `{ content: [{ type: 'text', text: '<JSON>' }] }`; the JSON payload has `status: 'succeeded' | 'pending_approval'` plus the result or the `agent_action_id` to track in the AI Inbox. |

Tool names use `__` instead of `.` (MCP/OpenAI tool names must match
`^[a-zA-Z0-9_-]{1,64}$`) — e.g. `lead.list` → `lead__list`,
`campaign.brief.get` → `campaign__brief__get`.

## Connecting a client

### Claude Code / Claude Desktop (`.mcp.json`)

```json
{
  "mcpServers": {
    "crm": {
      "type": "http",
      "url": "http://localhost:3000/api/v1/mcp",
      "headers": {
        "Authorization": "Bearer <JWT_ACCESS_TOKEN>"
      }
    }
  }
}
```

Replace the URL host/port with your deployed API origin, and the token with
a real access token for the account you want the agent to act as. Access
tokens are short-lived (15 minutes per `CLAUDE.md`); for anything beyond
manual testing, front this with a token-refresh proxy or a long-lived
service account rather than pasting a raw access token into a config file.

### curl smoke test

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"..."}' | jq -r .data.accessToken)

curl -s -X POST http://localhost:3000/api/v1/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq .
```

## Files

| Area | File |
|---|---|
| JSON-RPC / MCP param schemas | `backend/src/modules/mcp/mcp.schema.ts` |
| Types, error codes, protocol constants | `backend/src/modules/mcp/mcp.types.ts` |
| tools/list + tools/call → agent pipeline | `backend/src/modules/mcp/mcp.service.ts` |
| JSON-RPC dispatch, initialize/ping/tools handlers | `backend/src/modules/mcp/mcp.controller.ts` |
| Route mounting (auth, RBAC, rate limit) | `backend/src/modules/mcp/mcp.routes.ts` |
| Shared tool-name ⇄ action-name mapping | `backend/src/modules/chat/chat.actions.ts` (`actionNameToToolName` / `toolNameToActionName`) |

## Security notes

- MCP requests carry the caller's real JWT and role — an MCP client
  connected as a `viewer` sees fewer tools in `tools/list` and gets the same
  RBAC rejections as the REST API or in-app Copilot for anything else.
- `tools/call` never bypasses the AI Inbox approval flow for
  `sensitive_write` / `customer_facing_write` / `compliance_critical`
  actions — this matches the "Do not connect the production Copilot
  directly to broad MCP tools without a strict allowlist, RBAC, audit
  logging, and approval gates" guidance in
  `docs/AI_COPILOT_AGENT_GAPS.md` §8, just applied to the *inbound* MCP
  server direction instead of outbound.
- Every call is logged to `agent_actions` / `ai_decision_log` with
  `sourceMessage: "MCP tool call: <name>"` for traceability.

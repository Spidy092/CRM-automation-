# AI Copilot Usage Guide

**Last updated:** 2026-06-29

This guide explains how to configure the AI provider key, how the CRM Copilot works, and how users should operate it safely.

---

## 1. What The AI Copilot Does

The AI Copilot is the floating chat assistant available on authenticated CRM pages. It is backed by the same agent harness used by AI Inbox and background AI decisions.

It can:

- answer CRM questions such as lead lists, campaign lists, campaign stats, and dashboard metrics,
- prepare CRM actions from natural language,
- create approval items in AI Inbox when a requested action needs human approval,
- execute safe read actions immediately,
- keep a short chat history per browser session,
- fall back gracefully when the AI provider is unavailable.

It does not directly bypass CRM security. All actions go through the typed agent action catalog, RBAC checks, policy gates, and existing module services.

---

## 2. Where To Add The AI API Key

Use the app UI. Do not add API keys to frontend code.

1. Log in as an `admin` user.
2. Open **Settings -> AI**.
3. Turn on **Enable AI Engine**.
4. Choose an AI provider:
   - **OpenAI** for the normal OpenAI API.
   - **Xiaomi MiMo** for the configured OpenAI-compatible MiMo endpoint.
   - **Custom** for another OpenAI-compatible chat-completions endpoint.
5. Paste the provider API key into **API Key**.
6. Set **API Base URL**:
   - For OpenAI, leave it blank to use the OpenAI SDK default endpoint.
   - For custom providers, enter the provider base URL, for example `https://provider.example.com/v1`.
7. Set **Model**:
   - Current app preset for OpenAI is `gpt-4o`.
   - Custom providers must use that provider's model name.
8. Keep **Max Tokens** at or below `500`.
9. Click **Save**.

OpenAI keys can be created from the OpenAI platform API keys page: https://platform.openai.com/api-keys

### Important Security Notes

- The backend never returns the raw API key to the frontend. It only returns `has_api_key: true/false`.
- The AI key is stored through `PATCH /api/v1/ai-settings`; only `admin` can update it.
- If `ENCRYPTION_KEY` is set, the backend encrypts the stored AI key with AES-256-GCM.
- If `ENCRYPTION_KEY` is missing, the backend stores the key as plaintext and logs a warning. This is acceptable only for local development.
- Do not paste API keys into chat prompts, issue comments, logs, or screenshots.

---

## 3. Environment Variables Related To AI

The preferred setup is the **Settings -> AI** page because it stores provider config in the database.

The environment also supports:

```env
OPENAI_API_KEY=sk-...
ENCRYPTION_KEY=your-32-byte-hex-key-here
```

How these are used:

- `OPENAI_API_KEY` is a fallback when AI settings exist but no database key is available to the OpenAI SDK path.
- `ENCRYPTION_KEY` protects stored provider keys. Generate it with:

```bash
openssl rand -hex 32
```

Never read or expose the real `.env` file in support messages. Use `.env.example` and `.env.prod.example` as references only.

---

## 4. How To Open And Use Copilot

1. Log in to the CRM.
2. Look at the bottom-right corner of the screen.
3. Click the round chat button.
4. Type a request in plain English.
5. Press Enter or click the send icon.

Example read prompts:

```text
Show dashboard metrics
List my active leads
Show campaigns
Get stats for this campaign
Find leads named Acme
```

Example write/action prompts:

```text
Pause this lead
Move this lead to Qualified
Launch this campaign
Send manual email outreach to this lead
Recompute the AI next action for this lead
```

Read actions can run immediately. Write actions requested from chat are prepared for approval and appear in AI Inbox.

---

## 5. Approval Flow In AI Inbox

When Copilot or an AI worker proposes a risky action, the app creates:

1. an `agent_actions` row as the durable command ledger,
2. an `ai_inbox_items` row as the user-facing approval item.

To approve or reject:

1. Open **AI Inbox** from the left navigation.
2. Review the item title, summary, urgency, confidence, draft response, and linked action badge.
3. Click:
   - **Approve** to execute the linked action once,
   - **Reject** to cancel the linked action,
   - **Snooze** to delay it for 4 hours.

After approval, the inbox item stores an action result so the user can see what happened.

---

## 6. What Happens Behind The Scenes

The flow is:

```text
User chat / AI event / AI reply
        -> action proposal
        -> Zod argument validation
        -> RBAC + policy gate
        -> execute now OR create AI Inbox approval
        -> typed executor calls existing CRM service
        -> audit log + decision log + metrics
```

Important backend pieces:

| Area | File |
|---|---|
| Chat routes | `backend/src/modules/chat/chat.routes.ts` |
| Chat service | `backend/src/modules/chat/chat.service.ts` |
| Action catalog | `backend/src/modules/agent/agent.actions.ts` |
| Policy gate | `backend/src/modules/agent/agent.policy.ts` |
| Action executor | `backend/src/modules/agent/agent.service.ts` |
| AI Inbox approval | `backend/src/modules/ai-inbox/ai-inbox.service.ts` |
| AI settings | `backend/src/modules/ai-settings/ai-settings.service.ts` |
| Frontend widget | `frontend/src/components/ChatWidget.tsx` |
| Frontend AI settings | `frontend/src/pages/AISettingsPage.tsx` |
| Frontend AI inbox | `frontend/src/pages/AIInboxPage.tsx` |

---

## 7. Roles And Permissions

| Role | Copilot behavior |
|---|---|
| `admin` | Can configure AI settings and request/administer most actions. |
| `manager` | Can use reads and approve many CRM actions. |
| `sales` | Can use reads and own-lead actions allowed by services. |
| `marketing` | Can use campaign/template/report-oriented actions. |
| `viewer` | Read-only. Cannot execute or approve writes. |

Policy rules:

- Chat write actions require approval.
- Viewer write actions are rejected.
- Low-risk writes can execute when policy allows.
- Customer-facing writes require approval unless autonomy/policy allows execution.
- Expired/stale actions fail closed before execution.

---

## 8. Supported Copilot Actions

Current action catalog:

| Action | What it does | Risk |
|---|---|---|
| `lead.list` | List leads with filters | Read |
| `lead.get` | Get one lead | Read |
| `lead.create` | Create lead | Sensitive write |
| `lead.update` | Update lead fields | Sensitive write |
| `lead.pause` | Pause/resume lead | Sensitive write |
| `pipeline.move_lead` | Move lead to pipeline stage | Sensitive write |
| `campaign.list` | List campaigns | Read |
| `campaign.pause` | Pause campaign | Customer-facing write |
| `campaign.resume` | Resume campaign | Customer-facing write |
| `campaign.launch` | Launch campaign | Customer-facing write |
| `campaign.stats` | Campaign statistics | Read |
| `assignment.override` | Override lead assignment | Sensitive write |
| `report.dashboard` | Dashboard metrics | Read |
| `scraper.run` | Run scraper config | Sensitive write |
| `outreach.send_manual` | Enqueue manual outreach | Customer-facing write |
| `ai.decision.recompute` | Recompute AI next action | Low-risk write |
| `ai.inbox.action` | Approve, reject, or snooze an AI Inbox item | Compliance-critical |

The model cannot invent new actions. If an action is not in this catalog, the backend rejects it.

---

## 9. Troubleshooting

### Copilot says AI is unavailable

Check:

1. **Settings -> AI** has **Enable AI Engine** turned on.
2. An API key is saved. The API key field should show `(Stored)`.
3. The model name is valid for the selected provider.
4. The base URL is correct for custom providers.
5. Backend logs for provider errors.

The app has deterministic fallback behavior for simple lead, campaign, and dashboard requests when AI is unavailable.

### API key does not save

Check:

1. You are logged in as `admin`.
2. The backend is running.
3. `PATCH /api/v1/ai-settings` is not blocked by auth or RBAC.
4. Database migrations have run.

### Approval created but action did not execute

Check:

1. Open **AI Inbox** and verify the item has `Agent action linked`.
2. Confirm the action was approved, not snoozed or rejected.
3. If it expired, the executor fails closed.
4. Check backend logs for `agent action execution failed`.
5. Check `agent_actions.status` and `agent_actions.error_message` in the database.

### Viewer cannot approve

This is expected. `viewer` is read-only.

---

## 10. Developer Verification Commands

Run these after changing Copilot or AI settings code:

```bash
cd backend
npm run build
npx jest src/modules/agent/agent.policy.test.ts src/modules/agent/agent.service.test.ts src/modules/chat/chat.service.test.ts src/modules/ai-inbox/ai-inbox.service.test.ts src/workers/events.worker.test.ts src/modules/ai-reply/ai-reply.service.test.ts src/modules/ai-reply/ai-reply.repository.test.ts src/modules/pipeline/pipeline.repository.test.ts --runInBand --forceExit
```

```bash
cd frontend
npm run build
```

---

## 11. Quick Start Checklist

- [ ] Run migrations.
- [ ] Set `ENCRYPTION_KEY` in backend environment.
- [ ] Log in as admin.
- [ ] Go to **Settings -> AI**.
- [ ] Enable AI Engine.
- [ ] Select provider.
- [ ] Paste API key.
- [ ] Save settings.
- [ ] Open Copilot from the bottom-right chat button.
- [ ] Ask: `Show dashboard metrics`.
- [ ] Ask a write request and confirm it appears in **AI Inbox**.

---

## 12. Agent Planner (Multi-Step Plans)

The Agent Planner is an optional Copilot mode that breaks open-ended goals into multi-step execution plans. It is available only when the `AGENT_PLANNER_ENABLED` feature flag is on.

### 12.1 Enabling the Planner

1. Open the backend environment configuration (for example `.env` or `.env.prod`).
2. Set:
   ```env
   AGENT_PLANNER_ENABLED=true
   ```
3. Make sure the AI engine is enabled and a provider key is configured in **Settings -> AI**.
4. Restart the backend service.

When the flag is off, Copilot continues to handle requests with the single-action chat flow described in the previous sections.

### 12.2 Starting a Plan from Chat

1. Open the Copilot chat widget.
2. Type an open-ended goal, for example:
   ```text
   Find leads in the Midwest, add them to the Summer Campaign, and start a manual email sequence.
   ```
3. The planner generates a preview that includes:
   - the DAG of planned steps,
   - estimated step count, cost, and runtime,
   - any steps that require approval.
4. Choose one of:
   - **Approve** — enqueue the plan and start execution,
   - **Cancel** — discard the plan and return to chat.

### 12.3 Plan Lifecycle Statuses

A plan can be in one of the following statuses:

| Status | Meaning |
|---|---|
| `pending_approval` | Plan preview created, waiting for user approval. |
| `approved` | User approved the plan; ready to run. |
| `running` | Steps are being executed. |
| `paused` | Execution stopped, usually waiting for an approval gate or a retry. |
| `completed` | All steps finished successfully. |
| `failed` | One or more steps failed and recovery was not possible. |
| `cancelled` | User cancelled the plan before or during execution. |

### 12.4 Approval Flow

Steps that perform CRM writes are marked `require_approval` and create items in the AI Inbox:

1. Open **AI Inbox** from the left navigation.
2. Review each planner approval item. It shows the plan title, step description, and affected records.
3. Approve or reject individual steps.
4. Use the bulk actions to approve or reject multiple planner items at once.
5. Once all required approvals are granted, the runner automatically resumes the plan.
6. If a step is rejected, the plan stops and Copilot reports the cancellation.

Paused plans can also be resumed manually from the plan detail view when the underlying issue is resolved.

### 12.5 Fallbacks

If the planner fails to generate a plan, or if execution times out, Copilot falls back to a plain-text response. It does not execute partial plans silently. You can still ask for the same goal again or break it into smaller single-action requests.

### 12.6 Limitations (v1 MVP)

The initial planner release has the following guardrails:

- **No fully autonomous writes** — all customer-facing or sensitive writes require approval.
- **Action catalog only** — only actions listed in `AGENT_ACTIONS` can appear in a plan. The planner cannot invent new CRM operations.
- **Hard caps** — a single plan is limited to **8 steps**, **$0.50 estimated cost**, and **5 minutes** of runtime. Plans that exceed any cap are rejected before execution.

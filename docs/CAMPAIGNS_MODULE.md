# Campaigns Module Documentation

**Module:** `backend/src/modules/campaigns/`
**Last Updated:** 2026-07-05

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Data Model](#3-data-model)
4. [API Reference](#4-api-reference)
5. [Service Layer](#5-service-layer)
6. [Repository Layer](#6-repository-layer)
7. [Automation Preview & Launch Flow](#7-automation-preview--launch-flow)
8. [Pipeline Auto-Enrollment](#8-pipeline-auto-enrollment)
9. [AI Integration](#9-ai-integration)
10. [Error Handling](#10-error-handling)
11. [Audit Logging](#11-audit-logging)
12. [Testing](#12-testing)
13. [Frontend Pages](#13-frontend-pages)

---

## 1. Overview

The Campaigns module manages the full lifecycle of outreach campaigns — from creation through targeting, sequencing, launch, and performance tracking. It serves as the orchestration layer between leads, outreach sequences, templates, and integration connectors.

### Responsibilities

- Campaign CRUD with lifecycle state machine
- Lead targeting by industry and country
- Outreach sequence assignment and step management
- Pre-flight validation before campaign launch
- Pipeline-based auto-enrollment triggers
- AI personalization toggle and brief generation
- Campaign statistics aggregation
- Audit logging on every mutation

### Key Files

| File | Lines | Purpose |
|------|-------|---------|
| `campaigns.controller.ts` | 196 | HTTP request handlers |
| `campaigns.service.ts` | 454 | Business logic, validation, audit |
| `campaigns.repository.ts` | 354 | PostgreSQL queries |
| `campaigns.routes.ts` | 50 | Route definitions + RBAC |
| `campaigns.schema.ts` | 29 | Zod validation schemas |
| `campaigns.types.ts` | 110 | TypeScript type definitions |

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    CAMPAIGNS MODULE                      │
│                                                         │
│  ┌──────────┐   ┌──────────┐   ┌──────────────────┐   │
│  │ Routes   │──▶│Controller│──▶│    Service       │   │
│  │ (RBAC)   │   │ (Zod)    │   │ (Business Logic) │   │
│  └──────────┘   └──────────┘   └────────┬─────────┘   │
│                                         │               │
│            ┌────────────────────────────┤               │
│            ▼                            ▼               │
│  ┌─────────────────┐     ┌──────────────────────────┐  │
│  │   Repository    │     │    External Calls        │  │
│  │  (PostgreSQL)   │     │  - Outreach Queue        │  │
│  └─────────────────┘     │  - AI Campaign Brain     │  │
│                          │  - Outreach Repository   │  │
│                          │  - Template Repository   │  │
│                          │  - Integration Repository │  │
│                          └──────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Dependencies

```
campaigns.service.ts
  ├── outreach/outreach.repository.ts    (sequence lookup)
  ├── outreach/outreach.prompt.ts        (AI personalization)
  ├── templates/templates.repository.ts  (template validation)
  ├── integrations/integrations.repository.ts (connector check)
  ├── ai-campaign-brain/ai-campaign-brain.repository.ts (brief lookup)
  ├── workers/queue.ts                   (BullMQ job enqueue)
  └── shared/utils/audit.ts              (audit logging)
```

---

## 3. Data Model

### Tables

#### `campaigns`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `name` | VARCHAR(255) | Campaign name |
| `status` | ENUM | `draft`, `active`, `paused`, `completed`, `archived` |
| `tone` | ENUM | `formal`, `professional`, `conversational` |
| `target_industries` | TEXT[] | Array of industry strings to target |
| `target_countries` | TEXT[] | Array of country strings to target |
| `sequence_id` | UUID FK → `outreach_sequences` | Associated outreach sequence |
| `pipeline_id` | UUID FK → `pipelines` | Pipeline for auto-enrollment |
| `trigger_stage_id` | UUID FK → `pipeline_stages` | Specific stage that triggers enrollment (nullable) |
| `ai_personalization_enabled` | BOOLEAN | Enable AI message personalization |
| `autonomy_level` | ENUM | `supervised`, `guarded`, `autopilot` |
| `ai_min_confidence` | INTEGER | Minimum AI confidence for auto-execution (0-100) |
| `created_by` | UUID FK → `users` | Creator user ID |
| `launched_at` | TIMESTAMPTZ | Launch timestamp |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp |
| `deleted_at` | TIMESTAMPTZ | Soft-delete timestamp |

#### `campaign_leads`

| Column | Type | Description |
|--------|------|-------------|
| `campaign_id` | UUID FK → `campaigns` | Campaign reference |
| `lead_id` | UUID FK → `leads` | Lead reference |
| `added_at` | TIMESTAMPTZ | When lead was added |

**Unique constraint:** `(campaign_id, lead_id)`

### State Machine

```
                    ┌──────────┐
                    │  draft   │
                    └────┬─────┘
                         │ launch
                         ▼
                    ┌──────────┐
          ┌────────│  active  │────────┐
          │        └────┬─────┘        │
          │ pause       │              │ complete
          ▼             │              ▼
     ┌──────────┐       │         ┌───────────┐
     │  paused  │       │         │ completed │
     └────┬─────┘       │         └─────┬─────┘
          │ resume      │               │ archive
          └────▶ active │               ▼
                    │             ┌──────────┐
                    └────────────▶│ archived │
                                  └──────────┘

Allowed transitions:
  draft    → active   (launch)
  active   → paused   (pause)
  paused   → active   (resume)
  active   → completed
  completed → archived
```

### Types

```typescript
type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed' | 'archived';
type OutreachTone = 'formal' | 'professional' | 'conversational';
type AutonomyLevel = 'supervised' | 'guarded' | 'autopilot';

interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  tone: OutreachTone;
  target_industries: string[];
  target_countries: string[];
  sequence_id: string | null;
  pipeline_id: string | null;
  trigger_stage_id: string | null;
  ai_personalization_enabled: boolean;
  autonomy_level: AutonomyLevel;
  ai_min_confidence: number;
  created_by: string;
  launched_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface CampaignStats {
  total_leads: number;
  sent: number;
  delivered: number;
  opened: number;
  replied: number;
  failed: number;
}

interface AutomationPreview {
  campaignId: string;
  sequenceId: string | null;
  firstStep: {
    stepNumber: number;
    channel: 'whatsapp' | 'email' | 'sms' | 'phone_call';
    templateId: string;
    delayHours: number;
  } | null;
  eligibleLeads: AutomationEligibleLead[];
  skippedLeads: AutomationSkippedLead[];
  templateIssues: string[];
  connectorIssues: string[];
  expectedJobs: number;
  mockMode: boolean;
}

interface LaunchCampaignResult {
  campaign: Campaign;
  automation: AutomationLaunchMeta;
}
```

---

## 4. API Reference

All routes require JWT authentication via `Authorization: Bearer <token>`.

### List Campaigns

```
GET /api/v1/campaigns
```

**RBAC:** All authenticated users

**Response:** `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Q3 Outreach",
      "status": "active",
      "tone": "professional",
      "target_industries": ["technology", "saas"],
      "target_countries": ["US", "UK"],
      "sequence_id": "uuid",
      "pipeline_id": "uuid",
      "trigger_stage_id": null,
      "ai_personalization_enabled": true,
      "autonomy_level": "guarded",
      "ai_min_confidence": 70,
      "created_by": "uuid",
      "launched_at": "2026-07-01T10:00:00Z",
      "created_at": "2026-06-28T09:00:00Z",
      "updated_at": "2026-07-01T10:00:00Z"
    }
  ]
}
```

---

### Get Campaign by ID

```
GET /api/v1/campaigns/:id
```

**RBAC:** All authenticated users

**Response:** `200 OK` — Single campaign object

---

### Create Campaign

```
POST /api/v1/campaigns
```

**RBAC:** `admin`, `manager`, `marketing`

**Request Body:**
```json
{
  "name": "Q3 Outreach",
  "tone": "professional",
  "target_industries": ["technology", "saas"],
  "target_countries": ["US", "UK"],
  "sequence_id": "uuid",
  "pipeline_id": "uuid",
  "ai_personalization_enabled": true
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | Yes | — | Campaign name (1-255 chars) |
| `tone` | enum | No | `professional` | `formal`, `professional`, `conversational` |
| `target_industries` | string[] | No | `[]` | Industries to target |
| `target_countries` | string[] | No | `[]` | Countries to target |
| `sequence_id` | UUID | No | — | Outreach sequence to use |
| `pipeline_id` | UUID | No | — | Pipeline for auto-enrollment |
| `ai_personalization_enabled` | boolean | No | `false` | Enable AI message personalization |

**Side Effects:**
- Writes audit log (`campaign.created`)
- If `ai_personalization_enabled` is true, enqueues `ai:generate-campaign-brief` job

**Response:** `201 Created` — Campaign object

---

### Update Campaign

```
PUT /api/v1/campaigns/:id
```

**RBAC:** `admin`, `manager`, `marketing`

**Request Body:** Same fields as create (all optional)

**Constraints:**
- Cannot update an active campaign — must pause first
- Throws `400 Bad Request` if status is `active`

**Side Effects:**
- Writes audit log (`campaign.updated`) with before/after values
- If `ai_personalization_enabled` is true, enqueues `ai:generate-campaign-brief` job

**Response:** `200 OK` — Updated campaign object

---

### Delete Campaign

```
DELETE /api/v1/campaigns/:id
```

**RBAC:** `admin`, `manager`

**Constraints:**
- Cannot delete an active campaign — must pause first
- Soft-deletes (sets `deleted_at`)

**Side Effects:**
- Writes audit log (`campaign.deleted`)

**Response:** `204 No Content`

---

### Automation Preview

```
GET /api/v1/campaigns/:id/automation-preview
```

**RBAC:** `admin`, `manager`

Returns a pre-flight validation report showing which leads will be contacted, which will be skipped, and any template/connector issues.

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "campaignId": "uuid",
    "sequenceId": "uuid",
    "firstStep": {
      "stepNumber": 1,
      "channel": "whatsapp",
      "templateId": "uuid",
      "delayHours": 0
    },
    "eligibleLeads": [
      {
        "leadId": "uuid",
        "businessName": "Acme Corp",
        "destination": "+1234567890"
      }
    ],
    "skippedLeads": [
      {
        "leadId": "uuid",
        "businessName": "Paused Co",
        "reasons": ["Lead status is paused."]
      }
    ],
    "templateIssues": [],
    "connectorIssues": [],
    "expectedJobs": 1,
    "mockMode": false
  }
}
```

---

### Launch Campaign

```
POST /api/v1/campaigns/:id/launch
```

**RBAC:** `admin`, `manager`

**Pre-launch checks:**
1. Status must be `draft` or `paused`
2. If AI personalization is enabled (and not `supervised` with `ai_min_confidence=0`), an approved AI brief must exist
3. Automation preview runs to validate all leads, templates, and connectors
4. For each eligible lead, an `outreach:dispatch` job is enqueued to BullMQ

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "active",
    "launched_at": "2026-07-05T12:00:00Z"
  },
  "meta": {
    "automation": {
      "enqueued": 45,
      "skipped": 3,
      "mockMode": false
    }
  }
}
```

**Side Effects:**
- Sets status to `active`, sets `launched_at`
- Enqueues `outreach:dispatch` jobs for each eligible lead
- Writes audit log (`campaign.launched`)

---

### Pause Campaign

```
POST /api/v1/campaigns/:id/pause
```

**RBAC:** `admin`, `manager`

**Constraints:**
- Only `active` campaigns can be paused

**Side Effects:**
- Sets status to `paused`
- Cancels all pending outreach jobs for this campaign via `cancelPendingOutreachJobs()`
- Writes audit log (`campaign.paused`)

**Response:** `200 OK` — Paused campaign object

---

### Resume Campaign

```
POST /api/v1/campaigns/:id/resume
```

**RBAC:** `admin`, `manager`

**Constraints:**
- Only `paused` campaigns can be resumed

**Side Effects:**
- Sets status to `active`
- Writes audit log (`campaign.resumed`)

**Response:** `200 OK` — Resumed campaign object

---

### Add Leads to Campaign

```
POST /api/v1/campaigns/:id/leads
```

**RBAC:** `admin`, `manager`, `marketing`

**Request Body:**
```json
{
  "lead_ids": ["uuid1", "uuid2", "uuid3"]
}
```

**Behavior:**
- Deduplicates — existing lead-campaign pairs are silently skipped
- Uses `INSERT ... WHERE NOT EXISTS` pattern with `23505` (unique violation) catch

**Side Effects:**
- Writes audit log (`campaign.leads_added`)

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "added": 2
  }
}
```

---

### Remove Lead from Campaign

```
DELETE /api/v1/campaigns/:id/leads/:leadId
```

**RBAC:** `admin`, `manager`, `marketing`

**Side Effects:**
- Writes audit log (`campaign.lead_removed`)

**Response:** `204 No Content`

---

### List Campaign Leads

```
GET /api/v1/campaigns/:id/leads
```

**RBAC:** All authenticated users

**Response:** `200 OK`
```json
{
  "success": true,
  "data": [
    {
      "lead_id": "uuid",
      "contact_name": "John Doe",
      "business_name": "Acme Corp",
      "lead_status": "active",
      "latest_step": 2,
      "step_status": "delivered",
      "step_time": "2026-07-03T14:30:00Z"
    }
  ]
}
```

Uses `LATERAL JOIN` on `outreach_logs` to get the latest step per lead.

---

### Get Campaign Stats

```
GET /api/v1/campaigns/:id/stats
```

**RBAC:** All authenticated users

**Response:** `200 OK`
```json
{
  "success": true,
  "data": {
    "total_leads": 50,
    "sent": 45,
    "delivered": 40,
    "opened": 22,
    "replied": 8,
    "failed": 2
  }
}
```

---

## 5. Service Layer

### Functions

| Function | Description | Audit Event |
|----------|-------------|-------------|
| `getAllCampaigns()` | Returns all non-deleted campaigns | — |
| `getCampaignById(id)` | Returns single campaign or 404 | — |
| `createCampaign(input, actor)` | Creates campaign, enqueues AI brief if enabled | `campaign.created` |
| `updateCampaignById(id, input, actor)` | Updates campaign, blocks if active | `campaign.updated` |
| `deleteCampaignById(id, actor)` | Soft-deletes, blocks if active | `campaign.deleted` |
| `launchCampaignById(id, actor)` | Validates, enqueues outreach jobs | `campaign.launched` |
| `pauseCampaignById(id, actor)` | Pauses, cancels pending jobs | `campaign.paused` |
| `resumeCampaignById(id, actor)` | Resumes from paused | `campaign.resumed` |
| `addLeads(campaignId, leadIds, actor)` | Adds leads with dedup | `campaign.leads_added` |
| `removeLead(campaignId, leadId, actor)` | Removes lead from campaign | `campaign.lead_removed` |
| `getCampaignLeads(campaignId)` | Returns leads with progress | — |
| `getStats(campaignId)` | Returns outreach stats | — |
| `getCampaignAutomationPreview(id)` | Pre-flight validation report | — |

### Validation Rules

1. **Active campaign protection:** Cannot edit or delete an active campaign — must pause first
2. **Launch gate:** Campaigns can only be launched from `draft` or `paused` status
3. **AI brief gate:** If AI personalization is enabled and autonomy is not `supervised` with `ai_min_confidence=0`, an approved brief must exist before launch
4. **Lead dedup:** Adding a lead that already exists in the campaign is silently skipped
5. **Active lead filter:** Only leads with `status = 'active'` are eligible for outreach

---

## 6. Repository Layer

### Query Functions

| Function | Query | Returns |
|----------|-------|---------|
| `findCampaigns()` | All non-deleted, ordered by `created_at DESC` | `Campaign[]` |
| `findCampaignById(id)` | Single by UUID | `Campaign \| null` |
| `insertCampaign(data, createdBy)` | INSERT with RETURNING | `Campaign` |
| `updateCampaign(id, data)` | Dynamic SET with RETURNING | `Campaign` |
| `deleteCampaign(id)` | UPDATE `deleted_at = NOW()` | `void` |
| `launchCampaign(id)` | UPDATE `status = 'active', launched_at = NOW()` | `Campaign` |
| `pauseCampaign(id)` | UPDATE `status = 'paused'` | `Campaign` |
| `resumeCampaign(id)` | UPDATE `status = 'active'` | `Campaign` |
| `addLeadsToCampaign(campaignId, leadIds)` | INSERT with NOT EXISTS dedup | `CampaignLead[]` |
| `removeLeadFromCampaign(campaignId, leadId)` | DELETE | `void` |
| `findCampaignLeads(campaignId)` | JOIN campaign_leads + campaigns | `string[]` |
| `findCampaignLeadsWithProgress(campaignId)` | LATERAL JOIN outreach_logs | `CampaignLeadProgressRow[]` |
| `findCampaignLeadRows(campaignId)` | JOIN leads for eligibility | `CampaignLeadRow[]` |
| `getCampaignStats(campaignId)` | COUNT + GROUP BY on outreach_logs | `CampaignStats` |

### Pipeline Enrollment Queries

| Function | Purpose |
|----------|---------|
| `findActiveCampaignsByPipeline(pipelineId)` | All active campaigns linked to a pipeline (with sequence) |
| `findActiveCampaignsByStage(stageId)` | Campaigns that target a specific stage |
| `findActiveCampaignsByPipelineNoStage(pipelineId)` | "Catch-all" campaigns — enroll on any stage move |

### Performance Notes

- `findCampaignLeadsWithProgress` uses `LATERAL JOIN` for efficient per-lead latest-step lookup
- `addLeadsToCampaign` iterates leads in a loop with `WHERE NOT EXISTS` — consider batch insert for large volumes
- `getCampaignStats` uses a single `GROUP BY` query on `outreach_logs` — efficient for indexed `campaign_id`

---

## 7. Automation Preview & Launch Flow

### Pre-flight Validation (Automation Preview)

The automation preview performs comprehensive validation before any jobs are enqueued:

```
1. Validate Sequence
   ├── Sequence exists?
   ├── Sequence has steps?
   └── For each step:
       ├── Template assigned?
       ├── Template exists?
       ├── Template is approved?
       └── Template channel matches step channel?

2. Validate Connectors
   ├── For each channel in sequence:
   │   └── At least one enabled connector with passing test?
   └── WhatsApp → ['whatsapp']
       SMS → ['twilio']
       Email → ['sendgrid', 'smtp']

3. Validate Leads
   ├── For each lead in campaign:
   │   ├── Lead status is 'active'?
   │   ├── Has destination for first step channel?
   │   ├── No template issues?
   │   └── No connector issues?
   └── Split into eligible/skipped lists
```

### Launch Flow

```
POST /campaigns/:id/launch
        │
        ▼
┌─────────────────────┐
│ 1. Find campaign    │
│ 2. Validate status  │
│    (draft/paused)   │
│ 3. Check AI brief   │
│    if required      │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│ 4. Build automation │
│    preview (pre-    │
│    flight checks)   │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│ 5. Update status    │
│    to 'active'      │
│ 6. Set launched_at  │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│ 7. For each eligible│
│    lead, enqueue    │
│    outreach:dispatch│
│    job to BullMQ    │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│ 8. Write audit log  │
│    with enqueued/   │
│    skipped counts   │
└─────────────────────┘
```

### BullMQ Job Payload

Each `outreach:dispatch` job receives:

```typescript
{
  leadId: string;
  campaignId: string;
  sequenceId: string;
  stepNumber: number;
  channel: 'whatsapp' | 'email' | 'sms' | 'phone_call';
  templateId: string;
  mockMode: boolean;
  aiPersonalizationEnabled: boolean;
}
```

---

## 8. Pipeline Auto-Enrollment

Campaigns can automatically enroll leads when they move between pipeline stages.

### Configuration

When creating a campaign, set:
- `pipeline_id` — the pipeline to monitor
- `trigger_stage_id` (optional) — specific stage that triggers enrollment

### Behavior

| `pipeline_id` | `trigger_stage_id` | Behavior |
|----------------|-------------------|----------|
| Set | Set (specific stage) | Enroll lead only when it moves TO that specific stage |
| Set | `null` | Enroll lead on ANY stage move within the pipeline |
| `null` | — | No auto-enrollment |

### Implementation

When a lead moves stages (`lead.stage_moved` event), the events worker:

1. Finds all active campaigns with `pipeline_id = <pipeline>` and `sequence_id IS NOT NULL`
2. If `trigger_stage_id` is set, filters to campaigns targeting that stage
3. If `trigger_stage_id` is null, includes "catch-all" campaigns (linked to pipeline but no specific stage)
4. Enrolls eligible leads into matching campaigns

### Repository Queries

```typescript
// Stage-specific trigger
findActiveCampaignsByStage(stageId)
// → campaigns WHERE trigger_stage_id = $1 AND status = 'active'

// Catch-all (any stage move in pipeline)
findActiveCampaignsByPipelineNoStage(pipelineId)
// → campaigns WHERE pipeline_id = $1 AND trigger_stage_id IS NULL AND status = 'active'

// All campaigns for pipeline
findActiveCampaignsByPipeline(pipelineId)
// → campaigns WHERE pipeline_id = $1 AND status = 'active'
```

---

## 9. AI Integration

### AI Personalization

When `ai_personalization_enabled = true` on a campaign:

1. **At creation/update:** An `ai:generate-campaign-brief` job is enqueued
2. **At launch:** The `aiPersonalizationEnabled` flag is passed to each `outreach:dispatch` job
3. **During dispatch:** The outreach worker calls OpenAI GPT-4o to personalize each message per lead

### AI Campaign Brief

The AI Campaign Brain module generates a strategy brief including:
- Segment summary
- Recommended offer angle
- Expected objections
- Risk warnings
- Recommended sequence (channels, timing, goals)
- Template suggestions
- Recommended autonomy level
- Confidence score

### Brief Approval Gate

| `ai_personalization_enabled` | `autonomy_level` | `ai_min_confidence` | Brief Required? |
|------------------------------|------------------|---------------------|-----------------|
| `false` | — | — | No |
| `true` | `supervised` | `0` | No (manual override) |
| `true` | `supervised` | `> 0` | Yes |
| `true` | `guarded` | any | Yes |
| `true` | `autopilot` | any | Yes |

---

## 10. Error Handling

### HTTP Status Codes

| Code | When |
|------|------|
| `200` | Successful read/update/launch/pause/resume |
| `201` | Campaign created |
| `204` | Campaign deleted, lead removed |
| `400` | Validation error, edit/delete active campaign, launch from invalid status |
| `401` | No authentication |
| `403` | Insufficient RBAC permissions |
| `404` | Campaign not found |

### Error Responses

```json
{
  "success": false,
  "error": {
    "message": "Cannot edit an active campaign. Pause it first.",
    "statusCode": 400
  }
}
```

### BullMQ Error Handling

- Failed `outreach:dispatch` jobs retry 3 times with exponential backoff (2× delay increment)
- After max retries, jobs route to the dead-letter queue (`dlq`) for manual inspection
- Launch errors for individual leads are logged but don't block other leads

---

## 11. Audit Logging

Every mutation writes an audit log entry:

| Action | Data Captured |
|--------|---------------|
| `campaign.created` | Full campaign object |
| `campaign.updated` | Before/after values |
| `campaign.deleted` | Campaign object before deletion |
| `campaign.launched` | Old status, new status, enqueued/skipped counts |
| `campaign.paused` | Before/after status |
| `campaign.resumed` | Before/after status |
| `campaign.leads_added` | Lead IDs, count |
| `campaign.lead_removed` | Lead ID |

Each audit entry includes:
- `userId` — actor who performed the action
- `action` — event type
- `entityType` — `campaign`
- `entityId` — campaign UUID
- `oldValue` — state before change (for updates)
- `newValue` — state after change
- `ipAddress` — client IP

---

## 12. Testing

### Test Files

| File | Coverage |
|------|----------|
| `campaigns.service.test.ts` | Service layer business logic |
| `campaigns.repository.test.ts` | Repository query correctness |
| `campaigns.controller.test.ts` | HTTP handler responses |
| `campaigns.routes.test.ts` | Route wiring and RBAC |

### Running Tests

```bash
# Run all campaigns tests
npm run test -- --testPathPattern=campaigns

# Run specific test file
npm run test -- --testPathPattern=campaigns.service.test
```

### Test Scenarios

- Campaign CRUD lifecycle
- Status transition validation (can't edit/delete active)
- Lead add with dedup
- Automation preview with eligible/skipped leads
- Launch with template validation failures
- Launch with connector validation failures
- AI brief gate enforcement
- Audit log generation

---

## 13. Frontend Pages

| Page | Route | Description |
|------|-------|-------------|
| `CampaignsPage` | `/campaigns` | Campaign list with status filters |
| `CampaignFormPage` | `/campaigns/new`, `/campaigns/:id/edit` | Create/edit campaign form |
| `CampaignDetailPage` | `/campaigns/:id` | Campaign detail with stats, leads, launch controls |

### Campaign Detail Page Features

- Campaign overview (name, status, tone, targeting)
- Automation preview with eligible/skipped lead counts
- Launch/pause/resume buttons (with RBAC)
- Lead list with progress (latest step, status)
- Campaign statistics (sent, delivered, opened, replied, failed)
- AI brief review (if AI personalization is enabled)

---

## 14. Campaign Operations (Phases 0–2, 2026-10-15)

Implements `docs/campaign-operations-research-plan-2026-10-15.md` phases 0–2.
Phases 3 (operator controls) and 4 (advanced outreach) are documented
follow-up work — see §15.

### What changed and why

After launch, every campaign answers: which action happens next, its
estimated time and timezone, how many recipients are scheduled, how many
potential messages remain, and why anything is waiting. Execution was made
reliable before any scheduling promise is displayed.

Key fixes (all covered by regression tests):

- Campaign summary counts `sent` from `sent_at`, not from the mutable status
  column — an opened/replied message stays counted as sent, reconciling with
  per-step totals.
- The worker enforces an authoritative pre-send gate (campaign active,
  enrollment member, lead eligible, reply/opt-out stops, template approval)
  for first sends, follow-ups, retries, and stale jobs.
- Manual retry on a paused campaign is rejected (409) with an explanation.
- Pause freezes remaining delays in PostgreSQL before transport jobs are
  cancelled; resume reapplies windows and recomputes capacity without
  restarting completed steps. Individually paused leads stay paused.
- First-step delays are rejected explicitly at launch (never silently
  ignored); minute-level delays remain later scope.

### Durable execution model (flag-gated)

PostgreSQL owns enrollment progress, next-step timing, and execution
identity (`campaign_sequence_snapshots`, `campaign_leads` execution columns,
`campaign_step_executions`, `campaign_day_capacity` — migration `0084`,
**review required before running**). BullMQ is wake-up transport only.

- Sequence versions are pinned per enrollment; edits mint new versions.
- Step executions carry an opaque id + generation; workers claim before
  sending, so repeats, stale jobs, recovery, and retries cannot double-send.
- Daily capacity is reserved atomically (`reserved < send_limit`); definite
  failures release the slot, uncertain outcomes hold it for review.
- Crash-after-acceptance surfaces as `uncertain` via lease expiry — never a
  blind resend, never a promise of exactly-once delivery.
- The recovery sweep (`campaignRecovery.worker`, 60s) republishes orphaned
  intents and reconciles expired leases. Bounded batches only.
- The existing event-outbox allowlist was **not** extended; campaign
  scheduling uses its own intent rows + publisher path.

### Rollout

`CAMPAIGN_OPERATIONS_V2_ENABLED` (default **off**). Enabling requires
migrations `0084` through `0086` to have run. The flag controls durable
campaign operations; once an enrollment has durable execution state, that
state remains its scheduling owner even if the flag is turned off. Durable
jobs are parked while disabled and can be swept again after re-enabling.
Enrollments without durable ownership continue through the legacy path.
Never allow both paths to schedule the same enrollment. Rollback turns the
flag off while retaining durable rows for reconciliation; it does not hand
durable enrollments back to legacy dispatch.

Legacy paused campaigns are not automatically backfilled by this release.
Recovering their lost due times and a guided resume schedule are deferred;
do not claim that the current UI reconstructs timing for those campaigns.

### New API surface (all Zod-validated, explicit RBAC, same envelope)

- `GET /:id/operations` — next committed activity, state/channel counts,
  capacity, waiting reasons, attention items, freshness timestamp.
- `GET /:id/schedule` — committed upcoming work + clearly-marked projections.
- `GET /:id/activity` — cursor-paginated operational history.
- `GET /:id/enrollments` — cursor-paginated per-lead progress (the legacy
  array `/:id/leads` endpoint is unchanged for existing consumers).
- `POST /:id/enrollments/:leadId/pause|resume` — optimistic version
  (`expectedGeneration`), reason, audit; sales limited to owned leads.
- `GET /operations-summary?ids=` — one bulk row per campaign for the list
  page (max 100 ids), never a request per campaign.
- Pause/resume responses keep `data` = campaign and gain operational counts
  in `meta.operations`; launch `meta.automation` gains skipped recipients
  and partial scheduling failures.

### Frontend

`CampaignDetailPage` gains an operations overview (next activity + timezone,
scheduled/potential counts, sent today vs capacity, waiting reasons,
attention items), launch/pause/resume outcome banners, a schedule panel
(committed vs projected), an activity feed, and a server-paginated
enrollment table with search, per-lead next action/ETA, waiting reasons,
and pause/resume/retry actions. `CampaignsPage` gains search, status and
needs-attention filters, card/table modes, and bulk summary badges. All
server state flows through `apiClient` + TanStack Query with bounded
15s polling that stops when the tab is hidden; loading, empty, error, and
stale states are covered by tests.

## 14b. Corrective Review Fixes (2026-10-15, findings 1–9)

A targeted implementation review found 9 defects in the first implementation.
All 9 are fixed below; each fix
names its regression proof. Mocked unit tests plus isolated scratch
PostgreSQL/Redis integration tests
(`backend/src/modules/campaigns/campaigns.durable.integration.test.ts`,
recording connector double, never real sends) cover the persistence, queue,
concurrency, and recovery boundaries.

1. **Migration defaults.** The user's request to complete the pending fix
   authorizes correcting both string defaults in the uncommitted 0084 file.
   The actual checked-in migration chain must succeed on populated pre-0084
   databases; a later migration alone cannot repair a failing 0084.
   Migration 0085 retains compatible default repair and adds `mock_mode`.
   Additive migration 0086 restores campaign enrollment, snapshot, and daily
   capacity uniqueness plus execution CHECK constraints omitted by earlier
   named constraint maps under the installed node-pg-migrate API. It fails
   on invalid existing data without deleting or merging records. Proof:
   `migrations.chain.integration.test.ts` runs the real chain, checks both
   defaults, and exercises enrollment/snapshot upserts and daily capacity.
   No application database migrations have been run; deployment remains a
   separate approval step. Databases that already applied 0084 retain 0085's
   corrective path and must apply 0086 before enabling durable dispatch.
2. **Transport IDs.** BullMQ custom IDs cannot contain `:` (verified against
   the installed validator). `buildTransportJobId` maps each execution key
   to stable `exec-<sha256 hex>`; the full key stays in job data, and stable
   IDs keep BullMQ dedupe from doubling republished intents. Applied to
   initial publication, deferrals, retries, resume, and recovery. Proof:
   `queue.transport.test.ts` plus a real-queue add/read/dedupe integration
   test on scratch Redis.
3. **Ownership vs. permission.** A job carrying `executionId` is always
   durable-owned (`handleDurableDispatch`), independent of the flag. Flag-off
   parks such jobs (no state change, never legacy sending); re-enabling lets
   the sweep republish due unscheduled *and* stale scheduled intents. Legacy
   and durable senders are never armed for the same enrollment. Proof:
   parking unit test plus a park → recover → dispatch integration test.
4. **Transactional acceptance.** `recordAcceptanceTx` commits sent-marking,
   enrollment advancement, and the next intent in one transaction; transport
   publication happens only after commit. Pre-commit crashes leave a claimed
   execution (lease expiry → explicit uncertain outcome); post-commit crashes
   leave an unscheduled intent the sweep republishes without resending.
   Proof: concurrent double-acceptance and failure-injection rollback
   integration tests.
5. **Pause/claim serialization.** `pauseCampaignTx` (status flip + freeze)
   and `claimDueStepExecutionTx` lock campaigns-then-enrollments in one
   shared order and revalidate live status/generation inside the lock.
   Pre-pause claims stay valid in-flight sends; post-pause claims are
   impossible. Proof: two-connection interleaving integration test plus
   lock-order contract tests.
6. **Enrollment resume.** `resumeSingleEnrollment` recomputes the frozen
   remainder through the shared scheduling rules (or an explicit schedule
   for unknown timing), persists the current-generation execution atomically
   with the state transition, then publishes. Duplicate resumes conflict
   (409). Proof: unit tests plus a pause → resume → dispatch integration
   test with duplicate-resume and explicit-timing cases.
7. **Fail-closed capacity.** Reservation errors release the claim to a
   retryable pre-send state and send nothing; the connector never runs
   without a successful required reservation. Pre-network failures stay
   `scheduled`, never `failed`/`uncertain`. Proof: unit test asserting zero
   connector calls plus an integration test with broken capacity storage.
8. **Mock mode.** `mock_mode` persists per execution and per enrollment
   (migration 0085); enroll, accept, resume, retry, and recovery all inherit
   and republish it. Simulated work can never convert to real outreach.
   Proof: mode assertions in unit tests plus an end-to-end mock-mode
   integration test (zero provider calls, zero real-mode jobs).
9. **Campaign-wide reporting.** Totals aggregate every enrollment via
   `listAllEnrollmentStates` using each row's pinned snapshot step count
   (legacy rows fall back to the live length); pagination applies to display
   only. Proof: 120-enrollment mixed-snapshot unit and integration tests.

### Final rollout contract

`CAMPAIGN_OPERATIONS_V2_ENABLED` (default **off**) grants *permission* to
dispatch durable work and create durable intents; it never *reinterprets*
ownership. Prerequisites: migrations 0084+0085+0086 reviewed, approved, and
applied. Rollback = flag off (parked intents retained, sweep idle);
re-enable resumes via the sweep — no reconciliation script needed. Never run
legacy and durable dispatch for the same enrollment simultaneously. Do not
drop durable tables as a rollback shortcut.

### Integration-test infrastructure

Scratch-only containers (never production data or credentials, never
`.env`): `postgres:16-alpine` on 5433 and `redis:7-alpine` on 6380 (see the
TESTING block in the integration file). Durable worker tests build a minimal
schema directly. The separate `migrations.chain.integration.test.ts` executes
the actual checked-in migration chain on fresh, uniquely named scratch
databases, both empty and populated before 0084, then verifies defaults,
upserts, and capacity constraints. These scratch tests do not apply migrations
to an application database. Test connections reject nonlocal hosts, incorrect
ports, and non-test database names before any destructive cleanup.

## 15. Deferred Follow-up Work (Phases 3–4, not implemented)

- Per-enrollment rescheduling with impact preview, bulk retry selection,
  explicit stop/completion states UI.
- Minute-based delays, sender capacity/rotation, cross-campaign contact
  frequency, meeting-booked stops, out-of-office snoozing, conditional steps
  and experimentation.
- Migrating long-running legacy campaigns to durable scheduling at a
  controlled boundary with reconciliation.
- Each addition must verify its integration contracts and must not bypass
  stops or capacity checks.

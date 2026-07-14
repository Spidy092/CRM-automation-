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

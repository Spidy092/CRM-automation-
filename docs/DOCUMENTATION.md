# CRM Automation Platform — Complete Documentation

**Version:** 1.0
**Last Updated:** 2026-06-26

---

## Table of Contents

1. [What Is This Application](#1-what-is-this-application)
2. [How It Works (High Level)](#2-how-it-works-high-level)
3. [Getting Started](#3-getting-started)
4. [Architecture Overview](#4-architecture-overview)
5. [Modules & Features](#5-modules--features)
6. [API Reference (All Endpoints)](#6-api-reference-all-endpoints)
7. [Frontend Pages & Navigation](#7-frontend-pages--navigation)
8. [Database Schema](#8-database-schema)
9. [Integrations](#9-integrations)
10. [AI Features](#10-ai-features)
11. [User Roles & Permissions](#11-user-roles--permissions)
12. [Background Jobs (BullMQ)](#12-background-jobs-bullmq)
13. [Webhooks](#13-webhooks)
14. [Configuration & Environment Variables](#14-configuration--environment-variables)
15. [Development Guide](#15-development-guide)
16. [Testing](#16-testing)
17. [Deployment](#17-deployment)

---

## 1. What Is This Application

This is a **sales CRM automation platform** that helps businesses:

- **Import and manage leads** from multiple sources (Google Ads, Facebook, CSV uploads, web scraping)
- **Score and classify leads** automatically (Hot / Warm / Cold)
- **Run outreach campaigns** via WhatsApp, SMS, and Email
- **Use AI** to personalize messages, classify lead replies, and recommend next actions
- **Track everything** through a pipeline with real-time reporting

Think of it as: **Lead intake → AI enrichment → Automated outreach → Reply handling → Reporting**

---

## 2. How It Works (High Level)

```
                    ┌──────────────┐
                    │  Lead Sources │
                    │  (CSV, Ads,  │
                    │  Scraper,    │
                    │  Webhooks)   │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │   LEAD DB    │
                    │  (PostgreSQL)│
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ Scoring  │ │ AI Intel │ │ Round    │
        │ Engine   │ │ (GPT-4o) │ │ Robin    │
        └────┬─────┘ └────┬─────┘ └────┬─────┘
             │            │            │
             ▼            ▼            ▼
        ┌──────────────────────────────────┐
        │         CAMPAIGNS                │
        │  (Targeting + Sequences)         │
        └──────────────┬───────────────────┘
                       │
                       ▼
        ┌──────────────────────────────────┐
        │       OUTREACH ENGINE            │
        │  WhatsApp / SMS / Email          │
        │  + AI Personalization            │
        └──────────────┬───────────────────┘
                       │
                       ▼
        ┌──────────────────────────────────┐
        │       REPLY HANDLING             │
        │  AI classifies intent            │
        │  Routes to inbox or auto-respond │
        └──────────────┬───────────────────┘
                       │
                       ▼
        ┌──────────────────────────────────┐
        │       REPORTING                  │
        │  Dashboard + CSV exports         │
        └──────────────────────────────────┘
```

---

## 3. Getting Started

### Prerequisites

- Docker & Docker Compose
- Node.js 20+ (for local development without Docker)

### Quick Start (Docker)

```bash
# Clone the repo
git clone <repo-url>
cd CRM

# Start everything
docker compose up --build
```

This starts:

| Service | URL | Purpose |
|---|---|---|
| API Server | http://localhost:3000 | Backend API |
| Frontend | http://localhost:5173 | React UI (dev mode) |
| PostgreSQL | localhost:5432 | Database |
| Redis | localhost:6379 | Queue + Cache |
| MinIO | http://localhost:9001 | File storage (S3-compatible) |
| Bull Board | http://localhost:3001 | Job monitoring dashboard |

### First Steps After Starting

1. Open http://localhost:5173
2. Register a user (or use the seed data)
3. Login with your credentials
4. You'll see the Dashboard

### Local Development (without Docker)

```bash
# Backend
cd backend
cp .env.example .env    # edit with your values
npm install
npm run migrate
npm run dev              # starts API server on :3000

# In another terminal — workers
npm run worker           # starts BullMQ workers

# Frontend
cd frontend
npm install
npm run dev              # starts React on :5173
```

---

## 4. Architecture Overview

### Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | Node.js 20 + Express.js + TypeScript |
| **Frontend** | React 18 + TypeScript + Tailwind CSS + shadcn/ui |
| **Database** | PostgreSQL 16 |
| **Cache / Queue** | Redis 7 + BullMQ |
| **AI** | OpenAI GPT-4o |
| **File Storage** | MinIO / AWS S3 |
| **Error Tracking** | Sentry |
| **Metrics** | Prometheus + Grafana |

### Project Structure

```
CRM/
├── backend/
│   ├── src/
│   │   ├── index.ts              # Express app entry point
│   │   ├── modules/              # Feature modules (19 total)
│   │   │   ├── auth/             # JWT, login, RBAC
│   │   │   ├── users/            # User management
│   │   │   ├── leads/            # Lead CRUD + import
│   │   │   ├── custom-fields/    # Custom field definitions
│   │   │   ├── pipeline/         # Pipeline stages
│   │   │   ├── scoring/          # Lead scoring rules
│   │   │   ├── assignments/      # Round robin assignment
│   │   │   ├── campaigns/        # Campaign management
│   │   │   ├── outreach/         # Message dispatch
│   │   │   ├── templates/        # Message templates
│   │   │   ├── integrations/     # WhatsApp, Twilio, etc.
│   │   │   ├── reports/          # Analytics & exports
│   │   │   ├── scraper/          # Web scraping
│   │   │   ├── ai-settings/      # OpenAI config
│   │   │   ├── ai-intelligence/  # Lead research & profiles
│   │   │   ├── ai-reply/         # Reply classification
│   │   │   ├── ai-campaign-brain/# Campaign briefs
│   │   │   ├── ai-inbox/         # Rep priority inbox
│   │   │   └── notifications/    # SSE real-time events
│   │   ├── workers/              # BullMQ job processors
│   │   ├── webhooks/             # Inbound webhook handlers
│   │   └── shared/               # Middleware, utils, types
│   ├── migrations/               # Database migrations (23)
│   ├── Dockerfile.dev
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx               # Router + routes
│   │   ├── pages/                # 28 page components
│   │   ├── api/                  # 19 API client modules
│   │   ├── components/           # UI components
│   │   └── store/                # Zustand stores
│   └── package.json
├── docker-compose.yml            # Dev environment
├── docker-compose.prod.yml       # Production
└── docs/                         # Documentation
```

### Module Architecture (per module)

Each backend module follows the same 6-layer pattern:

```
module/
├── module.controller.ts    # HTTP handlers (req/res)
├── module.service.ts       # Business logic
├── module.repository.ts    # Database queries
├── module.routes.ts        # Express router + RBAC
├── module.schema.ts        # Zod validation schemas
└── module.types.ts         # TypeScript type definitions
```

**Data flow:** Route → Controller (validates input) → Service (business logic) → Repository (DB queries) → Response

---

## 5. Modules & Features

### 5.1 Authentication (`auth`)

**Purpose:** User login, registration, JWT token management, password reset.

**Features:**
- JWT RS256 access tokens (15 min TTL)
- Refresh tokens (7 day TTL)
- Password reset via email token (1 hour expiry, single-use)
- Session tracking in database

### 5.2 Users (`users`)

**Purpose:** User account management.

**Features:**
- Create, list, update user profiles
- Role assignment (admin, manager, sales, marketing, viewer)
- Admin-only user creation

### 5.3 Leads (`leads`)

**Purpose:** Central lead management.

**Features:**
- CRUD operations on leads
- CSV/Excel import (max 10MB, auto-maps columns)
- Custom fields (JSONB, validated against definitions)
- Lead activity timeline
- Pause/unpause outreach for individual leads
- Soft delete (deleted_at timestamp)

### 5.4 Custom Fields (`custom-fields`)

**Purpose:** Define custom data fields for leads.

**Features:**
- Create field definitions (text, number, select, date, boolean)
- Validate lead custom field values against definitions
- Admin-only management

### 5.5 Pipeline (`pipeline`)

**Purpose:** Manage sales pipeline stages and lead movement.

**Features:**
- Multiple pipelines support
- Custom stages per pipeline (e.g., New → Contacted → Qualified → Closed)
- Move leads between stages with validation
- Stage ordering

### 5.6 Scoring (`scoring`)

**Purpose:** Automatic lead scoring and classification.

**Features:**
- Configurable scoring rules (field-based conditions)
- Auto-classify leads as Hot (score ≥ 80) / Warm (40-79) / Cold (< 40)
- Manual score recalculation
- BullMQ worker for async scoring

### 5.7 Assignments (`assignments`)

**Purpose:** Round-robin lead assignment to sales reps.

**Features:**
- Automatic round-robin distribution
- Manual assignment override
- Configurable assignment rules
- Track assignment history per user

### 5.8 Campaigns (`campaigns`)

**Purpose:** Marketing campaign management.

**Features:**
- Create campaigns with targeting rules
- Add/remove leads from campaigns
- Launch, pause, resume campaigns
- Automation preview before launch
- Campaign statistics
- AI-generated pre-launch briefs

### 5.9 Outreach (`outreach`)

**Purpose:** Multi-channel message dispatch and sequence engine.

**Features:**
- Multi-step outreach sequences
- Send messages via WhatsApp, SMS, Email
- Manual outreach sending
- Task management for follow-ups
- Lead timeline and message logs
- AI-powered message personalization

### 5.10 Templates (`templates`)

**Purpose:** Reusable message templates.

**Features:**
- Create templates for email, SMS, WhatsApp
- Template variables (e.g., `{{lead.name}}`)
- Approval workflow (admin/marketing approves)
- Template versioning

### 5.11 Integrations (`integrations`)

**Purpose:** Third-party service connections.

**Supported integrations:**

| Integration | Purpose | Auth Method |
|---|---|---|
| WhatsApp Business | Messaging | Bearer token + HMAC webhook |
| Twilio | SMS | Account SID + Auth Token |
| SendGrid | Email | API Key |
| Google Ads | Lead import | OAuth 2.0 |
| Facebook | Lead import | OAuth 2.0 |
| Google Sheets | Data sync | API Key |
| Google Calendar | Scheduling | OAuth 2.0 |
| Outlook | Scheduling | OAuth 2.0 |
| SMTP | Email fallback | Host + credentials |

### 5.12 Reports (`reports`)

**Purpose:** Analytics dashboards and data exports.

**Features:**
- Dashboard with key metrics
- Lead generation reports
- Outreach performance reports
- Pipeline analytics
- Sales rep performance reports
- CSV export (async via BullMQ)

### 5.13 Scraper (`scraper`)

**Purpose:** Automated lead collection from web sources.

**Supported sources:**
- Google Business / Google Places
- Facebook Business Pages
- YouTube Channels

**Features:**
- Configurable scraper targets
- Scheduled scraping runs
- Run logs and history
- Deduplication

### 5.14 AI Intelligence (`ai-intelligence`)

**Purpose:** AI-powered lead research and profile generation.

**Features:**
- OpenAI-powered lead research
- Generates: research summary, buying intent, recommended offer angle, objections, buying signals
- Decision logging with chain-of-thought reasoning
- Redis caching (7 day TTL)
- Auto-triggered on lead creation/import

### 5.15 AI Reply Classification (`ai-reply`)

**Purpose:** Classify inbound lead replies by intent.

**8 intent classes:**
1. Meeting request
2. Pricing question
3. Objection
4. Positive interest
5. Negative / not interested
6. Opt-out / unsubscribe
7. General question
8. Forwarded / referral

**Features:**
- Draft response generation
- Opt-out detection with automatic sequence cancellation
- Pipeline stage auto-movement
- Confidence threshold routing to inbox
- Memory updates (objections, buying signals)

### 5.16 AI Campaign Brain (`ai-campaign-brain`)

**Purpose:** Generate campaign strategy briefs before launch.

**Features:**
- Analyzes target segment with AI
- Recommends sequence steps and templates
- Autonomy level recommendation
- Approve/reject workflow (admin/manager)
- Inbox notification to campaign creator

### 5.17 AI Inbox (`ai-inbox`)

**Purpose:** Priority inbox for sales reps with AI-curated action items.

**6 item types:**
1. Reply needs attention
2. Meeting follow-up
3. Pricing request
4. Objection handling
5. High-intent lead
6. Campaign action required

**Features:**
- Urgency scoring
- Approve / reject / snooze actions
- Guarded-mode auto-expiry (30 min cron)
- Auto-resolve for leads acted on elsewhere

### 5.18 AI Settings (`ai-settings`)

**Purpose:** OpenAI configuration management.

**Features:**
- Configure API key, base URL, model
- AES-256-GCM encryption for API keys
- Public endpoint never exposes raw keys
- Max tokens hard-capped at 500
- Temperature range 0-2

### 5.19 Notifications (`notifications`)

**Purpose:** Real-time Server-Sent Events (SSE).

**Features:**
- SSE endpoint for live updates
- Supports Bearer token or query param auth
- Events for lead updates, campaign status, inbox items

---

## 6. API Reference (All Endpoints)

**Base URL:** `http://localhost:3000/api/v1`

**Authentication:** `Authorization: Bearer <jwt_token>` header

**Standard Response Envelope:**
```json
{
  "success": true,
  "data": { ... },
  "error": null,
  "meta": { "page": 1, "limit": 20, "total": 100 }
}
```

---

### 6.1 Auth — `/api/v1/auth`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/login` | Public | Login with email + password |
| POST | `/auth/refresh` | Public | Refresh access token |
| POST | `/auth/logout` | Public | Invalidate refresh token |
| POST | `/auth/forgot-password` | Public | Request password reset email |
| POST | `/auth/reset-password` | Public | Reset password with token |
| GET | `/auth/me` | Authenticated | Get current user profile |

### 6.2 Users — `/api/v1/users`

| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| POST | `/users` | Auth | admin | Create user |
| GET | `/users` | Auth | admin, manager | List users |
| GET | `/users/:id` | Auth | All | Get user by ID |
| PATCH | `/users/:id` | Auth | All | Update user profile |

### 6.3 Leads — `/api/v1/leads`

| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| GET | `/leads` | Auth | admin, manager, sales, viewer | List leads (cursor-based pagination) |
| GET | `/leads/:id` | Auth | admin, manager, sales, viewer | Get lead detail |
| POST | `/leads` | Auth | admin, manager | Create lead |
| PUT | `/leads/:id` | Auth | admin, manager, sales | Update lead |
| DELETE | `/leads/:id` | Auth | admin | Soft-delete lead |
| POST | `/leads/import` | Auth | admin, manager | Import CSV/Excel file |
| GET | `/leads/:id/activity` | Auth | admin, manager, sales, viewer | Get lead activity timeline |
| POST | `/leads/:id/pause` | Auth | admin, manager, sales | Pause/unpause outreach |

### 6.4 Custom Fields — `/api/v1/custom-fields`

| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| GET | `/custom-fields` | Auth | All | List field definitions |
| POST | `/custom-fields` | Auth | admin | Create field definition |
| PUT | `/custom-fields/:id` | Auth | admin | Update field definition |

### 6.5 Pipelines — `/api/v1/pipelines`

| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| GET | `/pipelines` | Auth | All | List pipelines |
| GET | `/pipelines/:id` | Auth | All | Get pipeline with stages |
| POST | `/pipelines` | Auth | admin, manager | Create pipeline |
| PUT | `/pipelines/:id` | Auth | admin, manager | Update pipeline |
| DELETE | `/pipelines/:id` | Auth | admin | Delete pipeline |
| GET | `/pipelines/:pipelineId/stages` | Auth | All | List stages for pipeline |
| POST | `/pipelines/:pipelineId/stages` | Auth | admin, manager | Create stage |
| PUT | `/pipelines/stages/:id` | Auth | admin, manager | Update stage |
| DELETE | `/pipelines/stages/:id` | Auth | admin, manager | Delete stage |
| POST | `/pipelines/move-lead` | Auth | admin, manager, sales | Move lead to different stage |

### 6.6 Campaigns — `/api/v1/campaigns`

| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| GET | `/campaigns` | Auth | All | List campaigns |
| GET | `/campaigns/:id` | Auth | All | Get campaign detail |
| POST | `/campaigns` | Auth | admin, manager, marketing | Create campaign |
| PUT | `/campaigns/:id` | Auth | admin, manager, marketing | Update campaign |
| DELETE | `/campaigns/:id` | Auth | admin, manager | Delete campaign |
| GET | `/campaigns/:id/automation-preview` | Auth | admin, manager | Preview automation rules |
| POST | `/campaigns/:id/launch` | Auth | admin, manager | Launch campaign |
| POST | `/campaigns/:id/pause` | Auth | admin, manager | Pause campaign |
| POST | `/campaigns/:id/resume` | Auth | admin, manager | Resume campaign |
| POST | `/campaigns/:id/leads` | Auth | admin, manager, marketing | Add leads to campaign |
| DELETE | `/campaigns/:id/leads/:leadId` | Auth | admin, manager, marketing | Remove lead from campaign |
| GET | `/campaigns/:id/leads` | Auth | All | List campaign leads |
| GET | `/campaigns/:id/stats` | Auth | All | Get campaign statistics |

### 6.7 Assignments — `/api/v1/assignments`

| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| GET | `/assignments/config` | Auth | admin, manager | Get assignment config |
| PUT | `/assignments/config` | Auth | admin, manager | Update assignment config |
| GET | `/assignments/eligible-users` | Auth | admin, manager | List eligible sales reps |
| POST | `/assignments/manual` | Auth | admin, manager | Manually assign lead |
| POST | `/assignments/override` | Auth | admin, manager | Override existing assignment |
| GET | `/assignments/user/:userId` | Auth | admin, manager | Get user's assignments |

### 6.8 Scoring — `/api/v1/scoring`

| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| GET | `/scoring/config` | Auth | All | Get scoring config |
| PUT | `/scoring/config` | Auth | admin, manager | Update scoring config |
| GET | `/scoring/rules` | Auth | All | List scoring rules |
| GET | `/scoring/rules/:id` | Auth | All | Get scoring rule |
| POST | `/scoring/rules` | Auth | admin, manager | Create scoring rule |
| PUT | `/scoring/rules/:id` | Auth | admin, manager | Update scoring rule |
| DELETE | `/scoring/rules/:id` | Auth | admin | Delete scoring rule |
| POST | `/scoring/calculate/:leadId` | Auth | admin, manager | Calculate score for lead |
| POST | `/scoring/recalculate-all` | Auth | admin | Recalculate all lead scores |

### 6.9 Integrations — `/api/v1/integrations`

| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| GET | `/integrations` | Auth | All | List configured integrations |
| GET | `/integrations/:id` | Auth | All | Get integration detail |
| PUT | `/integrations/:id` | Auth | admin | Update integration config |
| POST | `/integrations/:id/test` | Auth | admin | Test integration connection |

### 6.10 OAuth — `/api/v1/integrations/oauth`

| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| GET | `/oauth/:provider/authorize` | Auth | admin | Get OAuth authorization URL |
| GET | `/oauth/:provider/callback` | Auth | admin | Handle OAuth callback (exchange code) |
| POST | `/oauth/:provider/refresh` | Auth | admin | Refresh OAuth token |

Supported providers: `google_ads`, `facebook`

### 6.11 Templates — `/api/v1/templates`

| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| GET | `/templates` | Auth | All | List templates |
| GET | `/templates/:id` | Auth | All | Get template |
| POST | `/templates` | Auth | admin, marketing | Create template |
| PUT | `/templates/:id` | Auth | admin, marketing | Update template |
| POST | `/templates/:id/approve` | Auth | admin, marketing | Approve template |
| DELETE | `/templates/:id` | Auth | admin, marketing | Delete template |

### 6.12 Outreach — `/api/v1/outreach`

| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| GET | `/outreach/sequences` | Auth | All | List outreach sequences |
| GET | `/outreach/sequences/:id` | Auth | All | Get sequence detail |
| POST | `/outreach/sequences` | Auth | admin, marketing | Create sequence |
| PUT | `/outreach/sequences/:id` | Auth | admin, marketing | Update sequence |
| DELETE | `/outreach/sequences/:id` | Auth | admin, marketing | Delete sequence |
| GET | `/outreach/leads/:leadId/timeline` | Auth | All | Get lead outreach timeline |
| GET | `/outreach/leads/:leadId/logs` | Auth | All | Get lead message logs |
| POST | `/outreach/send` | Auth | admin, manager, sales | Send manual outreach |
| GET | `/outreach/tasks` | Auth | admin, manager, sales | List follow-up tasks |
| POST | `/outreach/tasks` | Auth | admin, manager, sales | Create task |
| PUT | `/outreach/tasks/:id` | Auth | admin, manager, sales | Update task |

### 6.13 Reports — `/api/v1/reports`

| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| GET | `/reports` | Auth | All | List available reports |
| GET | `/reports/dashboard` | Auth | All | Dashboard metrics |
| GET | `/reports/leads` | Auth | All | Lead generation report |
| GET | `/reports/outreach` | Auth | All | Outreach performance report |
| GET | `/reports/pipeline` | Auth | All | Pipeline analytics report |
| GET | `/reports/reps` | Auth | All | Sales rep performance report |
| POST | `/reports/export` | Auth | All | Trigger async CSV export |
| GET | `/reports/export/:jobId/download` | Auth | All | Download exported CSV |

### 6.14 Scraper — `/api/v1/scraper`

| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| GET | `/scraper` | Auth | All | List scraper configs |
| GET | `/scraper/:id` | Auth | All | Get scraper config |
| POST | `/scraper` | Auth | admin | Create scraper config |
| PUT | `/scraper/:id` | Auth | admin | Update scraper config |
| DELETE | `/scraper/:id` | Auth | admin | Delete scraper config |
| POST | `/scraper/:configId/scrape` | Auth | admin | Trigger scrape run |
| GET | `/scraper/:configId/logs` | Auth | admin, manager | List scrape run logs |

### 6.15 AI Intelligence — `/api/v1/ai-intelligence`

| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| GET | `/ai-intelligence/leads/:leadId/profile` | Auth | All | Get lead AI profile |
| GET | `/ai-intelligence/leads/:leadId/decisions` | Auth | All | Get lead AI decisions |
| GET | `/ai-intelligence/decisions` | Auth | admin | Get global AI decision log |

### 6.16 AI Reply — `/api/v1/ai-reply`

| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| POST | `/ai-reply/classify` | Auth | admin, manager, sales, marketing | Classify inbound reply |
| GET | `/ai-reply/history` | Auth | admin, manager, sales, viewer | Get reply classification history |
| POST | `/ai-reply/trigger/:leadId` | Auth | admin, manager, sales, marketing | Trigger classification for lead |

### 6.17 AI Campaign Brain — `/api/v1/ai-campaign-brain`

| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| GET | `/ai-campaign-brain/campaigns/:campaignId/brief` | Auth | All | Get campaign AI brief |
| POST | `/ai-campaign-brain/campaigns/:campaignId/brief/approve` | Auth | admin, manager | Approve brief |
| POST | `/ai-campaign-brain/campaigns/:campaignId/brief/reject` | Auth | admin, manager | Reject brief |

### 6.18 AI Inbox — `/api/v1/ai-inbox`

| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| GET | `/ai-inbox` | Auth | admin, manager, sales, marketing | List inbox items |
| PATCH | `/ai-inbox/:id/action` | Auth | admin, manager, sales, marketing | Approve/reject/snooze item |

### 6.19 AI Settings — `/api/v1/ai-settings`

| Method | Path | Auth | Roles | Description |
|---|---|---|---|---|
| GET | `/ai-settings` | Auth | All | Get AI configuration |
| PATCH | `/ai-settings` | Auth | admin | Update AI configuration |

### 6.20 Notifications (SSE) — `/api/v1/events`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/events` | Bearer token (header or `?token=`) | SSE stream for real-time events |

### 6.21 Health & Metrics

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | None | Health check (DB + Redis ping) |
| GET | `/metrics` | None | Prometheus metrics scrape |

---

## 7. Frontend Pages & Navigation

### Public Pages

| Path | Page | Description |
|---|---|---|
| `/login` | Login | Email + password login |
| `/forgot-password` | Forgot Password | Request password reset |
| `/reset-password` | Reset Password | Set new password with token |

### Protected Pages (require login)

| Path | Page | Description |
|---|---|---|
| `/` | Dashboard | Overview metrics, charts |
| `/leads` | Leads | Lead list with search/filter |
| `/leads/new` | New Lead | Create lead form |
| `/leads/import` | Import Leads | CSV/Excel upload |
| `/leads/:id` | Lead Detail | Full lead view + timeline |
| `/leads/:id/edit` | Edit Lead | Edit lead form |
| `/leads/:id/ai` | Lead AI Profile | AI research & insights for lead |
| `/campaigns` | Campaigns | Campaign list |
| `/campaigns/new` | New Campaign | Create campaign form |
| `/campaigns/:id/brief` | Campaign Brief | AI-generated strategy brief |
| `/pipelines` | Pipelines | Pipeline board view |
| `/templates` | Templates | Template list |
| `/templates/new` | New Template | Create template |
| `/templates/:id/edit` | Edit Template | Edit template |
| `/outreach/sequences` | Outreach Sequences | Sequence builder |
| `/ai-inbox` | AI Inbox | Priority action items |
| `/reports` | Reports | Analytics dashboard |
| `/scraper` | Scraper | Scraper configuration |
| `/automation/rules` | Automation Rules | Automation configuration |
| `/admin/ai-decisions` | AI Decision Log | AI audit trail |
| `/settings` | Settings | General settings |
| `/settings/users` | Users | User management |
| `/settings/ai` | AI Settings | OpenAI configuration |
| `/settings/scoring` | Scoring | Scoring rules config |
| `/settings/assignments` | Assignments | Round robin config |
| `/settings/integrations` | Integrations | Third-party connections |
| `/settings/custom-fields` | Custom Fields | Field definitions |

---

## 8. Database Schema

### Core Tables

| Table | Purpose |
|---|---|
| `users` | User accounts with roles |
| `leads` | Lead records with custom fields (JSONB) |
| `custom_field_definitions` | Custom field type definitions |
| `pipelines` | Sales pipelines |
| `pipeline_stages` | Stages within pipelines |
| `campaigns` | Marketing campaigns |
| `campaign_leads` | Lead-campaign junction |
| `templates` | Message templates |
| `outreach_sequences` | Multi-step sequences |
| `outreach_sequence_steps` | Individual steps |
| `outreach_tasks` | Follow-up tasks |
| `outreach_logs` | Message send logs |
| `scoring_rules` | Scoring rule definitions |
| `scoring_config` | Global scoring settings |
| `assignment_config` | Round robin settings |
| `integrations` | Third-party integration configs |
| `refresh_tokens` | Active refresh tokens |
| `password_reset_tokens` | Password reset tokens |
| `report_exports` | Async export job tracking |
| `scraper_configs` | Scraper configurations |
| `scraper_logs` | Scraper run history |
| `ai_settings` | OpenAI configuration |

### AI Tables (Phase 2)

| Table | Purpose |
|---|---|
| `lead_ai_profiles` | AI-generated lead research profiles |
| `ai_decision_log` | AI decision audit trail |
| `lead_conversation_summaries` | AI-summarized conversation history |
| `campaign_ai_briefs` | AI-generated campaign briefs |
| `ai_inbox_items` | Priority inbox for reps |

### Key Relationships

```
users ──────< leads (assigned_to)
leads ──────< campaign_leads >────── campaigns
campaigns ──< outreach_sequences ──< outreach_sequence_steps
leads ──────< outreach_logs
leads ──────< lead_ai_profiles
leads ──────< ai_decision_log
campaigns ──< campaign_ai_briefs
leads ──────< ai_inbox_items
pipelines ──< pipeline_stages
leads ──────< pipeline_stages (via current_stage_id)
```

---

## 9. Integrations

### WhatsApp Business API
- **Purpose:** Send/receive WhatsApp messages
- **Auth:** Bearer token for API, HMAC for webhook verification
- **Setup:** Configure in Settings → Integrations

### Twilio (SMS)
- **Purpose:** Send/receive SMS messages
- **Auth:** Account SID + Auth Token
- **Setup:** Add Twilio credentials in Settings → Integrations

### SendGrid (Email)
- **Purpose:** Send email campaigns
- **Auth:** API Key
- **Setup:** Add SendGrid API key in Settings → Integrations

### Google Ads
- **Purpose:** Import leads from Google Ads lead forms
- **Auth:** OAuth 2.0
- **Setup:** Click "Connect Google Ads" in Settings → Integrations, complete OAuth flow

### Facebook Business
- **Purpose:** Import leads from Facebook lead forms
- **Auth:** OAuth 2.0
- **Setup:** Click "Connect Facebook" in Settings → Integrations, complete OAuth flow

### Google Sheets
- **Purpose:** Sync lead data to/from Google Sheets
- **Auth:** API Key

### Google Calendar / Outlook
- **Purpose:** Schedule meetings with leads
- **Auth:** OAuth 2.0

---

## 10. AI Features

### How AI Personalization Works

1. **Lead is created/imported** → BullMQ triggers `ai:research-lead` job
2. **AI Intelligence module** calls OpenAI with lead data → generates profile (buying intent, objections, next action)
3. **Campaign is launched** → outreach engine sends messages
4. **Message personalization** → OpenAI rewrites template with lead-specific details
5. **Lead replies** → AI classifies intent (meeting, pricing, objection, etc.)
6. **AI Inbox** → high-uncertainty items surfaced to sales rep for review

### AI Configuration

Go to **Settings → AI** to configure:
- API Key (encrypted with AES-256-GCM)
- Base URL (for custom OpenAI endpoints)
- Model (default: gpt-4o)
- Max tokens (hard cap: 500)
- Temperature (0-2)

### AI Reply Classification Intents

| Intent | Action |
|---|---|
| Meeting request | Auto-route to inbox, notify rep |
| Pricing question | Draft pricing response |
| Objection | Log objection, suggest rebuttal |
| Positive interest | Move to next pipeline stage |
| Not interested | Log, reduce outreach frequency |
| Opt-out | Cancel all sequences, mark DNC |
| General question | Draft response for review |
| Referral | Log referral source |

---

## 11. User Roles & Permissions

| Role | Can Do | Cannot Do |
|---|---|---|
| **admin** | Everything | — |
| **manager** | Manage leads, campaigns, pipeline, assignments, reports | System settings, user management |
| **sales** | View/manage own leads, pipeline updates, outreach | Create campaigns, manage users |
| **marketing** | Create campaigns, templates, view reports | Manage leads, pipeline, assignments |
| **viewer** | Read-only access to leads and reports | Anything write operations |

### Rate Limits

| Type | Limit |
|---|---|
| Authenticated users | 100 requests/minute |
| Public endpoints | 10 requests/minute |

---

## 12. Background Jobs (BullMQ)

### Workers

| Worker | Queue | Jobs |
|---|---|---|
| `scoring.worker` | `scoring` | `scoring:calculate-lead`, `scoring:recalculate-all` |
| `assignment.worker` | `assignment` | `assignment:round-robin` |
| `outreach.worker` | `outreach` | Message dispatch (WhatsApp/SMS/Email) |
| `reportExport.worker` | `report-export` | Async CSV generation |
| `scraper.worker` | `scraper` | Background scraping runs |
| `aiResearch.worker` | `ai-research` | `ai:research-lead` |
| `aiReply.worker` | `ai-reply` | `ai:classify-reply` |
| `aiCampaignBrain.worker` | `ai-campaign` | `ai:generate-campaign-brief` |
| `aiInbox.worker` | `ai:inbox` | `ai:create-inbox-item`, `ai:expiry-sweep` (cron every 30 min) |
| `events.worker` | `lead-events` | `lead.created`, `lead.stage_moved`, `lead.status_changed` |

### Job Features
- Exponential backoff on failure (3 retries, 2× delay)
- Dead-letter queue after max retries
- Prometheus metrics on all workers
- Sentry error capture
- Configurable retention limits

### Monitoring

Open **http://localhost:3001** (Bull Board) to see:
- Queue lengths
- Active/waiting/failed jobs
- Job details and retry status

---

## 13. Webhooks

**Base URL:** `http://localhost:3000/webhooks`

These are **public endpoints** (no JWT auth) — they verify signatures instead.

| Path | Source | Verification |
|---|---|---|
| `POST /webhooks/whatsapp` | WhatsApp Business | HMAC-SHA256 signature |
| `GET /webhooks/whatsapp` | WhatsApp verification | verify_token match |
| `POST /webhooks/twilio` | Twilio SMS | Twilio signature (HMAC-SHA1) |
| `POST /webhooks/sendgrid` | SendGrid events | SendGrid signature verification |
| `POST /webhooks/google-ads` | Google Ads leads | Secret key check |

---

## 14. Configuration & Environment Variables

All configuration is via environment variables. See `.env.example` for reference.

### Core

| Variable | Description | Default |
|---|---|---|
| `NODE_ENV` | Environment | `development` |
| `PORT` | API server port | `3000` |

### Authentication

| Variable | Description |
|---|---|
| `JWT_PRIVATE_KEY` | RSA private key (PEM format) for signing JWTs |
| `JWT_PUBLIC_KEY` | RSA public key (PEM format) for verifying JWTs |
| `JWT_ACCESS_EXPIRES_IN` | Access token TTL | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token TTL | `7d` |
| `ENCRYPTION_KEY` | 32-byte hex key for AES-256-GCM encryption |

### Database

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://crm:crm_dev_password@localhost:5432/crm_db` |
| `DATABASE_POOL_MIN` | Min pool connections | `2` |
| `DATABASE_POOL_MAX` | Max pool connections | `20` |

### Redis

| Variable | Description | Default |
|---|---|---|
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |

### File Storage (S3 / MinIO)

| Variable | Description | Default |
|---|---|---|
| `S3_ENDPOINT` | S3 endpoint URL | `http://localhost:9000` |
| `S3_BUCKET` | Bucket name | `crm-assets` |
| `S3_REGION` | AWS region | `ap-south-1` |
| `AWS_ACCESS_KEY_ID` | Access key | `minioadmin` |
| `AWS_SECRET_ACCESS_KEY` | Secret key | `minioadmin` |

### AI

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | OpenAI API key (sk-...) |
| `SENTRY_DSN` | Sentry DSN for error tracking |

### Rate Limiting

| Variable | Description | Default |
|---|---|---|
| `RATE_LIMIT_WINDOW_MS` | Window in ms | `60000` (1 min) |
| `RATE_LIMIT_MAX_AUTHENTICATED` | Max requests per window (auth) | `100` |
| `RATE_LIMIT_MAX_PUBLIC` | Max requests per window (public) | `10` |

### Integrations

| Variable | Description |
|---|---|
| `GOOGLE_PLACES_API_KEY` | Google Places API key |
| `YOUTUBE_API_KEY` | YouTube Data API key |
| `FACEBOOK_ACCESS_TOKEN` | Facebook Graph API token |

### CORS

| Variable | Description | Default |
|---|---|---|
| `CORS_ORIGIN` | Allowed origin | `http://localhost:5173` |

---

## 15. Development Guide

### Running Locally

```bash
# Start infrastructure only
docker compose up postgres redis minio

# Backend
cd backend
npm install
npm run migrate
npm run dev        # API server

# Workers (separate terminal)
cd backend
npm run worker     # BullMQ processors

# Frontend
cd frontend
npm install
npm run dev        # React dev server
```

### Project Conventions

- **Module pattern:** Each module has controller/service/repository/routes/schema/types
- **Validation:** All inputs validated with Zod schemas
- **Error handling:** Typed `AppError` subclasses (NotFoundError, ValidationError, etc.)
- **Response format:** Always `{ success, data, error, meta }`
- **IDs:** UUID v4
- **Timestamps:** ISO 8601 UTC
- **Soft deletes:** `deleted_at` timestamp column
- **No `any`:** All files fully typed

### Adding a New Module

1. Create `src/modules/<name>/` with 6 files (controller, service, repository, routes, schema, types)
2. Add routes to `src/index.ts`
3. Create migration in `migrations/`
4. Add tests (70%+ coverage required)
5. Add frontend page in `frontend/src/pages/`
6. Add API client in `frontend/src/api/`
7. Add route in `frontend/src/App.tsx`

### Database Migrations

```bash
npm run migrate    # Run pending migrations
```

**Rules:**
- Never edit existing migration files
- Always add new migration files
- Use `node-pg-migrate` format
- Append-only

---

## 16. Testing

### Backend Tests

```bash
cd backend
npm test                # Run all tests with coverage
npm run test:watch      # Watch mode
```

**Coverage requirements:**
- Minimum 70% overall
- Auth module: 90%+
- Every worker: at least 1 integration test

**Test files:** Located next to source files as `*.test.ts`

### Frontend Tests

```bash
cd frontend
npm test                # Run all tests
npm run test:coverage   # With coverage report
```

**Test files:** Located in `__tests__/` subdirectories

### Running Specific Tests

```bash
# Backend — single module
npx jest --testPathPattern=leads

# Frontend — single page
npx vitest --testPathPattern=Dashboard
```

---

## 17. Deployment

### Production Docker

```bash
docker compose -f docker-compose.prod.yml up --build
```

### CI/CD Pipeline

- **Branches:** `main` (production), `staging`, `develop`
- **PRs:** Target `develop`, require lint + test pass
- **Deploy:** GitHub Actions → Docker build → Server push

### Production Checklist

- [ ] Set all environment variables in `.env`
- [ ] Use strong JWT keys (RSA 2048+)
- [ ] Set `NODE_ENV=production`
- [ ] Configure Sentry DSN
- [ ] Set up SSL/TLS (Nginx)
- [ ] Configure rate limits
- [ ] Set up database backups
- [ ] Monitor Bull Board (restrict access)
- [ ] Set up Prometheus + Grafana

### Health Check

```bash
curl http://localhost:3000/health
# Returns: { "status": "ok", "timestamp": "...", "uptime": ... }
```

### Prometheus Metrics

```bash
curl http://localhost:3000/metrics
# Returns Prometheus-format metrics
```

---

*End of documentation.*

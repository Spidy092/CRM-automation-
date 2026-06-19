# CRM Automation Platform
## Technical Requirements Document (TRD)
**Prepared By:** Chethan Gowda
**Date:** 18 June 2026
**Version:** 1.0
**Reference:** PRD v2.0 Finalized

---

## 1. Overview

This document defines the technical requirements for the CRM Automation Platform. It covers the system architecture approach, technology stack, API specifications, data models, service boundaries, non-functional requirements, and constraints that development teams must follow during implementation.

---

## 2. Technology Stack

### 2.1 Backend

| Layer | Technology | Justification |
|---|---|---|
| Runtime | Node.js 20 LTS | Async I/O suits high-volume outreach and webhook handling |
| Framework | Express.js | Lightweight, well-supported, fast to build REST APIs |
| Task Queue | BullMQ (Redis-backed) | Reliable job scheduling for outreach sequences and follow-ups |
| Cache | Redis 7 | Session storage, rate limiting, queue backend |
| AI/LLM | OpenAI GPT-4o API | Message personalization and content generation |

### 2.2 Frontend

| Layer | Technology |
|---|---|
| Framework | React 18 + TypeScript |
| UI Library | Tailwind CSS + shadcn/ui |
| State Management | Zustand |
| Data Fetching | React Query (TanStack Query) |
| Charts/Dashboards | Recharts |

### 2.3 Database

| Type | Technology | Usage |
|---|---|---|
| Primary RDBMS | PostgreSQL 16 | Leads, users, campaigns, pipeline, audit logs |
| Cache/Queue | Redis 7 | BullMQ jobs, session tokens, rate limiting |
| File Storage | AWS S3 / MinIO | Marketing assets, CSV uploads, report exports |

### 2.4 Infrastructure

| Component | Technology |
|---|---|
| Containerization | Docker + Docker Compose |
| Reverse Proxy | Nginx |
| Process Manager | PM2 (Node.js) |
| Hosting | AWS EC2 / DigitalOcean Droplet |
| CI/CD | GitHub Actions |
| Monitoring | Sentry (errors) + Prometheus + Grafana (metrics) |

---

## 3. System Architecture

### 3.1 Architecture Pattern

The platform uses a **modular monolith** architecture for Phase 1. Each functional domain is a self-contained module with clear boundaries, enabling extraction into microservices in future phases without rewriting.

### 3.2 Core Modules

```
crm-platform/
├── modules/
│   ├── auth/              # Authentication, RBAC, sessions
│   ├── leads/             # Lead CRUD, scoring, custom fields
│   ├── campaigns/         # Campaign management, targeting rules
│   ├── outreach/          # Message dispatch, sequence engine
│   ├── pipeline/          # Stage management, transitions
│   ├── assignments/       # Round Robin engine, override logic
│   ├── templates/         # Template CRUD, approval workflow
│   ├── integrations/      # All third-party connectors
│   ├── reports/           # Analytics, dashboards, exports
│   └── scraper/           # Lead source crawlers
├── workers/               # BullMQ job processors
├── webhooks/              # Inbound webhook handlers
└── shared/                # Utilities, middleware, validators
```

### 3.3 Request Flow

```
Client (React) → Nginx → Express API → Module Handler
                                      ↓
                              PostgreSQL / Redis
                                      ↓
                         BullMQ Workers (async jobs)
                                      ↓
                    External APIs (WhatsApp, Twilio, SendGrid)
```

---

## 4. API Specification

### 4.1 API Standards

- **Protocol:** REST over HTTPS
- **Format:** JSON (request and response bodies)
- **Authentication:** JWT Bearer tokens (access token: 15 min, refresh token: 7 days)
- **Versioning:** URL-based — `/api/v1/`
- **Rate Limiting:** 100 requests/minute per authenticated user; 10 requests/minute for public endpoints
- **Pagination:** Cursor-based for lead lists; offset-based for reports

### 4.2 Authentication Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/auth/login` | Email + password login, returns JWT pair |
| POST | `/api/v1/auth/refresh` | Refresh access token using refresh token |
| POST | `/api/v1/auth/logout` | Invalidate refresh token |
| POST | `/api/v1/auth/forgot-password` | Send password reset email |
| POST | `/api/v1/auth/reset-password` | Reset password with token |

### 4.3 Lead Endpoints

| Method | Endpoint | Description | Roles |
|---|---|---|---|
| GET | `/api/v1/leads` | List leads (paginated, filterable) | All |
| POST | `/api/v1/leads` | Create single lead | Admin, Manager |
| GET | `/api/v1/leads/:id` | Get lead detail | All |
| PUT | `/api/v1/leads/:id` | Update lead | Admin, Manager, Sales |
| DELETE | `/api/v1/leads/:id` | Soft-delete lead | Admin |
| POST | `/api/v1/leads/import` | Bulk import via CSV/Excel | Admin, Manager |
| POST | `/api/v1/leads/:id/assign` | Manually assign lead to rep | Admin, Manager |
| POST | `/api/v1/leads/:id/score` | Recalculate lead score | Admin, Manager |
| GET | `/api/v1/leads/:id/activity` | Get lead activity timeline | All |
| POST | `/api/v1/leads/:id/pause` | Pause outreach automation | Sales, Manager, Admin |

### 4.4 Campaign Endpoints

| Method | Endpoint | Description | Roles |
|---|---|---|---|
| GET | `/api/v1/campaigns` | List campaigns | All |
| POST | `/api/v1/campaigns` | Create campaign | Admin, Manager, Marketing |
| GET | `/api/v1/campaigns/:id` | Get campaign detail | All |
| PUT | `/api/v1/campaigns/:id` | Update campaign | Admin, Manager, Marketing |
| DELETE | `/api/v1/campaigns/:id` | Archive campaign | Admin, Manager |
| POST | `/api/v1/campaigns/:id/launch` | Launch campaign | Admin, Manager |
| POST | `/api/v1/campaigns/:id/pause` | Pause campaign | Admin, Manager |

### 4.5 Outreach Endpoints

| Method | Endpoint | Description | Roles |
|---|---|---|---|
| GET | `/api/v1/outreach/sequences` | List outreach sequences | Admin, Manager |
| POST | `/api/v1/outreach/sequences` | Create sequence | Admin, Manager |
| PUT | `/api/v1/outreach/sequences/:id` | Update sequence | Admin, Manager |
| POST | `/api/v1/outreach/send` | Manually trigger message to lead | Admin, Manager, Sales |
| GET | `/api/v1/outreach/logs` | Get outreach delivery logs | Admin, Manager |

### 4.6 Template Endpoints

| Method | Endpoint | Description | Roles |
|---|---|---|---|
| GET | `/api/v1/templates` | List templates | All |
| POST | `/api/v1/templates` | Create template (pending approval) | Admin, Manager, Marketing |
| GET | `/api/v1/templates/:id` | Get template | All |
| PUT | `/api/v1/templates/:id` | Update template (resets to pending) | Admin, Manager, Marketing |
| POST | `/api/v1/templates/:id/approve` | Approve template | Admin, Manager |
| POST | `/api/v1/templates/:id/reject` | Reject template with reason | Admin, Manager |

### 4.7 Pipeline Endpoints

| Method | Endpoint | Description | Roles |
|---|---|---|---|
| GET | `/api/v1/pipelines` | List pipelines | All |
| POST | `/api/v1/pipelines` | Create pipeline | Admin |
| PUT | `/api/v1/pipelines/:id/stages` | Update stage configuration | Admin |
| POST | `/api/v1/leads/:id/stage` | Move lead to a stage | Sales, Manager, Admin |

### 4.8 Reporting Endpoints

| Method | Endpoint | Description | Roles |
|---|---|---|---|
| GET | `/api/v1/reports/dashboard` | Role-based dashboard metrics | All |
| GET | `/api/v1/reports/leads` | Lead generation report | Admin, Manager |
| GET | `/api/v1/reports/outreach` | Outreach performance report | Admin, Manager, Marketing |
| GET | `/api/v1/reports/pipeline` | Pipeline conversion report | Admin, Manager |
| GET | `/api/v1/reports/reps` | Sales rep performance report | Admin, Manager |
| POST | `/api/v1/reports/export` | Export report as CSV or XLSX | Admin, Manager |

### 4.9 Integration Endpoints

| Method | Endpoint | Description | Roles |
|---|---|---|---|
| GET | `/api/v1/integrations` | List integration statuses | Admin |
| PUT | `/api/v1/integrations/:name` | Save/update credentials | Admin |
| POST | `/api/v1/integrations/:name/test` | Test integration connection | Admin |

### 4.10 Webhook Endpoints (Inbound)

| Method | Endpoint | Source | Event |
|---|---|---|---|
| POST | `/webhooks/whatsapp` | WhatsApp Cloud API | Inbound messages, delivery receipts |
| POST | `/webhooks/twilio` | Twilio | SMS delivery status, inbound SMS |
| POST | `/webhooks/sendgrid` | SendGrid | Email open, click, bounce, unsubscribe |
| POST | `/webhooks/google-ads` | Google Ads | New lead form submissions |

---

## 5. Data Models

### 5.1 Users

```
users
├── id                UUID PK
├── name              VARCHAR(255) NOT NULL
├── email             VARCHAR(255) UNIQUE NOT NULL
├── password_hash     VARCHAR(255) NOT NULL
├── role              ENUM(admin, manager, sales_rep, marketing)
├── is_available      BOOLEAN DEFAULT true
├── is_active         BOOLEAN DEFAULT true
├── created_at        TIMESTAMP
└── updated_at        TIMESTAMP
```

### 5.2 Leads

```
leads
├── id                UUID PK
├── business_name     VARCHAR(255) NOT NULL
├── contact_name      VARCHAR(255) NOT NULL
├── phone             VARCHAR(50) NOT NULL
├── email             VARCHAR(255) NOT NULL
├── website           VARCHAR(500)
├── industry          VARCHAR(100) NOT NULL
├── location          VARCHAR(255) NOT NULL
├── country           VARCHAR(100)
├── google_rating     DECIMAL(2,1)
├── review_count      INTEGER
├── social_links      JSONB
├── source_platform   VARCHAR(100) NOT NULL
├── lead_score        INTEGER DEFAULT 0
├── classification    ENUM(hot, warm, cold)
├── status            ENUM(active, paused, won, lost, opted_out)
├── assigned_to       UUID FK → users.id
├── pipeline_stage_id UUID FK → pipeline_stages.id
├── custom_fields     JSONB
├── tags              TEXT[]
├── notes             TEXT
├── created_at        TIMESTAMP
└── updated_at        TIMESTAMP
```

### 5.3 Campaigns

```
campaigns
├── id                UUID PK
├── name              VARCHAR(255) NOT NULL
├── status            ENUM(draft, active, paused, completed, archived)
├── tone              ENUM(formal, professional, conversational)
├── target_industries TEXT[]
├── target_countries  TEXT[]
├── sequence_id       UUID FK → outreach_sequences.id
├── pipeline_id       UUID FK → pipelines.id
├── created_by        UUID FK → users.id
├── created_at        TIMESTAMP
└── updated_at        TIMESTAMP
```

### 5.4 Outreach Sequences

```
outreach_sequences
├── id                UUID PK
├── name              VARCHAR(255) NOT NULL
├── steps             JSONB NOT NULL
│   └── [{
│         step_number: int,
│         channel: enum(whatsapp, email, sms, phone_call),
│         delay_hours: int,
│         template_id: uuid
│       }]
├── created_by        UUID FK → users.id
├── created_at        TIMESTAMP
└── updated_at        TIMESTAMP
```

### 5.5 Outreach Logs

```
outreach_logs
├── id                UUID PK
├── lead_id           UUID FK → leads.id
├── campaign_id       UUID FK → campaigns.id
├── channel           ENUM(whatsapp, email, sms, phone_call)
├── template_id       UUID FK → templates.id
├── status            ENUM(queued, sent, delivered, opened, replied, failed, bounced)
├── external_msg_id   VARCHAR(255)
├── sent_at           TIMESTAMP
├── delivered_at      TIMESTAMP
├── opened_at         TIMESTAMP
├── replied_at        TIMESTAMP
└── error_message     TEXT
```

### 5.6 Templates

```
templates
├── id                UUID PK
├── name              VARCHAR(255) NOT NULL
├── channel           ENUM(whatsapp, email, sms, phone_call)
├── subject           VARCHAR(500)
├── body              TEXT NOT NULL
├── variables         TEXT[]
├── approval_status   ENUM(pending, approved, rejected)
├── approved_by       UUID FK → users.id
├── rejection_reason  TEXT
├── created_by        UUID FK → users.id
├── created_at        TIMESTAMP
└── updated_at        TIMESTAMP
```

### 5.7 Pipelines & Stages

```
pipelines
├── id                UUID PK
├── name              VARCHAR(255) NOT NULL
├── is_default        BOOLEAN DEFAULT false
├── created_by        UUID FK → users.id
└── created_at        TIMESTAMP

pipeline_stages
├── id                UUID PK
├── pipeline_id       UUID FK → pipelines.id
├── name              VARCHAR(255) NOT NULL
├── position          INTEGER NOT NULL
├── is_terminal_won   BOOLEAN DEFAULT false
├── is_terminal_lost  BOOLEAN DEFAULT false
└── created_at        TIMESTAMP
```

### 5.8 Lead Scoring Rules

```
scoring_rules
├── id                UUID PK
├── factor            VARCHAR(100) NOT NULL
├── weight            INTEGER NOT NULL
├── condition         JSONB NOT NULL
├── score_value       INTEGER NOT NULL
├── is_active         BOOLEAN DEFAULT true
├── created_by        UUID FK → users.id
└── updated_at        TIMESTAMP

scoring_config
├── id                UUID PK
├── hot_min_score     INTEGER NOT NULL
├── warm_min_score    INTEGER NOT NULL
├── assignment_threshold INTEGER NOT NULL
└── updated_at        TIMESTAMP
```

### 5.9 Custom Fields

```
custom_field_definitions
├── id                UUID PK
├── label             VARCHAR(255) NOT NULL
├── field_key         VARCHAR(100) UNIQUE NOT NULL
├── field_type        ENUM(text, number, date, dropdown, checkbox)
├── options           JSONB
├── is_required       BOOLEAN DEFAULT false
├── is_active         BOOLEAN DEFAULT true
├── created_by        UUID FK → users.id
└── created_at        TIMESTAMP
```

### 5.10 Audit Logs

```
audit_logs
├── id                UUID PK
├── user_id           UUID FK → users.id
├── action            VARCHAR(100) NOT NULL
├── entity_type       VARCHAR(100) NOT NULL
├── entity_id         UUID
├── old_value         JSONB
├── new_value         JSONB
└── created_at        TIMESTAMP
```

### 5.11 Tasks (Manual Phone Call & Follow-Up Tasks)

```
tasks
├── id                UUID PK
├── lead_id           UUID FK → leads.id (CASCADE)
├── campaign_id       UUID FK → campaigns.id (SET NULL)
├── sequence_id       UUID FK → outreach_sequences.id (SET NULL)
├── step_number       INTEGER
├── assigned_to       UUID FK → users.id (SET NULL)
├── type              ENUM(phone_call, follow_up, meeting_prep, other) DEFAULT phone_call
├── title             VARCHAR(255) NOT NULL
├── description       TEXT
├── due_at            TIMESTAMP
├── status            ENUM(pending, in_progress, completed, cancelled) DEFAULT pending
├── completed_at      TIMESTAMP
├── created_by        UUID FK → users.id
├── created_at        TIMESTAMP
└── updated_at        TIMESTAMP
```

> A `phone_call` step in an outreach sequence does **not** auto-dispatch a message.
> Instead the outreach engine inserts a row here, assigning the task to the lead's
> sales rep, and the sequence advances only when the rep marks the task completed.

---

## 6. Integration Technical Specifications

### 6.1 WhatsApp Cloud API

- **Provider:** Meta WhatsApp Business Cloud API
- **Auth:** Bearer token (stored encrypted in DB)
- **Outbound:** `POST https://graph.facebook.com/v18.0/{phone_number_id}/messages`
- **Inbound:** Webhook at `/webhooks/whatsapp` (verify token + HMAC signature validation)
- **Message Types:** Text, template messages (for first contact per Meta policy)
- **Rate Limit:** Respect Meta's per-number messaging limits

### 6.2 Twilio (SMS)

- **Auth:** Account SID + Auth Token
- **Outbound:** Twilio REST API `POST /2010-04-01/Accounts/{SID}/Messages`
- **Inbound:** Webhook at `/webhooks/twilio` (Twilio signature validation)
- **Delivery Status:** Webhook callbacks for delivered/failed

### 6.3 SendGrid (Email)

- **Auth:** API Key
- **Outbound:** SendGrid Mail Send API v3
- **Inbound Events:** Webhook at `/webhooks/sendgrid` for open, click, bounce, unsubscribe
- **Unsubscribe Handling:** Automatic opt-out on unsubscribe event

### 6.4 Google Sheets

- **Auth:** OAuth 2.0 (service account)
- **Usage:** Lead import from sheets, export of reports to sheets
- **Library:** Google Sheets API v4

### 6.5 Google Calendar

- **Auth:** OAuth 2.0
- **Usage:** Create calendar events when meetings are scheduled
- **Library:** Google Calendar API v3

### 6.6 Microsoft Outlook

- **Auth:** Microsoft OAuth 2.0 (Microsoft Graph API)
- **Usage:** Send emails via rep's Outlook account, sync calendar
- **Endpoint:** `POST https://graph.microsoft.com/v1.0/me/sendMail`

### 6.7 Slack

- **Auth:** Bot OAuth token
- **Usage:** Notifications for new lead assignments, template approvals, daily summaries
- **Method:** Slack Web API `chat.postMessage`

### 6.8 Microsoft Teams

- **Auth:** Incoming Webhook URL
- **Usage:** Same notification events as Slack
- **Method:** Adaptive Card payloads via webhook

### 6.9 SMTP

- **Config:** Host, port, username, password (stored encrypted)
- **Usage:** Fallback email sending when SendGrid is not configured
- **Library:** Nodemailer

---

## 7. Background Job Architecture

All async operations run through BullMQ workers backed by Redis.

### 7.1 Job Queues

| Queue | Purpose | Concurrency |
|---|---|---|
| `outreach.send` | Send individual outreach messages | 10 |
| `outreach.schedule` | Schedule follow-up steps | 5 |
| `leads.score` | Recalculate lead scores | 5 |
| `leads.assign` | Auto-assign leads via Round Robin | 3 |
| `scraper.run` | Execute lead source scrapers | 2 |
| `reports.generate` | Generate scheduled reports | 2 |
| `exports.generate` | Generate CSV/XLSX export files | 3 |

### 7.2 Job Retry Policy

- Max retries: 3
- Backoff: Exponential (1s, 4s, 16s)
- Failed jobs moved to dead-letter queue for manual review

---

## 8. Lead Scraper Technical Requirements

### 8.1 Scraper Architecture

Each lead source has a dedicated scraper module. Scrapers run as BullMQ jobs on a configurable schedule.

### 8.2 Source-Specific Requirements

| Source | Method | Library/API |
|---|---|---|
| Google Business | Google Places API | `@googlemaps/google-maps-services-js` |
| Facebook Business | Facebook Graph API | Meta Graph API v18 |
| YouTube Channels | YouTube Data API v3 | Google APIs Node.js client |
| Google Ads Lead Forms | Google Ads API | Google Ads API client |
| Website Contact Forms | HTTP scraping | Puppeteer (headless Chrome) |
| Custom Web Scraping | Configurable CSS selectors | Puppeteer + Cheerio |
| CSV/Excel Upload | File parse | `csv-parse` + `xlsx` |

### 8.3 Deduplication

- Leads are deduplicated on `(email OR phone) + source_platform`.
  - Enforced at the database level by two unique indexes:
    `UNIQUE (lower(email), source_platform)` and `UNIQUE (phone, source_platform)`.
  - Two leads in the same source that share an email **or** a phone number are treated
    as the same lead (matching either identifier is a duplicate).
- Before insert, the application **must normalize** identifiers:
  - `email` is lower-cased and trimmed.
  - `phone` is normalized to **E.164** format and stored in that form; variants of the
    same number must resolve to the same string, otherwise the phone-based dedup index
    will not match them.
- Duplicate detection runs before insert; existing leads are updated (upserted), not duplicated.

---

## 9. AI Message Personalization

### 9.1 Provider

- **Model:** OpenAI GPT-4o via API
- **Fallback:** Template variable substitution if AI call fails

### 9.2 Prompt Structure

Each personalization request sends:
- Lead data (business name, industry, city, rating, website)
- Template body with `{{variables}}`
- Campaign tone setting (formal / professional / conversational)
- Channel type (WhatsApp / Email / SMS — affects length and format)

### 9.3 Output Constraints

- WhatsApp: max 1,024 characters
- SMS: max 160 characters (single segment)
- Email: no hard limit; structured with subject + body
- Phone Call: no hard limit; generated as a call script stored on the manual task

### 9.4 Cost Control

- AI personalization is called once per lead per sequence step.
- Generated messages are cached per `(lead_id, template_id)` to avoid duplicate API calls on retries.

---

## 10. Security Technical Requirements

### 10.1 Authentication

- Passwords hashed with bcrypt (cost factor 12)
- JWT signed with RS256 (asymmetric keys)
- Refresh tokens stored in DB with expiry; invalidated on logout
- Failed login attempts: lock account after 5 consecutive failures for 15 minutes

### 10.2 Authorization

- RBAC enforced at the route middleware level
- Resource-level ownership checks (sales reps can only access their assigned leads)
- All permission checks centralized in `auth/permissions.ts`

### 10.3 Data Encryption

- Database: PostgreSQL encryption at rest (AWS RDS encryption or LUKS)
- Integration credentials: AES-256-GCM encrypted before storing in DB
- TLS 1.2+ enforced on all endpoints

### 10.4 Input Validation

- All request bodies validated with Zod schemas
- SQL injection prevented via parameterized queries (no raw string interpolation)
- File uploads: type validation (CSV, XLSX, PDF, JPEG, PNG only), max 10MB

### 10.5 Webhook Security

- WhatsApp: HMAC-SHA256 signature verification on every inbound webhook
- Twilio: Twilio request signature validation
- SendGrid: Signed webhook verification

### 10.6 Audit Logging

All of the following actions are written to `audit_logs`:
- User login / logout / failed login
- Lead created, updated, deleted, assigned
- Template created, approved, rejected
- Campaign launched, paused
- Integration credentials updated
- User role changes
- Report exports

---

## 11. Non-Functional Requirements

### 11.1 Performance

| Metric | Target |
|---|---|
| API response time (p95) | < 300ms |
| Lead list page load | < 1 second |
| Outreach job processing | < 5 seconds per message |
| Report generation | < 10 seconds |
| CSV export (10,000 rows) | < 30 seconds |

### 11.2 Scalability

- System must handle 1,000+ leads/month ingestion without degradation.
- Outreach queue must process up to 500 messages/hour.
- Database indexes on `leads.email`, `leads.phone`, `leads.assigned_to`, `leads.created_at`, `outreach_logs.lead_id`.

### 11.3 Availability

- Target uptime: 99.5% (Phase 1)
- Graceful degradation: if an integration is unavailable, jobs are retried; the platform remains operational.

### 11.4 Observability

- Structured JSON logging (Winston)
- Error tracking: Sentry
- Health check endpoint: `GET /health` returns service and DB status
- BullMQ dashboard (Bull Board) for job monitoring (admin-only)

---

## 12. Development Constraints

- **Node.js version:** 20 LTS
- **PostgreSQL version:** 16
- **Redis version:** 7
- **All secrets** stored in environment variables, never hardcoded
- **Database migrations** managed with `node-pg-migrate`
- **API documentation** generated with Swagger/OpenAPI 3.0
- **Code style:** ESLint + Prettier enforced via pre-commit hooks
- **Testing:** Jest for unit tests; Supertest for API integration tests; minimum 70% coverage on core modules

---

## 13. Pending Inputs Required Before Development

| Item | Owner | Impact |
|---|---|---|
| Target countries/regions list | Stakeholder | Scraper geo-filter configuration |
| Target industries list | Stakeholder | Scoring rules, campaign targeting |
| Excluded industries list | Stakeholder | Scraper and campaign filters |
| API credentials (all 10 integrations) | Client | Integration module configuration |
| OpenAI API key | Client | AI personalization module |

---

*Document prepared by: Chethan Gowda | TRD v1.0 | 18 June 2026*

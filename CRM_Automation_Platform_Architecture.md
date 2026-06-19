# CRM Automation Platform
## System Architecture Design
**Prepared By:** Chethan Gowda
**Date:** 18 June 2026
**Version:** 1.0
**Reference:** TRD v1.0 | PRD v2.0

---

## 1. Architecture Overview

### 1.1 Pattern: Modular Monolith

The platform is built as a **modular monolith** for Phase 1. All domain modules (leads, campaigns, outreach, pipeline, etc.) run within a single deployable Node.js process, but are organized as independent modules with strict internal boundaries — no cross-module direct database access, all inter-module communication via service interfaces.

**Rationale:**
- 1–2 month delivery timeline favors a single deployable unit over distributed services
- Modular boundaries allow future extraction into microservices without rewriting
- Simpler operational overhead (one process, one deployment, one log stream)
- Sufficient for Phase 1 scale (1,000+ leads/month, 500 messages/hour)

### 1.2 High-Level System Layers

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                         │
│              React 18 + TypeScript (SPA)                    │
│         Served via Nginx as static files                    │
└─────────────────────┬───────────────────────────────────────┘
                      │ HTTPS
┌─────────────────────▼───────────────────────────────────────┐
│                      GATEWAY LAYER                          │
│                   Nginx Reverse Proxy                       │
│         TLS Termination | Rate Limiting | Static Serve      │
└──────────┬──────────────────────────────┬───────────────────┘
           │ /api/*                       │ /webhooks/*
┌──────────▼──────────┐       ┌───────────▼───────────────────┐
│   APPLICATION LAYER │       │      WEBHOOK LAYER            │
│   Express.js API    │       │   Inbound Webhook Handlers    │
│   (Node.js 20 LTS)  │       │   WhatsApp | Twilio |         │
│                     │       │   SendGrid | Google Ads       │
│  ┌───────────────┐  │       └───────────────────────────────┘
│  │ Auth Module   │  │
│  │ Leads Module  │  │
│  │ Campaigns     │  │
│  │ Outreach      │  │
│  │ Pipeline      │  │
│  │ Assignments   │  │
│  │ Templates     │  │
│  │ Integrations  │  │
│  │ Reports       │  │
│  │ Scraper       │  │
│  └───────────────┘  │
└──────────┬──────────┘
           │
┌──────────▼──────────────────────────────────────────────────┐
│                      DATA LAYER                             │
│   PostgreSQL 16          Redis 7          AWS S3 / MinIO    │
│   (Primary DB)           (Cache/Queue)    (File Storage)    │
└──────────┬──────────────────────────────────────────────────┘
           │
┌──────────▼──────────────────────────────────────────────────┐
│                    WORKER LAYER                             │
│              BullMQ Workers (Node.js processes)             │
│   outreach.send | outreach.schedule | leads.score           │
│   leads.assign  | scraper.run       | reports.generate      │
│   exports.generate                                          │
└──────────┬──────────────────────────────────────────────────┘
           │
┌──────────▼──────────────────────────────────────────────────┐
│                  EXTERNAL SERVICES LAYER                    │
│  WhatsApp Cloud API  │  Twilio  │  SendGrid  │  OpenAI      │
│  Google Places API   │  Google Sheets/Calendar              │
│  Microsoft Graph API │  Slack   │  MS Teams  │  SMTP        │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Component Architecture

### 2.1 Application Server Components

```
Express.js Application
│
├── Middleware Stack (applied globally)
│   ├── helmet.js          — Security headers
│   ├── cors               — CORS policy
│   ├── express-rate-limit — Rate limiting (Redis-backed)
│   ├── morgan             — HTTP request logging
│   └── JWT verifier       — Token validation on protected routes
│
├── Route Layer
│   ├── /api/v1/auth       → Auth Module
│   ├── /api/v1/leads      → Leads Module
│   ├── /api/v1/campaigns  → Campaigns Module
│   ├── /api/v1/outreach   → Outreach Module
│   ├── /api/v1/templates  → Templates Module
│   ├── /api/v1/pipelines  → Pipeline Module
│   ├── /api/v1/reports    → Reports Module
│   └── /api/v1/integrations → Integrations Module
│
├── Webhook Route Layer
│   ├── /webhooks/whatsapp
│   ├── /webhooks/twilio
│   ├── /webhooks/sendgrid
│   └── /webhooks/google-ads
│
└── Shared Services
    ├── Database Pool      — pg (node-postgres) connection pool
    ├── Redis Client       — ioredis
    ├── Queue Client       — BullMQ
    ├── Logger             — Winston (JSON structured)
    └── Event Bus          — Internal EventEmitter for cross-module events
```

### 2.2 Module Internal Structure

Each domain module follows the same internal structure:

```
modules/leads/
├── leads.routes.ts        — Express router, RBAC middleware
├── leads.controller.ts    — Request/response handling
├── leads.service.ts       — Business logic
├── leads.repository.ts    — Database queries (parameterized SQL)
├── leads.schema.ts        — Zod validation schemas
└── leads.types.ts         — TypeScript interfaces
```

### 2.3 Worker Architecture

Workers run as separate Node.js processes managed by PM2, sharing the same codebase but only loading the worker entry point.

```
workers/
├── outreach.worker.ts     — Processes outreach.send and outreach.schedule queues
├── leads.worker.ts        — Processes leads.score and leads.assign queues
├── scraper.worker.ts      — Processes scraper.run queue
└── reports.worker.ts      — Processes reports.generate and exports.generate queues
```

---

## 3. Infrastructure Topology

### 3.1 Production Server Layout

```
Internet
    │
    ▼
┌─────────────────────────────────────────┐
│           Load Balancer / DNS           │
│         (AWS ALB or Nginx upstream)     │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│              Web Server                 │
│         Ubuntu 22.04 LTS               │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │           Nginx                 │   │
│  │  - TLS termination (Let's Encrypt)  │
│  │  - Static file serving (React)  │   │
│  │  - Reverse proxy to Node.js     │   │
│  │  - Rate limiting                │   │
│  └──────────────┬──────────────────┘   │
│                 │                       │
│  ┌──────────────▼──────────────────┐   │
│  │        PM2 Process Manager      │   │
│  │                                 │   │
│  │  [API Server]    Port 3000      │   │
│  │  [Outreach Worker]              │   │
│  │  [Leads Worker]                 │   │
│  │  [Scraper Worker]               │   │
│  │  [Reports Worker]               │   │
│  └──────────────┬──────────────────┘   │
└─────────────────┼───────────────────────┘
                  │
    ┌─────────────┼─────────────┐
    │             │             │
┌───▼───┐   ┌────▼────┐  ┌─────▼────┐
│  PG   │   │  Redis  │  │  S3/MinIO│
│  DB   │   │  Cache  │  │  Files   │
│ :5432 │   │  :6379  │  │  :9000   │
└───────┘   └─────────┘  └──────────┘
```

### 3.2 Minimum Server Specifications (Phase 1)

| Component | Spec |
|---|---|
| Web/App Server | 4 vCPU, 8GB RAM, 50GB SSD |
| PostgreSQL | 2 vCPU, 4GB RAM, 100GB SSD (managed RDS or self-hosted) |
| Redis | 1 vCPU, 2GB RAM (managed ElastiCache or self-hosted) |
| File Storage | AWS S3 (managed) or MinIO on same server |

### 3.3 Docker Compose Layout (Development & Staging)

```yaml
services:
  nginx:        # Reverse proxy + static file server
  api:          # Express.js application server
  worker:       # BullMQ workers (all queues)
  postgres:     # PostgreSQL 16
  redis:        # Redis 7
  minio:        # S3-compatible file storage (dev only)
  bull-board:   # BullMQ job monitoring UI (admin only)
```

---

## 4. Data Flow Diagrams

### 4.1 Lead Ingestion Flow

```
Lead Source (Google/Facebook/CSV/etc.)
        │
        ▼
  Scraper Module
  (BullMQ: scraper.run)
        │
        ▼
  Deduplication Check
  (email OR phone + source)
        │
   ┌────┴────┐
   │         │
Duplicate  New Lead
   │         │
Update     Insert to
existing   leads table
lead       │
           ▼
     Lead Scoring Job
     (BullMQ: leads.score)
           │
           ▼
     Score Calculated
     Classification Set (Hot/Warm/Cold)
           │
     Threshold Met?
     ┌─────┴─────┐
    Yes          No
     │           │
     ▼           ▼
Lead Assignment  Lead stays
(BullMQ:        unassigned
leads.assign)   (manual review)
     │
     ▼
Round Robin Assignment
→ Sales Rep notified (Slack/Teams)
→ Outreach Sequence Triggered
```

### 4.2 Outreach Dispatch Flow

```
Campaign Launched
      │
      ▼
Leads matching campaign filters
      │
      ▼
For each lead → Outreach Sequence Steps
      │
      ▼
Step 1: WhatsApp message
(BullMQ: outreach.send)
      │
      ├── AI Personalization (OpenAI GPT-4o)
      │   └── Cached per (lead_id, template_id)
      │
      ├── Send via WhatsApp Cloud API
      │
      ├── Log to outreach_logs (status: sent)
      │
      └── Schedule Step 2 (BullMQ: outreach.schedule)
            delay = configured hours
            │
            ▼
      Check stop conditions:
      - Lead replied? → STOP
      - Lead opted out? → STOP
      - Lead Won/Lost? → STOP
      - Manually paused? → STOP
      - Max steps reached? → STOP
            │
           No stop condition
            │
            ▼
      Step 2: Email (SendGrid)
            │
            ▼
      Step 3: SMS (Twilio)
            │
            ▼
      Step 4: Phone Call Task
      → Assigned to sales rep as manual task
```

### 4.3 Inbound Webhook Flow

```
External Service (WhatsApp/Twilio/SendGrid)
        │
        ▼
  Nginx → /webhooks/{service}
        │
        ▼
  Signature Verification
  (HMAC-SHA256 / Twilio sig / SendGrid sig)
        │
   Valid?
   ┌────┴────┐
  No        Yes
   │         │
  401       Parse Event Type
            │
     ┌──────┼──────┬──────────┐
     │      │      │          │
  Reply  Delivery  Opt-out  Bounce
     │      │      │          │
     ▼      ▼      ▼          ▼
Update   Update  Set lead   Update
outreach outreach status=   outreach
_logs    _logs   opted_out  _logs
replied  status  Stop       status
_at      =deliv  automation =bounced
     │
     ▼
Stop outreach automation for lead
Move lead stage → "Follow-Up Required"
Notify assigned sales rep (Slack/Teams)
```

### 4.4 Template Approval Flow

```
Marketing User / Admin creates template
        │
        ▼
Template saved (approval_status: pending)
        │
        ▼
Manager / Admin receives notification
(Slack/Teams/Email)
        │
        ▼
Manager reviews template
        │
   ┌────┴────┐
Approve    Reject
   │         │
   ▼         ▼
status=    status=rejected
approved   rejection_reason saved
   │         │
   ▼         ▼
Template   Creator notified
available  with reason
for use in
campaigns
```

---

## 5. Integration Architecture

### 5.1 Integration Connection Map

```
CRM Platform
│
├── OUTBOUND MESSAGING
│   ├── WhatsApp Cloud API ←→ /webhooks/whatsapp (inbound)
│   ├── Twilio SMS         ←→ /webhooks/twilio (delivery status)
│   ├── SendGrid Email     ←→ /webhooks/sendgrid (events)
│   └── SMTP               → (outbound only, no webhook)
│
├── LEAD SOURCES
│   ├── Google Places API  → (scraper, outbound only)
│   ├── Facebook Graph API → (scraper, outbound only)
│   ├── YouTube Data API   → (scraper, outbound only)
│   ├── Google Ads API     ←→ /webhooks/google-ads (lead forms)
│   └── Puppeteer          → (web scraping, outbound only)
│
├── PRODUCTIVITY
│   ├── Google Sheets      ←→ (import/export, bidirectional)
│   ├── Google Calendar    → (create events, outbound)
│   └── Microsoft Outlook  → (send email, outbound)
│
├── NOTIFICATIONS
│   ├── Slack              → (outbound notifications only)
│   └── Microsoft Teams    → (outbound notifications only)
│
└── AI
    └── OpenAI GPT-4o      → (outbound API calls only)
```

### 5.2 Credentials Storage Architecture

```
Admin UI → PUT /api/v1/integrations/{name}
                │
                ▼
         Encrypt with AES-256-GCM
         (encryption key from ENV)
                │
                ▼
         Store in integrations table
         (encrypted_credentials JSONB)
                │
         At runtime:
                │
                ▼
         Decrypt on-demand
         Cache decrypted client in memory
         (invalidated on credential update)
```

---

## 6. Security Architecture

### 6.1 Network Security Zones

```
┌─────────────────────────────────────────────────────┐
│                  PUBLIC ZONE                        │
│   Internet → Nginx (port 443 HTTPS only)            │
│   Port 80 redirects to 443                          │
│   Port 22 SSH restricted to admin IPs only          │
└──────────────────────┬──────────────────────────────┘
                       │ Internal only
┌──────────────────────▼──────────────────────────────┐
│                 APPLICATION ZONE                    │
│   Node.js API (port 3000, localhost only)           │
│   BullMQ Workers (no external ports)               │
│   Bull Board UI (port 3001, admin IP only)          │
└──────────────────────┬──────────────────────────────┘
                       │ Internal only
┌──────────────────────▼──────────────────────────────┐
│                   DATA ZONE                         │
│   PostgreSQL (port 5432, localhost/VPC only)        │
│   Redis (port 6379, localhost/VPC only)             │
│   MinIO/S3 (VPC endpoint or localhost)              │
└─────────────────────────────────────────────────────┘
```

### 6.2 Authentication Flow

```
User → POST /api/v1/auth/login
            │
            ▼
      Validate email + password (bcrypt)
            │
            ▼
      Generate:
      - Access Token (JWT RS256, 15 min)
      - Refresh Token (opaque, 7 days, stored in DB)
            │
            ▼
      Return tokens to client
            │
      Client stores:
      - Access Token: memory (not localStorage)
      - Refresh Token: HttpOnly cookie
            │
      On expiry:
      POST /api/v1/auth/refresh
      → New access token issued
```

### 6.3 Request Authorization Flow

```
Incoming Request
      │
      ▼
JWT Middleware
→ Verify RS256 signature
→ Check expiry
→ Extract user_id + role
      │
      ▼
RBAC Middleware (per route)
→ Check role has permission for this endpoint
      │
      ▼
Resource Ownership Check (where applicable)
→ Sales rep: can only access own assigned leads
→ Manager: can access all leads in their team
→ Admin: full access
      │
      ▼
Controller → Service → Repository
```

---

## 7. Observability Architecture

### 7.1 Logging

```
All services → Winston Logger
                    │
                    ▼
            Structured JSON logs
            {timestamp, level, module, message, meta}
                    │
              ┌─────┴─────┐
              │           │
         stdout/stderr  Log files
         (PM2 captures)  /var/log/crm/
```

### 7.2 Error Tracking

```
Unhandled errors / exceptions
        │
        ▼
Sentry SDK (Node.js)
        │
        ▼
Sentry Dashboard
→ Error grouping, stack traces, user context
→ Alerts via email/Slack on new error types
```

### 7.3 Metrics & Monitoring

```
Node.js App → prom-client
                  │
                  ▼
         /metrics endpoint
         (internal only)
                  │
                  ▼
           Prometheus scrapes
                  │
                  ▼
           Grafana Dashboards
           - API request rates
           - Queue depths
           - Job success/failure rates
           - DB connection pool usage
           - Memory/CPU
```

### 7.4 Health Check

```
GET /health
→ Returns:
{
  "status": "ok",
  "db": "connected",
  "redis": "connected",
  "uptime": 12345,
  "timestamp": "2026-06-18T..."
}
```

---

## 8. Scalability Plan

### 8.1 Phase 1 Capacity (Current Design)

| Metric | Capacity |
|---|---|
| Leads/month | 5,000+ (well above 1,000 target) |
| Outreach messages/hour | 500+ |
| Concurrent API users | 50–100 |
| DB connections | 20 (pg pool) |
| Queue workers | 7 queues, configurable concurrency |

### 8.2 Phase 2 Scaling Path (Future)

When load exceeds Phase 1 capacity, the following changes apply without architectural rewrites:

| Bottleneck | Solution |
|---|---|
| API throughput | Add second Node.js instance behind Nginx upstream |
| Queue processing | Increase BullMQ worker concurrency or add worker instances |
| Database reads | Add PostgreSQL read replica; route report queries to replica |
| Database writes | Partition `outreach_logs` table by month |
| File storage | Already on S3 — scales automatically |
| Scraper capacity | Extract scraper module to standalone service |

### 8.3 Microservices Extraction Order (Phase 3+)

When the modular monolith needs to be split, extract in this order:

1. **Scraper Service** — High resource usage, independent schedule
2. **Outreach Service** — High volume, needs independent scaling
3. **Reports Service** — CPU-intensive, can run on separate instance
4. **Core CRM API** — Leads, pipeline, users (last to split)

---

## 9. Backup & Disaster Recovery

### 9.1 Database Backup

| Type | Frequency | Retention | Method |
|---|---|---|---|
| Full backup | Daily | 30 days | pg_dump → S3 |
| WAL archiving | Continuous | 7 days | PostgreSQL WAL → S3 |
| Point-in-time recovery | On demand | — | Restore from WAL |

### 9.2 File Storage Backup

- AWS S3: Versioning enabled, cross-region replication for production
- MinIO (dev/staging): Daily snapshot to external storage

### 9.3 Recovery Time Objectives

| Scenario | RTO | RPO |
|---|---|---|
| Application crash | < 1 min (PM2 auto-restart) | 0 |
| Server failure | < 30 min (redeploy from Docker image) | < 1 hour |
| Database corruption | < 2 hours (restore from backup) | < 24 hours |

### 9.4 Redis Recovery

- Redis is used for cache and job queues only.
- On Redis failure: API falls back gracefully (rate limiting disabled, sessions re-authenticated).
- BullMQ jobs in-flight at time of failure are retried on restart (jobs are persisted in Redis AOF).
- Redis AOF persistence enabled.

---

## 10. CI/CD Pipeline

```
Developer pushes to GitHub
        │
        ▼
GitHub Actions Workflow
        │
   ┌────┴────────────────┐
   │                     │
ESLint + Prettier    Jest Tests
(code style)         (unit + integration)
   │                     │
   └────────┬────────────┘
            │ All pass
            ▼
     Build Docker image
            │
            ▼
     Push to Container Registry
     (GitHub Container Registry / ECR)
            │
            ▼
     Deploy to Staging
     (docker-compose pull + up)
            │
            ▼
     Smoke tests (health check)
            │
            ▼
     Manual approval gate
            │
            ▼
     Deploy to Production
     (zero-downtime: PM2 reload)
```

---

## 11. Environment Configuration

### 11.1 Environment Variables (Required)

```
# Application
NODE_ENV=production
PORT=3000
JWT_PRIVATE_KEY=<RS256 private key>
JWT_PUBLIC_KEY=<RS256 public key>
ENCRYPTION_KEY=<32-byte AES key>

# Database
DATABASE_URL=postgresql://user:pass@host:5432/crm

# Redis
REDIS_URL=redis://host:6379

# File Storage
S3_BUCKET=crm-assets
S3_REGION=ap-south-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=

# AI
OPENAI_API_KEY=

# Monitoring
SENTRY_DSN=

# (Integration credentials stored encrypted in DB, not in ENV)
```

### 11.2 Environment Separation

| Environment | Purpose | Database | Redis |
|---|---|---|---|
| Development | Local dev | Local Docker | Local Docker |
| Staging | QA testing | Separate DB | Separate Redis |
| Production | Live system | Managed RDS | Managed ElastiCache |

---

*Document prepared by: Chethan Gowda | Architecture v1.0 | 18 June 2026*

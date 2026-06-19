# CRM Automation Platform
## Development Roadmap — Phase 1
**Prepared By:** Chethan Gowda
**Date:** 18 June 2026
**Version:** 1.0
**Reference:** TRD v1.0 | Architecture v1.0 | PRD v2.0
**Target Timeline:** 8 Weeks (2 Months)

---

## 1. Overview

Phase 1 delivers a fully functional CRM Automation Platform within 8 weeks. The roadmap is organized into 4 two-week sprints, each with a clear deliverable that can be demonstrated to stakeholders.

### 1.1 Team Assumptions

| Role | Count |
|---|---|
| Backend Developer | 2 |
| Frontend Developer | 1 |
| Full-Stack Developer | 1 |
| QA Engineer | 1 |
| DevOps / Infrastructure | 1 (part-time) |
| Project Manager | 1 (part-time) |

### 1.2 Sprint Summary

| Sprint | Weeks | Theme | Key Deliverable |
|---|---|---|---|
| Sprint 1 | Week 1–2 | Foundation | Auth, DB, Infrastructure, Lead CRUD |
| Sprint 2 | Week 3–4 | Core CRM | Pipeline, Scoring, Assignment, Campaigns |
| Sprint 3 | Week 5–6 | Automation | Outreach Engine, Integrations, Webhooks |
| Sprint 4 | Week 7–8 | Intelligence & Polish | AI Personalization, Reports, Scrapers, UAT |

---

## 2. Pre-Sprint: Setup Week (Day 1–3)

Before Sprint 1 begins, the following must be completed:

### Tasks

- [ ] Create GitHub repository with branch protection rules (`main`, `develop`, `staging`)
- [ ] Set up Docker Compose for local development (PostgreSQL, Redis, MinIO, Bull Board)
- [ ] Configure GitHub Actions CI pipeline (lint + test on PR)
- [ ] Initialize Node.js project with TypeScript, ESLint, Prettier, Jest
- [ ] Initialize React project with TypeScript, Tailwind CSS, shadcn/ui
- [ ] Run database schema migration (`CRM_Automation_Platform_Database_Schema.sql`)
- [ ] Set up Sentry project (backend + frontend)
- [ ] Provision staging server and deploy base Docker Compose stack
- [ ] Collect API credentials from client (WhatsApp, Twilio, SendGrid, OpenAI, Google APIs)

**Owner:** DevOps + Lead Backend Developer
**Blocker:** API credentials must be received before Sprint 3

---

## 3. Sprint 1 — Foundation (Week 1–2)

**Goal:** Working backend API with authentication, user management, and lead CRUD. Basic frontend shell with login.

### 3.1 Backend Tasks

| Task | Owner | Days |
|---|---|---|
| Project structure setup (modules, shared, workers) | BE Dev 1 | 0.5 |
| Database connection pool + migration runner | BE Dev 1 | 0.5 |
| Redis client + BullMQ setup | BE Dev 1 | 0.5 |
| Auth module: login, JWT RS256, refresh token, logout | BE Dev 1 | 2 |
| Auth module: forgot password, reset password | BE Dev 1 | 1 |
| RBAC middleware (role-based route protection) | BE Dev 1 | 1 |
| Users module: CRUD, availability toggle | BE Dev 2 | 1.5 |
| Leads module: create, read, update, soft-delete | BE Dev 2 | 2 |
| Leads module: bulk CSV/Excel import | BE Dev 2 | 1.5 |
| Leads module: custom fields support (JSONB) | BE Dev 2 | 1 |
| Audit logging middleware | BE Dev 1 | 1 |
| Health check endpoint | BE Dev 1 | 0.5 |
| Winston structured logging setup | BE Dev 1 | 0.5 |
| Unit tests: auth + leads modules (70% coverage) | BE Dev 1+2 | 2 |

### 3.2 Frontend Tasks

| Task | Owner | Days |
|---|---|---|
| React project setup (routing, auth context, API client) | FE Dev | 1 |
| Login page + JWT token management | FE Dev | 1.5 |
| App shell: sidebar navigation, role-based menu | FE Dev | 1.5 |
| Leads list page (table, pagination, filters) | FE Dev | 2 |
| Lead detail page (view + edit form) | FE Dev | 2 |
| Lead import page (CSV/Excel upload) | FE Dev | 1 |
| User management page (admin only) | FE Dev | 1 |

### 3.3 Sprint 1 Deliverable

- Working login system with 4 user roles
- Lead list, detail, create, edit, import via CSV
- Audit log writing on all lead actions
- Deployed to staging environment

---

## 4. Sprint 2 — Core CRM (Week 3–4)

**Goal:** Pipeline management, lead scoring engine, Round Robin assignment, and campaign creation.

### 4.1 Backend Tasks

| Task | Owner | Days |
|---|---|---|
| Pipeline module: CRUD for pipelines and stages | BE Dev 1 | 1.5 |
| Pipeline module: move lead between stages | BE Dev 1 | 1 |
| Scoring module: scoring rules CRUD | BE Dev 2 | 1.5 |
| Scoring module: score calculation engine (BullMQ worker) | BE Dev 2 | 2 |
| Scoring module: auto-classification (Hot/Warm/Cold) | BE Dev 2 | 1 |
| Assignment module: Round Robin engine (BullMQ worker) | BE Dev 1 | 2 |
| Assignment module: manual override by manager | BE Dev 1 | 0.5 |
| Assignment module: rep availability check | BE Dev 1 | 0.5 |
| Templates module: CRUD + approval workflow | BE Dev 2 | 2 |
| Campaigns module: create, configure, launch, pause | BE Dev 1 | 2 |
| Campaigns module: lead filtering by industry + country | BE Dev 1 | 1 |
| Outreach sequences module: CRUD | BE Dev 2 | 1.5 |
| Slack/Teams notification on lead assignment | BE Dev 2 | 1 |
| Unit tests: pipeline, scoring, assignment, campaigns | BE Dev 1+2 | 2 |

### 4.2 Frontend Tasks

| Task | Owner | Days |
|---|---|---|
| Pipeline Kanban board view | FE Dev | 2.5 |
| Pipeline stage configuration page (admin) | FE Dev | 1 |
| Lead scoring rules configuration page (admin) | FE Dev | 1.5 |
| Template management page (create, list, approval) | FE Dev | 2 |
| Campaign creation wizard (name, tone, sequence, filters) | FE Dev | 2 |
| Campaign list + status management page | FE Dev | 1 |

### 4.3 Sprint 2 Deliverable

- Kanban pipeline board with drag-and-drop stage movement
- Automated lead scoring and classification on import
- Round Robin assignment with Slack/Teams notifications
- Campaign creation and template management with approval workflow

---

## 5. Sprint 3 — Automation Engine (Week 5–6)

**Goal:** Full outreach automation with WhatsApp, Email, SMS. All integrations connected. Inbound webhooks live.

**Dependency:** API credentials from client must be available at start of Sprint 3.

### 5.1 Backend Tasks

| Task | Owner | Days |
|---|---|---|
| Integrations module: credential storage (AES-256-GCM) | BE Dev 1 | 1 |
| Integrations module: connection test endpoint | BE Dev 1 | 0.5 |
| WhatsApp Cloud API connector | BE Dev 1 | 1.5 |
| Twilio SMS connector | BE Dev 2 | 1 |
| SendGrid email connector | BE Dev 2 | 1 |
| SMTP fallback email connector (Nodemailer) | BE Dev 2 | 0.5 |
| Outreach engine: sequence step dispatcher (BullMQ) | BE Dev 1 | 2 |
| Outreach engine: follow-up scheduler (BullMQ) | BE Dev 1 | 1.5 |
| Outreach engine: stop condition checker | BE Dev 1 | 1 |
| Inbound webhook: WhatsApp (reply detection, delivery) | BE Dev 2 | 1.5 |
| Inbound webhook: Twilio (delivery status, inbound SMS) | BE Dev 2 | 1 |
| Inbound webhook: SendGrid (open, click, bounce, unsub) | BE Dev 2 | 1 |
| Inbound webhook: Google Ads lead forms | BE Dev 2 | 1 |
| Auto opt-out on unsubscribe webhook | BE Dev 1 | 0.5 |
| Google Sheets connector (import/export) | BE Dev 1 | 1.5 |
| Google Calendar connector (create meeting events) | BE Dev 2 | 1 |
| Microsoft Outlook connector (send email via Graph API) | BE Dev 2 | 1 |
| Lead activity timeline endpoint | BE Dev 1 | 1 |
| Integration tests: outreach flow end-to-end | BE Dev 1+2 | 2 |

### 5.2 Frontend Tasks

| Task | Owner | Days |
|---|---|---|
| Integrations settings page (connect/test all 10) | FE Dev | 2 |
| Outreach sequence builder (step editor UI) | FE Dev | 2.5 |
| Lead activity timeline component | FE Dev | 1.5 |
| Outreach logs view per lead | FE Dev | 1 |
| Manual outreach trigger button on lead detail | FE Dev | 0.5 |
| Pause/resume automation toggle on lead | FE Dev | 0.5 |
| Campaign launch confirmation + live status | FE Dev | 1 |

### 5.3 Sprint 3 Deliverable

- End-to-end outreach: WhatsApp → Email → SMS sequence fires automatically on campaign launch
- Inbound replies stop automation and notify sales rep
- All 10 integrations configurable from admin UI
- Lead activity timeline shows full communication history

---

## 6. Sprint 4 — Intelligence, Reports & UAT (Week 7–8)

**Goal:** AI personalization, lead scrapers, reporting dashboards, export, and full UAT sign-off.

### 6.1 Backend Tasks

| Task | Owner | Days |
|---|---|---|
| OpenAI GPT-4o integration for message personalization | BE Dev 1 | 2 |
| AI message caching per (lead_id, template_id) | BE Dev 1 | 0.5 |
| Scraper: Google Business / Google Places | BE Dev 2 | 2 |
| Scraper: Facebook Business Pages | BE Dev 2 | 1.5 |
| Scraper: YouTube Channels | BE Dev 2 | 1 |
| Scraper: Google Ads Lead Forms | BE Dev 1 | 1 |
| Scraper: Website Contact Forms (Puppeteer) | BE Dev 1 | 1.5 |
| Scraper: Custom web scraping (CSS selector config) | BE Dev 1 | 1.5 |
| Scraper: deduplication on insert | BE Dev 2 | 0.5 |
| Reports module: dashboard metrics API | BE Dev 2 | 1.5 |
| Reports module: leads report | BE Dev 2 | 1 |
| Reports module: outreach performance report | BE Dev 2 | 1 |
| Reports module: pipeline conversion report | BE Dev 2 | 1 |
| Reports module: sales rep performance report | BE Dev 2 | 1 |
| Reports module: CSV + XLSX export (BullMQ worker) | BE Dev 1 | 1.5 |
| Report schedules: configurable per role (BullMQ cron) | BE Dev 1 | 1 |
| Performance testing + query optimization | BE Dev 1+2 | 1 |
| Security review: OWASP checklist | BE Dev 1 | 1 |

### 6.2 Frontend Tasks

| Task | Owner | Days |
|---|---|---|
| Admin dashboard (leads generated, qualified, conversion) | FE Dev | 2 |
| Manager dashboard (team performance, pipeline funnel) | FE Dev | 1.5 |
| Sales rep dashboard (my leads, tasks, pipeline) | FE Dev | 1.5 |
| Marketing dashboard (campaign metrics, open/reply rates) | FE Dev | 1 |
| Reports page with filters + date range | FE Dev | 1.5 |
| Export button (CSV/XLSX) on all report views | FE Dev | 0.5 |
| Report schedule configuration page | FE Dev | 1 |
| Scraper configuration page (sources, geo, industry) | FE Dev | 1.5 |
| AI personalization preview in template editor | FE Dev | 1 |
| Final UI polish, responsive design, loading states | FE Dev | 1.5 |

### 6.3 QA Tasks (Week 7–8)

| Task | Owner | Days |
|---|---|---|
| Test plan creation covering all modules | QA | 1 |
| Functional testing: auth, leads, pipeline, campaigns | QA | 2 |
| Functional testing: outreach automation end-to-end | QA | 2 |
| Functional testing: reports, exports, dashboards | QA | 1.5 |
| Integration testing: all 10 external integrations | QA | 2 |
| Security testing: RBAC, JWT, webhook signatures | QA | 1 |
| Performance testing: 1,000 leads import, 500 msg/hr | QA | 1 |
| Bug fixes and regression testing | QA + Dev | 2 |
| UAT with stakeholders | PM + QA | 1 |
| Sign-off and production deployment | All | 0.5 |

### 6.4 Sprint 4 Deliverable

- AI-personalized messages generated per lead per campaign
- All 6 lead scrapers operational with deduplication
- Role-based dashboards live with real data
- CSV/XLSX export working on all reports
- UAT completed and signed off
- Production deployment

---

## 7. Milestone Timeline

```
Week 1    Week 2    Week 3    Week 4    Week 5    Week 6    Week 7    Week 8
│─────────│─────────│─────────│─────────│─────────│─────────│─────────│
│ SPRINT 1          │ SPRINT 2          │ SPRINT 3          │ SPRINT 4│
│ Foundation        │ Core CRM          │ Automation        │ AI+UAT  │
│                   │                   │                   │         │
│ ✓ Auth            │ ✓ Pipeline        │ ✓ WhatsApp        │ ✓ AI    │
│ ✓ Lead CRUD       │ ✓ Scoring         │ ✓ Email/SMS       │ ✓ Scrape│
│ ✓ Import          │ ✓ Assignment      │ ✓ Webhooks        │ ✓ Dash  │
│ ✓ Staging deploy  │ ✓ Campaigns       │ ✓ Integrations    │ ✓ UAT   │
│                   │                   │                   │ ✓ PROD  │
```

---

## 8. Risk Register

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| API credentials not received before Sprint 3 | Medium | High | Chase client in Week 2; mock integrations in Sprint 3 if delayed |
| WhatsApp Meta policy delays (template approval) | Medium | Medium | Submit WhatsApp message templates in Week 1 for early approval |
| Scraper blocked by target websites | Medium | Medium | Use rotating proxies; implement polite crawl delays |
| OpenAI API rate limits | Low | Medium | Implement request queuing and caching |
| Scope creep from stakeholder feedback | Medium | High | Freeze scope after Sprint 2 demo; log new requests for Phase 2 |
| Geographic/industry list not provided | Medium | Medium | Use placeholder filters; update when list is received |
| Performance issues at scale | Low | Medium | Load test in Sprint 4 Week 7; optimize before UAT |

---

## 9. Definition of Done

A feature is considered done when:

- [ ] Code reviewed and approved by at least one other developer
- [ ] Unit tests written with ≥70% coverage on the module
- [ ] API endpoint documented in Swagger/OpenAPI
- [ ] Deployed to staging and smoke-tested
- [ ] QA sign-off on the feature
- [ ] No critical or high-severity bugs open

---

## 10. Post-Phase 1 Backlog (Phase 2 Candidates)

The following items are out of scope for Phase 1 but should be planned for Phase 2:

| Feature | Reason Deferred |
|---|---|
| Multi-language outreach support | Phase 1 is English only |
| Territory-based and skill-based assignment | Round Robin sufficient for Phase 1 |
| `outreach_logs` table partitioning by month | Not needed at Phase 1 volume |
| Microservices extraction (scraper, outreach) | Modular monolith sufficient for Phase 1 |
| Mobile app for sales reps | Web app covers Phase 1 needs |
| Advanced AI lead enrichment | Basic personalization sufficient for Phase 1 |
| GDPR/compliance module | No compliance requirement in Phase 1 |
| Read replica for reporting queries | Single DB sufficient for Phase 1 |

---

## 11. Success Metrics — Measurement Plan

KPIs will be measured starting from the first full month after go-live:

| KPI | Target | Measurement Method |
|---|---|---|
| Monthly Leads Generated | 1,000+ | `COUNT(*) FROM leads WHERE created_at >= month_start` |
| Qualified Lead % | 40% | `COUNT(*) WHERE classification IN ('hot','warm') / total` |
| Outreach Response Rate | 15% | `COUNT(*) FROM outreach_logs WHERE replied_at IS NOT NULL / sent` |
| Sales Conversion Rate | 8% | `COUNT(*) FROM leads WHERE status = 'won' / total assigned` |
| System Uptime | 99.5% | Uptime monitoring via health check endpoint |
| API p95 Response Time | <300ms | Prometheus + Grafana |

---

*Document prepared by: Chethan Gowda | Roadmap v1.0 | 18 June 2026*

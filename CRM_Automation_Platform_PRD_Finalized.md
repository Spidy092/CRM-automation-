# CRM Automation Platform
## Product Requirements Document (PRD) — Finalized
**Prepared By:** Chethan Gowda
**Date:** 18 June 2026
**Version:** 2.0 Finalized

---

## 1. Introduction

This document defines the finalized business, operational, and technical requirements for the CRM Automation Platform. All open discussion points from the v1.0 Discovery Document have been resolved and are captured here.

The platform automates lead generation, lead qualification, outreach campaigns, sales allocation, and reporting while providing a centralized system for managing the complete customer acquisition process.

**Phase 1 Target Timeline:** 1–2 months

---

## 2. Business Objectives

- Automate lead discovery from multiple online sources.
- Reduce manual effort in prospecting and outreach.
- Improve lead response rates through personalized communication.
- Provide a centralized CRM for sales and management teams.
- Automatically distribute qualified leads to sales representatives.
- Track lead progression through the sales pipeline.
- Generate actionable reports and performance analytics.

---

## 3. Lead Generation Requirements

### 3.1 Data Sources (Phase 1 — All Sources)

All of the following lead sources are included in Phase 1:

| # | Source |
|---|---|
| 1 | Google Business / Google Places |
| 2 | Facebook Business Pages |
| 3 | YouTube Channels |
| 4 | Google Ads Lead Forms |
| 5 | Website Contact Forms |
| 6 | Custom Web Scraping Sources |
| 7 | Manual Lead Uploads (CSV/Excel) |

### 3.2 Targeting Requirements

- **Geographic Targeting:** Enabled. Specific target countries/regions to be provided separately by the stakeholder.
- **Industry Targeting:** Enabled. Specific target industries and excluded industries to be provided separately by the stakeholder.
- The platform must support configurable geographic and industry filters at the campaign level.

---

## 4. Lead Data Requirements

### 4.1 Standard Fields

The following fields are included for every lead record:

| Field | Mandatory |
|---|---|
| Business Name | Yes |
| Contact Name | Yes |
| Phone Number | Yes |
| Email Address | Yes |
| Website | No |
| Industry Category | Yes |
| Business Location | Yes |
| Google Rating | No |
| Review Count | No |
| Social Media Links | No |
| Source Platform | Yes |
| Lead Score | Yes (auto-calculated) |
| Notes | No |
| Tags | No |
| Lead Owner (Sales Rep) | Yes (auto-assigned once qualification threshold met) |

### 4.2 Custom Fields

- Admins can create, edit, and delete custom fields.
- Custom fields support types: Text, Number, Date, Dropdown, Checkbox.
- Custom fields are available in lead views, filters, and exports.

---

## 5. Lead Qualification & Scoring

### 5.1 Scoring Configuration

- All scoring rules are **fully configurable by admin**.
- Admins can define scoring factors, weights, and thresholds.
- Default scoring factors available for configuration:
  - Industry Relevance
  - Online Activity
  - Review Quality
  - Company Size
  - Website Quality
  - Social Presence
  - Source Reliability
  - Previous Engagement

### 5.2 Lead Classification

- Admins configure the score ranges for each classification tier:
  - **Hot** — High-priority leads (score range configurable)
  - **Warm** — Medium-priority leads (score range configurable)
  - **Cold** — Low-priority leads (score range configurable)

### 5.3 Sales Assignment Trigger

- The score threshold that triggers automatic sales assignment is **configurable by admin**.
- Admins can set different thresholds per campaign or globally.

---

## 6. Outreach Automation Requirements

### 6.1 Communication Channel Priority

Outreach follows this sequence per lead:

1. **WhatsApp** (primary)
2. **Email** (secondary)
3. **SMS** (tertiary)
4. **Phone Call Tasks** (manual, assigned to sales rep)

> The first three channels (WhatsApp, Email, SMS) are dispatched automatically.
> A **Phone Call** step does not auto-send — it creates a manual task assigned to the
> lead's sales rep (stored in the `tasks` table), and the sequence advances only when
> the rep marks the task completed.

### 6.2 Follow-Up Configuration

- Number of automated follow-ups: **fully configurable by admin**
- Delay between follow-ups: **fully configurable by admin**
- Admins can set different sequences per campaign.

### 6.3 Automation Stop Conditions

Outreach automation stops for a lead when **any** of the following occur:

- Lead replies to any message
- Lead opts out (unsubscribe/stop request)
- Lead is marked as **Won** or **Lost**
- Sales rep manually pauses automation for the lead
- Maximum configured follow-ups are reached

---

## 7. Content Personalization Requirements

### 7.1 AI Personalization

The platform generates personalized outreach messages using AI, incorporating:

- Business Name
- Industry
- City / Location
- Google Reviews and Ratings
- Website Information
- Custom Business Insights

### 7.2 Communication Tone

- Tone is **configurable per campaign** by admin.
- Available tone options: Formal, Professional, Conversational.

### 7.3 Template Management

- Admins and marketing users can create message templates.
- **New templates require manager/admin approval before use.**
- Once approved, templates are used automatically in campaigns without further approval.
- Templates support personalization variables (e.g., `{{business_name}}`, `{{city}}`).

### 7.4 Language Support

- **English only** for Phase 1.

### 7.5 Marketing Assets

- Marketing assets (PDFs, images) can be attached to outreach messages.
- Asset attachment is configurable per campaign.

---

## 8. Sales Team Management

### 8.1 Lead Assignment

- **Default Method:** Round Robin (equal distribution among available reps)
- **Manager Override:** Managers can manually reassign any lead at any time.
- Reassignment rules are supported.

### 8.2 User Roles

| Role | Permissions |
|---|---|
| **Admin** | Full access — configure all settings, users, scoring, pipelines, templates |
| **Manager** | View all leads, override assignments, approve templates, view all reports |
| **Sales Representative** | View/manage assigned leads, update pipeline stages, pause automation |
| **Marketing User** | Create campaigns, create templates (pending approval), view campaign reports |

### 8.3 Representative Availability

- Admins can mark reps as available/unavailable.
- Unavailable reps are excluded from Round Robin assignment.

---

## 9. Sales Pipeline Requirements

### 9.1 Pipeline Configuration

- Pipeline stages are **fully configurable by admin**.
- Admins can add, rename, reorder, and remove stages.
- Multiple pipelines can be created for different products/campaigns.

### 9.2 Default Pipeline Stages

The following 9 stages are provided as defaults:

| # | Stage |
|---|---|
| 1 | New Lead |
| 2 | Contacted |
| 3 | Follow-Up Required |
| 4 | Interested |
| 5 | Meeting Scheduled |
| 6 | Proposal Sent |
| 7 | Negotiation |
| 8 | Won |
| 9 | Lost |

### 9.3 Stage Transitions

- Sales reps can manually move leads between stages.
- Automated stage transitions can be triggered by lead actions (e.g., reply moves lead from "Contacted" to "Follow-Up Required").
- Admins configure automation rules for stage transitions.

---

## 10. Reporting & Analytics

### 10.1 Dashboards

- Role-based dashboards for Admin, Manager, Sales Rep, and Marketing User.
- Real-time metrics display.

### 10.2 Key Metrics

| Metric | Audience |
|---|---|
| Total Leads Generated | Admin, Manager |
| Leads by Source | Admin, Manager, Marketing |
| Qualified Leads | Admin, Manager |
| Outreach Sent | Admin, Manager, Marketing |
| Open Rates | Admin, Manager, Marketing |
| Reply Rates | Admin, Manager, Marketing |
| Meetings Scheduled | Admin, Manager, Sales |
| Conversion Rate | Admin, Manager |
| Revenue Generated | Admin, Manager |
| Sales Rep Performance | Admin, Manager |

### 10.3 Report Scheduling

- Report generation schedules are **configurable per user role**.
- Admins set frequency (daily, weekly, monthly) and recipients per role.

### 10.4 Export

- Reports can be exported in **CSV** and **Excel (XLSX)** formats.
- Export available from all report views.

---

## 11. Integration Requirements

### 11.1 Mandatory Integrations (Phase 1 — All Required)

All integrations listed below are mandatory and must be available from day one:

| Integration | Purpose |
|---|---|
| **WhatsApp Cloud API** | WhatsApp outreach messaging |
| **Twilio** | SMS outreach |
| **SendGrid** | Email outreach (primary) |
| **SMTP Servers** | Email outreach (custom/fallback) |
| **Google Sheets** | Lead import/export, reporting sync |
| **Google Calendar** | Meeting scheduling |
| **Microsoft Outlook** | Email integration for sales reps |
| **Slack** | Internal notifications and alerts |
| **Microsoft Teams** | Internal notifications and alerts |
| **CRM Platforms** | Sync with existing CRM tools (if applicable) |

### 11.2 API Credentials

- API credentials for all integrations must be provided by the client before development begins.
- The platform will include a secure credentials management interface for admins.

---

## 12. Security Requirements

### 12.1 User Roles & Access Control

- Role-based access control (RBAC) enforced across all modules.
- Four roles: Admin, Manager, Sales Representative, Marketing User.
- Admins can create, edit, and deactivate user accounts.

### 12.2 Data Security

- All data encrypted at rest and in transit (TLS/SSL).
- Secure API key storage for integrations.
- Audit logging for all critical actions (lead assignment, template approval, user changes).

### 12.3 Compliance

- No specific compliance framework (GDPR, PDPB, etc.) required at this stage.
- Basic data retention and deletion capabilities to be included for future compliance readiness.

---

## 13. Success Criteria — Phase 1 KPIs

The project will be considered successful when the following targets are achieved within 3 months of go-live:

| KPI | Target |
|---|---|
| Monthly Leads Generated | 1,000+ |
| Qualified Lead Percentage | 40% |
| Outreach Response Rate | 15% |
| Sales Conversion Rate | 8% |
| Meeting Booking Rate | To be defined post-launch |
| Sales Team Productivity | Measurable improvement vs. baseline |

---

## 14. Phase 1 Scope Summary

### In Scope

- All 7 lead sources
- Lead data management with standard + custom fields
- Admin-configurable lead scoring and classification
- Outreach automation (WhatsApp → Email → SMS) with configurable sequences
- AI-powered message personalization (English only)
- Template management with approval workflow
- Round Robin lead assignment with manager override
- Configurable sales pipeline (9 default stages)
- Role-based dashboards and reporting (CSV + XLSX export)
- All 10 integrations (WhatsApp, Twilio, SendGrid, SMTP, Google Sheets, Google Calendar, Outlook, Slack, Teams, CRM)
- 4 user roles with RBAC

### Pending (To Be Provided by Stakeholder)

- Specific target countries/regions list
- Specific target industries list
- Industries to be excluded list
- API credentials for all integrations

---

## 15. Next Steps

Following approval of this finalized PRD, the following documents will be prepared:

1. **Technical Requirements Document (TRD)** — API specifications, data models, system constraints
2. **System Architecture Design** — Tech stack, microservices/monolith decision, infrastructure
3. **Database Schema Design** — Entity relationships, tables, indexes
4. **Development Roadmap** — Sprint plan, milestones, delivery timeline for 1–2 month Phase 1

---

*Document prepared by: Chethan Gowda | Version 2.0 Finalized | 18 June 2026*

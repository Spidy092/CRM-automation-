# CRM Automation Platform

Swaragh Technologies' internal agency CRM for lead management, campaigns, outreach, newsletters, reporting, and connected messaging services. It is not currently used to send campaigns on behalf of client businesses. The backend is an Express and TypeScript application; the frontend is React and TypeScript. PostgreSQL stores application data, while Redis and BullMQ support background work.

## Repository

- `backend/` — API, CRM modules, webhooks, and workers
- `frontend/` — CRM interface and public pages
- `migrations/` — append-only database migrations
- `nginx/` — reverse proxy configuration
- `docs/` — feature and operations guides

## Start locally

Use [Local Development Setup](docs/LOCAL_DEV_SETUP.md) for prerequisites and the native development workflow. Docker Compose files are also provided for the application stack. Configuration keys are documented in `.env.example`; keep real secrets out of Git and chat. Database migrations require review and approval before running.

The package commands are run from their respective directories:

```bash
(cd backend && npm ci && npm run build)
(cd frontend && npm ci && npm run build)
```

For local development, the backend exposes `npm run dev` and `npm run worker`; the frontend exposes `npm run dev`. Backend tests use `npm run test`; frontend tests also use `npm run test`.

## Lead contact details

When creating or editing a lead, enter a primary email and phone. Use **Add email** or **Add phone** to save optional additional contact details for that lead. You can remove an added entry from the form; saved entries appear on the lead detail page.

The lead create and update API accepts optional `additional_emails` and `additional_phones` arrays alongside the required `email` and `phone` fields. Apply the append-only `1750000000088_add-lead-additional-contacts.js` migration through the approved migration process before deploying this feature. Existing leads start with empty additional-contact lists.

## Lead tags and saved groups

On **Leads**, choose an existing tag from **All tags** and combine it with a tab such as **Uncontacted** or other filters. Existing lead tags are available immediately; this feature does not rename or replace them. When bulk tagging selected leads, choose an existing suggestion to reuse its spelling.

Use **Save current filters**, enter a name such as “Schools awaiting contact,” and select **Save group**. Click the saved name later to show leads matching those filters at that time. Groups save filters rather than a fixed set of leads, are limited to 50 per account, and are stored only in the current browser. They do not sync between devices and clearing browser storage removes them.

`GET /api/v1/leads/tags` returns distinct nonblank tags from nondeleted leads for admin, manager, sales, and viewer roles; sales users receive tags only from their assigned leads. It accepts no query parameters. `GET /api/v1/leads?exact_tag=...` filters by one literal tag, preserving commas and spaces, and combines with the existing filters. URL-encode the value when constructing a request. These changes require no database migration.

## Email template variables and unsubscribe links

In the Custom HTML email editor, use **Variables** beside Subject, Preheader, or HTML content to insert a token at the cursor. To place the unsubscribe link yourself, use `<a href="{{unsubscribe_link}}">Unsubscribe</a>`.

Campaign and Quick Send emails apply a recipient unsubscribe link after personalization, for both simple and designed templates. Delivery repairs anchors pointing to the application's `/unsubscribe` or `/outreach/unsubscribe` paths and empty links labelled Unsubscribe; it preserves unrelated and external links. If no recipient link exists, delivery adds a footer. Failure to generate a valid recipient link blocks sending.

Template warnings check for an anchor containing the unsubscribe placeholder or a token link, rather than the word “unsubscribe” alone. These sending changes apply to future emails; messages already delivered cannot be changed.

## WhatsApp Cloud API

The CRM has a WhatsApp Cloud API integration and an inbound webhook. Follow the [WhatsApp setup guide](docs/WHATSAPP_CLOUD_API_SETUP.md) to configure the Meta account, CRM credentials, server webhook secrets, and test delivery. The official Meta MCP mentioned in the dashboard can help with setup; it is not the runtime messaging connection.

The current outbound dispatcher sends free-form Cloud API text and does not automatically select an approved Meta message template. Do not use it for business-initiated or bulk WhatsApp outreach until that flow is implemented and verified against Meta's messaging policy.

## Public legal pages

The frontend has unauthenticated routes intended for `soft.swaragh.net`:

- `/privacy` — Privacy Policy
- `/terms` — Terms of Service
- `/data-deletion` — Data Deletion Instructions

These paths become public only after the frontend changes are deployed. Complete the [legal publication review](docs/legal/LEGAL_PUBLICATION_REVIEW.md), then have the business owner and legal counsel review the wording before placing the production URLs in Meta App Settings. Working drafts are in `docs/legal/`.

## Project guidance

Read [AGENTS.md](AGENTS.md) before changing code. In particular, preserve existing migrations, protect secrets, and avoid direct pushes to protected branches.

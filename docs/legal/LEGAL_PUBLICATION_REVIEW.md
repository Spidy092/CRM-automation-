# Swaragh CRM legal publication review

Prepared 16 October 2026. This document records what the public `/privacy`, `/terms`, and `/data-deletion` pages say, the source of each material fact, and what Swaragh must verify before publishing. It is an operational review, not a legal opinion.

## Verified facts

| Fact | Evidence |
| --- | --- |
| Public brand is Swaragh Technologies; website lists `info@swaragh.com` and a Bengaluru office address. | https://swaragh.com/ (checked 16 October 2026); owner confirmed the name and inbox in this conversation. |
| CRM is currently used by Swaragh for its own agency outreach and newsletters; it is not used to send on behalf of clients. | Owner clarification in this conversation on 16 October 2026. |
| CRM includes public newsletter subscription and unsubscribe paths. | `frontend/src/pages/PublicSubscribePage.tsx`, `frontend/src/App.tsx`, `backend/src/modules/newsletter/newsletter.routes.ts`. |
| CRM receives WhatsApp webhooks and can send via Cloud API. | `backend/src/webhooks/webhooks.routes.ts`, `backend/src/modules/integrations/whatsapp/whatsapp.connector.ts`. |
| A lead soft delete exists. | `backend/src/modules/leads/leads.repository.ts`. Soft deletion alone does not prove complete erasure across logs, backups, or external providers. |
| The application can use third-party messaging, hosting/storage, analytics, and AI integrations. | Backend modules and `.env.example`; actual production providers and enabled features were not verified. |

## Publication gates

1. **Retention and deletion:** review `DATA_RETENTION_AND_REQUESTS_PROPOSAL.md`, approve a schedule, then implement and test it for leads, messages, delivery logs, newsletter subscribers, backups, and vendor copies. Identify who executes and records deletion requests. The current code does not establish a complete erasure workflow.
2. **Agency scope:** this policy covers Swaragh's own agency outreach, not campaigns sent for clients. Review the wording and legal roles before any future client-sending service launches.
3. **Outreach permission:** define and record evidence of recipient permission by channel. Document how WhatsApp, email, and SMS opt-outs reach suppression lists before future sends. Do not claim that replying `STOP` is automated unless implemented and verified.
4. **Providers:** list actual production hosting region and vendors, including Meta, email/SMS, storage, analytics, and AI where enabled. Review international transfer terms if relevant.
5. **Terms:** reconcile the CRM page with the existing `swaragh.com/terms-of-service` page. The current CRM page covers public forms and communications and does not invent SaaS billing or client-account terms.
6. **Contact and response:** ensure `info@swaragh.com` is monitored for privacy, opt-out, and deletion requests. Create an internal workflow to verify, route, fulfill, and respond to each request.
7. **Review and deploy:** obtain business/legal review of final copy, deploy the frontend, then verify all three URLs without logging in before entering them in Meta App Settings.

## Current platform and legal references

- [WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/) requires opt-in, honoring opt-outs, approved templates to initiate conversations, and a published privacy policy. The policy page checked on 16 October 2026 says free-form replies are permitted during the 24-hour customer service window.
- [Digital Personal Data Protection Act commencement notification, 13 November 2025](https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf) and [Digital Personal Data Protection Rules, 2025](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf) have staged commencement. Have Indian counsel determine obligations applicable on publication and at later commencement dates rather than claiming every provision is currently in force.
- Other jurisdictions may apply depending on where recipients are located. Review those before expanding outreach.

## Proposed Meta App Settings URLs

After deployment and review:

- Privacy Policy URL: `https://soft.swaragh.net/privacy`
- Terms of Service URL: `https://soft.swaragh.net/terms`
- User Data Deletion URL: `https://soft.swaragh.net/data-deletion`

These URLs are proposed, not verified live endpoints.

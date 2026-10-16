# WhatsApp Cloud API setup for this CRM

Status: setup guide, verified against this repository, Meta's official MCP documentation, and a live CRM connection test on 2026-10-16. Meta dashboard labels and eligibility requirements can change.

## Choose the connection

Use Meta's **WhatsApp Cloud API** for the running CRM. The Meta **WhatsApp Business Tools MCP** mentioned in the developer dashboard is an optional assistant for setup and debugging. It does not replace the CRM's Cloud API connector, token, or webhook. Do not give an AI assistant an app secret or long-lived access token in chat.

This repository already sends via `backend/src/modules/integrations/whatsapp/whatsapp.connector.ts` and receives events at `/webhooks/whatsapp`. A separate OpenWA integration takes precedence for text-only messages when it is enabled. Disable OpenWA if all WhatsApp sends must use the official Cloud API.

## Meta dashboard

1. In the existing Meta app's **Connect on WhatsApp → API Setup**, select the intended WhatsApp Business Account (WABA) and sender number. Record the **Phone Number ID**. The WABA ID is a different value; do not paste it into the CRM's Phone Number ID field.
2. For initial testing, use Meta's temporary token and an allowed recipient. For production, create a system-user token with access to the correct WABA/phone number and the required WhatsApp messaging permission using Meta Business Settings. Store it only in the CRM's encrypted integration credential store. Confirm token scope and expiry in Meta's token debugger. A temporary user token can become invalid after logout, as the live test below showed.
3. In CRM **Settings → Integrations → WhatsApp Cloud API → Configure**, enter `phoneNumberId`, `apiToken`, the current supported Graph API version, and optionally `appSecret`; save and click **Test**. The test performs a Graph API GET of the phone-number object. A passing test proves read access, not successful message delivery or webhook setup.
4. On the server, set `WHATSAPP_VERIFY_TOKEN` to a new random value and `WHATSAPP_APP_SECRET` to this Meta app's secret using your deployment's secret management. The webhook currently reads the *environment* value for signature verification; entering `appSecret` only in the CRM integration form is insufficient. Do not commit these values.
5. In Meta's WhatsApp **Configuration**, set the callback URL to `https://YOUR_PUBLIC_CRM_HOST/webhooks/whatsapp` and enter the same verify token. Subscribe the WABA to the `messages` webhook field. The URL must be public HTTPS and reach the backend through the reverse proxy.
6. Send a test message from API Setup, then reply from the recipient phone. Check that the CRM receives the inbound event and its status updates. Inspect server logs without copying payloads, phone numbers, or tokens into support messages.
7. Before production sends, verify the business/number status, payment eligibility shown in Meta, recipient opt-in, approved message templates for business-initiated contact, and your unsubscribe handling.

## If the integration card says “failed”

- **Observed 16 October 2026:** the live CRM test returned `Error validating access token: The session is invalid because the user logged out.` The stored token must be replaced. Generate a fresh token in Meta; for production, prefer a system-user token assigned to the correct WhatsApp Business Account and permissions. Do not paste the token into chat, a ticket, or the repository.
- **Invalid/expired token or permission error:** generate or assign a valid token for the selected WABA and retry the CRM **Test** action.
- **Object not found:** compare the CRM Phone Number ID with Meta's **Phone number ID**, not the WABA ID or display phone number.
- **Webhook verification fails:** verify public HTTPS routing and exact match of `WHATSAPP_VERIFY_TOKEN`.
- **Inbound messages do not appear:** check the `messages` subscription and `WHATSAPP_APP_SECRET`; a configured UI app secret alone does not satisfy the webhook route.
- **Text sends unexpectedly use OpenWA:** disable the OpenWA integration, which currently takes priority for text-only sends.
- **The test passes but an outbound send fails:** check number/payment status, recipient eligibility, opt-in, the message window, and template approval. The connector's plain-text path does not automatically select a template.

## Verified state of this Meta app (16 October 2026)

- Meta API Setup shows phone-number ID `1165187630020531` for the selected sender and a distinct WhatsApp Business Account ID. Confirm this is the sender intended for the CRM before entering it; the test error alone does not prove the CRM currently stores this ID.
- The Meta webhook callback is already `https://soft.swaragh.net/webhooks/whatsapp`, with the `messages` field subscribed. Its verify token was masked, so equality with the server environment could not be checked here.
- Meta says this app is **unpublished**. Its Configuration page warns that unpublished apps receive only dashboard test webhooks, not production message events.
- Meta reports an absent or ineligible payment method for three accounts. Determine whether the intended WhatsApp Business Account is one of them before business-initiated sends.
- The live `https://soft.swaragh.net/privacy` route currently returns “Page not found.” The prepared policy pages must be reviewed and deployed before their URLs are entered in Meta App Settings.

**Next sequence:** review and deploy the three public legal pages; verify them without a login; complete required Meta app settings and publish the app; generate a production system-user token in Meta Business Settings; enter it into CRM Settings → Integrations → WhatsApp Cloud API; run **Test**; confirm the intended WABA's payment status; then test outbound and inbound messaging with an opted-in recipient. The person generating the token should enter it directly into the CRM credential form. No token needs to be shared in chat.

## Important implementation gap before bulk outreach

The current dispatcher calls the Cloud API connector without a `templateName`. It therefore sends a free-form text message. Meta's policy generally restricts these to the customer service window after a user's message; business-initiated messages require an approved template. Do not start bulk WhatsApp campaigns until this path enforces opt-in, window checks, and approved templates. The UI's local “WhatsApp template” is not itself proof of Meta template approval.

## MCP use

Meta's official Business Tools MCP is a beta remote server at `https://mcp.facebook.com/whatsapp_business_tools`. In the Codex App, Meta's guide says to use **Settings → MCP Servers → Add servers → Streamable HTTP**, set the name to **WhatsApp Business Tools**, the URL to that endpoint, and authentication to **OAuth**. Its consent requests `business_management`, `whatsapp_business_management`, and `whatsapp_business_messaging`. Grant only the intended business and app. Meta says an admin of both the business and WhatsApp-enabled app is required, and the Cloud API Terms must already be accepted. The MCP can list accounts, numbers, templates, and webhook state; its `whatsapp_biz_system_user_token` tool returns a link to generate a production token in Business Settings. It does not itself replace the CRM connector. This MCP is optional and in gradual rollout. Avoid third-party MCP servers that ask for your WhatsApp token.

Official references: [Meta's Business Tools MCP](https://developers.facebook.com/documentation/mcp/whatsapp-business-tools-mcp), [Meta Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api), [Meta's official Cloud API Postman collection](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api), [WhatsApp Business Messaging Policy](https://business.whatsapp.com/policy/).

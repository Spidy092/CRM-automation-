# Proposed data retention and rights-request procedure

Status: **proposed, not implemented**. Swaragh Technologies currently uses the CRM for its own agency outreach and newsletters. The owner has no existing fixed retention or deletion procedure and asked for a practical standard. This schedule is a business proposal, not a period imposed by Indian law or a description of current system behavior. Adopt it only after engineering, operations, and legal review.

## Proposed retention schedule

| Data | Proposed rule | Why / implementation check |
| --- | --- | --- |
| Prospect lead with no response or active opportunity | Review at 12 months from last meaningful interaction; delete or de-identify by 24 months if no continuing purpose | Avoid indefinite prospect storage; ensure jobs, exports, and enrichment copies are included. |
| Active customer or opportunity record and related messages | Keep while the relationship or opportunity is active; review annually; delete or de-identify within 24 months after closure unless legal retention applies | Verify links to activities, campaigns, files, and provider records. |
| Newsletter subscriber | Keep while subscribed; after unsubscribe, remove profile and preference detail within 12 months unless needed for a documented reason | Preserve only minimal suppression evidence needed to prevent re-contact. |
| Suppression / opt-out record | Keep a minimal identifier, channel, date, and source while marketing that audience; review annually | Prevent an erased contact being re-imported and messaged again; restrict access. |
| Application and security logs | 90 days unless a security investigation or legal hold requires longer | Ensure logs do not contain message content, tokens, or unnecessary PII. |
| Backups | Rolling 30 days; expired copies deleted automatically | Verify actual database, object-store, and off-site backup configurations. Restores must reapply completed deletions and suppressions. |
| Data export files | Delete after 7 days or sooner when no longer needed | Verify local, object-store, and staff-download copies. |

These are deliberately short defaults, not a universal industry rule. A legal hold, tax record, dispute, or other applicable obligation can require a documented exception. If the CRM cannot enforce a period, do not put that number in the public privacy policy.

## Proposed request workflow

1. Assign an owner to `info@swaragh.com` and record each access, correction, opt-out, or deletion request in a restricted register with received date and status. Do not require sensitive identity documents by default.
2. Acknowledge within **5 business days** as an internal service target. Verify identity proportionately using the contact channel or existing account context. Do not disclose records to an unverified requester.
3. Stop marketing to the identified address or number promptly while the request is reviewed. Record a minimal suppression entry so future imports cannot undo the opt-out. Check WhatsApp, newsletter, email outreach, and SMS paths separately.
4. Locate data across leads, activities, messages, campaign membership, newsletter subscribers, files, exports, logs, backups, and connected providers. Identify legal holds or records that must remain.
5. Fulfill or explain the request within **30 calendar days** as an internal target, subject to the applicable law and any valid extension. Record who acted, what systems were checked, and the completion date; avoid copying the personal data into the register.
6. For data in rolling backups, prevent restoration from resurrecting deleted data. If deletion cannot be applied inside immutable backups immediately, isolate them, let them expire within the approved backup window, and reapply deletions after any restore.
7. Review the register and retention jobs quarterly. Test the process with a synthetic contact before publishing a fixed retention claim.

## Engineering gap to close before adoption

The lead repository currently uses `deleted_at` soft deletion. That hides the row from normal queries but does not by itself erase personal data. Newsletter unsubscribe changes status rather than deleting all subscriber data. No end-to-end request handler, documented purge job, provider deletion process, or verified backup expiry was established in this review. Implement and test those before claiming this schedule is operational.

## Legal timing

The [13 November 2025 commencement notification](https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf) and the [Digital Personal Data Protection Rules, 2025](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf) have staged effective dates. An Indian legal reviewer should confirm obligations on the date the procedure is adopted. Meta's [WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/) independently requires honoring opt-outs and a published privacy policy.

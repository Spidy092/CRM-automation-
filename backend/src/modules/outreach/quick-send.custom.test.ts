import { jest, describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('./outreach.repository', () => ({
  insertOutreachLog: jest.fn(),
  updateOutreachLogStatus: jest.fn(),
}));
jest.mock('../../shared/utils/audit', () => ({ writeAuditLog: jest.fn() }));
jest.mock('../leads/leads.repository', () => ({ findLeadById: jest.fn() }));
jest.mock('../templates/templates.repository', () => ({ findTemplateById: jest.fn() }));
jest.mock('./outreach.prompt', () => ({ personalizeMessage: jest.fn() }));
jest.mock('../integrations/dispatch', () => ({ dispatchOutbound: jest.fn() }));

import { sendQuickMessage } from './outreach.service';
import { insertOutreachLog, updateOutreachLogStatus } from './outreach.repository';
import { findLeadById } from '../leads/leads.repository';
import { findTemplateById } from '../templates/templates.repository';
import { dispatchOutbound } from '../integrations/dispatch';

const actor = { id: 'user-1', role: 'admin', ipAddress: '127.0.0.1' };
const lead = {
  id: 'lead-1',
  status: 'active',
  email: 'lead@example.com',
  phone: '+15551234567',
};
const queuedLog = {
  id: 'log-1',
  lead_id: 'lead-1',
  campaign_id: null,
  channel: 'email',
  template_id: null,
  step_number: null,
  status: 'queued',
  message_body: 'Hello <Acme>',
};

describe('sendQuickMessage custom messages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (findLeadById as jest.Mock<any>).mockResolvedValue(lead);
    (insertOutreachLog as jest.Mock<any>).mockResolvedValue(queuedLog);
    (updateOutreachLogStatus as jest.Mock<any>).mockResolvedValue({ ...queuedLog, status: 'sent' });
    (dispatchOutbound as jest.Mock<any>).mockResolvedValue({
      ok: true,
      externalId: 'email-1',
      latencyMs: 10,
      retryable: false,
    });
  });

  it('sends a custom email without looking up a template and escapes the HTML body', async () => {
    const result = await sendQuickMessage(
      'lead-1',
      {
        channel: 'email',
        body: 'Hello <Acme>\nThanks & welcome',
        subject: 'A custom subject',
      },
      actor,
    );

    expect(findTemplateById).not.toHaveBeenCalled();
    expect(insertOutreachLog).toHaveBeenCalledWith(
      expect.objectContaining({ template_id: null, message_body: 'Hello <Acme>\nThanks & welcome' }),
    );
    expect(dispatchOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: 'custom',
        body: 'Hello &lt;Acme&gt;<br />Thanks &amp; welcome',
        subject: 'A custom subject',
      }),
    );
    expect(result.status).toBe('sent');
  });

  it('sends a custom SMS body without requiring an email subject', async () => {
    const smsLead = { ...lead, email: '' };
    (findLeadById as jest.Mock<any>).mockResolvedValue(smsLead);

    await sendQuickMessage(
      'lead-1',
      { channel: 'sms', body: 'A custom SMS' },
      actor,
    );

    expect(dispatchOutbound).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'sms', body: 'A custom SMS', subject: undefined }),
    );
  });
});

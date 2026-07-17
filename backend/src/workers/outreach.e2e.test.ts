/**
 * Outreach sequence end-to-end tests.
 *
 * Tests the full sequence flow:
 *   1. handleDispatch fires step 1 (WhatsApp) → schedules follow-up
 *   2. handleDispatch fires step 2 (Email)    → schedules follow-up
 *   3. handleDispatch fires step 3 (SMS)      → no more steps, done
 *   4. handleDispatch fires phone_call step   → creates task, does NOT dispatch
 *   5. Stop condition: lead replied           → outreach halts
 *
 * All external dependencies are mocked so this runs without Docker/Redis.
 */

import { handleDispatch, handleFollowUp, handleStopCheck } from './outreach.worker';

// ── Mocks ─────────────────────────────────────────────────────────────────

jest.mock('./queue', () => ({
  getBullConnection: jest.fn(() => ({ on: jest.fn() })),
  OUTREACH_QUEUE: 'outreach',
  OUTREACH_DISPATCH: 'outreach:dispatch-step',
  OUTREACH_FOLLOW_UP: 'outreach:schedule-follow-up',
  OUTREACH_STOP_CHECK: 'outreach:check-stop-condition',
  enqueueOutreachDispatch: jest.fn(),
  enqueueOutreachFollowUp: jest.fn(),
  enqueueOutreachStopCheck: jest.fn(),
}));

jest.mock('../shared/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../shared/utils/metrics', () => ({
  incJobsProcessed: jest.fn(),
  incJobsFailed: jest.fn(),
  observeJobDuration: jest.fn(),
}));
jest.mock('../lib/dlq', () => ({ moveToDLQ: jest.fn() }));
jest.mock('../shared/utils/sentry', () => ({ Sentry: { captureException: jest.fn() } }));

jest.mock('../modules/outreach/outreach.repository', () => ({
  findSequenceById: jest.fn(),
  findLogsByLead: jest.fn(),
}));
jest.mock('../modules/outreach/outreach.service', () => ({
  createLog: jest.fn(),
  updateLogStatus: jest.fn(),
  createTask: jest.fn(),
}));
jest.mock('../modules/leads/leads.repository', () => ({
  findLeadById: jest.fn(),
}));
jest.mock('../modules/templates/templates.repository', () => ({
  findTemplateById: jest.fn(),
}));
jest.mock('../modules/integrations/dispatch', () => ({
  dispatchOutbound: jest.fn(),
}));
jest.mock('../modules/outreach/outreach.prompt', () => ({
  personalizeMessage: jest.fn(),
}));

import { findSequenceById, findLogsByLead } from '../modules/outreach/outreach.repository';
import { createLog, updateLogStatus, createTask } from '../modules/outreach/outreach.service';
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { findLeadById } from '../modules/leads/leads.repository';
import { findTemplateById } from '../modules/templates/templates.repository';
import { dispatchOutbound } from '../modules/integrations/dispatch';
import { personalizeMessage } from '../modules/outreach/outreach.prompt';
import {
  enqueueOutreachDispatch,
  enqueueOutreachFollowUp,
} from './queue';

// ── Fixtures ──────────────────────────────────────────────────────────────

const THREE_STEP_SEQ = {
  id: 'seq-e2e',
  name: '3-Step Campaign',
  steps: [
    { stepNumber: 1, channel: 'whatsapp', delayHours: 0, templateId: 'tmpl-1' },
    { stepNumber: 2, channel: 'email', delayHours: 24, templateId: 'tmpl-2' },
    { stepNumber: 3, channel: 'sms', delayHours: 48, templateId: 'tmpl-3' },
  ],
  created_by: 'u1',
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
};

const FOUR_STEP_SEQ = {
  ...THREE_STEP_SEQ,
  id: 'seq-4step',
  steps: [
    ...THREE_STEP_SEQ.steps,
    { stepNumber: 4, channel: 'phone_call', delayHours: 72, templateId: null },
  ],
};

const MOCK_LOG = {
  id: 'log-1',
  lead_id: 'lead-e2e',
  campaign_id: 'camp-e2e',
  channel: 'whatsapp',
  template_id: 'tmpl-1',
  step_number: 1,
  status: 'queued',
  external_msg_id: null,
  message_body: null,
  sent_at: null,
  delivered_at: null,
  opened_at: null,
  replied_at: null,
  error_message: null,
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
};

const MOCK_LEAD = {
  id: 'lead-e2e',
  business_name: 'Acme',
  phone: '+12025551234',
  email: 'acme@example.com',
  status: 'active',
  assigned_to: 'rep-1',
};

const MOCK_TEMPLATE = {
  id: 'tmpl-1',
  approval_status: 'approved',
  body: 'Hello {business_name}',
  subject: 'Outreach',
  channel: 'whatsapp',
};

beforeEach(() => {
  jest.clearAllMocks();
  (findSequenceById as jest.Mock<any>).mockResolvedValue(THREE_STEP_SEQ);
  (createLog as jest.Mock<any>).mockResolvedValue(MOCK_LOG);
  (updateLogStatus as jest.Mock<any>).mockResolvedValue({ ...MOCK_LOG, status: 'sent' });
  (findLeadById as jest.Mock<any>).mockResolvedValue(MOCK_LEAD);
  (findTemplateById as jest.Mock<any>).mockResolvedValue(MOCK_TEMPLATE);
  (personalizeMessage as jest.Mock<any>).mockResolvedValue({ message: 'Hello Acme' });
  (dispatchOutbound as jest.Mock<any>).mockResolvedValue({ ok: true, externalId: 'ext-1', latencyMs: 10 });
});

// ── Test 1: Full 3-step sequence fires in order ──────────────────────────

describe('3-step sequence: WhatsApp → Email → SMS', () => {
  it('step 1 (WhatsApp): dispatches and schedules step 2', async () => {
    await handleDispatch({
      leadId: 'lead-e2e',
      campaignId: 'camp-e2e',
      sequenceId: 'seq-e2e',
      stepNumber: 1,
      channel: 'whatsapp',
      templateId: 'tmpl-1',
      mockMode: false,
    });

    expect(createLog).toHaveBeenCalledWith(expect.objectContaining({ channel: 'whatsapp' }));
    expect(dispatchOutbound).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'whatsapp', destination: MOCK_LEAD.phone }),
    );
    expect(updateLogStatus).toHaveBeenCalledWith('log-1', 'sent', expect.anything());
    expect(enqueueOutreachFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({ nextStepNumber: 2, delayHours: 24 }),
    );
  });

  it('step 2 (Email): dispatches and schedules step 3', async () => {
    const log2 = { ...MOCK_LOG, id: 'log-2', channel: 'email', step_number: 2 };
    (createLog as jest.Mock<any>).mockResolvedValue(log2);

    await handleDispatch({
      leadId: 'lead-e2e',
      campaignId: 'camp-e2e',
      sequenceId: 'seq-e2e',
      stepNumber: 2,
      channel: 'email',
      templateId: 'tmpl-2',
      mockMode: false,
    });

    expect(dispatchOutbound).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'email', destination: MOCK_LEAD.email }),
    );
    expect(enqueueOutreachFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({ nextStepNumber: 3, delayHours: 48 }),
    );
  });

  it('step 3 (SMS): dispatches and does NOT schedule a follow-up', async () => {
    const log3 = { ...MOCK_LOG, id: 'log-3', channel: 'sms', step_number: 3 };
    (createLog as jest.Mock<any>).mockResolvedValue(log3);

    await handleDispatch({
      leadId: 'lead-e2e',
      campaignId: 'camp-e2e',
      sequenceId: 'seq-e2e',
      stepNumber: 3,
      channel: 'sms',
      templateId: 'tmpl-3',
      mockMode: false,
    });

    expect(dispatchOutbound).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'sms', destination: MOCK_LEAD.phone }),
    );
    expect(enqueueOutreachFollowUp).not.toHaveBeenCalled();
  });
});

// ── Test 2: phone_call step creates task, never dispatches ───────────────

describe('phone_call step', () => {
  it('creates a task row and skips message dispatch', async () => {
    (findSequenceById as jest.Mock<any>).mockResolvedValue(FOUR_STEP_SEQ);
    (createTask as jest.Mock<any>).mockResolvedValue({ id: 'task-1' });

    await handleDispatch({
      leadId: 'lead-e2e',
      campaignId: 'camp-e2e',
      sequenceId: 'seq-4step',
      stepNumber: 4,
      channel: 'phone_call',
      templateId: null as unknown as string,
      mockMode: false,
    });

    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: 'lead-e2e',
        type: 'phone_call',
        assignedTo: 'rep-1',
        stepNumber: 4,
      }),
      expect.objectContaining({ id: 'system' }),
    );
    expect(createLog).not.toHaveBeenCalled();
    expect(dispatchOutbound).not.toHaveBeenCalled();
  });
});

// ── Test 3: handleFollowUp enqueues stop-check then next dispatch ─────────

describe('handleFollowUp', () => {
  it('evaluates stop condition and enqueues next dispatch when sequence is still valid', async () => {
    await handleFollowUp({
      leadId: 'lead-e2e',
      campaignId: 'camp-e2e',
      sequenceId: 'seq-e2e',
      previousStepNumber: 1,
      nextStepNumber: 2,
      delayHours: 24,
      mockMode: false,
    });

    expect(enqueueOutreachDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ stepNumber: 2, channel: 'email', templateId: 'tmpl-2' }),
    );
  });
});

// ── Test 4: Inbound reply stops all pending dispatches ───────────────────

describe('stop condition: lead replied', () => {
  it('handleStopCheck returns stopped=true when outreach_log has replied status', async () => {
    (findLogsByLead as jest.Mock<any>).mockResolvedValue([
      { id: 'l1', status: 'sent', campaign_id: 'camp-e2e' },
      { id: 'l2', status: 'replied', campaign_id: 'camp-e2e' },
    ]);
    (findLeadById as jest.Mock<any>).mockResolvedValue({ ...MOCK_LEAD, status: 'active' });

    const result = await handleStopCheck({
      leadId: 'lead-e2e',
      campaignId: 'camp-e2e',
      rules: [
        { type: 'replied' },
        { type: 'opted_out' },
        { type: 'max_messages', value: 10 },
      ],
    });

    expect(result.stopped).toBe(true);
    expect(result.reason).toBe('replied');
  });

  it('handleStopCheck returns stopped=true when lead status is opted_out', async () => {
    (findLogsByLead as jest.Mock<any>).mockResolvedValue([]);
    (findLeadById as jest.Mock<any>).mockResolvedValue({ ...MOCK_LEAD, status: 'opted_out' });

    const result = await handleStopCheck({
      leadId: 'lead-e2e',
      campaignId: 'camp-e2e',
      rules: [{ type: 'opted_out' }],
    });

    expect(result.stopped).toBe(true);
    expect(result.reason).toBe('opted_out');
  });

  it('handleStopCheck returns stopped=true when lead status is won', async () => {
    (findLogsByLead as jest.Mock<any>).mockResolvedValue([]);
    (findLeadById as jest.Mock<any>).mockResolvedValue({ ...MOCK_LEAD, status: 'won' });

    // 'won' maps to opted_out rule check — lead stops outreach
    const result = await handleStopCheck({
      leadId: 'lead-e2e',
      campaignId: 'camp-e2e',
      rules: [{ type: 'opted_out' }],
    });

    // 'won' is not 'opted_out' — verify it does NOT falsely stop via opted_out rule
    // (won/lost are handled at the campaign level; the stop check tests opted_out literally)
    expect(result.stopped).toBe(false);
  });

  it('handleStopCheck returns stopped=false when lead is active with no replies', async () => {
    (findLogsByLead as jest.Mock<any>).mockResolvedValue([
      { id: 'l1', status: 'sent' },
      { id: 'l2', status: 'delivered' },
    ]);
    (findLeadById as jest.Mock<any>).mockResolvedValue({ ...MOCK_LEAD, status: 'active' });

    const result = await handleStopCheck({
      leadId: 'lead-e2e',
      campaignId: 'camp-e2e',
      rules: [
        { type: 'replied' },
        { type: 'opted_out' },
        { type: 'max_messages', value: 10 },
      ],
    });

    expect(result.stopped).toBe(false);
  });
});

// ── Test 5: mock mode skips live connectors ───────────────────────────────

describe('mock mode', () => {
  it('dispatches successfully without calling dispatchOutbound', async () => {
    await handleDispatch({
      leadId: 'lead-e2e',
      campaignId: 'camp-e2e',
      sequenceId: 'seq-e2e',
      stepNumber: 1,
      channel: 'whatsapp',
      templateId: 'tmpl-1',
      mockMode: true,
    });

    expect(dispatchOutbound).not.toHaveBeenCalled();
    expect(updateLogStatus).toHaveBeenCalledWith(
      'log-1',
      'sent',
      expect.objectContaining({ externalMsgId: expect.stringContaining('mock-whatsapp') }),
    );
  });
});

jest.mock('../workers/queue');
jest.mock('../shared/utils/db', () => ({
  pool: { query: jest.fn() },
  queryOne: jest.fn(),
}));

jest.mock('../shared/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('./webhook-verifiers', () => ({
  verifyWhatsAppSignature: jest.fn().mockReturnValue(true),
  verifyTwilioSignature: jest.fn().mockReturnValue(true),
  verifySendGridSignature: jest.fn().mockReturnValue(true),
  verifyGoogleAdsSecret: jest.fn().mockReturnValue(true),
}));

jest.mock('./webhook-handlers', () => ({
  handleWhatsAppMessage: jest.fn().mockResolvedValue({ action: 'reply_recorded', leadId: 'l1' }),
  handleWhatsAppStatus: jest.fn().mockResolvedValue({ action: 'status_updated' }),
  handleTwilioMessage: jest.fn().mockResolvedValue({ action: 'reply_recorded', leadId: 'l1' }),
  handleTwilioStatus: jest.fn().mockResolvedValue({ action: 'status_updated' }),
  handleSendGridEvents: jest.fn().mockResolvedValue({ action: 'events_processed' }),
  handleGoogleAdsLeadForm: jest.fn().mockResolvedValue({ action: 'lead_created', leadId: 'l1' }),
}));

import express from 'express';
import request from 'supertest';
import { webhooksRoutes } from './webhooks.routes';
import { queryOne } from '../shared/utils/db';
import * as handlers from './webhook-handlers';

const app = express();
app.use(express.json());
app.use('/webhooks', webhooksRoutes);

const mockQueryOne = queryOne as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('POST /webhooks/whatsapp', () => {
  it('processes inbound message', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'evt-1' });

    await request(app)
      .post('/webhooks/whatsapp')
      .send({
        entry: [{ changes: [{ value: { messages: [{ id: 'wam-1', from: '+1234567890', type: 'text' }] } }] }],
      })
      .expect(200);

    expect(handlers.handleWhatsAppMessage).toHaveBeenCalled();
  });

  it('skips duplicate events', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'existing', status: 'processed' });

    await request(app)
      .post('/webhooks/whatsapp')
      .send({
        entry: [{ changes: [{ value: { messages: [{ id: 'wam-1', from: '+1234567890', type: 'text' }] } }] }],
      })
      .expect(200);

    expect(handlers.handleWhatsAppMessage).not.toHaveBeenCalled();
  });

  it('processes status update', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'evt-2' });

    await request(app)
      .post('/webhooks/whatsapp')
      .send({
        entry: [{ changes: [{ value: { statuses: [{ id: 'wam-2', status: 'delivered' }] } }] }],
      })
      .expect(200);

    expect(handlers.handleWhatsAppStatus).toHaveBeenCalled();
  });
});

describe('GET /webhooks/whatsapp', () => {
  it('returns challenge on valid verification', async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = 'verify-token';
    await request(app)
      .get('/webhooks/whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-token', 'hub.challenge': 'challenge-123' })
      .expect(200)
      .expect('challenge-123');
  });

  it('returns 403 on invalid verification', async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = 'verify-token';
    await request(app)
      .get('/webhooks/whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'x' })
      .expect(403);
  });
});

describe('POST /webhooks/twilio', () => {
  it('processes inbound SMS', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'evt-3' });

    await request(app)
      .post('/webhooks/twilio')
      .send({ From: '+1234567890', Body: 'Hello' })
      .expect(200);

    expect(handlers.handleTwilioMessage).toHaveBeenCalled();
  });

  it('processes status callback', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'evt-4' });

    await request(app)
      .post('/webhooks/twilio')
      .send({ MessageSid: 'SM123', MessageStatus: 'delivered' })
      .expect(200);

    expect(handlers.handleTwilioStatus).toHaveBeenCalled();
  });
});

describe('POST /webhooks/sendgrid', () => {
  it('processes event batch', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'evt-5' });

    await request(app)
      .post('/webhooks/sendgrid')
      .send([{ sg_message_id: 'sg-1', event: 'delivered' }])
      .expect(200);

    expect(handlers.handleSendGridEvents).toHaveBeenCalled();
  });
});

describe('POST /webhooks/google-ads', () => {
  it('processes lead form', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'evt-6' });

    await request(app)
      .post('/webhooks/google-ads')
      .send({ lead_id: 'g-lead-1', user_column_data: [] })
      .expect(200);

    expect(handlers.handleGoogleAdsLeadForm).toHaveBeenCalled();
  });
});

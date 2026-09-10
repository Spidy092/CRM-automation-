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
import { pool, queryOne } from '../shared/utils/db';
import * as handlers from './webhook-handlers';
import { verifyWhatsAppSignature } from './webhook-verifiers';

const app = express();
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    },
  }),
);
app.use('/webhooks', webhooksRoutes);

const mockQueryOne = queryOne as jest.Mock;
const mockPoolQuery = pool.query as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockQueryOne.mockReset();
  mockPoolQuery.mockReset();
  process.env.WHATSAPP_APP_SECRET = 'test-whatsapp-secret';
  process.env.TWILIO_AUTH_TOKEN = 'test-twilio-token';
  process.env.SENDGRID_VERIFICATION_KEY = 'test-sendgrid-key';
  process.env.FACEBOOK_APP_SECRET = 'test-facebook-secret';
  process.env.GOOGLE_ADS_WEBHOOK_SECRET = 'test-google-secret';
});

describe('POST /webhooks/whatsapp', () => {
  it('rejects when the app secret is not configured', async () => {
    delete process.env.WHATSAPP_APP_SECRET;

    await request(app)
      .post('/webhooks/whatsapp')
      .set('x-hub-signature-256', 'sha256=test')
      .send({ entry: [] })
      .expect(503);

    expect(handlers.handleWhatsAppMessage).not.toHaveBeenCalled();
  });

  it('verifies the captured raw body instead of a re-serialized object', async () => {
    mockQueryOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'evt-raw' });
    const payload = '{"entry": [ { "changes": [] } ]}';

    await request(app)
      .post('/webhooks/whatsapp')
      .set('x-hub-signature-256', 'sha256=test')
      .set('content-type', 'application/json')
      .send(payload)
      .expect(200);

    expect(verifyWhatsAppSignature).toHaveBeenCalledWith(
      payload,
      'sha256=test',
      'test-whatsapp-secret',
    );
  });

  it('processes inbound message', async () => {
    mockQueryOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'evt-1' });

    await request(app)
      .post('/webhooks/whatsapp')
      .send({
        entry: [
          {
            changes: [
              { value: { messages: [{ id: 'wam-1', from: '+1234567890', type: 'text' }] } },
            ],
          },
        ],
      })
      .expect(200);

    expect(handlers.handleWhatsAppMessage).toHaveBeenCalled();
  });

  it('skips duplicate events', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'existing', status: 'processed' });

    await request(app)
      .post('/webhooks/whatsapp')
      .send({
        entry: [
          {
            changes: [
              { value: { messages: [{ id: 'wam-1', from: '+1234567890', type: 'text' }] } },
            ],
          },
        ],
      })
      .expect(200);

    expect(handlers.handleWhatsAppMessage).not.toHaveBeenCalled();
  });

  it('retries a previously failed event and records the next failure', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'evt-failed', status: 'failed' });
    (handlers.handleWhatsAppMessage as jest.Mock).mockRejectedValueOnce(new Error('temporary'));

    await request(app)
      .post('/webhooks/whatsapp')
      .set('x-hub-signature-256', 'sha256=test')
      .send({
        entry: [
          {
            changes: [
              { value: { messages: [{ id: 'wam-failed', from: '+1234567890', type: 'text' }] } },
            ],
          },
        ],
      })
      .expect(200);

    expect(mockPoolQuery).toHaveBeenCalledWith(expect.stringContaining("SET status = 'received'"), [
      'evt-failed',
    ]);
    expect(mockPoolQuery).toHaveBeenCalledWith(expect.stringContaining("SET status = 'failed'"), [
      'temporary',
      'evt-failed',
    ]);
  });

  it('processes status update', async () => {
    mockQueryOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'evt-2' });

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
  it('fails closed when verification token is not configured', async () => {
    delete process.env.WHATSAPP_VERIFY_TOKEN;
    await request(app)
      .get('/webhooks/whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.challenge': 'challenge-123' })
      .expect(403);
  });

  it('returns challenge on valid verification', async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = 'verify-token';
    await request(app)
      .get('/webhooks/whatsapp')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'verify-token',
        'hub.challenge': 'challenge-123',
      })
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
  it('rejects unsigned callbacks', async () => {
    await request(app)
      .post('/webhooks/twilio')
      .send({ MessageSid: 'SM123', From: '+1234567890', Body: 'Hello' })
      .expect(401);
  });

  it('rejects inbound messages without a provider id', async () => {
    await request(app)
      .post('/webhooks/twilio')
      .set('x-twilio-signature', 'test-signature')
      .send({ From: '+1234567890', Body: 'Hello' })
      .expect(400);
  });

  it('processes inbound SMS', async () => {
    mockQueryOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'evt-3' });

    await request(app)
      .post('/webhooks/twilio')
      .set('x-twilio-signature', 'test-signature')
      .send({ MessageSid: 'SM123', From: '+1234567890', Body: 'Hello' })
      .expect(200);

    expect(handlers.handleTwilioMessage).toHaveBeenCalled();
  });

  it('processes status callback', async () => {
    mockQueryOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'evt-4' });

    await request(app)
      .post('/webhooks/twilio')
      .set('x-twilio-signature', 'test-signature')
      .send({ MessageSid: 'SM123', MessageStatus: 'delivered' })
      .expect(200);

    expect(handlers.handleTwilioStatus).toHaveBeenCalled();
  });
});

describe('POST /webhooks/sendgrid', () => {
  it('processes event batch', async () => {
    mockQueryOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'evt-5' });

    await request(app)
      .post('/webhooks/sendgrid')
      .set('x-twilio-email-event-webhook-signature', 'test-signature')
      .set('x-twilio-email-event-webhook-timestamp', '1700000000')
      .send([{ sg_message_id: 'sg-1', event: 'delivered' }])
      .expect(200);

    expect(handlers.handleSendGridEvents).toHaveBeenCalled();
  });
});

describe('POST /webhooks/google-ads', () => {
  it('processes lead form', async () => {
    mockQueryOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'evt-6' });

    await request(app)
      .post('/webhooks/google-ads')
      .send({ lead_id: 'g-lead-1', user_column_data: [], secret: 'test-google-secret' })
      .expect(200);

    expect(handlers.handleGoogleAdsLeadForm).toHaveBeenCalled();
  });
});

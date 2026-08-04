import type { Job } from 'bullmq';

jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation((_queue, processor, _opts) => {
    (global as any).__lastProcessor = processor;
    (global as any).__lastWorkerInstance = {
      on: jest.fn((event, handler) => {
        (global as any).__lastWorkerInstance[`__on_${event}`] = handler;
        return (global as any).__lastWorkerInstance;
      }),
    };
    return (global as any).__lastWorkerInstance;
  }),
}));

jest.mock('./queue', () => ({
  NEWSLETTER_QUEUE: 'newsletter',
  getBullConnection: jest.fn(() => ({ on: jest.fn(), ping: jest.fn() })),
  enqueueNewsletterBroadcast: jest.fn(),
}));

jest.mock('../shared/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../modules/ai-settings/ai-settings.service', () => ({
  getAiConfig: jest.fn(),
}));

jest.mock('../modules/newsletter/newsletter.service', () => ({
  getDigestConfig: jest.fn(),
}));

jest.mock('../modules/newsletter/newsletter.repository', () => ({
  findSubscribers: jest.fn(),
}));

jest.mock('../modules/integrations/sendgrid/sendgrid.connector', () => ({
  sendEmail: jest.fn(),
}));

jest.mock('../modules/integrations/smtp/smtp.connector', () => ({
  sendEmail: jest.fn(),
}));

const mockCreate = jest.fn();
jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  }));
});

import { startNewsletterWorker } from './newsletter.worker';
import { enqueueNewsletterBroadcast } from './queue';
import { getAiConfig } from '../modules/ai-settings/ai-settings.service';
import { getDigestConfig } from '../modules/newsletter/newsletter.service';
import { findSubscribers } from '../modules/newsletter/newsletter.repository';
import * as sendgrid from '../modules/integrations/sendgrid/sendgrid.connector';
import * as smtp from '../modules/integrations/smtp/smtp.connector';
import { logger } from '../shared/utils/logger';

const mockFindSubscribers = findSubscribers as jest.Mock;
const mockGetAiConfig = getAiConfig as jest.Mock;
const mockGetDigestConfig = getDigestConfig as jest.Mock;
const mockSgSend = sendgrid.sendEmail as jest.Mock;
const mockSmtpSend = smtp.sendEmail as jest.Mock;
const mockEnqueueBroadcast = enqueueNewsletterBroadcast as jest.Mock;

function makeJob(name: string, data: unknown = {}): Job {
  return { id: 'job-1', name, data } as unknown as Job;
}

async function getProcessor() {
  startNewsletterWorker();
  return (global as any).__lastProcessor as (job: Job) => Promise<void>;
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.OPENAI_API_KEY;
});

describe('startNewsletterWorker routing', () => {
  it('logs a warning for an unknown job name', async () => {
    const processor = await getProcessor();
    await processor(makeJob('newsletter:unknown'));
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Unknown job name'),
      expect.any(Object),
    );
  });

  it('registers a failed-event handler that logs the job failure', async () => {
    startNewsletterWorker();
    const workerInstance = (global as any).__lastWorkerInstance;
    workerInstance.__on_failed({ id: 'job-1', name: 'newsletter:broadcast' }, new Error('boom'));
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('failed'),
      expect.objectContaining({ jobName: 'newsletter:broadcast', error: 'boom' }),
    );
  });
});

describe('processBroadcast (newsletter:broadcast)', () => {
  it('sends to every confirmed subscriber via SendGrid and stops when a page is empty', async () => {
    mockFindSubscribers
      .mockResolvedValueOnce([
        { id: 'sub-1', email: 'a@example.com', unsubscribe_token_hash: 'tok1' },
        { id: 'sub-2', email: 'b@example.com', unsubscribe_token_hash: 'tok2' },
      ])
      .mockResolvedValueOnce([]);
    mockSgSend.mockResolvedValue({ ok: true });

    const processor = await getProcessor();
    await processor(makeJob('newsletter:broadcast', { subject: 'Hi', htmlBody: '<p>Body</p>' }));

    expect(mockSgSend).toHaveBeenCalledTimes(2);
    expect(mockSgSend).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: 'sub-1', to: 'a@example.com', subject: 'Hi' }),
    );
    expect(mockSmtpSend).not.toHaveBeenCalled();
    expect(mockFindSubscribers).toHaveBeenCalledWith(100, 0, 'confirmed');
    expect(mockFindSubscribers).toHaveBeenCalledWith(100, 100, 'confirmed');
  });

  it('falls back to SMTP when SendGrid returns not ok', async () => {
    mockFindSubscribers
      .mockResolvedValueOnce([{ id: 'sub-1', email: 'a@example.com', unsubscribe_token_hash: 'tok1' }])
      .mockResolvedValueOnce([]);
    mockSgSend.mockResolvedValue({ ok: false });
    mockSmtpSend.mockResolvedValue({ ok: true });

    const processor = await getProcessor();
    await processor(makeJob('newsletter:broadcast', { subject: 'Hi', htmlBody: '<p>Body</p>' }));

    expect(mockSmtpSend).toHaveBeenCalledTimes(1);
  });

  it('logs an error and continues when both SendGrid and SMTP fail', async () => {
    mockFindSubscribers
      .mockResolvedValueOnce([{ id: 'sub-1', email: 'a@example.com', unsubscribe_token_hash: 'tok1' }])
      .mockResolvedValueOnce([]);
    mockSgSend.mockRejectedValue(new Error('sg down'));
    mockSmtpSend.mockRejectedValue(new Error('smtp down'));

    const processor = await getProcessor();
    await processor(makeJob('newsletter:broadcast', { subject: 'Hi', htmlBody: '<p>Body</p>' }));

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to send newsletter email to subscriber',
      expect.objectContaining({ email: 'a@example.com' }),
    );
  });
});

describe('processAutomatedDigest (newsletter:automated-digest)', () => {
  it('does nothing and logs an error when no OpenAI API key is configured', async () => {
    mockGetAiConfig.mockResolvedValue({});
    mockGetDigestConfig.mockResolvedValue({ ok: true, value: {} });

    const processor = await getProcessor();
    await processor(makeJob('newsletter:automated-digest'));

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('OPENAI_API_KEY missing'),
    );
    expect(mockEnqueueBroadcast).not.toHaveBeenCalled();
  });

  it('generates content via OpenAI and enqueues a broadcast job', async () => {
    mockGetAiConfig.mockResolvedValue({ apiKey: 'sk-test' });
    mockGetDigestConfig.mockResolvedValue({
      ok: true,
      value: { topic: 'Sales Tips', tone: 'friendly', targetAudience: 'reps', customPrompt: 'Be nice' },
    });
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'Great tip.\n\nAnother tip.' } }],
    });

    const processor = await getProcessor();
    await processor(makeJob('newsletter:automated-digest'));

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o' }),
    );
    expect(mockEnqueueBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('Sales Tips'),
        htmlBody: expect.stringContaining('Great tip.'),
      }),
    );
  });

  it('logs an error and does not enqueue when OpenAI returns empty content', async () => {
    mockGetAiConfig.mockResolvedValue({ apiKey: 'sk-test' });
    mockGetDigestConfig.mockResolvedValue({ ok: true, value: {} });
    mockCreate.mockResolvedValue({ choices: [{ message: { content: '   ' } }] });

    const processor = await getProcessor();
    await processor(makeJob('newsletter:automated-digest'));

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to generate automated digest'),
      expect.objectContaining({ error: expect.stringContaining('empty content') }),
    );
    expect(mockEnqueueBroadcast).not.toHaveBeenCalled();
  });

  it('falls back to defaults when the AI config and digest config lookups fail', async () => {
    mockGetAiConfig.mockRejectedValue(new Error('settings down'));
    mockGetDigestConfig.mockRejectedValue(new Error('redis down'));
    process.env.OPENAI_API_KEY = 'sk-env-fallback';
    mockCreate.mockResolvedValue({ choices: [{ message: { content: 'Fallback content' } }] });

    const processor = await getProcessor();
    await processor(makeJob('newsletter:automated-digest'));

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to fetch AI settings'),
      expect.any(Object),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to fetch newsletter digest config'),
      expect.any(Object),
    );
    expect(mockEnqueueBroadcast).toHaveBeenCalled();
  });
});

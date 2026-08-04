/* eslint-disable @typescript-eslint/no-explicit-any */
import { startScraperWorker } from './scraper.worker';
import { SCRAPER_QUEUE, SCRAPER_RUN } from './queue';
import { runScrape, runScrapeForJob } from '../modules/scraper/scraper.service';

const mockWorkerInstance: any = {
  on: jest.fn().mockReturnThis(),
  emit: jest.fn().mockReturnThis(),
};

jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation((_queue: string, processor: any, _opts: any) => {
    mockWorkerInstance.processor = processor;
    return mockWorkerInstance;
  }),
}));

jest.mock('./queue', () => ({
  SCRAPER_QUEUE: 'scraper',
  SCRAPER_RUN: 'scraper:run',
  getBullConnection: jest.fn().mockReturnValue({ host: 'localhost', port: 6379 }),
}));

jest.mock('../modules/scraper/scraper.service', () => ({
  runScrape: jest.fn(),
  runScrapeForJob: jest.fn(),
}));
jest.mock('../shared/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));
jest.mock('../shared/utils/metrics', () => ({
  incJobsProcessed: jest.fn(),
  incJobsFailed: jest.fn(),
  observeJobDuration: jest.fn(),
}));
jest.mock('../lib/dlq', () => ({ moveToDLQ: jest.fn() }));
jest.mock('../shared/utils/sentry', () => ({ Sentry: { captureException: jest.fn() } }));

describe('scraper.worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete mockWorkerInstance.processor;
  });

  it('starts worker and registers listeners', () => {
    startScraperWorker();
    const { Worker } = require('bullmq');
    expect(Worker).toHaveBeenCalledWith(SCRAPER_QUEUE, expect.any(Function), expect.any(Object));
    expect(mockWorkerInstance.on).toHaveBeenCalledWith('ready', expect.any(Function));
    expect(mockWorkerInstance.on).toHaveBeenCalledWith('failed', expect.any(Function));
  });

  it('processes a scheduled scraper:run job (no logId) via runScrape', async () => {
    startScraperWorker();
    const job = { id: 'job-1', name: SCRAPER_RUN, data: { configId: 'cfg-1', triggeredBy: 'u1' } };
    (runScrape as jest.Mock).mockResolvedValue({ logId: 'log-1', status: 'completed' });
    await mockWorkerInstance.processor(job);
    expect(runScrape).toHaveBeenCalledWith('cfg-1', { id: 'u1', role: 'admin', ipAddress: null });
    expect(runScrapeForJob).not.toHaveBeenCalled();
  });

  it('processes a background scraper:run job (logId present) via runScrapeForJob', async () => {
    startScraperWorker();
    const job = {
      id: 'job-1b',
      name: SCRAPER_RUN,
      data: { configId: 'cfg-1', triggeredBy: 'u1', logId: 'log-1' },
    };
    (runScrapeForJob as jest.Mock).mockResolvedValue({ logId: 'log-1', status: 'completed' });
    await mockWorkerInstance.processor(job);
    expect(runScrapeForJob).toHaveBeenCalledWith('cfg-1', 'log-1');
    expect(runScrape).not.toHaveBeenCalled();
  });

  it('throws on unknown job name', async () => {
    startScraperWorker();
    const job = { id: 'job-2', name: 'unknown', data: {} };
    await expect(mockWorkerInstance.processor(job)).rejects.toThrow('Unknown scraper job: unknown');
  });

  it('increments failed counter when runScrape rejects', async () => {
    const { incJobsFailed } = require('../shared/utils/metrics');
    startScraperWorker();
    const job = { id: 'job-3', name: SCRAPER_RUN, data: { configId: 'cfg-1', triggeredBy: 'u1' } };
    (runScrape as jest.Mock).mockRejectedValue(new Error('boom'));
    await expect(mockWorkerInstance.processor(job)).rejects.toThrow('boom');
    expect(incJobsFailed).toHaveBeenCalled();
  });

  it('throws on a retryable run failure so BullMQ retries it (C1)', async () => {
    const { incJobsFailed, incJobsProcessed } = require('../shared/utils/metrics');
    startScraperWorker();
    const job = {
      id: 'job-5',
      name: SCRAPER_RUN,
      data: { configId: 'cfg-1', triggeredBy: 'u1', logId: 'log-1' },
    };
    (runScrapeForJob as jest.Mock).mockResolvedValue({
      logId: 'log-1',
      status: 'failed',
      errorMessage: 'socket hang up',
      retryable: true,
    });

    // The service writes the log row and returns rather than throwing. Left as
    // a clean return this would count as a success and never retry.
    await expect(mockWorkerInstance.processor(job)).rejects.toThrow('socket hang up');
    expect(incJobsFailed).toHaveBeenCalled();
    expect(incJobsProcessed).not.toHaveBeenCalled();
  });

  it('does NOT retry a permanent failure, but still counts it as failed (C1)', async () => {
    const { incJobsFailed, incJobsProcessed } = require('../shared/utils/metrics');
    startScraperWorker();
    const job = {
      id: 'job-6',
      name: SCRAPER_RUN,
      data: { configId: 'cfg-1', triggeredBy: 'u1', logId: 'log-1' },
    };
    (runScrapeForJob as jest.Mock).mockResolvedValue({
      logId: 'log-1',
      status: 'failed',
      errorMessage: 'CSS selectors are required',
      retryable: false,
    });

    await expect(mockWorkerInstance.processor(job)).resolves.toBeUndefined();
    expect(incJobsFailed).toHaveBeenCalled();
    // A failed run must never be reported as a processed success.
    expect(incJobsProcessed).not.toHaveBeenCalled();
  });

  it('counts a genuinely successful run as a success', async () => {
    const { incJobsProcessed, incJobsFailed } = require('../shared/utils/metrics');
    startScraperWorker();
    const job = {
      id: 'job-7',
      name: SCRAPER_RUN,
      data: { configId: 'cfg-1', triggeredBy: 'u1', logId: 'log-1' },
    };
    (runScrapeForJob as jest.Mock).mockResolvedValue({ logId: 'log-1', status: 'completed' });

    await mockWorkerInstance.processor(job);
    expect(incJobsProcessed).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'success' }),
    );
    expect(incJobsFailed).not.toHaveBeenCalled();
  });

  it('routes failed job to DLQ after max attempts', () => {
    startScraperWorker();
    const { moveToDLQ } = require('../lib/dlq');
    const job = {
      id: 'job-4',
      name: SCRAPER_RUN,
      data: { configId: 'cfg-1' },
      attemptsMade: 3,
      opts: { attempts: 3 },
    };
    const failedHandler = mockWorkerInstance.on.mock.calls.find((c: any[]) => c[0] === 'failed')?.[1];
    failedHandler(job, new Error('boom'));
    expect(moveToDLQ).toHaveBeenCalled();
  });
});

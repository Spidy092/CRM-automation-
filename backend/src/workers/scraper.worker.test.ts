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
    (runScrape as jest.Mock).mockResolvedValue(undefined);
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
    (runScrapeForJob as jest.Mock).mockResolvedValue(undefined);
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

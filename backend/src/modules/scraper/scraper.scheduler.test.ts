import { syncSchedule, removeSchedule, reconcileSchedules } from './scraper.scheduler';
import { scraperQueue, SCRAPER_RUN } from '../../workers/queue';
import { findActiveScraperConfigs } from './scraper.repository';

jest.mock('../../workers/queue', () => ({
  scraperQueue: {
    add: jest.fn(),
    getRepeatableJobs: jest.fn(),
    removeRepeatableByKey: jest.fn(),
  },
  SCRAPER_RUN: 'scraper:run',
}));
jest.mock('./scraper.repository', () => ({
  findActiveScraperConfigs: jest.fn(),
}));
jest.mock('../../shared/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

describe('scraper.scheduler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (scraperQueue.getRepeatableJobs as jest.Mock).mockResolvedValue([]);
  });

  describe('removeSchedule', () => {
    it('does nothing when no repeatable job is registered for the config', async () => {
      await removeSchedule('cfg-1');
      expect(scraperQueue.removeRepeatableByKey).not.toHaveBeenCalled();
    });

    it('removes the matching repeatable job by key', async () => {
      (scraperQueue.getRepeatableJobs as jest.Mock).mockResolvedValue([
        { id: 'scraper-schedule-cfg-1', key: 'the-key' },
        { id: 'scraper-schedule-cfg-2', key: 'other-key' },
      ]);
      await removeSchedule('cfg-1');
      expect(scraperQueue.removeRepeatableByKey).toHaveBeenCalledWith('the-key');
    });
  });

  describe('syncSchedule', () => {
    it('does not register a job when cron is null', async () => {
      await syncSchedule('cfg-1', null, true);
      expect(scraperQueue.add).not.toHaveBeenCalled();
    });

    it('does not register a job when the config is inactive', async () => {
      await syncSchedule('cfg-1', '0 6 * * 1', false);
      expect(scraperQueue.add).not.toHaveBeenCalled();
    });

    it('always removes any existing schedule before (re)adding', async () => {
      (scraperQueue.getRepeatableJobs as jest.Mock).mockResolvedValue([
        { id: 'scraper-schedule-cfg-1', key: 'old-key' },
      ]);
      await syncSchedule('cfg-1', '0 6 * * 1', true);
      expect(scraperQueue.removeRepeatableByKey).toHaveBeenCalledWith('old-key');
      expect(scraperQueue.add).toHaveBeenCalledWith(
        SCRAPER_RUN,
        { configId: 'cfg-1', triggeredBy: 'scheduler' },
        { repeat: { pattern: '0 6 * * 1' }, jobId: 'scraper-schedule-cfg-1' },
      );
    });
  });

  describe('reconcileSchedules', () => {
    it('re-registers schedules only for active configs with a cron set', async () => {
      (findActiveScraperConfigs as jest.Mock).mockResolvedValue([
        { id: 'cfg-1', schedule_cron: '0 6 * * 1', is_active: true },
        { id: 'cfg-2', schedule_cron: null, is_active: true },
      ]);
      await reconcileSchedules();
      expect(scraperQueue.add).toHaveBeenCalledTimes(1);
      expect(scraperQueue.add).toHaveBeenCalledWith(
        SCRAPER_RUN,
        { configId: 'cfg-1', triggeredBy: 'scheduler' },
        { repeat: { pattern: '0 6 * * 1' }, jobId: 'scraper-schedule-cfg-1' },
      );
    });

    it('logs and continues when one config fails to reconcile', async () => {
      (findActiveScraperConfigs as jest.Mock).mockResolvedValue([
        { id: 'cfg-1', schedule_cron: '0 6 * * 1', is_active: true },
        { id: 'cfg-2', schedule_cron: '0 7 * * 1', is_active: true },
      ]);
      (scraperQueue.add as jest.Mock)
        .mockRejectedValueOnce(new Error('redis down'))
        .mockResolvedValueOnce(undefined);

      await expect(reconcileSchedules()).resolves.toBeUndefined();
      expect(scraperQueue.add).toHaveBeenCalledTimes(2);
    });
  });
});

import { Request, Response } from 'express';
import {
  listConfigsHandler,
  createConfigHandler,
  getRunLeadsHandler,
  retryFailedHandler,
  importSelectedHandler,
  getStatsSummaryHandler,
  discoverPagesHandler,
  triggerScrapeHandler,
} from './scraper.controller';
import * as service from './scraper.service';

jest.mock('./scraper.service');

describe('Scraper Controller', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;

  beforeEach(() => {
    jest.clearAllMocks();
    req = { user: { id: '1', role: 'admin' }, body: {} } as any;
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
  });

  describe('listConfigsHandler', () => {
    it('returns configs', async () => {
      (service.listConfigs as jest.Mock).mockResolvedValue([{ id: '1' }]);
      await listConfigsHandler(req as Request, res as Response, (() => {}) as any);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: [{ id: '1' }],
      });
    });
  });

  describe('createConfigHandler', () => {
    it('creates config', async () => {
      req.body = { name: 'Test', source_type: 'google_places', config: { query: 'test' } };
      (service.createConfig as jest.Mock).mockResolvedValue({ id: '1', name: 'Test' });

      await createConfigHandler(req as Request, res as Response, (() => {}) as any);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: { id: '1', name: 'Test' },
      });
    });
  });

  describe('triggerScrapeHandler', () => {
    it('enqueues the run via queueScrapeRun and returns 202 with the pending result', async () => {
      req.params = { configId: 'cfg-1' } as any;
      (service.queueScrapeRun as jest.Mock).mockResolvedValue({
        logId: 'log-1',
        recordsFound: 0,
        recordsImported: 0,
        recordsDuplicate: 0,
        recordsFailed: 0,
        status: 'running',
      });

      await triggerScrapeHandler(req as Request, res as Response, (() => {}) as any);

      expect(service.queueScrapeRun).toHaveBeenCalledWith('cfg-1', { id: '1', role: 'admin', ipAddress: null });
      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          logId: 'log-1',
          recordsFound: 0,
          recordsImported: 0,
          recordsDuplicate: 0,
          recordsFailed: 0,
          status: 'running',
        },
      });
    });
  });

  describe('getRunLeadsHandler', () => {
    it('returns leads for the run', async () => {
      const logId = 'a0000000-0000-0000-0000-000000000001';
      req.params = { logId } as any;
      (service.getLeadsForRun as jest.Mock).mockResolvedValue([{ id: 'lead-1' }]);

      await getRunLeadsHandler(req as Request, res as Response, (() => {}) as any);

      expect(service.getLeadsForRun).toHaveBeenCalledWith(logId);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: [{ id: 'lead-1' }],
      });
    });

    it('forwards errors to next', async () => {
      const logId = 'a0000000-0000-0000-0000-000000000001';
      req.params = { logId } as any;
      const err = new Error('not found');
      (service.getLeadsForRun as jest.Mock).mockRejectedValue(err);
      const next = jest.fn();

      await getRunLeadsHandler(req as Request, res as Response, next as any);

      expect(next).toHaveBeenCalledWith(err);
    });

    it('forwards validation error when logId is not a UUID', async () => {
      req.params = { logId: 'not-a-uuid' } as any;
      const next = jest.fn();

      await getRunLeadsHandler(req as Request, res as Response, next as any);

      expect(next).toHaveBeenCalled();
      expect(service.getLeadsForRun).not.toHaveBeenCalled();
    });
  });

  describe('retryFailedHandler', () => {
    it('retries failed items for the run', async () => {
      const logId = 'a0000000-0000-0000-0000-000000000001';
      req.params = { logId } as any;
      (service.retryFailedItems as jest.Mock).mockResolvedValue({
        logId: 'retry-log-1',
        status: 'completed',
      });

      await retryFailedHandler(req as Request, res as Response, (() => {}) as any);

      expect(service.retryFailedItems).toHaveBeenCalledWith(
        logId,
        expect.objectContaining({ id: '1', role: 'admin' }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: { logId: 'retry-log-1', status: 'completed' },
      });
    });
  });

  describe('importSelectedHandler', () => {
    it('imports the selection with a 201 envelope', async () => {
      const logId = 'a0000000-0000-0000-0000-000000000001';
      req.params = { logId } as any;
      req.body = { selection: ['UC1'] };
      (service.importSelectedCandidates as jest.Mock).mockResolvedValue({
        logId: 'import-log-1',
        status: 'completed',
      });

      await importSelectedHandler(req as Request, res as Response, (() => {}) as any);

      expect(service.importSelectedCandidates).toHaveBeenCalledWith(
        logId,
        ['UC1'],
        expect.objectContaining({ id: '1', role: 'admin' }),
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('rejects non-UUID log ids before any service call', async () => {
      req.params = { logId: 'not-a-uuid' } as any;
      req.body = { selection: ['UC1'] };
      const next = jest.fn();

      await importSelectedHandler(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect(service.importSelectedCandidates as jest.Mock).not.toHaveBeenCalled();
    });

    it('rejects empty selections before any service call', async () => {
      req.params = { logId: 'a0000000-0000-0000-0000-000000000001' } as any;
      req.body = { selection: [] };
      const next = jest.fn();

      await importSelectedHandler(req as Request, res as Response, next);

      expect(next).toHaveBeenCalled();
      expect(service.importSelectedCandidates as jest.Mock).not.toHaveBeenCalled();
    });
  });

  describe('getStatsSummaryHandler', () => {
    it('returns the aggregated summary using the query hours param', async () => {
      req.query = { hours: '48' } as any;
      (service.getStatsSummary as jest.Mock).mockResolvedValue({ windowHours: 48, totalRuns: 3 });

      await getStatsSummaryHandler(req as Request, res as Response, (() => {}) as any);

      expect(service.getStatsSummary).toHaveBeenCalledWith(48);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: { windowHours: 48, totalRuns: 3 },
      });
    });

    it('defaults to 24 hours when no query param is given', async () => {
      req.query = {} as any;
      (service.getStatsSummary as jest.Mock).mockResolvedValue({ windowHours: 24, totalRuns: 0 });

      await getStatsSummaryHandler(req as Request, res as Response, (() => {}) as any);

      expect(service.getStatsSummary).toHaveBeenCalledWith(24);
    });
  });

  describe('discoverPagesHandler', () => {
    it('returns discovered pages for a valid URL', async () => {
      req.body = { url: 'https://example.com/' };
      (service.discoverPages as jest.Mock).mockResolvedValue([
        { url: 'https://example.com/', label: 'Home' },
      ]);

      await discoverPagesHandler(req as Request, res as Response, (() => {}) as any);

      expect(service.discoverPages).toHaveBeenCalledWith('https://example.com/');
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: [{ url: 'https://example.com/', label: 'Home' }],
      });
    });

    it('forwards errors to next', async () => {
      req.body = { url: 'not-a-url' };
      const next = jest.fn();

      await discoverPagesHandler(req as Request, res as Response, next as any);

      expect(next).toHaveBeenCalled();
      expect(service.discoverPages).not.toHaveBeenCalled();
    });
  });
});

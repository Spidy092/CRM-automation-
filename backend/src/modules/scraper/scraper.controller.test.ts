import { Request, Response } from 'express';
import { listConfigsHandler, createConfigHandler } from './scraper.controller';
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
});

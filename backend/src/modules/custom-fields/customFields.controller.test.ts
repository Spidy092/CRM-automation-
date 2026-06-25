import type { Request, Response, NextFunction } from 'express';
import {
  listDefinitionsHandler,
  createDefinitionHandler,
  updateDefinitionHandler,
} from './customFields.controller';
import * as customFieldsService from './customFields.service';
import { ZodError } from 'zod';

jest.mock('./customFields.service');

const mockedService = customFieldsService as jest.Mocked<typeof customFieldsService>;

function mockReq(opts: {
  params?: Record<string, string>;
  body?: Record<string, unknown>;
  query?: Record<string, string>;
  user?: { id: string; role: string };
  ip?: string;
} = {}): Partial<Request> {
  return {
    params: opts.params || {},
    body: opts.body || {},
    query: opts.query || {},
    user: opts.user || { id: 'admin-1', role: 'admin' },
    ip: opts.ip || '127.0.0.1',
  } as unknown as Request;
}

function mockRes(): Partial<Response> {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnThis();
  res.json = jest.fn().mockReturnThis();
  return res;
}

const mockNext = jest.fn() as NextFunction;

describe('customFields.controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('listDefinitionsHandler', () => {
    it('returns items with includeInactive=true', async () => {
      mockedService.listDefinitions.mockResolvedValueOnce([
        { id: 'f1', field_key: 'size' },
      ] as any);
      const req = mockReq({ query: { includeInactive: 'true' } });
      const res = mockRes() as Response;
      await listDefinitionsHandler(req as Request, res, mockNext);
      expect(mockedService.listDefinitions).toHaveBeenCalledWith(true);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: [{ id: 'f1', field_key: 'size' }] }),
      );
    });

    it('returns items with includeInactive=false (default)', async () => {
      mockedService.listDefinitions.mockResolvedValueOnce([
        { id: 'f1', field_key: 'size' },
      ] as any);
      const req = mockReq();
      const res = mockRes() as Response;
      await listDefinitionsHandler(req as Request, res, mockNext);
      expect(mockedService.listDefinitions).toHaveBeenCalledWith(false);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('passes errors to next', async () => {
      mockedService.listDefinitions.mockRejectedValueOnce(new Error('db fail'));
      const req = mockReq();
      const res = mockRes() as Response;
      await listDefinitionsHandler(req as Request, res, mockNext);
      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('createDefinitionHandler', () => {
    it('returns 201 on success', async () => {
      mockedService.createDefinition.mockResolvedValueOnce({ id: 'f1' } as any);
      const req = mockReq({
        body: {
          label: 'Size',
          field_key: 'size',
          field_type: 'number',
        },
      });
      const res = mockRes() as Response;
      await createDefinitionHandler(req as Request, res, mockNext);
      expect(mockedService.createDefinition).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('falls back to system actor when no user', async () => {
      mockedService.createDefinition.mockResolvedValueOnce({ id: 'f1' } as any);
      const req = { params: {}, body: { label: 'Size', field_key: 'size', field_type: 'number' }, query: {}, ip: '127.0.0.1' } as unknown as Request;
      const res = mockRes() as Response;
      await createDefinitionHandler(req as Request, res, mockNext);
      expect(mockedService.createDefinition).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ id: '00000000-0000-0000-0000-000000000001' }),
      );
    });

    it('passes Zod validation errors to next', async () => {
      const req = mockReq({ body: { label: '' } });
      const res = mockRes() as Response;
      await createDefinitionHandler(req as Request, res, mockNext);
      expect(mockNext).toHaveBeenCalledWith(expect.any(ZodError));
    });

    it('passes service errors to next', async () => {
      mockedService.createDefinition.mockRejectedValueOnce(new Error('db fail'));
      const req = mockReq({ body: { label: 'Size', field_key: 'size', field_type: 'number' } });
      const res = mockRes() as Response;
      await createDefinitionHandler(req as Request, res, mockNext);
      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('updateDefinitionHandler', () => {
    it('returns 200 on success', async () => {
      mockedService.updateDefinition.mockResolvedValueOnce({ id: 'f1', label: 'Updated' } as any);
      const req = mockReq({ params: { id: 'f1' }, body: { label: 'Updated' } });
      const res = mockRes() as Response;
      await updateDefinitionHandler(req as Request, res, mockNext);
      expect(mockedService.updateDefinition).toHaveBeenCalledWith(
        'f1',
        { label: 'Updated' },
        expect.any(Object),
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('passes Zod validation errors to next', async () => {
      const req = mockReq({ params: { id: 'f1' }, body: { label: '' } });
      const res = mockRes() as Response;
      await updateDefinitionHandler(req as Request, res, mockNext);
      expect(mockNext).toHaveBeenCalledWith(expect.any(ZodError));
    });

    it('passes service errors to next', async () => {
      mockedService.updateDefinition.mockRejectedValueOnce(new Error('db fail'));
      const req = mockReq({ params: { id: 'f1' }, body: { label: 'Updated' } });
      const res = mockRes() as Response;
      await updateDefinitionHandler(req as Request, res, mockNext);
      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});

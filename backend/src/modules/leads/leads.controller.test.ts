jest.mock('./leads.service', () => ({
  bulkUpdateLeads: jest.fn(),
}));
jest.mock('./leads.import', () => ({ importLeads: jest.fn(), isSupportedFile: jest.fn() }));
jest.mock('./leads.enrichment', () => ({ enrichLead: jest.fn() }));

import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../shared/middleware/errorHandler';
import * as leadsService from './leads.service';
import { bulkUpdateHandler } from './leads.controller';

describe('bulkUpdateHandler ownership rejection', () => {
  it('returns the stable error code and affected lead ids in the response meta', async () => {
    const ids = ['11111111-1111-4111-8111-111111111111'];
    const error = Object.assign(
      new AppError('Bulk ownership changes must use the assignment endpoints', 422),
      {
        code: 'ownership_via_assignment_endpoints',
        leadIds: ids,
      },
    );
    (leadsService.bulkUpdateLeads as jest.Mock).mockRejectedValue(error);

    const req = {
      body: { ids, patch: { assigned_to: '22222222-2222-4222-8222-222222222222' } },
      user: { id: 'admin-1', role: 'admin' },
      ip: '127.0.0.1',
    } as unknown as Request;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    } as unknown as Response;
    const next = jest.fn() as NextFunction;

    await bulkUpdateHandler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: error.message,
      meta: { code: 'ownership_via_assignment_endpoints', lead_ids: ids },
    });
    expect(next).not.toHaveBeenCalled();
  });
});

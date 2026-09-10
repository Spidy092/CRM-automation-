import type { NextFunction, Request, Response } from 'express';
import { validateWorkflowHandler } from './workflow.controller';

function mockResponse(): Response {
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
  return response;
}

describe('workflow controller', () => {
  it('returns a standard success envelope for valid workflow drafts', async () => {
    const req = {
      body: {
        name: 'New lead',
        entryNodeId: 'trigger',
        nodes: [
          { id: 'trigger', type: 'trigger', next: ['end'], trigger: { event: 'lead.created' } },
          { id: 'end', type: 'end', next: [] },
        ],
      },
    } as Request;
    const res = mockResponse();
    const next = jest.fn() as NextFunction;

    await validateWorkflowHandler(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { valid: true, issues: [] },
    });
  });

  it('returns validation issues without invoking persistence', async () => {
    const req = { body: { name: '', entryNodeId: 'missing', nodes: [] } } as Request;
    const res = mockResponse();
    const next = jest.fn() as NextFunction;

    await validateWorkflowHandler(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ valid: false }),
      }),
    );
  });
});

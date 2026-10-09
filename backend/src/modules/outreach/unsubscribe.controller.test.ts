import type { Request, Response } from 'express';
import { unsubscribeOutreachHandler } from './outreach.controller';
import { unsubscribeOutreachRecipient } from './unsubscribe.service';

jest.mock('./outreach.service', () => ({}));
jest.mock('./unsubscribe.service', () => ({ unsubscribeOutreachRecipient: jest.fn() }));

describe('public outreach unsubscribe controller', () => {
  it('validates the token and completes without an authenticated user', async () => {
    const token = 'a'.repeat(64);
    const req = { body: { token } } as Request;
    const res = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response;
    const next = jest.fn();
    await unsubscribeOutreachHandler(req, res, next);
    expect(unsubscribeOutreachRecipient).toHaveBeenCalledWith(token);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { message: expect.stringContaining('unsubscribed') },
    });
    expect(next).not.toHaveBeenCalled();
  });
  it('rejects a client-supplied lead ID and malformed token before the service runs', async () => {
    jest.clearAllMocks();
    const next = jest.fn();
    await unsubscribeOutreachHandler(
      { body: { token: 'invalid', leadId: 'another-lead' } } as Request,
      {} as Response,
      next,
    );
    expect(next).toHaveBeenCalled();
    expect(unsubscribeOutreachRecipient).not.toHaveBeenCalled();
  });
});

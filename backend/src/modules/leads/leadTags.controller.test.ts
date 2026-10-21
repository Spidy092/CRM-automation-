import type { Request, Response } from 'express';
import { leadTagsHandler } from './leadTags.controller';
import { getLeadTags } from './leadTags.service';

jest.mock('./leadTags.service', () => ({ getLeadTags: jest.fn() }));

describe('lead tag request boundaries', () => {
  beforeEach(() => jest.clearAllMocks());

  const response = (): Response =>
    ({
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    }) as unknown as Response;

  it('rejects unauthenticated requests before fetching any tags', async () => {
    const next = jest.fn();
    await leadTagsHandler({ query: {} } as Request, response(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    expect(getLeadTags).not.toHaveBeenCalled();
  });

  it('rejects assignment overrides supplied as query parameters', async () => {
    const next = jest.fn();
    await leadTagsHandler(
      {
        query: { assigned_to: 'other-rep' },
        user: { id: 'rep-1', role: 'sales' },
      } as unknown as Request,
      response(),
      next,
    );
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ZodError' }));
    expect(getLeadTags).not.toHaveBeenCalled();
  });

  it('passes repository failures to the shared error handler', async () => {
    const error = new Error('Database unavailable');
    jest.mocked(getLeadTags).mockRejectedValueOnce(error);
    const next = jest.fn();
    const res = response();
    await leadTagsHandler(
      { query: {}, user: { id: 'rep-1', role: 'sales' } } as unknown as Request,
      res,
      next,
    );
    expect(next).toHaveBeenCalledWith(error);
    expect(res.json).not.toHaveBeenCalled();
  });
});

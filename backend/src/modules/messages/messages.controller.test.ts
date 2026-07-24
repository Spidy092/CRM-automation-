import { jest, describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('./messages.service', () => ({
  listMessageSnippets: jest.fn(),
  getMessageSnippet: jest.fn(),
  createMessageSnippet: jest.fn(),
  updateMessageSnippet: jest.fn(),
  removeMessageSnippet: jest.fn(),
}));

import * as messagesService from './messages.service';
import {
  listMessageSnippetsHandler,
  getMessageSnippetHandler,
  createMessageSnippetHandler,
  updateMessageSnippetHandler,
  deleteMessageSnippetHandler,
} from './messages.controller';

const VALID_ID = '123e4567-e89b-12d3-a456-426614174000';

function mockReq(overrides: Record<string, unknown> = {}) {
  return {
    params: {},
    query: {},
    body: {},
    user: { id: 'u1', role: 'admin' },
    ip: '127.0.0.1',
    ...overrides,
  } as any;
}

function mockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const next = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
});

describe('listMessageSnippetsHandler', () => {
  it('returns snippets', async () => {
    (messagesService.listMessageSnippets as jest.Mock<any>).mockResolvedValue([{ id: 'm1' }]);
    const res = mockRes();
    await listMessageSnippetsHandler(mockReq(), res, next);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('getMessageSnippetHandler', () => {
  it('returns the snippet', async () => {
    (messagesService.getMessageSnippet as jest.Mock<any>).mockResolvedValue({ id: 'm1' });
    const res = mockRes();
    await getMessageSnippetHandler(mockReq({ params: { id: VALID_ID } }), res, next);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rejects an invalid id', async () => {
    const res = mockRes();
    await getMessageSnippetHandler(mockReq({ params: { id: 'bad' } }), res, next);
    expect(next).toHaveBeenCalled();
  });
});

describe('createMessageSnippetHandler', () => {
  it('creates a snippet', async () => {
    (messagesService.createMessageSnippet as jest.Mock<any>).mockResolvedValue({ id: 'm1' });
    const res = mockRes();
    await createMessageSnippetHandler(
      mockReq({ body: { title: 'Follow up', body: 'Hi there' } }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('rejects invalid body', async () => {
    const res = mockRes();
    await createMessageSnippetHandler(mockReq({ body: {} }), res, next);
    expect(next).toHaveBeenCalled();
    expect(messagesService.createMessageSnippet).not.toHaveBeenCalled();
  });
});

describe('updateMessageSnippetHandler', () => {
  it('updates a snippet', async () => {
    (messagesService.updateMessageSnippet as jest.Mock<any>).mockResolvedValue({ id: 'm1' });
    const res = mockRes();
    await updateMessageSnippetHandler(
      mockReq({ params: { id: VALID_ID }, body: { title: 'x' } }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('deleteMessageSnippetHandler', () => {
  it('deletes a snippet', async () => {
    (messagesService.removeMessageSnippet as jest.Mock<any>).mockResolvedValue(undefined);
    const res = mockRes();
    await deleteMessageSnippetHandler(mockReq({ params: { id: VALID_ID } }), res, next);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

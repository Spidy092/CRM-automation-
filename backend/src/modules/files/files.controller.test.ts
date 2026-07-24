import { jest, describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('./files.service', () => ({
  listFiles: jest.fn(),
  getFile: jest.fn(),
  uploadFile: jest.fn(),
  updateFile: jest.fn(),
  removeFile: jest.fn(),
}));

import * as filesService from './files.service';
import {
  listFilesHandler,
  getFileHandler,
  uploadFileHandler,
  updateFileHandler,
  deleteFileHandler,
} from './files.controller';

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

describe('listFilesHandler', () => {
  it('returns files', async () => {
    (filesService.listFiles as jest.Mock<any>).mockResolvedValue([{ id: 'f1' }]);
    const res = mockRes();
    await listFilesHandler(mockReq(), res, next);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('getFileHandler', () => {
  it('returns the file', async () => {
    (filesService.getFile as jest.Mock<any>).mockResolvedValue({ id: 'f1' });
    const res = mockRes();
    await getFileHandler(mockReq({ params: { id: VALID_ID } }), res, next);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rejects an invalid id', async () => {
    const res = mockRes();
    await getFileHandler(mockReq({ params: { id: 'not-a-uuid' } }), res, next);
    expect(next).toHaveBeenCalled();
    expect(filesService.getFile).not.toHaveBeenCalled();
  });
});

describe('uploadFileHandler', () => {
  it('rejects when no file uploaded', async () => {
    const res = mockRes();
    await uploadFileHandler(mockReq(), res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(filesService.uploadFile).not.toHaveBeenCalled();
  });

  it('uploads the file when present', async () => {
    (filesService.uploadFile as jest.Mock<any>).mockResolvedValue({ id: 'f1' });
    const res = mockRes();
    await uploadFileHandler(
      mockReq({ file: { originalname: 'a.png', mimetype: 'image/png', size: 10, buffer: Buffer.from('') } }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('updateFileHandler', () => {
  it('updates the file', async () => {
    (filesService.updateFile as jest.Mock<any>).mockResolvedValue({ id: 'f1', filename: 'x.png' });
    const res = mockRes();
    await updateFileHandler(
      mockReq({ params: { id: VALID_ID }, body: { filename: 'x.png' } }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('deleteFileHandler', () => {
  it('deletes the file', async () => {
    (filesService.removeFile as jest.Mock<any>).mockResolvedValue(undefined);
    const res = mockRes();
    await deleteFileHandler(mockReq({ params: { id: VALID_ID } }), res, next);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

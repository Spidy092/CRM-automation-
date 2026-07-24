jest.mock('./files.repository', () => ({
  findFiles: jest.fn(),
  findFileById: jest.fn(),
  insertFile: jest.fn(),
  updateFile: jest.fn(),
  softDeleteFile: jest.fn(),
}));

jest.mock('../../shared/utils/audit', () => ({ writeAuditLog: jest.fn() }));
jest.mock('fs/promises', () => ({
  unlink: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
}));

import { listFiles, getFile, uploadFile, updateFile, removeFile } from './files.service';
import {
  findFiles,
  findFileById,
  insertFile,
  updateFile as updateFileRepo,
  softDeleteFile,
} from './files.repository';
import { writeAuditLog } from '../../shared/utils/audit';
import { unlink } from 'fs/promises';
import { FileRow } from './files.types';

const actor = { id: 'u1', role: 'admin', ipAddress: '127.0.0.1' };

const baseRow: FileRow = {
  id: 'f1',
  filename: 'logo.png',
  mime_type: 'image/png',
  size_bytes: 1024,
  storage_path: '/tmp/uploads/files/f1.png',
  url: 'http://localhost:3000/uploads/files/f1.png',
  tags: [],
  created_by: 'u1',
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
};

beforeEach(() => jest.clearAllMocks());

describe('listFiles', () => {
  it('maps rows to responses without storage_path', async () => {
    (findFiles as jest.Mock).mockResolvedValue([baseRow]);
    const result = await listFiles({});
    expect(result).toEqual([
      {
        id: 'f1',
        filename: 'logo.png',
        mime_type: 'image/png',
        size_bytes: 1024,
        url: baseRow.url,
        tags: [],
        created_by: 'u1',
        created_at: baseRow.created_at,
        updated_at: baseRow.updated_at,
      },
    ]);
    expect((result[0] as unknown as Record<string, unknown>).storage_path).toBeUndefined();
  });
});

describe('getFile', () => {
  it('returns the file when found', async () => {
    (findFileById as jest.Mock).mockResolvedValue(baseRow);
    await expect(getFile('f1')).resolves.toMatchObject({ id: 'f1' });
  });

  it('throws 404 when missing', async () => {
    (findFileById as jest.Mock).mockResolvedValue(null);
    await expect(getFile('missing')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('uploadFile', () => {
  it('rejects unsupported mime types', async () => {
    await expect(
      uploadFile(
        { originalname: 'x.exe', mimetype: 'application/x-msdownload', size: 10, buffer: Buffer.from('') },
        actor,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(insertFile).not.toHaveBeenCalled();
  });

  it('writes to disk and inserts a row for allowed mime types', async () => {
    (insertFile as jest.Mock).mockResolvedValue(baseRow);
    const result = await uploadFile(
      { originalname: 'logo.png', mimetype: 'image/png', size: 1024, buffer: Buffer.from('x') },
      actor,
    );
    expect(insertFile).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'logo.png', mime_type: 'image/png', created_by: 'u1' }),
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'file.uploaded', entityId: 'f1' }),
    );
    expect(result.id).toBe('f1');
  });
});

describe('updateFile', () => {
  it('throws 404 when file missing', async () => {
    (findFileById as jest.Mock).mockResolvedValue(null);
    await expect(updateFile('missing', { filename: 'x' }, actor)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('updates and writes audit log', async () => {
    (findFileById as jest.Mock).mockResolvedValue(baseRow);
    (updateFileRepo as jest.Mock).mockResolvedValue({ ...baseRow, filename: 'renamed.png' });
    const result = await updateFile('f1', { filename: 'renamed.png' }, actor);
    expect(result.filename).toBe('renamed.png');
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'file.updated' }));
  });
});

describe('removeFile', () => {
  it('throws 404 when file missing', async () => {
    (findFileById as jest.Mock).mockResolvedValue(null);
    await expect(removeFile('missing', actor)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('soft-deletes, unlinks disk file, and writes audit log', async () => {
    (findFileById as jest.Mock).mockResolvedValue(baseRow);
    (softDeleteFile as jest.Mock).mockResolvedValue(baseRow);
    await removeFile('f1', actor);
    expect(softDeleteFile).toHaveBeenCalledWith('f1');
    expect(unlink).toHaveBeenCalledWith(baseRow.storage_path);
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'file.deleted' }));
  });

  it('swallows unlink errors', async () => {
    (findFileById as jest.Mock).mockResolvedValue(baseRow);
    (softDeleteFile as jest.Mock).mockResolvedValue(baseRow);
    (unlink as jest.Mock).mockRejectedValueOnce(new Error('ENOENT'));
    await expect(removeFile('f1', actor)).resolves.toBeUndefined();
  });
});

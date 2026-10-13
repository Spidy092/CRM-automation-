/**
 * Fail-closed behavior of the file-lifecycle reference validation.
 *
 * This file never calls setFileReferenceCheckers, so the module state is
 * pristine (each test file gets its own module registry): deletion must
 * refuse rather than silently skip the reference check.
 */
jest.mock('./files.repository', () => ({
  findFiles: jest.fn(),
  findFileById: jest.fn(),
  insertFile: jest.fn(),
  updateFile: jest.fn(),
  softDeleteFile: jest.fn(),
}));

jest.mock('../../shared/utils/db', () => ({
  advisoryLockKey: jest.fn((namespace: string, id: string) => `${namespace}:${id}`),
  withAdvisoryLock: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
}));

jest.mock('../../shared/utils/audit', () => ({ writeAuditLog: jest.fn() }));
jest.mock('fs/promises', () => ({
  unlink: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
}));

import { removeFile, setFileReferenceCheckers } from './files.service';
import { softDeleteFile } from './files.repository';

const actor = { id: 'u1', role: 'admin', ipAddress: '127.0.0.1' };

describe('file reference checker wiring', () => {
  it('refuses to delete when checkers are not configured (fail closed)', async () => {
    await expect(removeFile('f1', actor)).rejects.toMatchObject({
      statusCode: 500,
      message: expect.stringContaining('not configured'),
    });
    expect(softDeleteFile).not.toHaveBeenCalled();
  });

  it('deletes once checkers are injected', async () => {
    const { findFileById } = await import('./files.repository');
    (findFileById as jest.Mock).mockResolvedValue({
      id: 'f1',
      filename: 'logo.png',
      storage_path: '/tmp/f1.png',
    });
    (softDeleteFile as jest.Mock).mockResolvedValue({});
    setFileReferenceCheckers({
      findTemplatesUsingFile: jest.fn().mockResolvedValue([]),
      findPagesUsingFile: jest.fn().mockResolvedValue([]),
    });
    await expect(removeFile('f1', actor)).resolves.toBeUndefined();
    expect(softDeleteFile).toHaveBeenCalledWith('f1');
  });
});

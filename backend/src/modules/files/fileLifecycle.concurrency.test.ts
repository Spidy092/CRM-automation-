/**
 * File-lifecycle race regression test: deletion vs. "attach from library".
 *
 * Killer interleaving (before the protocol): delete checks references (none
 * yet) → attach reads the live file and appends → delete soft-deletes and
 * unlinks → the template points at a deleted disk file and sends fail.
 *
 * What this proves: with both operations serialized on the same key — exactly
 * what `withAdvisoryLock(advisoryLockKey('file-lifecycle', id))` does across
 * connections in production (proven live in
 * shared/utils/advisoryLock.test.ts) — the check-then-act sequences in
 * `removeFile` / `addTemplateAttachmentFromLibrary` admit no broken outcome.
 * Each test forces genuine overlap (one side holds the lock while the other
 * waits) via gates inside the faked repositories, so the winner is
 * deterministic and the loser must observe the winner's committed state.
 *
 * Mechanics: repositories are backed by in-memory maps (the SQL containment
 * queries themselves are covered by the repository unit tests), while the
 * REAL service functions and a REAL (in-process FIFO) mutex stand in for the
 * advisory lock. No database is needed; nothing touches disk or the network.
 */

jest.mock('./files.repository', () => ({
  findFiles: jest.fn(),
  findFileById: jest.fn(),
  insertFile: jest.fn(),
  updateFile: jest.fn(),
  softDeleteFile: jest.fn(),
}));

jest.mock('../templates/templates.repository', () => ({
  findTemplateById: jest.fn(),
  appendTemplateAttachment: jest.fn(),
}));

jest.mock('../pages/pages.repository', () => ({
  findPages: jest.fn(),
  findPageById: jest.fn(),
  findPublishedPageBySlug: jest.fn(),
  findPageBySlug: jest.fn(),
  insertPage: jest.fn(),
  updatePage: jest.fn(),
}));

jest.mock('../../shared/utils/audit', () => ({ writeAuditLog: jest.fn() }));
jest.mock('fs/promises', () => ({
  unlink: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
}));

// FIFO mutex keyed by lock string: the in-process stand-in for Postgres
// advisory locks (same mutual-exclusion contract, one process).
const mutexTails = new Map<string, Promise<void>>();
async function testMutex<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = mutexTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((resolve) => {
    release = resolve;
  });
  mutexTails.set(key, prev.then(() => mine));
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

jest.mock('../../shared/utils/db', () => ({
  advisoryLockKey: jest.fn((namespace: string, id: string) => `${namespace}:${id}`),
  withAdvisoryLock: jest.fn((key: string, fn: () => Promise<unknown>) => testMutex(key, fn)),
  // Nested per-key acquisition in the given order — mirrors the production
  // helper (including its sorted-order contract) key by key.
  withAdvisoryLocks: jest.fn(async (keys: string[], fn: () => Promise<unknown>) => {
    const run = async (index: number): Promise<unknown> =>
      index === keys.length ? fn() : testMutex(keys[index], () => run(index + 1));
    return run(0);
  }),
}));

import { AppError } from '../../shared/middleware/errorHandler';
import { removeFile, setFileReferenceCheckers } from './files.service';
import { addTemplateAttachmentFromLibrary } from '../templates/templates.service';
import { createPage, updatePage } from '../pages/pages.service';
import { findFileById, softDeleteFile } from './files.repository';
import { appendTemplateAttachment, findTemplateById } from '../templates/templates.repository';
import {
  findPageById,
  findPageBySlug,
  insertPage,
  updatePage as updatePageRepo,
} from '../pages/pages.repository';
import { unlink } from 'fs/promises';

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface MemFile {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  url: string;
  deleted: boolean;
}

interface MemAttachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  storagePath: string;
  libraryFileId?: string;
}

interface MemTemplate {
  id: string;
  name: string;
  channel: string;
  approval_status: string;
  created_by: string;
  attachments: MemAttachment[];
}

interface MemPageBlock {
  type: string;
  fileIds?: string[];
  fileId?: string;
  label?: string;
  url?: string;
}

interface MemPage {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  blocks: MemPageBlock[];
  status: string;
  created_by: string;
}

const state = {
  files: new Map<string, MemFile>(),
  templates: new Map<string, MemTemplate>(),
  pages: new Map<string, MemPage>(),
  appendGate: null as Deferred | null,
  softDeleteGate: null as Deferred | null,
  insertPageGate: null as Deferred | null,
  updatePageGate: null as Deferred | null,
};

const FILE_ID = 'file-race-1';
const TEMPLATE_ID = 'tmpl-race-1';
const PAGE_ID = 'page-race-1';
const actor = { id: 'u1', role: 'admin', ipAddress: '127.0.0.1' };

function seed(): void {
  state.files.clear();
  state.templates.clear();
  state.pages.clear();
  mutexTails.clear();
  state.appendGate = null;
  state.softDeleteGate = null;
  state.insertPageGate = null;
  state.updatePageGate = null;
  state.files.set(FILE_ID, {
    id: FILE_ID,
    filename: 'brochure.pdf',
    mime_type: 'application/pdf',
    size_bytes: 4096,
    storage_path: '/uploads/files/race-1.pdf',
    url: 'http://localhost:3000/uploads/files/race-1.pdf',
    deleted: false,
  });
  state.templates.set(TEMPLATE_ID, {
    id: TEMPLATE_ID,
    name: 'Race template',
    channel: 'email',
    approval_status: 'pending',
    created_by: 'u1',
    attachments: [],
  });
  state.pages.set(PAGE_ID, {
    id: PAGE_ID,
    title: 'Race page',
    slug: 'race-page',
    description: null,
    blocks: [],
    status: 'draft',
    created_by: 'u1',
  });
}

// Repository fakes with the same contracts as the real SQL.
(findFileById as jest.Mock).mockImplementation(async (id: string) => {
  const row = state.files.get(id);
  if (!row || row.deleted) return null;
  const { deleted: _deleted, ...rest } = row;
  return rest;
});
(softDeleteFile as jest.Mock).mockImplementation(async (id: string) => {
  if (state.softDeleteGate) await state.softDeleteGate.promise;
  const row = state.files.get(id);
  if (!row || row.deleted) throw new AppError('File not found', 404);
  row.deleted = true;
  const { deleted: _deleted, ...rest } = row;
  return rest;
});
(findTemplateById as jest.Mock).mockImplementation(async (id: string) => {
  const row = state.templates.get(id);
  return row ? { ...row, attachments: [...row.attachments] } : null;
});
(appendTemplateAttachment as jest.Mock).mockImplementation(async (id: string, attachment: MemAttachment) => {
  if (state.appendGate) await state.appendGate.promise;
  const row = state.templates.get(id);
  if (!row) throw new AppError('Template not found', 404);
  row.attachments.push(attachment);
  return { ...row, attachments: [...row.attachments] };
});
(findPageById as jest.Mock).mockImplementation(async (id: string) => {
  const row = state.pages.get(id);
  return row ? { ...row, blocks: [...row.blocks] } : null;
});
(findPageBySlug as jest.Mock).mockImplementation(async (slug: string) => {
  for (const row of state.pages.values()) {
    if (row.slug === slug) return { ...row, blocks: [...row.blocks] };
  }
  return null;
});
(insertPage as jest.Mock).mockImplementation(
  async (data: { title: string; slug: string; description: string | null; blocks: MemPageBlock[]; created_by: string }) => {
    if (state.insertPageGate) await state.insertPageGate.promise;
    const row: MemPage = {
      id: `page-${state.pages.size + 1}`,
      title: data.title,
      slug: data.slug,
      description: data.description,
      blocks: data.blocks,
      status: 'draft',
      created_by: data.created_by,
    };
    state.pages.set(row.id, row);
    return { ...row, blocks: [...row.blocks] };
  },
);
(updatePageRepo as jest.Mock).mockImplementation(async (id: string, fields: { blocks?: MemPageBlock[] }) => {
  if (state.updatePageGate) await state.updatePageGate.promise;
  const row = state.pages.get(id);
  if (!row) throw new AppError('Page not found', 404);
  if (fields.blocks !== undefined) row.blocks = fields.blocks;
  return { ...row, blocks: [...row.blocks] };
});

// Genuine reference scans (mirror the @> containment semantics).
function scanPageReferences(fileId: string): Array<{ id: string; title: string }> {
  const out: Array<{ id: string; title: string }> = [];
  for (const p of state.pages.values()) {
    const hit = p.blocks.some(
      (b) => (b.fileIds ?? []).includes(fileId) || b.fileId === fileId,
    );
    if (hit) out.push({ id: p.id, title: p.title });
  }
  return out;
}

setFileReferenceCheckers({
  findTemplatesUsingFile: jest.fn(async (fileId: string) => {
    const out: Array<{ id: string; name: string }> = [];
    for (const t of state.templates.values()) {
      if (t.attachments.some((a) => a.libraryFileId === fileId)) out.push({ id: t.id, name: t.name });
    }
    return out;
  }),
  findPagesUsingFile: jest.fn(async (fileId: string) => scanPageReferences(fileId)),
});

beforeEach(() => {
  jest.clearAllMocks();
  seed();
});

/** No template attachment or page block may ever point at an unlinked disk copy. */
function expectNoDanglingReferences(): void {
  const unlinkedPaths = ((unlink as jest.Mock).mock.calls.flat() as unknown[]).filter(
    (c): c is string => typeof c === 'string',
  );
  for (const template of state.templates.values()) {
    for (const attachment of template.attachments) {
      if (!attachment.libraryFileId) continue;
      const referenced = state.files.get(attachment.libraryFileId);
      expect(referenced).toBeDefined();
      expect(referenced?.deleted).toBe(false);
      expect(unlinkedPaths).not.toContain(referenced?.storage_path);
    }
  }
  for (const page of state.pages.values()) {
    const referencedIds = new Set<string>();
    for (const block of page.blocks) {
      (block.fileIds ?? []).forEach((id) => referencedIds.add(id));
      if (block.fileId) referencedIds.add(block.fileId);
    }
    for (const fileId of referencedIds) {
      const referenced = state.files.get(fileId);
      expect(referenced).toBeDefined();
      expect(referenced?.deleted).toBe(false);
      expect(unlinkedPaths).not.toContain(referenced?.storage_path);
    }
  }
}

describe('file lifecycle: delete vs attach-from-library race', () => {
  it('delete holding the lock wins: a concurrent attach sees the file as gone', async () => {
    const softDeleteGate = deferred();
    state.softDeleteGate = softDeleteGate;

    // Delete acquires the lock, re-checks (no references yet), and parks
    // inside its critical section before the soft-delete.
    const deletePromise = removeFile(FILE_ID, actor);
    await sleep(50);

    // Attach now runs up to the lock and waits while delete holds it.
    const attachPromise = addTemplateAttachmentFromLibrary(TEMPLATE_ID, FILE_ID, actor);
    await sleep(50);

    softDeleteGate.resolve();
    const [deleteResult, attachResult] = await Promise.allSettled([deletePromise, attachPromise]);

    expect(deleteResult.status).toBe('fulfilled');
    expect(attachResult.status).toBe('rejected');
    expect((attachResult as PromiseRejectedResult).reason).toMatchObject({ statusCode: 404 });
    expect(unlink).toHaveBeenCalledWith('/uploads/files/race-1.pdf');
    expect(state.templates.get(TEMPLATE_ID)?.attachments).toHaveLength(0);
    expectNoDanglingReferences();
  });

  it('attach holding the lock wins: a concurrent delete is blocked naming the template', async () => {
    const appendGate = deferred();
    state.appendGate = appendGate;

    // Attach acquires the lock, re-reads the live file, and parks inside its
    // critical section before appending.
    const attachPromise = addTemplateAttachmentFromLibrary(TEMPLATE_ID, FILE_ID, actor);
    await sleep(50);

    // Delete now runs up to the lock and waits while attach holds it.
    const deletePromise = removeFile(FILE_ID, actor);
    await sleep(50);

    appendGate.resolve();
    const [attachResult, deleteResult] = await Promise.allSettled([attachPromise, deletePromise]);

    expect(attachResult.status).toBe('fulfilled');
    expect(deleteResult.status).toBe('rejected');
    const reason = (deleteResult as PromiseRejectedResult).reason as AppError & {
      meta?: { references?: { templates?: Array<{ name: string }> } };
    };
    expect(reason).toMatchObject({ statusCode: 409 });
    expect(reason.meta?.references?.templates?.[0]?.name).toBe('Race template');
    expect(unlink).not.toHaveBeenCalled();

    // The winning attachment references a live disk copy.
    expect(state.templates.get(TEMPLATE_ID)?.attachments).toHaveLength(1);
    expect(state.files.get(FILE_ID)?.deleted).toBe(false);
    expectNoDanglingReferences();
  });

  it('delete holding the lock wins: a concurrent page create sees the file as gone', async () => {
    const softDeleteGate = deferred();
    state.softDeleteGate = softDeleteGate;

    // Delete acquires the lock, re-checks (no references yet), and parks
    // inside its critical section before the soft-delete.
    const deletePromise = removeFile(FILE_ID, actor);
    await sleep(50);

    // Page create now runs up to the lifecycle lock and waits while delete holds it.
    const createPromise = createPage(
      {
        title: 'Offer',
        slug: 'offer',
        description: null,
        blocks: [{ type: 'gallery', fileIds: [FILE_ID] }],
      },
      actor,
    );
    await sleep(50);

    softDeleteGate.resolve();
    const [deleteResult, createResult] = await Promise.allSettled([deletePromise, createPromise]);

    expect(deleteResult.status).toBe('fulfilled');
    expect(createResult.status).toBe('rejected');
    expect((createResult as PromiseRejectedResult).reason).toMatchObject({
      statusCode: 404,
      message: expect.stringContaining(FILE_ID),
    });
    expect(unlink).toHaveBeenCalledWith('/uploads/files/race-1.pdf');
    expect([...state.pages.values()].some((p) => p.slug === 'offer')).toBe(false);
    expectNoDanglingReferences();
  });

  it('page create holding the lock wins: a concurrent delete is blocked naming the page', async () => {
    const insertGate = deferred();
    state.insertPageGate = insertGate;

    // Create acquires the sorted lifecycle locks, re-reads the live file,
    // and parks inside its critical section before inserting.
    const createPromise = createPage(
      {
        title: 'Offer',
        slug: 'offer',
        description: null,
        blocks: [{ type: 'attachment', fileId: FILE_ID, label: 'Brochure' }],
      },
      actor,
    );
    await sleep(50);

    // Delete now runs up to the lock and waits while create holds it.
    const deletePromise = removeFile(FILE_ID, actor);
    await sleep(50);

    insertGate.resolve();
    const [createResult, deleteResult] = await Promise.allSettled([createPromise, deletePromise]);

    expect(createResult.status).toBe('fulfilled');
    expect(deleteResult.status).toBe('rejected');
    const reason = (deleteResult as PromiseRejectedResult).reason as AppError & {
      meta?: { references?: { pages?: Array<{ title: string }> } };
    };
    expect(reason).toMatchObject({ statusCode: 409 });
    expect(reason.meta?.references?.pages?.[0]?.title).toBe('Offer');
    expect(unlink).not.toHaveBeenCalled();
    expect(state.files.get(FILE_ID)?.deleted).toBe(false);
    expectNoDanglingReferences();
  });

  it('page update holding the lock wins: a concurrent delete is blocked naming the page', async () => {
    const updateGate = deferred();
    state.updatePageGate = updateGate;

    // Update rewrites the blocks while holding the sorted lifecycle locks.
    const updatePromise = updatePage(
      PAGE_ID,
      { blocks: [{ type: 'gallery', fileIds: [FILE_ID] }] },
      actor,
    );
    await sleep(50);

    const deletePromise = removeFile(FILE_ID, actor);
    await sleep(50);

    updateGate.resolve();
    const [updateResult, deleteResult] = await Promise.allSettled([updatePromise, deletePromise]);

    expect(updateResult.status).toBe('fulfilled');
    expect(deleteResult.status).toBe('rejected');
    const reason = (deleteResult as PromiseRejectedResult).reason as AppError & {
      meta?: { references?: { pages?: Array<{ title: string }> } };
    };
    expect(reason).toMatchObject({ statusCode: 409 });
    expect(reason.meta?.references?.pages?.[0]?.title).toBe('Race page');
    expect(unlink).not.toHaveBeenCalled();
    expectNoDanglingReferences();
  });
});

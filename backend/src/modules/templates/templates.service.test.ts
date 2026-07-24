import {
  createTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
  approveTemplate,
  removeTemplate,
  addTemplateAttachment,
  addTemplateAttachmentFromLibrary,
  removeTemplateAttachment,
} from './templates.service';
import { TemplateRow } from './templates.types';

jest.mock('./templates.repository', () => ({
  findTemplates: jest.fn(),
  findTemplateById: jest.fn(),
  insertTemplate: jest.fn(),
  updateTemplate: jest.fn(),
  setApprovalStatus: jest.fn(),
  deleteTemplate: jest.fn(),
  appendTemplateAttachment: jest.fn(),
  removeTemplateAttachment: jest.fn(),
}));

jest.mock('../../shared/utils/audit', () => ({ writeAuditLog: jest.fn() }));
jest.mock('fs/promises', () => ({
  unlink: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../files/files.service', () => ({ getFileRow: jest.fn() }));

import {
  findTemplates,
  findTemplateById,
  insertTemplate,
  updateTemplate as updateTemplateRepo,
  setApprovalStatus,
  deleteTemplate,
  appendTemplateAttachment,
  removeTemplateAttachment as removeTemplateAttachmentRepo,
} from './templates.repository';
import { writeAuditLog } from '../../shared/utils/audit';
import { unlink, writeFile } from 'fs/promises';
import { getFileRow } from '../files/files.service';

const actor = { id: 'u1', role: 'admin', ipAddress: '127.0.0.1' };

const baseRow: TemplateRow = {
  id: 't1',
  name: 'Welcome Email',
  channel: 'email',
  subject: 'Welcome',
  body: 'Hello {{name}}',
  variables: ['name'],
  approval_status: 'pending',
  approved_by: null,
  approved_at: null,
  rejection_reason: null,
  attachments: [],
  created_by: 'u1',
  created_at: '2026-06-19T00:00:00Z',
  updated_at: '2026-06-19T00:00:00Z',
};

describe('listTemplates', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns paginated items with hasMore true when extra row fetched', async () => {
    // Repository trims to limit and sets hasMore=true when extra row was fetched.
    const rows = [{ ...baseRow, id: 't1' }];
    (findTemplates as jest.Mock).mockResolvedValue({ rows, hasMore: true });
    const result = await listTemplates({ limit: 1 });
    expect(result.items).toHaveLength(1);
    expect(result.meta.hasMore).toBe(true);
    expect(result.meta.nextCursor).toBeTruthy();
  });

  it('returns empty list when no templates', async () => {
    (findTemplates as jest.Mock).mockResolvedValue({ rows: [], hasMore: false });
    const result = await listTemplates({ limit: 20 });
    expect(result.items).toHaveLength(0);
    expect(result.meta.hasMore).toBe(false);
  });
});

describe('getTemplate', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws 404 when template not found', async () => {
    (findTemplateById as jest.Mock).mockResolvedValue(null);
    await expect(getTemplate('missing')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns template when found', async () => {
    (findTemplateById as jest.Mock).mockResolvedValue(baseRow);
    const result = await getTemplate(baseRow.id);
    expect(result.id).toBe(baseRow.id);
    expect(result.name).toBe(baseRow.name);
  });
});

describe('createTemplate', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates and audits new template', async () => {
    (insertTemplate as jest.Mock).mockResolvedValue(baseRow);
    const result = await createTemplate(
      { name: 'Welcome Email', channel: 'email', body: 'Hello', variables: ['name'] },
      actor,
    );
    expect(result.id).toBe(baseRow.id);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'template.created', entityId: baseRow.id }),
    );
  });
});

describe('updateTemplate', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws 404 when template missing', async () => {
    (findTemplateById as jest.Mock).mockResolvedValue(null);
    await expect(updateTemplate('x', { name: 'X' }, actor)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('allows admin to edit approved template', async () => {
    const approved = { ...baseRow, approval_status: 'approved' as const };
    (findTemplateById as jest.Mock).mockResolvedValue(approved);
    (updateTemplateRepo as jest.Mock).mockResolvedValue({ ...approved, name: 'Updated' });
    const result = await updateTemplate(approved.id, { name: 'Updated' }, actor);
    expect(result.name).toBe('Updated');
  });

  it('forbids non-admin from editing approved template', async () => {
    const approved = { ...baseRow, approval_status: 'approved' as const };
    (findTemplateById as jest.Mock).mockResolvedValue(approved);
    await expect(
      updateTemplate(approved.id, { name: 'Updated' }, { id: 'u2', role: 'marketing' }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('allows marketing to edit pending template', async () => {
    (findTemplateById as jest.Mock).mockResolvedValue(baseRow);
    (updateTemplateRepo as jest.Mock).mockResolvedValue({ ...baseRow, name: 'Updated' });
    const result = await updateTemplate(
      baseRow.id,
      { name: 'Updated' },
      { id: 'u2', role: 'marketing' },
    );
    expect(result.name).toBe('Updated');
  });
});

describe('approveTemplate', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws 409 when approving already approved template', async () => {
    const approved = { ...baseRow, approval_status: 'approved' as const };
    (findTemplateById as jest.Mock).mockResolvedValue(approved);
    await expect(approveTemplate(baseRow.id, { approved: true }, actor)).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('approves pending template and audits', async () => {
    (findTemplateById as jest.Mock).mockResolvedValue(baseRow);
    (setApprovalStatus as jest.Mock).mockResolvedValue({
      ...baseRow,
      approval_status: 'approved',
      approved_by: actor.id,
    });
    const result = await approveTemplate(baseRow.id, { approved: true }, actor);
    expect(result.approval_status).toBe('approved');
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'template.approved', entityId: baseRow.id }),
    );
  });

  it('rejects template with reason and audits', async () => {
    (findTemplateById as jest.Mock).mockResolvedValue(baseRow);
    (setApprovalStatus as jest.Mock).mockResolvedValue({
      ...baseRow,
      approval_status: 'rejected',
      rejection_reason: 'Bad grammar',
    });
    const result = await approveTemplate(
      baseRow.id,
      { approved: false, rejection_reason: 'Bad grammar' },
      actor,
    );
    expect(result.approval_status).toBe('rejected');
    expect(result.rejection_reason).toBe('Bad grammar');
  });
});

describe('removeTemplate', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws 404 when template missing', async () => {
    (findTemplateById as jest.Mock).mockResolvedValue(null);
    await expect(removeTemplate('x', actor)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('deletes and audits', async () => {
    (findTemplateById as jest.Mock).mockResolvedValue(baseRow);
    (deleteTemplate as jest.Mock).mockResolvedValue(undefined);
    await removeTemplate(baseRow.id, actor);
    expect(deleteTemplate).toHaveBeenCalledWith(baseRow.id);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'template.deleted', entityId: baseRow.id }),
    );
  });

  it('cleans up attachment files from disk when the template had any', async () => {
    const withAttachments: TemplateRow = {
      ...baseRow,
      attachments: [
        {
          id: 'a1',
          filename: 'flyer.png',
          mimeType: 'image/png',
          sizeBytes: 1234,
          url: 'http://localhost:3000/uploads/templates/a1.png',
          storagePath: '/srv/uploads/templates/a1.png',
        },
      ],
    };
    (findTemplateById as jest.Mock).mockResolvedValue(withAttachments);
    (deleteTemplate as jest.Mock).mockResolvedValue(undefined);
    await removeTemplate(withAttachments.id, actor);
    expect(unlink).toHaveBeenCalledWith('/srv/uploads/templates/a1.png');
  });

  it('never unlinks a library-referenced attachment file', async () => {
    const withLibraryAttachment: TemplateRow = {
      ...baseRow,
      attachments: [
        {
          id: 'a1',
          filename: 'brochure.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 4096,
          url: 'http://localhost:3000/uploads/files/lib-1.pdf',
          storagePath: '/srv/uploads/files/lib-1.pdf',
          libraryFileId: 'lib-1',
        },
      ],
    };
    (findTemplateById as jest.Mock).mockResolvedValue(withLibraryAttachment);
    (deleteTemplate as jest.Mock).mockResolvedValue(undefined);
    await removeTemplate(withLibraryAttachment.id, actor);
    expect(unlink).not.toHaveBeenCalled();
  });
});

describe('addTemplateAttachment', () => {
  beforeEach(() => jest.clearAllMocks());

  const file = {
    originalname: 'flyer.png',
    mimetype: 'image/png',
    size: 2048,
    buffer: Buffer.from('fake-image-bytes'),
  };

  it('throws 404 when template missing', async () => {
    (findTemplateById as jest.Mock).mockResolvedValue(null);
    await expect(addTemplateAttachment('missing', file, actor)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('rejects edits to an approved template from a non-admin', async () => {
    (findTemplateById as jest.Mock).mockResolvedValue({ ...baseRow, approval_status: 'approved' });
    await expect(
      addTemplateAttachment(baseRow.id, file, { ...actor, role: 'marketing' }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('rejects an unsupported mime type', async () => {
    (findTemplateById as jest.Mock).mockResolvedValue(baseRow);
    await expect(
      addTemplateAttachment(baseRow.id, { ...file, mimetype: 'application/zip' }, actor),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects once the per-template attachment limit is reached', async () => {
    const full: TemplateRow = {
      ...baseRow,
      attachments: [1, 2, 3].map((n) => ({
        id: `a${n}`,
        filename: `f${n}.png`,
        mimeType: 'image/png',
        sizeBytes: 10,
        url: `http://x/${n}.png`,
        storagePath: `/x/${n}.png`,
      })),
    };
    (findTemplateById as jest.Mock).mockResolvedValue(full);
    await expect(addTemplateAttachment(full.id, file, actor)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('writes the file to disk and appends it to the template, then audits', async () => {
    (findTemplateById as jest.Mock).mockResolvedValue(baseRow);
    const updatedRow: TemplateRow = {
      ...baseRow,
      attachments: [
        {
          id: 'new-id',
          filename: 'flyer.png',
          mimeType: 'image/png',
          sizeBytes: 2048,
          url: 'http://localhost:3000/uploads/templates/new-id.png',
          storagePath: '/x/new-id.png',
        },
      ],
    };
    (appendTemplateAttachment as jest.Mock).mockResolvedValue(updatedRow);

    const result = await addTemplateAttachment(baseRow.id, file, actor);

    expect(writeFile).toHaveBeenCalled();
    expect(appendTemplateAttachment).toHaveBeenCalledWith(
      baseRow.id,
      expect.objectContaining({ filename: 'flyer.png', mimeType: 'image/png', sizeBytes: 2048 }),
    );
    expect(result.attachments).toEqual([
      { id: 'new-id', filename: 'flyer.png', mimeType: 'image/png', sizeBytes: 2048, url: updatedRow.attachments[0].url },
    ]);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'template.attachment_added' }),
    );
  });
});

describe('addTemplateAttachmentFromLibrary', () => {
  beforeEach(() => jest.clearAllMocks());

  const libraryFile = {
    id: 'lib-1',
    filename: 'brochure.pdf',
    mime_type: 'application/pdf',
    size_bytes: 4096,
    storage_path: '/x/uploads/files/lib-1.pdf',
    url: 'http://localhost:3000/uploads/files/lib-1.pdf',
    tags: [],
    created_by: 'u1',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
  };

  it('throws 404 when template missing', async () => {
    (findTemplateById as jest.Mock).mockResolvedValue(null);
    await expect(
      addTemplateAttachmentFromLibrary('missing', 'lib-1', actor),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects edits to an approved template from a non-admin', async () => {
    (findTemplateById as jest.Mock).mockResolvedValue({ ...baseRow, approval_status: 'approved' });
    await expect(
      addTemplateAttachmentFromLibrary(baseRow.id, 'lib-1', { ...actor, role: 'marketing' }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('rejects once the per-template attachment limit is reached', async () => {
    const full: TemplateRow = {
      ...baseRow,
      attachments: [1, 2, 3].map((n) => ({
        id: `a${n}`,
        filename: `f${n}.png`,
        mimeType: 'image/png',
        sizeBytes: 10,
        url: `http://x/${n}.png`,
        storagePath: `/x/${n}.png`,
      })),
    };
    (findTemplateById as jest.Mock).mockResolvedValue(full);
    await expect(
      addTemplateAttachmentFromLibrary(full.id, 'lib-1', actor),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('appends a reference attachment carrying the library storagePath, then audits', async () => {
    (findTemplateById as jest.Mock).mockResolvedValue(baseRow);
    (getFileRow as jest.Mock).mockResolvedValue(libraryFile);
    const updatedRow: TemplateRow = {
      ...baseRow,
      attachments: [
        {
          id: 'new-id',
          filename: 'brochure.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 4096,
          url: libraryFile.url,
          storagePath: libraryFile.storage_path,
          libraryFileId: 'lib-1',
        },
      ],
    };
    (appendTemplateAttachment as jest.Mock).mockResolvedValue(updatedRow);

    const result = await addTemplateAttachmentFromLibrary(baseRow.id, 'lib-1', actor);

    expect(appendTemplateAttachment).toHaveBeenCalledWith(
      baseRow.id,
      expect.objectContaining({
        filename: 'brochure.pdf',
        libraryFileId: 'lib-1',
        storagePath: libraryFile.storage_path,
      }),
    );
    expect(result.attachments[0]).toMatchObject({ filename: 'brochure.pdf', libraryFileId: 'lib-1' });
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'template.attachment_added_from_library' }),
    );
  });
});

describe('removeTemplateAttachment', () => {
  beforeEach(() => jest.clearAllMocks());

  const rowWithAttachment: TemplateRow = {
    ...baseRow,
    attachments: [
      {
        id: 'a1',
        filename: 'flyer.png',
        mimeType: 'image/png',
        sizeBytes: 1234,
        url: 'http://localhost:3000/uploads/templates/a1.png',
        storagePath: '/x/a1.png',
      },
    ],
  };

  it('throws 404 when template missing', async () => {
    (findTemplateById as jest.Mock).mockResolvedValue(null);
    await expect(removeTemplateAttachment('missing', 'a1', actor)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('throws 404 when the attachment id does not belong to the template', async () => {
    (findTemplateById as jest.Mock).mockResolvedValue(rowWithAttachment);
    await expect(
      removeTemplateAttachment(rowWithAttachment.id, 'not-there', actor),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('removes the attachment, deletes the file, and audits', async () => {
    (findTemplateById as jest.Mock).mockResolvedValue(rowWithAttachment);
    (removeTemplateAttachmentRepo as jest.Mock).mockResolvedValue(baseRow);

    const result = await removeTemplateAttachment(rowWithAttachment.id, 'a1', actor);

    expect(removeTemplateAttachmentRepo).toHaveBeenCalledWith(rowWithAttachment.id, 'a1');
    expect(unlink).toHaveBeenCalledWith('/x/a1.png');
    expect(result.attachments).toEqual([]);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'template.attachment_removed' }),
    );
  });
});

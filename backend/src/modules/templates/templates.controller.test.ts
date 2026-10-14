import { jest, describe, it, expect, beforeEach } from '@jest/globals';

jest.mock('./templates.service', () => ({
  listTemplates: jest.fn(),
  getTemplate: jest.fn(),
  createTemplate: jest.fn(),
  updateTemplate: jest.fn(),
  approveTemplate: jest.fn(),
  removeTemplate: jest.fn(),
  addTemplateAttachment: jest.fn(),
  addTemplateAttachmentFromLibrary: jest.fn(),
  removeTemplateAttachment: jest.fn(),
  duplicateTemplate: jest.fn(),
  setTemplateArchived: jest.fn(),
  previewTemplate: jest.fn(),
  testSendTemplate: jest.fn(),
}));

import * as templatesService from './templates.service';
import {
  listTemplatesHandler,
  getTemplateHandler,
  createTemplateHandler,
  updateTemplateHandler,
  approveTemplateHandler,
  deleteTemplateHandler,
  addTemplateAttachmentHandler,
  addTemplateAttachmentFromLibraryHandler,
  removeTemplateAttachmentHandler,
  duplicateTemplateHandler,
  archiveTemplateHandler,
  unarchiveTemplateHandler,
  renameTemplateHandler,
  previewTemplateHandler,
  testSendTemplateHandler,
} from './templates.controller';

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

beforeEach(() => { jest.clearAllMocks(); });

describe('listTemplatesHandler', () => {
  it('returns templates', async () => {
    (templatesService.listTemplates as jest.Mock<any>).mockResolvedValue({
      items: [{ id: 't1' }],
      meta: { hasMore: false },
    });
    const res = mockRes();
    await listTemplatesHandler(mockReq(), res, next);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('getTemplateHandler', () => {
  it('returns template', async () => {
    (templatesService.getTemplate as jest.Mock<any>).mockResolvedValue({ id: 't1' });
    const res = mockRes();
    await getTemplateHandler(mockReq({ params: { id: '123e4567-e89b-12d3-a456-426614174000' } }), res, next);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('calls next on error', async () => {
    (templatesService.getTemplate as jest.Mock<any>).mockRejectedValue(new Error('not found'));
    await getTemplateHandler(mockReq({ params: { id: '00000000-0000-0000-0000-000000000000' } }), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });
});

describe('createTemplateHandler', () => {
  it('creates template', async () => {
    (templatesService.createTemplate as jest.Mock<any>).mockResolvedValue({ id: 't1' });
    const res = mockRes();
    await createTemplateHandler(
      mockReq({ body: { name: 'Test', channel: 'email', body: 'Hello' } }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('updateTemplateHandler', () => {
  it('updates template', async () => {
    (templatesService.updateTemplate as jest.Mock<any>).mockResolvedValue({ id: 't1', name: 'Updated' });
    const res = mockRes();
    await updateTemplateHandler(
      mockReq({ params: { id: '123e4567-e89b-12d3-a456-426614174000' }, body: { name: 'Updated' } }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('approveTemplateHandler', () => {
  it('approves template', async () => {
    (templatesService.approveTemplate as jest.Mock<any>).mockResolvedValue({
      id: 't1',
      approval_status: 'approved',
    });
    const res = mockRes();
    await approveTemplateHandler(
      mockReq({ params: { id: '123e4567-e89b-12d3-a456-426614174000' }, body: { approved: true } }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('deleteTemplateHandler', () => {
  it('deletes template', async () => {
    (templatesService.removeTemplate as jest.Mock<any>).mockResolvedValue(undefined);
    const res = mockRes();
    await deleteTemplateHandler(mockReq({ params: { id: '123e4567-e89b-12d3-a456-426614174000' } }), res, next);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('addTemplateAttachmentHandler', () => {
  const validId = '123e4567-e89b-12d3-a456-426614174000';

  it('uploads attachment and returns 201', async () => {
    const mockFile = { originalname: 'test.png', mimetype: 'image/png', size: 1024, buffer: Buffer.from('') };
    (templatesService.addTemplateAttachment as jest.Mock<any>).mockResolvedValue({ id: 't1' });
    const res = mockRes();
    await addTemplateAttachmentHandler(
      mockReq({ params: { id: validId }, file: mockFile }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(templatesService.addTemplateAttachment).toHaveBeenCalledWith(validId, mockFile, expect.any(Object));
  });

  it('returns 400 when no file uploaded', async () => {
    const res = mockRes();
    await addTemplateAttachmentHandler(
      mockReq({ params: { id: validId } }),
      res,
      next,
    );
    expect(next).toHaveBeenCalled();
  });
});

describe('addTemplateAttachmentFromLibraryHandler', () => {
  const validId = '123e4567-e89b-12d3-a456-426614174000';
  const validFileId = '223e4567-e89b-12d3-a456-426614174000';

  it('attaches from library and returns 201', async () => {
    (templatesService.addTemplateAttachmentFromLibrary as jest.Mock<any>).mockResolvedValue({ id: 't1' });
    const res = mockRes();
    await addTemplateAttachmentFromLibraryHandler(
      mockReq({ params: { id: validId }, body: { file_id: validFileId } }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(templatesService.addTemplateAttachmentFromLibrary).toHaveBeenCalledWith(validId, validFileId, expect.any(Object));
  });

  it('returns error on invalid file_id', async () => {
    const res = mockRes();
    await addTemplateAttachmentFromLibraryHandler(
      mockReq({ params: { id: validId }, body: { file_id: 'not-a-uuid' } }),
      res,
      next,
    );
    expect(next).toHaveBeenCalled();
  });
});

describe('removeTemplateAttachmentHandler', () => {
  const validId = '123e4567-e89b-12d3-a456-426614174000';
  const validAttachmentId = '323e4567-e89b-12d3-a456-426614174000';

  it('removes attachment and returns 200', async () => {
    (templatesService.removeTemplateAttachment as jest.Mock<any>).mockResolvedValue({ id: 't1' });
    const res = mockRes();
    await removeTemplateAttachmentHandler(
      mockReq({ params: { id: validId, attachmentId: validAttachmentId } }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(templatesService.removeTemplateAttachment).toHaveBeenCalledWith(validId, validAttachmentId, expect.any(Object));
  });

  it('returns error on invalid attachmentId', async () => {
    const res = mockRes();
    await removeTemplateAttachmentHandler(
      mockReq({ params: { id: validId, attachmentId: 'not-a-uuid' } }),
      res,
      next,
    );
    expect(next).toHaveBeenCalled();
  });
});

describe('duplicateTemplateHandler', () => {
  const validId = '123e4567-e89b-12d3-a456-426614174000';

  it('duplicates and returns 201 without a name', async () => {
    (templatesService.duplicateTemplate as jest.Mock<any>).mockResolvedValue({ id: 't2' });
    const res = mockRes();
    await duplicateTemplateHandler(mockReq({ params: { id: validId }, body: {} }), res, next);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(templatesService.duplicateTemplate).toHaveBeenCalledWith(validId, undefined, expect.any(Object));
  });

  it('rejects invalid ids', async () => {
    await duplicateTemplateHandler(mockReq({ params: { id: 'nope' }, body: {} }), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });
});

describe('archiveTemplateHandler + unarchiveTemplateHandler', () => {
  const validId = '123e4567-e89b-12d3-a456-426614174000';

  it('archives with 200', async () => {
    (templatesService.setTemplateArchived as jest.Mock<any>).mockResolvedValue({ id: validId });
    const res = mockRes();
    await archiveTemplateHandler(mockReq({ params: { id: validId } }), res, next);
    expect(templatesService.setTemplateArchived).toHaveBeenCalledWith(validId, true, expect.any(Object));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('unarchives with 200', async () => {
    (templatesService.setTemplateArchived as jest.Mock<any>).mockResolvedValue({ id: validId });
    const res = mockRes();
    await unarchiveTemplateHandler(mockReq({ params: { id: validId } }), res, next);
    expect(templatesService.setTemplateArchived).toHaveBeenCalledWith(validId, false, expect.any(Object));
  });
});

describe('renameTemplateHandler', () => {
  const validId = '123e4567-e89b-12d3-a456-426614174000';

  it('renames through updateTemplate with only the name field', async () => {
    (templatesService.updateTemplate as jest.Mock<any>).mockResolvedValue({ id: validId });
    const res = mockRes();
    await renameTemplateHandler(mockReq({ params: { id: validId }, body: { name: 'New name' } }), res, next);
    expect(templatesService.updateTemplate).toHaveBeenCalledWith(validId, { name: 'New name' }, expect.any(Object));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('requires a name', async () => {
    await renameTemplateHandler(mockReq({ params: { id: validId }, body: {} }), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });
});

describe('previewTemplateHandler', () => {
  const validId = '123e4567-e89b-12d3-a456-426614174000';

  it('previews without requiring authentication side effects', async () => {
    (templatesService.previewTemplate as jest.Mock<any>).mockResolvedValue({ text: 'hi' });
    const res = mockRes();
    await previewTemplateHandler(mockReq({ params: { id: validId }, body: {} }), res, next);
    expect(templatesService.previewTemplate).toHaveBeenCalledWith(validId, undefined);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('testSendTemplateHandler', () => {
  const validId = '123e4567-e89b-12d3-a456-426614174000';

  it('sends to the authorized recipient', async () => {
    (templatesService.testSendTemplate as jest.Mock<any>).mockResolvedValue({ sent: true });
    const res = mockRes();
    await testSendTemplateHandler(
      mockReq({ params: { id: validId }, body: { to: 'owner@example.com' } }),
      res,
      next,
    );
    expect(templatesService.testSendTemplate).toHaveBeenCalledWith(
      validId,
      'owner@example.com',
      undefined,
      expect.any(Object),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rejects invalid recipient addresses before any service call', async () => {
    await testSendTemplateHandler(
      mockReq({ params: { id: validId }, body: { to: 'not-an-email' } }),
      mockRes(),
      next,
    );
    expect(templatesService.testSendTemplate).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});

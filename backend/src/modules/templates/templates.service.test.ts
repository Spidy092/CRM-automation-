import {
  createTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
  approveTemplate,
  removeTemplate,
} from './templates.service';
import { TemplateRow } from './templates.types';

jest.mock('./templates.repository', () => ({
  findTemplates: jest.fn(),
  findTemplateById: jest.fn(),
  insertTemplate: jest.fn(),
  updateTemplate: jest.fn(),
  setApprovalStatus: jest.fn(),
  deleteTemplate: jest.fn(),
}));

jest.mock('../../shared/utils/audit', () => ({ writeAuditLog: jest.fn() }));

import {
  findTemplates,
  findTemplateById,
  insertTemplate,
  updateTemplate as updateTemplateRepo,
  setApprovalStatus,
  deleteTemplate,
} from './templates.repository';
import { writeAuditLog } from '../../shared/utils/audit';

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
});

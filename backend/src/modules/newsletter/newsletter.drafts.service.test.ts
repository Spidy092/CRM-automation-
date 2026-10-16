import { AppError } from '../../shared/middleware/errorHandler';
import * as repository from './newsletter.drafts.repository';
import { triggerBroadcast } from './newsletter.service';
import { list, save, remove, send } from './newsletter.drafts.service';

jest.mock('./newsletter.drafts.repository', () => ({
  listDrafts: jest.fn(), findDraft: jest.fn(), createDraft: jest.fn(),
  updateDraft: jest.fn(), deleteDraft: jest.fn(), claimDraft: jest.fn(), finishDraft: jest.fn(),
}));
jest.mock('./newsletter.service', () => ({ triggerBroadcast: jest.fn() }));
const repo = repository as jest.Mocked<typeof repository>;
const trigger = triggerBroadcast as jest.MockedFunction<typeof triggerBroadcast>;
const row: repository.NewsletterDraftRow = {
  id: '550e8400-e29b-41d4-a716-446655440099',
  content: { subject: 'Hello', htmlBody: '<p>World</p>', timezone: 'Asia/Kolkata' },
  revision: 2, status: 'draft', created_by: 'admin-1', broadcast_id: null,
  created_at: '2026-10-15T00:00:00.000Z', updated_at: '2026-10-15T00:00:00.000Z',
};

describe('newsletter drafts service', () => {
  beforeEach(() => jest.clearAllMocks());
  it('lists drafts through its repository', async () => {
    repo.listDrafts.mockResolvedValue([row]);
    expect(await list(25, 0)).toEqual({ ok: true, value: [row] });
  });
  it('creates and revision-updates drafts', async () => {
    repo.createDraft.mockResolvedValue(row);
    repo.updateDraft.mockResolvedValue({ ...row, revision: 3 });
    expect(await save(row.content, 'admin-1')).toEqual({ ok: true, value: row });
    expect(await save(row.content, 'admin-1', row.id, row.revision)).toMatchObject({ ok: true, value: { revision: 3 } });
    expect(repo.updateDraft).toHaveBeenCalledWith(row.id, 2, row.content);
  });
  it('reports conflicts when an edited revision is stale', async () => {
    repo.updateDraft.mockResolvedValue(null);
    const result = await save(row.content, 'admin-1', row.id, 1);
    expect(result).toMatchObject({ ok: false, error: expect.any(AppError) });
  });
  it('deletes only the matching draft revision', async () => {
    repo.deleteDraft.mockResolvedValue(true);
    expect(await remove(row.id, 2)).toEqual({ ok: true, value: { deleted: true } });
    expect(repo.deleteDraft).toHaveBeenCalledWith(row.id, 2);
  });
  it('sends one frozen version with a stable idempotency key and marks it sent', async () => {
    repo.findDraft.mockResolvedValue(row);
    repo.claimDraft.mockResolvedValue(row);
    trigger.mockResolvedValue({ ok: true, value: { enqueued: true, broadcastId: 'broadcast-1' } });
    expect(await send(row.id, 2, 'admin-1')).toMatchObject({ ok: true, value: { enqueued: true } });
    expect(trigger).toHaveBeenCalledWith('Hello', '<p>World</p>', expect.objectContaining({ idempotencyKey: `draft-${row.id}-2` }), { id: 'admin-1' });
    expect(repo.finishDraft).toHaveBeenCalledWith(row.id, 2, 'broadcast-1');
  });
  it('keeps the frozen draft recoverable after an ambiguous enqueue failure', async () => {
    repo.findDraft.mockResolvedValue(row);
    repo.claimDraft.mockResolvedValue(row);
    trigger.mockResolvedValue({ ok: false, error: new AppError('queue unavailable', 503) });
    expect((await send(row.id, 2, 'admin-1')).ok).toBe(false);
    expect(repo.finishDraft).not.toHaveBeenCalled();
  });
});

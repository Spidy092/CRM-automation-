import { AppError } from '../../shared/middleware/errorHandler';
import { broadcastBodySchema, type NewsletterDraftContent } from './newsletter.schema';
import * as repository from './newsletter.drafts.repository';
import { triggerBroadcast } from './newsletter.service';
import type { NewsletterResult } from './newsletter.types';

type Draft = repository.NewsletterDraftRow;
function failure(err: unknown): { ok: false; error: AppError } {
  const missing = (err as { code?: string })?.code;
  return {
    ok: false,
    error:
      err instanceof AppError
        ? err
        : new AppError(
            missing === '42P01' || missing === '42703'
              ? 'Newsletter drafts require migration 0084. Ask an operator to apply it before continuing.'
              : 'Newsletter draft operation failed. Please retry.',
            missing === '42P01' || missing === '42703' ? 503 : 500,
          ),
  };
}
export async function list(
  limit: number,
  offset: number,
): Promise<NewsletterResult<Draft[], AppError>> {
  try {
    return { ok: true, value: await repository.listDrafts(limit, offset) };
  } catch (err) {
    return failure(err);
  }
}
export async function save(
  content: NewsletterDraftContent,
  actorId: string,
  id?: string,
  revision?: number,
): Promise<NewsletterResult<Draft, AppError>> {
  try {
    const row = id
      ? await repository.updateDraft(id, revision ?? 0, content)
      : await repository.createDraft(content, actorId);
    if (!row)
      return failure(
        new AppError('Draft changed or is already sending. Refresh before editing.', 409),
      );
    return { ok: true, value: row };
  } catch (err) {
    return failure(err);
  }
}
export async function remove(
  id: string,
  revision: number,
): Promise<NewsletterResult<{ deleted: boolean }, AppError>> {
  try {
    if (!(await repository.deleteDraft(id, revision)))
      return failure(
        new AppError('Draft changed or is already sending. Refresh before deleting.', 409),
      );
    return { ok: true, value: { deleted: true } };
  } catch (err) {
    return failure(err);
  }
}
export async function send(
  id: string,
  revision: number,
  actorId: string,
): Promise<Awaited<ReturnType<typeof triggerBroadcast>>> {
  try {
    const current = await repository.findDraft(id);
    if (!current) return failure(new AppError('Draft not found', 404));
    if (current.revision !== revision)
      return failure(new AppError('Draft changed. Refresh before sending.', 409));
    if (current.status === 'sent')
      return {
        ok: true,
        value: {
          enqueued: false,
          deduplicated: true,
          broadcastId: current.broadcast_id ?? undefined,
        },
      };
    const parsed = broadcastBodySchema.safeParse(current.content);
    if (!parsed.success)
      return failure(new AppError('Add a subject and content before sending this draft.', 422));
    if (!(await repository.claimDraft(id, revision)))
      return failure(new AppError('Draft changed. Refresh before sending.', 409));
    const result = await triggerBroadcast(
      parsed.data.subject,
      parsed.data.htmlBody,
      {
        ...parsed.data,
        idempotencyKey: `draft-${id}-${revision}`,
      },
      { id: actorId },
    );
    // Keep sending on any error: an enqueue response can be lost. The UI offers
    // retry using the frozen revision instead of editing potentially sent content.
    if (result.ok) await repository.finishDraft(id, revision, result.value.broadcastId);
    return result;
  } catch (err) {
    return failure(err);
  }
}

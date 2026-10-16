import { query, queryOne } from '../../shared/utils/db';
import type { NewsletterDraftContent } from './newsletter.schema';

export interface NewsletterDraftRow {
  id: string;
  content: NewsletterDraftContent;
  revision: number;
  status: 'draft' | 'sending' | 'sent';
  created_by: string;
  broadcast_id: string | null;
  created_at: string;
  updated_at: string;
}
const COLS = 'id, content, revision, status, created_by, broadcast_id, created_at, updated_at';

export async function listDrafts(limit: number, offset: number): Promise<NewsletterDraftRow[]> {
  return query<NewsletterDraftRow>(
    `SELECT ${COLS} FROM newsletter_drafts WHERE status <> 'sent'
     ORDER BY updated_at DESC, id DESC LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
}
export async function findDraft(id: string): Promise<NewsletterDraftRow | null> {
  return queryOne<NewsletterDraftRow>(`SELECT ${COLS} FROM newsletter_drafts WHERE id = $1`, [id]);
}
export async function createDraft(
  content: NewsletterDraftContent,
  actorId: string,
): Promise<NewsletterDraftRow | null> {
  return queryOne<NewsletterDraftRow>(
    `INSERT INTO newsletter_drafts (content, created_by) VALUES ($1::jsonb, $2) RETURNING ${COLS}`,
    [JSON.stringify(content), actorId],
  );
}
export async function updateDraft(
  id: string,
  revision: number,
  content: NewsletterDraftContent,
): Promise<NewsletterDraftRow | null> {
  return queryOne<NewsletterDraftRow>(
    `UPDATE newsletter_drafts SET content = $3::jsonb, revision = revision + 1, updated_at = now()
     WHERE id = $1 AND revision = $2 AND status = 'draft' RETURNING ${COLS}`,
    [id, revision, JSON.stringify(content)],
  );
}
export async function deleteDraft(id: string, revision: number): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `DELETE FROM newsletter_drafts WHERE id = $1 AND revision = $2 AND status = 'draft' RETURNING id`,
    [id, revision],
  );
  return row !== null;
}
/** Sending freezes the revision; retries always use the same immutable content/key. */
export async function claimDraft(id: string, revision: number): Promise<NewsletterDraftRow | null> {
  return queryOne<NewsletterDraftRow>(
    `UPDATE newsletter_drafts SET status = 'sending', updated_at = now()
     WHERE id = $1 AND revision = $2 AND status IN ('draft', 'sending') RETURNING ${COLS}`,
    [id, revision],
  );
}
export async function finishDraft(
  id: string,
  revision: number,
  broadcastId?: string,
): Promise<void> {
  await query(
    `UPDATE newsletter_drafts SET status = 'sent', broadcast_id = $3, updated_at = now()
    WHERE id = $1 AND revision = $2 AND status = 'sending'`,
    [id, revision, broadcastId ?? null],
  );
}

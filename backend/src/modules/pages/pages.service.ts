import { AppError } from '../../shared/middleware/errorHandler';
import { writeAuditLog } from '../../shared/utils/audit';
import { advisoryLockKey, withAdvisoryLocks } from '../../shared/utils/db';
import {
  countPageViews,
  findPageById,
  findPageBySlug,
  findPages,
  findPageViews,
  findPagesReferencingFile,
  findPublishedPageBySlug,
  insertPage,
  insertPageView,
  setPageStatus,
  softDeletePage,
  updatePage as updatePageRepo,
} from './pages.repository';
import {
  LandingPageActor,
  LandingPageInput,
  LandingPageResponse,
  PageViewRow,
  PublicFileRef,
  PublicLandingPageResponse,
} from './pages.types';
import { getFile } from '../files/files.service';

export async function listPages(): Promise<LandingPageResponse[]> {
  return findPages();
}

export async function getPage(id: string): Promise<LandingPageResponse> {
  const row = await findPageById(id);
  if (!row) throw new AppError('Page not found', 404);
  return row;
}

/**
 * Live pages whose gallery/attachment blocks reference a Files-library entry.
 * Consumed by the files module before deleting a library entry — deleting a
 * referenced file turns those blocks into "missing" renders.
 */
export async function findPagesUsingFile(
  fileId: string,
): Promise<Array<{ id: string; title: string }>> {
  return findPagesReferencingFile(fileId);
}

/** Collect every fileId referenced by gallery/attachment blocks, deduplicated. */
function collectFileIds(blocks: PublicLandingPageResponse['blocks']): string[] {
  const ids = new Set<string>();
  for (const block of blocks) {
    if (block.type === 'gallery') block.fileIds.forEach((id) => ids.add(id));
    if (block.type === 'attachment') ids.add(block.fileId);
  }
  return Array.from(ids);
}

/**
 * Referenced file ids in globally sorted order — the file-lifecycle protocol
 * requires sorted multi-key acquisition to stay deadlock-free.
 */
function sortedReferencedFileIds(blocks: PublicLandingPageResponse['blocks']): string[] {
  return collectFileIds(blocks).sort();
}

/**
 * Re-read every referenced file through the files service interface while
 * the caller holds the lifecycle locks. `getFile` already excludes
 * soft-deleted rows, so a missing/deleted file surfaces as 404, reworded to
 * name the dangling reference so the editor knows which block to drop.
 */
async function assertFilesLive(fileIds: string[]): Promise<void> {
  for (const fileId of fileIds) {
    try {
      await getFile(fileId);
    } catch (err) {
      if ((err as AppError | null)?.statusCode === 404) {
        throw new AppError(
          `Referenced file ${fileId} was not found or was deleted — remove it from the page blocks and try again`,
          404,
        );
      }
      throw err;
    }
  }
}

export async function getPublicPage(slug: string): Promise<PublicLandingPageResponse> {
  const row = await findPublishedPageBySlug(slug);
  if (!row) throw new AppError('Page not found', 404);

  const fileIds = collectFileIds(row.blocks);
  const resolved = await Promise.all(
    fileIds.map(async (id) => {
      try {
        const file = await getFile(id);
        return [id, { url: file.url, filename: file.filename, mimeType: file.mime_type }] as const;
      } catch {
        return null; // file was deleted since the block was saved — block renders as missing
      }
    }),
  );
  const files: Record<string, PublicFileRef> = {};
  for (const entry of resolved) {
    if (entry) files[entry[0]] = entry[1];
  }

  return {
    title: row.title,
    slug: row.slug,
    description: row.description,
    blocks: row.blocks,
    files,
  };
}

export async function recordPageView(
  slug: string,
  data: { leadId: string | null; ipAddress: string | null; userAgent: string | null },
): Promise<void> {
  const row = await findPublishedPageBySlug(slug);
  if (!row) return; // best-effort — public view logging never blocks the page render
  await insertPageView({
    page_id: row.id,
    lead_id: data.leadId,
    ip_address: data.ipAddress,
    user_agent: data.userAgent,
  });
}

export async function getPageViews(id: string): Promise<{ total: number; recent: PageViewRow[] }> {
  const page = await findPageById(id);
  if (!page) throw new AppError('Page not found', 404);
  const [total, recent] = await Promise.all([countPageViews(id), findPageViews(id)]);
  return { total, recent };
}

export async function createPage(
  input: LandingPageInput,
  actor: LandingPageActor,
): Promise<LandingPageResponse> {
  const existing = await findPageBySlug(input.slug);
  if (existing) throw new AppError(`Slug "${input.slug}" is already in use`, 409);

  // File-lifecycle protocol: every file referenced by the new blocks is
  // locked (sorted — see withAdvisoryLocks) and re-read while locked, so a
  // concurrent file deletion either commits first (re-read 404s here, never
  // a dangling block) or lands after this insert commits (and its reference
  // re-check then blocks with 409). Reads go through the files service
  // interface, which already excludes soft-deleted rows.
  const fileIds = sortedReferencedFileIds(input.blocks ?? []);
  const row = await withAdvisoryLocks(
    fileIds.map((id) => advisoryLockKey('file-lifecycle', id)),
    async () => {
      await assertFilesLive(fileIds);
      return insertPage({
        title: input.title,
        slug: input.slug,
        description: input.description ?? null,
        blocks: input.blocks ?? [],
        created_by: actor.id,
      });
    },
  );

  await writeAuditLog({
    userId: actor.id,
    action: 'page.created',
    entityType: 'landing_page',
    entityId: row.id,
    newValue: { title: row.title, slug: row.slug },
    ipAddress: actor.ipAddress ?? null,
  });

  return row;
}

export async function updatePage(
  id: string,
  input: Partial<LandingPageInput>,
  actor: LandingPageActor,
): Promise<LandingPageResponse> {
  const before = await findPageById(id);
  if (!before) throw new AppError('Page not found', 404);

  if (input.slug && input.slug !== before.slug) {
    const existing = await findPageBySlug(input.slug);
    if (existing) throw new AppError(`Slug "${input.slug}" is already in use`, 409);
  }

  // Same lifecycle protocol as createPage, applied only when the blocks
  // themselves are rewritten — title/slug/description edits take the
  // lock-free fast path. Writing the full block set re-validates every
  // reference, so a page holding a previously deleted file must drop that
  // block before any other block edit can save (the editor already renders
  // such blocks as missing / unselected).
  const fileIds = input.blocks !== undefined ? sortedReferencedFileIds(input.blocks) : [];
  const row = await withAdvisoryLocks(
    fileIds.map((id) => advisoryLockKey('file-lifecycle', id)),
    async () => {
      await assertFilesLive(fileIds);
      return updatePageRepo(id, input);
    },
  );

  await writeAuditLog({
    userId: actor.id,
    action: 'page.updated',
    entityType: 'landing_page',
    entityId: id,
    oldValue: { title: before.title, slug: before.slug },
    newValue: { title: row.title, slug: row.slug },
    ipAddress: actor.ipAddress ?? null,
  });

  return row;
}

export async function publishPage(
  id: string,
  actor: LandingPageActor,
): Promise<LandingPageResponse> {
  const before = await findPageById(id);
  if (!before) throw new AppError('Page not found', 404);

  const row = await setPageStatus(id, 'published');

  await writeAuditLog({
    userId: actor.id,
    action: 'page.published',
    entityType: 'landing_page',
    entityId: id,
    oldValue: { status: before.status },
    newValue: { status: row.status },
    ipAddress: actor.ipAddress ?? null,
  });

  return row;
}

export async function unpublishPage(
  id: string,
  actor: LandingPageActor,
): Promise<LandingPageResponse> {
  const before = await findPageById(id);
  if (!before) throw new AppError('Page not found', 404);

  const row = await setPageStatus(id, 'draft');

  await writeAuditLog({
    userId: actor.id,
    action: 'page.unpublished',
    entityType: 'landing_page',
    entityId: id,
    oldValue: { status: before.status },
    newValue: { status: row.status },
    ipAddress: actor.ipAddress ?? null,
  });

  return row;
}

export async function removePage(id: string, actor: LandingPageActor): Promise<void> {
  const before = await findPageById(id);
  if (!before) throw new AppError('Page not found', 404);

  await softDeletePage(id);

  await writeAuditLog({
    userId: actor.id,
    action: 'page.deleted',
    entityType: 'landing_page',
    entityId: id,
    oldValue: { title: before.title, slug: before.slug },
    ipAddress: actor.ipAddress ?? null,
  });
}

import { AppError } from '../../shared/middleware/errorHandler';
import { writeAuditLog } from '../../shared/utils/audit';
import {
  countPageViews,
  findPageById,
  findPageBySlug,
  findPages,
  findPageViews,
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

/** Collect every fileId referenced by gallery/attachment blocks, deduplicated. */
function collectFileIds(blocks: PublicLandingPageResponse['blocks']): string[] {
  const ids = new Set<string>();
  for (const block of blocks) {
    if (block.type === 'gallery') block.fileIds.forEach((id) => ids.add(id));
    if (block.type === 'attachment') ids.add(block.fileId);
  }
  return Array.from(ids);
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

  return { title: row.title, slug: row.slug, description: row.description, blocks: row.blocks, files };
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

export async function getPageViews(
  id: string,
): Promise<{ total: number; recent: PageViewRow[] }> {
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

  const row = await insertPage({
    title: input.title,
    slug: input.slug,
    description: input.description ?? null,
    blocks: input.blocks ?? [],
    created_by: actor.id,
  });

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

  const row = await updatePageRepo(id, input);

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

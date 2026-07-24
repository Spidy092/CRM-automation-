import { query, queryOne } from '../../shared/utils/db';
import { AppError } from '../../shared/middleware/errorHandler';
import { LandingPageRow, PageBlock, PageViewRow } from './pages.types';

const COLS = `id, title, slug, description, blocks, status, created_by, created_at, updated_at`;

export async function findPages(): Promise<LandingPageRow[]> {
  return query<LandingPageRow>(
    `SELECT ${COLS} FROM landing_pages WHERE deleted_at IS NULL ORDER BY created_at DESC`,
  );
}

export async function findPageById(id: string): Promise<LandingPageRow | null> {
  return queryOne<LandingPageRow>(
    `SELECT ${COLS} FROM landing_pages WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
}

export async function findPublishedPageBySlug(slug: string): Promise<LandingPageRow | null> {
  return queryOne<LandingPageRow>(
    `SELECT ${COLS} FROM landing_pages WHERE slug = $1 AND status = 'published' AND deleted_at IS NULL`,
    [slug],
  );
}

export async function findPageBySlug(slug: string): Promise<LandingPageRow | null> {
  return queryOne<LandingPageRow>(
    `SELECT ${COLS} FROM landing_pages WHERE slug = $1 AND deleted_at IS NULL`,
    [slug],
  );
}

export async function insertPage(data: {
  title: string;
  slug: string;
  description: string | null;
  blocks: PageBlock[];
  created_by: string;
}): Promise<LandingPageRow> {
  const row = await queryOne<LandingPageRow>(
    `INSERT INTO landing_pages (title, slug, description, blocks, created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     RETURNING ${COLS}`,
    [data.title, data.slug, data.description, JSON.stringify(data.blocks), data.created_by],
  );
  if (!row) throw new AppError('Failed to create page', 500);
  return row;
}

export async function updatePage(
  id: string,
  fields: Partial<{
    title: string;
    slug: string;
    description: string | null;
    blocks: PageBlock[];
  }>,
): Promise<LandingPageRow> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (fields.title !== undefined) {
    sets.push(`title = $${i++}`);
    params.push(fields.title);
  }
  if (fields.slug !== undefined) {
    sets.push(`slug = $${i++}`);
    params.push(fields.slug);
  }
  if (fields.description !== undefined) {
    sets.push(`description = $${i++}`);
    params.push(fields.description);
  }
  if (fields.blocks !== undefined) {
    sets.push(`blocks = $${i++}::jsonb`);
    params.push(JSON.stringify(fields.blocks));
  }
  sets.push(`updated_at = current_timestamp`);

  params.push(id);
  const sql = `UPDATE landing_pages SET ${sets.join(', ')} WHERE id = $${i} AND deleted_at IS NULL RETURNING ${COLS}`;
  const row = await queryOne<LandingPageRow>(sql, params);
  if (!row) throw new AppError('Page not found', 404);
  return row;
}

export async function setPageStatus(
  id: string,
  status: 'draft' | 'published',
): Promise<LandingPageRow> {
  const row = await queryOne<LandingPageRow>(
    `UPDATE landing_pages SET status = $1, updated_at = current_timestamp
     WHERE id = $2 AND deleted_at IS NULL RETURNING ${COLS}`,
    [status, id],
  );
  if (!row) throw new AppError('Page not found', 404);
  return row;
}

export async function softDeletePage(id: string): Promise<void> {
  const result = await queryOne<{ id: string }>(
    `UPDATE landing_pages SET deleted_at = current_timestamp WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [id],
  );
  if (!result) throw new AppError('Page not found', 404);
}

export async function insertPageView(data: {
  page_id: string;
  lead_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
}): Promise<void> {
  await queryOne(
    `INSERT INTO landing_page_views (page_id, lead_id, ip_address, user_agent)
     VALUES ($1, $2, $3, $4)`,
    [data.page_id, data.lead_id, data.ip_address, data.user_agent],
  );
}

export async function findPageViews(pageId: string, limit = 50): Promise<PageViewRow[]> {
  return query<PageViewRow>(
    `SELECT id, page_id, lead_id, ip_address, user_agent, viewed_at
     FROM landing_page_views WHERE page_id = $1 ORDER BY viewed_at DESC LIMIT $2`,
    [pageId, limit],
  );
}

export async function countPageViews(pageId: string): Promise<number> {
  const row = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM landing_page_views WHERE page_id = $1`,
    [pageId],
  );
  return row ? parseInt(row.count, 10) : 0;
}

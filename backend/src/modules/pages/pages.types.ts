export type PageStatus = 'draft' | 'published';

export type PageBlock =
  | { type: 'gallery'; fileIds: string[] }
  | { type: 'link'; label: string; url: string }
  | { type: 'attachment'; fileId: string; label?: string }
  | { type: 'video'; youtubeUrl: string }
  | { type: 'map'; address: string };

/** Raw row shape from the `landing_pages` table. */
export interface LandingPageRow {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  blocks: PageBlock[];
  status: PageStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/** Landing page API response shape (currently identical to the row). */
export type LandingPageResponse = LandingPageRow;

export interface PublicFileRef {
  url: string;
  filename: string;
  mimeType: string;
}

/**
 * Shape returned by the public (unauthenticated) slug lookup — published pages only.
 * `files` resolves every fileId referenced by a gallery/attachment block to its public
 * URL/metadata, since the public route has no authenticated access to the Files-library
 * lookup endpoint.
 */
export type PublicLandingPageResponse = Pick<
  LandingPageRow,
  'title' | 'slug' | 'description' | 'blocks'
> & {
  files: Record<string, PublicFileRef>;
};

export interface LandingPageInput {
  title: string;
  slug: string;
  description?: string | null;
  blocks?: PageBlock[];
}

export interface LandingPageActor {
  id: string;
  role: string;
  ipAddress?: string | null;
}

export interface PageViewRow {
  id: string;
  page_id: string;
  lead_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  viewed_at: string;
}

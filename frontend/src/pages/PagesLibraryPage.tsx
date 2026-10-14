import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePages, useDeletePage, usePublishPage, useUnpublishPage, type LandingPage } from '@/api/pages';
import { PageHeader } from '@/components/ui/PageHeader';
import { ContentTabs } from '@/components/ContentTabs';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { LoadingTable } from '@/components/ui/LoadingTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
import { TemplateChooser } from '@/components/content/TemplateChooser';
import { Copy, Edit, ExternalLink, Eye, FileStack, Plus, Search, X } from 'lucide-react';

function formatUpdatedAt(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function PagesLibraryPage(): React.JSX.Element {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'published' | 'draft'>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'title'>('newest');
  const [previewPage, setPreviewPage] = useState<LandingPage | null>(null);
  const [deletePage, setDeletePage] = useState<LandingPage | null>(null);
  const [chooserPage, setChooserPage] = useState<LandingPage | null>(null);

  const { data: pages = [], isLoading, error, refetch } = usePages();
  const deletePageMut = useDeletePage();
  const publishPage = usePublishPage();
  const unpublishPage = useUnpublishPage();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const publishedCount = pages.filter((p) => p.status === 'published').length;
  const draftCount = pages.filter((p) => p.status === 'draft').length;
  const isFiltering = search.trim() !== '' || statusFilter !== 'all';

  const filteredPages = pages
    .filter((page) => {
      const q = search.trim().toLowerCase();
      const matchSearch =
        !q ||
        page.title.toLowerCase().includes(q) ||
        page.slug.toLowerCase().includes(q);
      const matchStatus = statusFilter === 'all' || page.status === statusFilter;
      return matchSearch && matchStatus;
    })
    .sort((a, b) => {
      if (sortBy === 'oldest') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (sortBy === 'title') return a.title.localeCompare(b.title);
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  const confirmDelete = async (): Promise<void> => {
    if (!deletePage) return;
    try {
      await deletePageMut.mutateAsync(deletePage.id);
      showToast('Page deleted.', 'success');
      if (previewPage?.id === deletePage.id) setPreviewPage(null);
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to delete page.'), 'error');
    } finally {
      setDeletePage(null);
    }
  };

  const handleTogglePublish = async (page: LandingPage): Promise<void> => {
    try {
      if (page.status === 'published') {
        await unpublishPage.mutateAsync(page.id);
        showToast('Page unpublished. Templates linking to it will now reach a missing page.', 'success');
      } else {
        await publishPage.mutateAsync(page.id);
        showToast('Page published. It can now be shared from templates.', 'success');
      }
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to update page status.'), 'error');
    }
  };

  const handleCopyLink = async (slug: string): Promise<void> => {
    const fullUrl = `${window.location.origin}/p/${slug}`;
    try {
      await navigator.clipboard.writeText(fullUrl);
      showToast('Page link copied. Anyone with this link can open the published page.', 'success');
    } catch {
      showToast('Failed to copy page link.', 'error');
    }
  };

  const openUseInTemplate = (page: LandingPage): void => {
    setPreviewPage(null);
    setChooserPage(page);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <ContentTabs />

      <PageHeader
        eyebrow="Content"
        title="Landing pages"
        description="Share product details, pricing, and offers from your templates."
        actions={
          <Button asChild className="min-h-[44px]">
            <Link to="/pages/new">
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              Create page
            </Link>
          </Button>
        }
      />
      <p role="status" className="text-sm text-slate-600">
        {isFiltering ? (
          <>
            {filteredPages.length} match{filteredPages.length === 1 ? '' : 'es'}
            {search.trim() ? (
              <>
                {' '}for “{search.trim()}”
              </>
            ) : null}
            {' '}· {pages.length} total ({publishedCount} published · {draftCount} draft{draftCount === 1 ? '' : 's'})
          </>
        ) : (
          <>
            {pages.length} total · {publishedCount} published · {draftCount} draft{draftCount === 1 ? '' : 's'}
          </>
        )}
      </p>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <Input
                aria-label="Search landing pages"
                placeholder="Search pages by title or slug…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-1" role="group" aria-label="Status filter">
                {(['all', 'published', 'draft'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatusFilter(s)}
                    aria-pressed={statusFilter === s}
                    className={`min-h-[44px] rounded-md px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${statusFilter === s ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    {s === 'all' ? 'All' : s === 'published' ? 'Published' : 'Drafts'}
                  </button>
                ))}
              </div>

              <select
                aria-label="Sort pages"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="h-11 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="newest">Sort: Newest First</option>
                <option value="oldest">Sort: Oldest First</option>
                <option value="title">Sort: Title (A-Z)</option>
              </select>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {isLoading && <LoadingTable />}

          {!isLoading && error && (
            <div className="space-y-3">
              <ErrorState message="Failed to load pages" />
              <Button type="button" variant="outline" size="sm" className="min-h-[44px]" onClick={() => void refetch()}>
                Retry
              </Button>
            </div>
          )}

          {!isLoading && !error && filteredPages.length === 0 && (
            <>
              {pages.length === 0 && !isFiltering ? (
                <EmptyState
                  icon={<FileStack className="h-6 w-6" aria-hidden="true" />}
                  title="No landing pages yet"
                  description="Create a page for content you reuse — for example: a product overview, a pricing summary, or a limited-time offer."
                  action={
                    <Button size="sm" asChild className="min-h-[44px]">
                      <Link to="/pages/new">
                        <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                        Create page
                      </Link>
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={<Search className="h-6 w-6" aria-hidden="true" />}
                  title="No matches"
                  description="No pages match this search or filter. Try different keywords or clear the filters."
                  action={
                    <Button
                      size="sm"
                      variant="outline"
                      className="min-h-[44px]"
                      onClick={() => {
                        setSearch('');
                        setStatusFilter('all');
                      }}
                    >
                      Clear filters
                    </Button>
                  }
                />
              )}
            </>
          )}

          {!isLoading && !error && filteredPages.length > 0 && (
            <ul className="space-y-3" aria-label="Landing pages">
              {filteredPages.map((page) => (
                <li
                  key={page.id}
                  className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 transition-colors hover:border-slate-300 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-900">{page.title}</span>
                      <StatusBadge tone={page.status === 'published' ? 'green' : 'gray'}>
                        {page.status === 'published' ? 'Published' : 'Draft'}
                      </StatusBadge>
                    </div>
                    <p className="mt-1 truncate font-mono text-xs text-slate-500" title={`/p/${page.slug}`}>/p/{page.slug}</p>
                    <p className="mt-0.5 text-xs text-slate-500">Last updated {formatUpdatedAt(page.updated_at)}</p>
                    {page.status !== 'published' && (
                      <p className="mt-1 text-xs text-amber-700">Publish this page before sharing — drafts cannot be inserted as public links.</p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-1">
                    <Button variant="outline" size="sm" className="h-11 text-xs" onClick={() => setPreviewPage(page)}>
                      <Eye className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Preview
                    </Button>
                    <Button variant="ghost" size="sm" className="h-11 text-xs" asChild>
                      <Link to={`/pages/${page.id}/edit`}>
                        <Edit className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Edit
                      </Link>
                    </Button>
                    {page.status === 'published' ? (
                      <>
                        <Button variant="outline" size="sm" className="h-11 text-xs" onClick={() => openUseInTemplate(page)}>
                          Use in template
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="min-h-[44px] min-w-[44px]"
                          title="Copy page link"
                          aria-label={`Copy link for ${page.title}`}
                          onClick={() => void handleCopyLink(page.slug)}
                        >
                          <Copy className="h-4 w-4 text-slate-600" aria-hidden="true" />
                        </Button>
                        <Button variant="ghost" size="icon" className="min-h-[44px] min-w-[44px]" title="View public page" aria-label={`View public page ${page.title}`} asChild>
                          <a href={`/p/${page.slug}`} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-4 w-4 text-slate-600" aria-hidden="true" />
                          </a>
                        </Button>
                      </>
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-11 text-xs"
                      disabled={publishPage.isPending || unpublishPage.isPending}
                      onClick={() => void handleTogglePublish(page)}
                    >
                      {page.status === 'published' ? 'Unpublish' : 'Publish'}
                    </Button>
                    <Button variant="ghost" size="icon" className="min-h-[44px] min-w-[44px]" title="Delete" aria-label={`Delete ${page.title}`} onClick={() => setDeletePage(page)}>
                      <span className="text-red-500">Delete</span>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {previewPage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPreviewPage(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Preview ${previewPage.title}`}
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-slate-900">{previewPage.title}</h2>
                <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                  <StatusBadge tone={previewPage.status === 'published' ? 'green' : 'gray'}>
                    {previewPage.status === 'published' ? 'Published' : 'Draft'}
                  </StatusBadge>
                  Last updated {formatUpdatedAt(previewPage.updated_at)}
                </p>
              </div>
              <Button variant="ghost" size="icon" className="min-h-[44px] min-w-[44px]" onClick={() => setPreviewPage(null)} aria-label="Close page preview">
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
            {previewPage.status !== 'published' ? (
              <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Draft preview — this content is not publicly shareable until you publish it.
              </p>
            ) : (
              <p className="mt-3 break-all font-mono text-xs text-slate-500">
                {`${window.location.origin}/p/${previewPage.slug}`}
              </p>
            )}
            {previewPage.description && <p className="mt-3 text-sm text-slate-700">{previewPage.description}</p>}
            <div className="mt-3 space-y-2">
              {(previewPage.blocks ?? []).map((b, i) => (
                <p key={`${b.type}-${i}`} className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  {b.type === 'gallery' && `Image gallery · ${b.fileIds.length} image${b.fileIds.length === 1 ? '' : 's'}`}
                  {b.type === 'link' && `Link · ${b.label || b.url}`}
                  {b.type === 'attachment' && `Attachment · ${b.label || 'file'}`}
                  {b.type === 'video' && 'YouTube video'}
                  {b.type === 'map' && `Map · ${b.address}`}
                </p>
              ))}
              {(previewPage.blocks ?? []).length === 0 && (
                <p className="text-xs text-slate-500">No content blocks yet.</p>
              )}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {previewPage.status === 'published' ? (
                <>
                  <Button type="button" size="sm" className="min-h-[44px]" onClick={() => openUseInTemplate(previewPage)}>
                    Use in template
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="min-h-[44px]" onClick={() => void handleCopyLink(previewPage.slug)}>
                    <Copy className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Copy link
                  </Button>
                </>
              ) : (
                <Button type="button" variant="outline" size="sm" className="min-h-[44px]" asChild>
                  <Link to={`/pages/${previewPage.id}/edit`}>Edit and publish</Link>
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      <AlertDialog
        open={deletePage !== null}
        title="Delete this page?"
        description="This removes the page from the library. Templates that link to it will reach a missing page — links are not cleaned up automatically. This cannot be undone."
        confirmLabel={deletePageMut.isPending ? 'Deleting…' : 'Delete page'}
        cancelLabel="Keep page"
        variant="destructive"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeletePage(null)}
      />

      {chooserPage && (
        <TemplateChooser
          open
          itemDescription={`“${chooserPage.title}”`}
          onClose={() => setChooserPage(null)}
          onChoose={(templateId) => {
            setChooserPage(null);
            navigate(`/templates/${templateId}/edit?addPage=${chooserPage.slug}`);
          }}
          onCreateNew={() => {
            setChooserPage(null);
            navigate(`/templates/new?addPage=${chooserPage.slug}`);
          }}
        />
      )}
    </div>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePages, useDeletePage, usePublishPage, useUnpublishPage, usePageViews } from '@/api/pages';
import { PageHeader } from '@/components/ui/PageHeader';
import { ContentTabs } from '@/components/ContentTabs';
import { UnifiedContentAnalyticsCard } from '@/components/UnifiedContentAnalyticsCard';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { LoadingTable } from '@/components/ui/LoadingTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
import { Copy, Edit, ExternalLink, Eye, FileStack, Plus, Search, Trash2 } from 'lucide-react';

function ViewsBadge({ pageId }: { pageId: string }) {
  const { data } = usePageViews(pageId);
  if (!data || data.total === 0) return null;
  return (
    <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
      <Eye className="h-3 w-3" />
      {data.total} view{data.total === 1 ? '' : 's'}
    </span>
  );
}

export function PagesLibraryPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'published' | 'draft'>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'title'>('newest');

  const { data: pages = [], isLoading, error } = usePages();
  const deletePage = useDeletePage();
  const publishPage = usePublishPage();
  const unpublishPage = useUnpublishPage();
  const { showToast } = useToast();

  const publishedCount = pages.filter((p) => p.status === 'published').length;
  const draftCount = pages.filter((p) => p.status === 'draft').length;

  const filteredPages = pages
    .filter((page) => {
      const matchSearch =
        page.title.toLowerCase().includes(search.toLowerCase()) ||
        page.slug.toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === 'all' || page.status === statusFilter;
      return matchSearch && matchStatus;
    })
    .sort((a, b) => {
      if (sortBy === 'oldest') {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      }
      if (sortBy === 'title') {
        return a.title.localeCompare(b.title);
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this page?')) return;
    try {
      await deletePage.mutateAsync(id);
      showToast('Page deleted.', 'success');
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to delete page.'), 'error');
    }
  };

  const handleTogglePublish = async (id: string, status: 'draft' | 'published') => {
    try {
      if (status === 'published') {
        await unpublishPage.mutateAsync(id);
        showToast('Page unpublished.', 'success');
      } else {
        await publishPage.mutateAsync(id);
        showToast('Page published.', 'success');
      }
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to update page status.'), 'error');
    }
  };

  const handleCopyLink = async (slug: string) => {
    const fullUrl = `${window.location.origin}/p/${slug}`;
    try {
      await navigator.clipboard.writeText(fullUrl);
      showToast('Page link copied to clipboard.', 'success');
    } catch {
      showToast('Failed to copy page link.', 'error');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <ContentTabs />

      <PageHeader
        eyebrow="Content"
        title="Pages"
        description="Simple published pages you can link leads to — pricing pages, one-pagers, landing copy."
        metrics={[
          { label: 'Total Pages', value: pages.length },
          { label: 'Published', value: publishedCount, tone: 'success' },
          { label: 'Drafts', value: draftCount, tone: 'warning' },
        ]}
        actions={
          <Button asChild>
            <Link to="/pages/new">
              <Plus className="mr-2 h-4 w-4" />
              New Page
            </Link>
          </Button>
        }
      />

      <UnifiedContentAnalyticsCard />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            {/* Search Input */}
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search pages by title or slug…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Filter Pills & Sort Select */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  onClick={() => setStatusFilter('all')}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                    statusFilter === 'all'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  All ({pages.length})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('published')}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                    statusFilter === 'published'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Published ({publishedCount})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('draft')}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                    statusFilter === 'draft'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Drafts ({draftCount})
                </button>
              </div>

              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'newest' | 'oldest' | 'title')}
                className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
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

          {!isLoading && error && <ErrorState message="Failed to load pages" />}

          {!isLoading && !error && filteredPages.length === 0 && (
            <EmptyState
              icon={<FileStack className="h-6 w-6" />}
              title={statusFilter !== 'all' ? `No ${statusFilter} pages found` : 'No pages yet'}
              description={
                statusFilter !== 'all'
                  ? 'Try changing your status filter or clearing your search term.'
                  : 'Create a page to share with leads at a public link.'
              }
              action={
                <Button size="sm" asChild>
                  <Link to="/pages/new">
                    <Plus className="mr-2 h-4 w-4" />
                    New Page
                  </Link>
                </Button>
              }
            />
          )}

          {!isLoading && !error && filteredPages.length > 0 && (
            <div className="space-y-3">
              {filteredPages.map((page) => (
                <div
                  key={page.id}
                  className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 sm:flex-row sm:items-center hover:border-slate-300 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-900">{page.title}</span>
                      <StatusBadge tone={page.status === 'published' ? 'green' : 'gray'}>
                        {page.status}
                      </StatusBadge>
                      <ViewsBadge pageId={page.id} />
                    </div>
                    <p className="mt-1 text-xs font-mono text-slate-500">/p/{page.slug}</p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {page.status === 'published' && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Copy page link"
                          onClick={() => handleCopyLink(page.slug)}
                        >
                          <Copy className="h-4 w-4 text-slate-600" />
                        </Button>
                        <Button variant="ghost" size="icon" title="View public page" asChild>
                          <a href={`/p/${page.slug}`} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-4 w-4 text-slate-600" />
                          </a>
                        </Button>
                      </>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => handleTogglePublish(page.id, page.status)}
                    >
                      {page.status === 'published' ? 'Unpublish' : 'Publish'}
                    </Button>
                    <Button variant="ghost" size="icon" asChild title="Edit">
                      <Link to={`/pages/${page.id}/edit`}>
                        <Edit className="h-4 w-4" />
                      </Link>
                    </Button>
                    <Button variant="ghost" size="icon" title="Delete" onClick={() => handleDelete(page.id)}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


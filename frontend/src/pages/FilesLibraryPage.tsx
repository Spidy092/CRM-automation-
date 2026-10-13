import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFiles, useUploadFile, useDeleteFile, useUpdateFile, type LibraryFile } from '@/api/files';
import { PageHeader } from '@/components/ui/PageHeader';
import { ContentTabs } from '@/components/ContentTabs';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingTable } from '@/components/ui/LoadingTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage, getApiErrorReferences, getApiErrorStatus, type FileReferencesMeta } from '@/lib/apiError';
import { FileThumb } from '@/components/content/FileThumb';
import { TemplateChooser } from '@/components/content/TemplateChooser';
import { fileExtension, formatBytes, resolveAssetUrl } from '@/lib/contentLinks';
import { Eye, FileText, Image as ImageIcon, Link as LinkIcon, MoreHorizontal, Plus, Search, Upload, LayoutGrid, List, X } from 'lucide-react';

const UPLOAD_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,application/pdf';

function GridImage({ file }: { file: LibraryFile }): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="flex flex-col items-center gap-1 p-2 text-center">
        <FileText className="h-12 w-12 text-slate-400" aria-hidden="true" />
        <span className="max-w-full truncate px-2 text-xs text-slate-500" title={file.filename}>{file.filename}</span>
      </span>
    );
  }
  return (
    <img
      src={resolveAssetUrl(file.url)}
      alt={file.filename}
      title={file.filename}
      className="h-full w-full object-cover"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function FilesLibraryPage(): React.JSX.Element {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'image' | 'pdf'>('all');
  const [tagFilter, setTagFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'name' | 'size'>('newest');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const [previewFile, setPreviewFile] = useState<LibraryFile | null>(null);
  const [moreFile, setMoreFile] = useState<LibraryFile | null>(null);
  const [renameFile, setRenameFile] = useState<LibraryFile | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteFile, setDeleteFile] = useState<LibraryFile | null>(null);
  const [blockedRefs, setBlockedRefs] = useState<FileReferencesMeta | null>(null);
  const [chooserFile, setChooserFile] = useState<LibraryFile | null>(null);

  // Fetch the full library once; search/type/tag filters apply client-side so
  // the compact summary can always show true library totals alongside matches.
  const { data: files = [], isLoading, error, refetch } = useFiles();
  const uploadFile = useUploadFile();
  const deleteFileMut = useDeleteFile();
  const updateFile = useUpdateFile();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounter = useRef(0);

  const totalImages = files.filter((f) => f.mime_type.startsWith('image/')).length;
  const totalPdfs = files.filter((f) => f.mime_type.includes('pdf')).length;
  const allTags = useMemo(() => Array.from(new Set(files.flatMap((f) => f.tags ?? []))).sort(), [files]);
  const isFiltering = search.trim() !== '' || typeFilter !== 'all' || tagFilter !== 'all';

  const filteredFiles = files
    .filter((file) => {
      const q = search.trim().toLowerCase();
      if (q && !file.filename.toLowerCase().includes(q) && !file.mime_type.toLowerCase().includes(q) && !(file.tags ?? []).some((t) => t.toLowerCase().includes(q))) return false;
      if (typeFilter === 'image' && !file.mime_type.startsWith('image/')) return false;
      if (typeFilter === 'pdf' && !file.mime_type.includes('pdf')) return false;
      if (tagFilter !== 'all' && !(file.tags ?? []).includes(tagFilter)) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'oldest') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (sortBy === 'name') return a.filename.localeCompare(b.filename);
      if (sortBy === 'size') return b.size_bytes - a.size_bytes;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  const uploadFiles = async (selected: File[]): Promise<void> => {
    if (selected.length === 0) return;
    setUploadProgress({ done: 0, total: selected.length });
    let succeeded = 0;
    let failed = 0;
    for (const file of selected) {
      try {
        await uploadFile.mutateAsync(file);
        succeeded += 1;
      } catch (err) {
        failed += 1;
        showToast(`${file.name}: ${getApiErrorMessage(err, 'Failed to upload')}`, 'error');
      }
      setUploadProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
    }
    setUploadProgress(null);
    if (succeeded > 0) {
      showToast(
        `${succeeded} file${succeeded === 1 ? '' : 's'} uploaded${failed > 0 ? `, ${failed} failed` : '.'}`,
        failed > 0 ? 'error' : 'success',
      );
    }
  };

  const handleCopyUrl = async (url: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
      showToast('URL copied to clipboard. Anyone with this link can open the file.', 'success');
    } catch {
      showToast('Failed to copy URL.', 'error');
    }
  };

  const openRename = (file: LibraryFile): void => {
    setMoreFile(null);
    setRenameFile(file);
    setRenameValue(file.filename);
  };

  const confirmRename = async (): Promise<void> => {
    if (!renameFile) return;
    const next = renameValue.trim();
    if (!next || next === renameFile.filename) {
      setRenameFile(null);
      return;
    }
    try {
      await updateFile.mutateAsync({ id: renameFile.id, input: { filename: next } });
      showToast('File renamed. Existing links keep working — references use the file ID, not the name.', 'success');
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to rename file.'), 'error');
    } finally {
      setRenameFile(null);
    }
  };

  const confirmDelete = async (): Promise<void> => {
    if (!deleteFile) return;
    try {
      await deleteFileMut.mutateAsync(deleteFile.id);
      showToast('File deleted from the library.', 'success');
      if (previewFile?.id === deleteFile.id) setPreviewFile(null);
      setDeleteFile(null);
      setMoreFile(null);
    } catch (err) {
      // Referenced files are blocked (409) with the affected items — deleting
      // would break template sends and page renders that share this file.
      const refs = getApiErrorReferences(err);
      if (getApiErrorStatus(err) === 409 && refs && (refs.templates.length > 0 || refs.pages.length > 0)) {
        setBlockedRefs(refs);
        return;
      }
      showToast(getApiErrorMessage(err, 'Failed to delete file.'), 'error');
      setDeleteFile(null);
      setMoreFile(null);
    }
  };

  const closeDelete = (): void => {
    setDeleteFile(null);
    setBlockedRefs(null);
    setMoreFile(null);
  };

  const openUseInTemplate = (file: LibraryFile): void => {
    setMoreFile(null);
    setPreviewFile(null);
    setChooserFile(file);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <ContentTabs />
      <PageHeader
        eyebrow="Content"
        title="Files"
        description="Reuse images and PDFs in your templates and pages."
        actions={
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={UPLOAD_ACCEPT}
              multiple
              className="hidden"
              onChange={(e) => {
                const selected = Array.from(e.target.files ?? []);
                e.target.value = '';
                void uploadFiles(selected);
              }}
            />
            <Button onClick={() => fileInputRef.current?.click()} disabled={uploadFile.isPending} className="min-h-[44px]">
              {uploadFile.isPending ? (
                <>
                  <Upload className="mr-2 h-4 w-4 animate-pulse" />
                  Uploading…
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  Upload files
                </>
              )}
            </Button>
          </>
        }
      />
      <p role="status" className="text-sm text-slate-600">
        {isFiltering ? (
          <>
            {filteredFiles.length} match{filteredFiles.length === 1 ? '' : 'es'}
            {search.trim() ? (
              <>
                {' '}for “{search.trim()}”
              </>
            ) : null}
            {' '}· {files.length} total in library ({totalImages} images · {totalPdfs} PDFs)
          </>
        ) : (
          <>
            {files.length} item{files.length === 1 ? '' : 's'} · {totalImages} image{totalImages === 1 ? '' : 's'} · {totalPdfs} PDF{totalPdfs === 1 ? '' : 's'}
          </>
        )}
      </p>

      <Card
        onDragEnter={(e) => {
          e.preventDefault();
          if (e.dataTransfer.types.includes('Files')) {
            dragCounter.current += 1;
            setIsDraggingOver(true);
          }
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          dragCounter.current -= 1;
          if (dragCounter.current <= 0) {
            dragCounter.current = 0;
            setIsDraggingOver(false);
          }
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          dragCounter.current = 0;
          setIsDraggingOver(false);
          void uploadFiles(Array.from(e.dataTransfer.files ?? []));
        }}
        className={isDraggingOver ? 'ring-2 ring-indigo-400' : undefined}
      >
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <Input
                aria-label="Search files"
                placeholder="Search files…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-1" role="group" aria-label="File type filter">
                <button
                  type="button"
                  onClick={() => setTypeFilter('all')}
                  aria-pressed={typeFilter === 'all'}
                  className={`min-h-[44px] rounded-md px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${typeFilter === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setTypeFilter('image')}
                  aria-pressed={typeFilter === 'image'}
                  className={`flex min-h-[44px] items-center gap-1 rounded-md px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${typeFilter === 'image' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  Images
                </button>
                <button
                  type="button"
                  onClick={() => setTypeFilter('pdf')}
                  aria-pressed={typeFilter === 'pdf'}
                  className={`flex min-h-[44px] items-center gap-1 rounded-md px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${typeFilter === 'pdf' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                  PDFs
                </button>
              </div>

              {allTags.length > 0 && (
                <select
                  aria-label="Filter by tag"
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                  className="h-11 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="all">All tags</option>
                  {allTags.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              )}

              <select
                aria-label="Sort files"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="h-11 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="newest">Sort: Newest First</option>
                <option value="oldest">Sort: Oldest First</option>
                <option value="name">Sort: Name (A-Z)</option>
                <option value="size">Sort: Size (Largest)</option>
              </select>

              <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-1" role="group" aria-label="View mode">
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  title="Grid view"
                  aria-label="Grid view"
                  aria-pressed={viewMode === 'grid'}
                  className={`min-h-[44px] min-w-[44px] rounded-md p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${viewMode === 'grid' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
                >
                  <LayoutGrid className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  title="List view"
                  aria-label="List view"
                  aria-pressed={viewMode === 'list'}
                  className={`min-h-[44px] min-w-[44px] rounded-md p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${viewMode === 'list' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
                >
                  <List className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {uploadProgress && (
            <p role="status" className="mb-4 flex items-center gap-2 rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
              <Upload className="h-3.5 w-3.5 animate-pulse" aria-hidden="true" />
              Uploading {uploadProgress.done} of {uploadProgress.total}…
            </p>
          )}

          {isLoading && <LoadingTable />}

          {!isLoading && error && (
            <div className="space-y-3">
              <ErrorState message="Failed to load files" />
              <Button type="button" variant="outline" size="sm" className="min-h-[44px]" onClick={() => void refetch()}>
                Retry
              </Button>
            </div>
          )}

          {!isLoading && !error && filteredFiles.length === 0 && (
            <>
              {files.length === 0 && !isFiltering ? (
                <EmptyState
                  icon={<ImageIcon className="h-6 w-6" aria-hidden="true" />}
                  title="No files yet"
                  description="Upload product photos, one-pagers, or brochures. For example: a pricing PDF, a product photo, or a portfolio deck you reuse in templates."
                  action={
                    <Button size="sm" className="min-h-[44px]" onClick={() => fileInputRef.current?.click()}>
                      <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                      Upload files
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={<Search className="h-6 w-6" aria-hidden="true" />}
                  title="No matches"
                  description="No files match this search or filter. Try different keywords or clear the filters."
                  action={
                    <Button
                      size="sm"
                      variant="outline"
                      className="min-h-[44px]"
                      onClick={() => {
                        setSearch('');
                        setTypeFilter('all');
                        setTagFilter('all');
                      }}
                    >
                      Clear filters
                    </Button>
                  }
                />
              )}
            </>
          )}

          {!isLoading && !error && filteredFiles.length > 0 && (
            <div className={`rounded-lg p-1 transition-colors ${isDraggingOver ? 'bg-indigo-50 ring-2 ring-indigo-400' : ''}`}>
              {viewMode === 'list' ? (
                <ul className="space-y-2" aria-label="Files">
                  {filteredFiles.map((file) => (
                    <li
                      key={file.id}
                      className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 transition-colors hover:border-slate-300"
                    >
                      <button
                        type="button"
                        onClick={() => setPreviewFile(file)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
                        aria-label={`Preview ${file.filename}`}
                      >
                        <FileThumb url={file.url} filename={file.filename} mimeType={file.mime_type} size="md" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-900" title={file.filename}>
                            {file.filename}
                          </span>
                          <span className="block text-xs text-slate-500">
                            {fileExtension(file.filename)} · {formatBytes(file.size_bytes)}
                            {(file.tags ?? []).length > 0 ? ` · ${(file.tags ?? []).join(', ')}` : ''}
                          </span>
                        </span>
                      </button>
                      <span className="flex shrink-0 items-center gap-1">
                        <Button variant="ghost" size="icon" className="min-h-[44px] min-w-[44px]" title="Preview" aria-label={`Preview ${file.filename}`} onClick={() => setPreviewFile(file)}>
                          <Eye className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button variant="ghost" size="icon" className="min-h-[44px] min-w-[44px]" title="More actions" aria-label={`More actions for ${file.filename}`} onClick={() => setMoreFile(file)}>
                          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {filteredFiles.map((file) => {
                    const isImage = file.mime_type.startsWith('image/');
                    return (
                      <div
                        key={file.id}
                        className="group relative flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition-all hover:shadow-md"
                      >
                        <button
                          type="button"
                          onClick={() => setPreviewFile(file)}
                          className="relative flex h-36 w-full items-center justify-center bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
                          aria-label={`Preview ${file.filename}`}
                        >
                          {isImage ? (
                            <GridImage file={file} />
                          ) : (
                            <span className="flex flex-col items-center gap-1 p-2 text-center">
                              <FileText className="h-12 w-12 text-slate-400" aria-hidden="true" />
                              <span className="max-w-full truncate px-2 text-xs text-slate-500" title={file.filename}>{file.filename}</span>
                            </span>
                          )}
                        </button>
                        <div className="p-3">
                          <p className="truncate text-left text-sm font-medium text-slate-900" title={file.filename}>
                            {file.filename}
                          </p>
                          <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                            <span>{formatBytes(file.size_bytes)}</span>
                            <span className="uppercase">{fileExtension(file.filename)}</span>
                          </div>
                          <div className="mt-2 flex gap-1">
                            <Button type="button" variant="outline" size="sm" className="h-11 flex-1 text-xs" onClick={() => setPreviewFile(file)}>
                              Preview
                            </Button>
                            <Button type="button" variant="outline" size="sm" className="h-11 flex-1 text-xs" onClick={() => openUseInTemplate(file)}>
                              Use in template
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {previewFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPreviewFile(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`File details: ${previewFile.filename}`}
            className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="min-w-0 truncate text-base font-semibold text-slate-900" title={previewFile.filename}>
                {previewFile.filename}
              </h2>
              <Button variant="ghost" size="icon" className="min-h-[44px] min-w-[44px]" onClick={() => setPreviewFile(null)} aria-label="Close file preview">
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
            <div className="mt-3 flex items-center justify-center rounded-md bg-slate-100 p-4">
              <FileThumb url={previewFile.url} filename={previewFile.filename} mimeType={previewFile.mime_type} size="lg" />
            </div>
            <p className="mt-3 text-xs text-slate-500">
              {previewFile.mime_type} · {formatBytes(previewFile.size_bytes)}
              {(previewFile.tags ?? []).length > 0 ? ` · Tags: ${(previewFile.tags ?? []).join(', ')}` : ''}
            </p>
            <p className="mt-1 break-all text-xs text-slate-500">{previewFile.url}</p>
            <p className="mt-2 text-xs text-slate-500">Shareable link — anyone with this link can open the file.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" size="sm" className="min-h-[44px]" onClick={() => openUseInTemplate(previewFile)}>
                Use in template
              </Button>
              <Button type="button" variant="outline" size="sm" className="min-h-[44px]" onClick={() => void handleCopyUrl(previewFile.url)}>
                <LinkIcon className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Copy link
              </Button>
              <Button type="button" variant="outline" size="sm" className="min-h-[44px]" onClick={() => { setPreviewFile(null); setMoreFile(previewFile); }}>
                <MoreHorizontal className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> More
              </Button>
            </div>
          </div>
        </div>
      )}

      {moreFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setMoreFile(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`More actions for ${moreFile.filename}`}
            className="w-full max-w-sm rounded-lg bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="truncate text-sm font-semibold text-slate-900" title={moreFile.filename}>More actions</h2>
            <div className="mt-3 space-y-2">
              <Button type="button" variant="outline" className="min-h-[44px] w-full justify-start" onClick={() => { setPreviewFile(moreFile); setMoreFile(null); }}>
                <Eye className="mr-2 h-4 w-4" aria-hidden="true" /> Preview
              </Button>
              <Button type="button" variant="outline" className="min-h-[44px] w-full justify-start" onClick={() => openUseInTemplate(moreFile)}>
                <Plus className="mr-2 h-4 w-4" aria-hidden="true" /> Use in template
              </Button>
              <Button type="button" variant="outline" className="min-h-[44px] w-full justify-start" onClick={() => openRename(moreFile)}>
                Rename
              </Button>
              <Button type="button" variant="outline" className="min-h-[44px] w-full justify-start" onClick={() => void handleCopyUrl(moreFile.url)}>
                <LinkIcon className="mr-2 h-4 w-4" aria-hidden="true" /> Copy link
              </Button>
              <Button type="button" variant="outline" className="min-h-[44px] w-full justify-start text-red-600 hover:bg-red-50" onClick={() => { setDeleteFile(moreFile); }}>
                Delete
              </Button>
              <Button type="button" variant="ghost" className="min-h-[44px] w-full" onClick={() => setMoreFile(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {renameFile !== null && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setRenameFile(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Rename file"
            className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-slate-900">Rename file</h2>
            <p className="mt-1 text-xs text-slate-500">
              Renaming does not break template or page references — they use the file ID, not the name.
            </p>
            <div className="mt-3 space-y-1.5">
              <Label htmlFor="rename-filename">File name</Label>
              <Input
                id="rename-filename"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" className="min-h-[44px]" onClick={() => setRenameFile(null)}>
                Cancel
              </Button>
              <Button type="button" className="min-h-[44px]" disabled={updateFile.isPending} onClick={() => void confirmRename()}>
                {updateFile.isPending ? 'Renaming…' : 'Rename'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <AlertDialog
        open={deleteFile !== null && blockedRefs === null}
        title="Delete this file?"
        description="This removes the file from the library. Templates or pages that link to it by URL may show a broken link. Files attached to templates or used in pages cannot be deleted until they are removed there — deletion is blocked and the affected items are listed."
        confirmLabel={deleteFileMut.isPending ? 'Deleting…' : 'Delete file'}
        cancelLabel="Keep file"
        variant="destructive"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteFile(null)}
      />

      {deleteFile !== null && blockedRefs !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Cannot delete ${deleteFile.filename}`}
            className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-5 shadow-xl"
          >
            <h2 className="text-base font-semibold text-slate-900">Cannot delete this file</h2>
            <p className="mt-1 text-sm text-slate-600">
              “<span title={deleteFile.filename}>{deleteFile.filename}</span>” is still in use. Deleting it would break
              template sends and page renders that share this file, so deletion is blocked. Remove it from these items first:
            </p>
            {blockedRefs.templates.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Attached to {blockedRefs.templates.length} template{blockedRefs.templates.length === 1 ? '' : 's'}
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-700">
                  {blockedRefs.templates.map((t) => (
                    <li key={t.id} className="truncate" title={t.name ?? t.id}>{t.name ?? t.id}</li>
                  ))}
                </ul>
              </div>
            )}
            {blockedRefs.pages.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Used in {blockedRefs.pages.length} landing page{blockedRefs.pages.length === 1 ? '' : 's'}
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-700">
                  {blockedRefs.pages.map((p) => (
                    <li key={p.id} className="truncate" title={p.title ?? p.id}>{p.title ?? p.id}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-3 text-xs text-slate-500">
              Raw download links pasted into message text are not tracked — check those manually before deleting.
            </p>
            <div className="mt-4 flex justify-end">
              <Button type="button" className="min-h-[44px]" onClick={closeDelete}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {chooserFile && (
        <TemplateChooser
          open
          itemDescription={`“${chooserFile.filename}”`}
          onClose={() => setChooserFile(null)}
          onChoose={(templateId) => {
            setChooserFile(null);
            navigate(`/templates/${templateId}/edit?addFile=${chooserFile.id}`);
          }}
          onCreateNew={() => {
            setChooserFile(null);
            navigate(`/templates/new?addFile=${chooserFile.id}`);
          }}
        />
      )}
    </div>
  );
}

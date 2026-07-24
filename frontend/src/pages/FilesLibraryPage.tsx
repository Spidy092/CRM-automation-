import { useRef, useState } from 'react';
import { useFiles, useUploadFile, useDeleteFile, useUpdateFile, type LibraryFile } from '@/api/files';
import { PageHeader } from '@/components/ui/PageHeader';
import { ContentTabs } from '@/components/ContentTabs';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadingTable } from '@/components/ui/LoadingTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
import { FileText, Image as ImageIcon, Link as LinkIcon, Plus, Search, Trash2, Upload, LayoutGrid, List } from 'lucide-react';

const UPLOAD_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,application/pdf';

function FileThumb({ file }: { file: LibraryFile }) {
  const isImage = file.mime_type.startsWith('image/');
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-100">
      {isImage ? (
        <img src={file.url} alt="" className="h-10 w-10 rounded object-cover" />
      ) : (
        <FileText className="h-5 w-5 text-slate-500" />
      )}
    </div>
  );
}

export function FilesLibraryPage() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'image' | 'pdf'>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'name' | 'size'>('newest');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');

  const { data: files = [], isLoading, error } = useFiles({ search: search || undefined });
  const uploadFile = useUploadFile();
  const deleteFile = useDeleteFile();
  const updateFile = useUpdateFile();
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounter = useRef(0);

  const totalImages = files.filter((f) => f.mime_type.startsWith('image/')).length;
  const totalPdfs = files.filter((f) => f.mime_type.includes('pdf')).length;

  const filteredFiles = files
    .filter((file) => {
      if (typeFilter === 'image') return file.mime_type.startsWith('image/');
      if (typeFilter === 'pdf') return file.mime_type.includes('pdf');
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'oldest') {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      }
      if (sortBy === 'name') {
        return a.filename.localeCompare(b.filename);
      }
      if (sortBy === 'size') {
        return b.size_bytes - a.size_bytes;
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  const uploadFiles = async (selected: File[]) => {
    if (selected.length === 0) return;

    setUploadProgress({ done: 0, total: selected.length });
    let succeeded = 0;
    let failed = 0;
    for (const file of selected) {
      try {
        await uploadFile.mutateAsync(file);
        succeeded += 1;
      } catch (error) {
        failed += 1;
        showToast(
          `${file.name}: ${getApiErrorMessage(error, 'Failed to upload')}`,
          'error',
        );
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

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files')) {
      dragCounter.current += 1;
      setIsDraggingOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDraggingOver(false);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDraggingOver(false);
    const dropped = Array.from(e.dataTransfer.files ?? []);
    await uploadFiles(dropped);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    e.target.value = '';
    await uploadFiles(selected);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this file? It will be removed from any templates referencing it.')) return;
    try {
      await deleteFile.mutateAsync(id);
      showToast('File deleted.', 'success');
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to delete file.'), 'error');
    }
  };

  const handleCopyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      showToast('URL copied to clipboard.', 'success');
    } catch {
      showToast('Failed to copy URL.', 'error');
    }
  };

  const handleRename = async (file: LibraryFile) => {
    const next = window.prompt('Rename file', file.filename);
    if (!next || next === file.filename) return;
    try {
      await updateFile.mutateAsync({ id: file.id, input: { filename: next } });
      showToast('File renamed.', 'success');
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to rename file.'), 'error');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <ContentTabs />
      <PageHeader
        eyebrow="Content"
        title="Files"
        description="A shared library of images and PDFs you can attach to any template or message."
        metrics={[
          { label: 'Total Files', value: files.length },
          { label: 'Images', value: totalImages },
          { label: 'PDFs & Docs', value: totalPdfs },
        ]}
        actions={
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={UPLOAD_ACCEPT}
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
            <Button onClick={() => fileInputRef.current?.click()} disabled={uploadFile.isPending}>
              {uploadFile.isPending ? (
                <>
                  <Upload className="mr-2 h-4 w-4 animate-pulse" />
                  Uploading…
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  Upload File
                </>
              )}
            </Button>
          </>
        }
      />

      <Card
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={isDraggingOver ? 'ring-2 ring-indigo-400' : undefined}
      >
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            {/* Search Input */}
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search files…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Filter & View Controls */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Type Segregation Filter Pills */}
              <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  onClick={() => setTypeFilter('all')}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                    typeFilter === 'all'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  All ({files.length})
                </button>
                <button
                  type="button"
                  onClick={() => setTypeFilter('image')}
                  className={`flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                    typeFilter === 'image'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                  Images ({totalImages})
                </button>
                <button
                  type="button"
                  onClick={() => setTypeFilter('pdf')}
                  className={`flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                    typeFilter === 'pdf'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <FileText className="h-3.5 w-3.5" />
                  PDFs ({totalPdfs})
                </button>
              </div>

              {/* Sort Order Selector */}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="newest">Sort: Newest First</option>
                <option value="oldest">Sort: Oldest First</option>
                <option value="name">Sort: Name (A-Z)</option>
                <option value="size">Sort: Size (Largest)</option>
              </select>

              {/* Grid / List View Toggle */}
              <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  title="Grid view"
                  className={`rounded-md p-1 transition-colors ${
                    viewMode === 'grid' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  title="List view"
                  className={`rounded-md p-1 transition-colors ${
                    viewMode === 'list' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  <List className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {uploadProgress && (
            <div className="mb-4 flex items-center gap-2 rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
              <Upload className="h-3.5 w-3.5 animate-pulse" />
              Uploading {uploadProgress.done} of {uploadProgress.total}…
            </div>
          )}

          {isLoading && <LoadingTable />}

          {!isLoading && error && <ErrorState message="Failed to load files" />}

          {!isLoading && !error && filteredFiles.length === 0 && (
            <div
              onClick={() => fileInputRef.current?.click()}
              className={`cursor-pointer rounded-lg border-2 border-dashed p-2 transition-colors ${
                isDraggingOver ? 'border-indigo-400 bg-indigo-50' : 'border-transparent'
              }`}
            >
              <EmptyState
                icon={<ImageIcon className="h-6 w-6" />}
                title={isDraggingOver ? 'Drop to upload' : typeFilter !== 'all' ? `No ${typeFilter} files found` : 'No files yet'}
                description={
                  typeFilter !== 'all'
                    ? 'Try switching file filters or clearing your search query.'
                    : 'Drag and drop images or PDFs here, or click to upload. Multiple files at once are supported.'
                }
                action={
                  <Button
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Upload Files
                  </Button>
                }
              />
            </div>
          )}

          {!isLoading && !error && filteredFiles.length > 0 && (
            <div
              className={`rounded-lg p-1 transition-colors ${
                isDraggingOver ? 'bg-indigo-50 ring-2 ring-indigo-400' : ''
              }`}
            >
              {viewMode === 'list' ? (
                <div className="space-y-2">
                  {filteredFiles.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 hover:border-slate-300 transition-colors bg-white"
                    >
                      <FileThumb file={file} />
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => handleRename(file)}
                          className="truncate text-left text-sm font-medium text-slate-900 hover:underline"
                          title="Click to rename"
                        >
                          {file.filename}
                        </button>
                        <div className="text-xs text-slate-500">
                          {(file.size_bytes / 1024).toFixed(0)} KB · {file.mime_type}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Copy URL"
                          onClick={() => handleCopyUrl(file.url)}
                        >
                          <LinkIcon className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Delete"
                          onClick={() => handleDelete(file.id)}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {filteredFiles.map((file) => {
                    const isImage = file.mime_type.startsWith('image/');
                    return (
                      <div
                        key={file.id}
                        className="group relative flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition-all hover:shadow-md"
                      >
                        <div className="relative flex h-36 w-full items-center justify-center bg-slate-100">
                          {isImage ? (
                            <img
                              src={file.url}
                              alt={file.filename}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <FileText className="h-12 w-12 text-slate-400" />
                          )}
                          <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <Button
                              variant="secondary"
                              size="icon"
                              className="h-8 w-8 bg-white/90 shadow"
                              title="Copy URL"
                              onClick={() => handleCopyUrl(file.url)}
                            >
                              <LinkIcon className="h-3.5 w-3.5 text-slate-700" />
                            </Button>
                            <Button
                              variant="secondary"
                              size="icon"
                              className="h-8 w-8 bg-white/90 shadow hover:bg-red-50"
                              title="Delete"
                              onClick={() => handleDelete(file.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-red-600" />
                            </Button>
                          </div>
                        </div>
                        <div className="p-3">
                          <button
                            type="button"
                            onClick={() => handleRename(file)}
                            className="w-full truncate text-left text-sm font-medium text-slate-900 hover:underline"
                            title="Click to rename"
                          >
                            {file.filename}
                          </button>
                          <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                            <span>{(file.size_bytes / 1024).toFixed(0)} KB</span>
                            <span className="uppercase">{file.mime_type.split('/')[1]}</span>
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
    </div>
  );
}


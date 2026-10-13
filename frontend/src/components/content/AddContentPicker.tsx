import { useEffect, useMemo, useRef, useState } from 'react';
import { useFiles, useUploadFile, type LibraryFile } from '@/api/files';
import { usePages, type LandingPage } from '@/api/pages';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getApiErrorMessage } from '@/lib/apiError';
import {
  ATTACHMENT_LIMITS,
  channelSupportsAttachments,
  channelSupportsInlineImage,
  describeRecipientResult,
  fileExtension,
  formatBytes,
  pagePublicUrl,
  type ContentPlacement,
} from '@/lib/contentLinks';
import { FileThumb } from './FileThumb';
import type { MessageChannel } from '@/types';
import { FileText, Search, Upload, X } from 'lucide-react';

export type PickerTab = 'files' | 'pages';

interface UploadItemState {
  key: string;
  file: File;
  status: 'uploading' | 'success' | 'error';
  error?: string;
  uploaded?: LibraryFile;
}

interface AddContentPickerProps {
  open: boolean;
  channel: MessageChannel;
  editorMode: 'simple' | 'visual' | 'html';
  onClose: () => void;
  onAddFile: (file: LibraryFile, placement: ContentPlacement) => void;
  onAddPage: (page: LandingPage, label: string) => void;
  /** Restrict file selection (e.g. gallery blocks need images only, portfolio needs PDFs). Upload still accepts all library types. */
  fileFilter?: 'all' | 'image' | 'pdf';
  allowPages?: boolean;
  initialTab?: PickerTab;
  /** Stable IDs already attached in the current draft — duplicates are blocked. */
  alreadyAttachedIds?: string[];
  dialogTitle?: string;
  /**
   * Restrict which file placements are offered. Unsupported operations stay
   * hidden entirely (e.g. visual/HTML editors only stage attachments — links
   * cannot be inserted into a designed document from here).
   */
  allowedPlacements?: ContentPlacement[];
}

function validateLocalFile(file: File): string | null {
  if (!ATTACHMENT_LIMITS.allowedTypes.includes(file.type as (typeof ATTACHMENT_LIMITS.allowedTypes)[number])) {
    return `Unsupported type “${file.type || 'unknown'}”. Allowed: PNG, JPEG, WEBP, GIF, PDF.`;
  }
  if (file.size > ATTACHMENT_LIMITS.maxBytes) {
    return `“${file.name}” is larger than 10MB.`;
  }
  return null;
}

/**
 * One shared “Add content” picker for template + page editors.
 * Deliberate selection followed by an explicit Add button — clicking a
 * thumbnail never commits content on its own.
 */
export function AddContentPicker({
  open,
  channel,
  editorMode,
  onClose,
  onAddFile,
  onAddPage,
  fileFilter = 'all',
  allowPages = true,
  initialTab = 'files',
  alreadyAttachedIds = [],
  dialogTitle = 'Add content to template',
  allowedPlacements,
}: AddContentPickerProps): React.JSX.Element | null {
  const [tab, setTab] = useState<PickerTab>(initialTab);
  const [fileSearch, setFileSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'image' | 'pdf'>('all');
  const [pageSearch, setPageSearch] = useState('');
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const defaultPlacement: ContentPlacement =
    allowedPlacements && allowedPlacements.length > 0 ? allowedPlacements[0] : 'link';
  const [placement, setPlacement] = useState<ContentPlacement>(defaultPlacement);
  const [pageLabel, setPageLabel] = useState('');
  const [uploads, setUploads] = useState<UploadItemState[]>([]);

  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: files = [], isLoading: filesLoading, error: filesError } = useFiles();
  const { data: pages = [], isLoading: pagesLoading } = usePages();
  const uploadFile = useUploadFile();

  const attachesSupported = channelSupportsAttachments(channel);
  const inlineSupported = channelSupportsInlineImage(channel, editorMode);
  const imageOnly = fileFilter === 'image';
  const pdfOnly = fileFilter === 'pdf';
  const fixedFilter = fileFilter !== 'all';

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    setTab(initialTab);
    setSelectedFileId(null);
    setSelectedPageId(null);
    setPlacement(
      allowedPlacements && allowedPlacements.length > 0 ? allowedPlacements[0] : 'link',
    );
    setPageLabel('');
    setUploads([]);
    const t = window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialTab]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      returnFocusRef.current?.focus?.();
    }
  }, [open]);

  const visibleFiles = useMemo(() => {
    const q = fileSearch.trim().toLowerCase();
    return files
      .filter((f) => {
        if (imageOnly && !f.mime_type.startsWith('image/')) return false;
        if (pdfOnly && !f.mime_type.includes('pdf')) return false;
        if (typeFilter === 'image' && !f.mime_type.startsWith('image/')) return false;
        if (typeFilter === 'pdf' && !f.mime_type.includes('pdf')) return false;
        if (!q) return true;
        return (
          f.filename.toLowerCase().includes(q) ||
          f.mime_type.toLowerCase().includes(q) ||
          (f.tags ?? []).some((t) => t.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [files, fileSearch, typeFilter, imageOnly, pdfOnly]);

  const publishedPages = useMemo(
    () => pages.filter((p) => p.status === 'published'),
    [pages],
  );
  const draftPages = useMemo(() => pages.filter((p) => p.status !== 'published'), [pages]);
  const visiblePublished = useMemo(() => {
    const q = pageSearch.trim().toLowerCase();
    if (!q) return publishedPages;
    return publishedPages.filter(
      (p) => p.title.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q),
    );
  }, [publishedPages, pageSearch]);

  const selectedFile: LibraryFile | null =
    files.find((f) => f.id === selectedFileId) ??
    uploads.find((u) => u.uploaded?.id === selectedFileId)?.uploaded ??
    null;
  const selectedPage: LandingPage | null = pages.find((p) => p.id === selectedPageId) ?? null;

  useEffect(() => {
    if (selectedPage && !pageLabel) setPageLabel(`View ${selectedPage.title}`);
  }, [selectedPage, pageLabel]);

  const runUploads = async (chosen: File[]): Promise<void> => {
    if (chosen.length === 0) return;
    const fresh: UploadItemState[] = chosen.map((file) => {
      const problem = validateLocalFile(file);
      return {
        key: `${file.name}-${file.size}-${file.lastModified}`,
        file,
        status: problem ? 'error' : 'uploading',
        error: problem ?? undefined,
      } as UploadItemState;
    });
    setUploads((prev) => [...fresh.filter((f) => f.status === 'uploading'), ...prev]);
    const failed: UploadItemState[] = fresh.filter((f) => f.status === 'error');
    if (failed.length > 0) {
      setUploads((prev) => [...failed.map((f) => ({ ...f })), ...prev]);
    }

    for (const item of fresh.filter((f) => f.status === 'uploading')) {
      setUploads((prev) => [...prev.filter((p) => p.key !== item.key), { ...item }]);
      try {
        const uploaded = await uploadFile.mutateAsync(item.file);
        setUploads((prev) => prev.map((p) => (p.key === item.key ? { ...p, status: 'success', uploaded } : p)));
        setSelectedFileId(uploaded.id);
        setSelectedPageId(null);
      } catch (err) {
        setUploads((prev) =>
          prev.map((p) =>
            p.key === item.key ? { ...p, status: 'error', error: getApiErrorMessage(err, 'Upload failed. Check the file type and size, then retry.') } : p,
          ),
        );
      }
    }
    const okCount = uploads.filter((u) => u.status === 'success').length;
    void okCount;
  };

  const retryFailed = async (): Promise<void> => {
    const failed = uploads.filter((u) => u.status === 'error' && !validateLocalFile(u.file));
    if (failed.length === 0) return;
    setUploads((prev) => prev.map((p) => (failed.some((f) => f.key === p.key) ? { ...p, status: 'uploading', error: undefined } : p)));
    for (const item of failed) {
      try {
        const uploaded = await uploadFile.mutateAsync(item.file);
        setUploads((prev) => prev.map((p) => (p.key === item.key ? { ...p, status: 'success', uploaded } : p)));
        setSelectedFileId(uploaded.id);
      } catch (err) {
        setUploads((prev) =>
          prev.map((p) =>
            p.key === item.key ? { ...p, status: 'error', error: getApiErrorMessage(err, 'Upload failed. Check the file type and size, then retry.') } : p,
          ),
        );
      }
    }
  };

  if (!open) return null;

  const uploadingCount = uploads.filter((u) => u.status === 'uploading').length;
  const failedUploads = uploads.filter((u) => u.status === 'error');
  const placementOptions: Array<{ value: ContentPlacement; label: string; hint: string; disabled?: boolean; disabledReason?: string }> = ([
    { value: 'link', label: 'Add download link', hint: channel === 'sms' || channel === 'phone_call' ? 'Plain text plus the file URL.' : 'A readable link using the file name.' },
    {
      value: 'attach',
      label: 'Attach file',
      hint: channel === 'email' ? 'Sent along with the message (max 3, 10MB each).' : 'Sent as WhatsApp media (only the first attachment).',
      disabled: !attachesSupported || (selectedFile != null && alreadyAttachedIds.includes(selectedFile.id)),
      disabledReason: !attachesSupported
        ? 'Attachments are not sent on this channel — use a download link instead.'
        : selectedFile != null && alreadyAttachedIds.includes(selectedFile.id)
          ? 'This file is already attached to the current draft.'
          : undefined,
    },
    {
      value: 'image',
      label: 'Insert image',
      hint: 'Inline image in the designed email with alt text.',
      disabled: !inlineSupported,
      disabledReason: !inlineSupported ? 'Inline images are only available in the visual email editor.' : undefined,
    },
  ] as Array<{ value: ContentPlacement; label: string; hint: string; disabled?: boolean; disabledReason?: string }>).filter(
    (opt) => !allowedPlacements || allowedPlacements.includes(opt.value),
  );

  const attachOption = placementOptions.find((opt) => opt.value === 'attach');
  const canAddFile =
    selectedFile != null &&
    (placement !== 'attach' || (attachOption != null && !attachOption.disabled));
  const canAddPage = selectedPage != null && selectedPage.status === 'published' && pageLabel.trim().length > 0;

  const handleAdd = (): void => {
    if (tab === 'files' && selectedFile) {
      if (placement === 'attach' && (attachOption == null || attachOption.disabled)) return;
      onAddFile(selectedFile, placement);
      return;
    }
    if (tab === 'pages' && selectedPage) {
      onAddPage(selectedPage, pageLabel.trim() || `View ${selectedPage.title}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-2 sm:p-4" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={dialogTitle}
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-slate-900">{dialogTitle}</h2>
            <p className="text-xs text-slate-500">Select an item, choose how to add it, then press Add selected.</p>
          </div>
          <Button ref={closeRef} variant="ghost" size="icon" onClick={onClose} aria-label="Close content picker">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {allowPages && (
          <div className="flex gap-1 border-b border-slate-100 px-4 pt-2" role="tablist" aria-label="Content type">
            {(['files', 'pages'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`min-h-[44px] rounded-t px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${tab === t ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:text-slate-800'}`}
              >
                {t === 'files' ? 'Files' : 'Landing pages'}
              </button>
            ))}
          </div>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-h-0 overflow-y-auto p-4">
            {tab === 'files' && (
              <div className="space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="relative min-w-0 flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                    <Input
                      aria-label="Search files"
                      placeholder="Search files by name or tag…"
                      value={fileSearch}
                      onChange={(e) => setFileSearch(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  {!fixedFilter && (
                    <div className="flex items-center gap-1" role="group" aria-label="File type filter">
                      {(['all', 'image', 'pdf'] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setTypeFilter(t)}
                          aria-pressed={typeFilter === t}
                          className={`min-h-[44px] rounded-md px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${typeFilter === t ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                        >
                          {t === 'all' ? 'All' : t === 'image' ? 'Images' : 'PDFs'}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ATTACHMENT_LIMITS.allowedTypes.join(',')}
                    multiple
                    className="hidden"
                    aria-hidden="true"
                    tabIndex={-1}
                    onChange={(e) => {
                      const chosen = Array.from(e.target.files ?? []);
                      e.target.value = '';
                      void runUploads(chosen);
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-[44px]"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingCount > 0}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    {uploadingCount > 0 ? `Uploading… (${uploadingCount})` : 'Upload files'}
                  </Button>
                  <span className="text-xs text-slate-500">PNG, JPEG, WEBP, GIF, PDF · 10MB each. Uploads stay in the library if you cancel.</span>
                </div>

                <div aria-live="polite" className="space-y-1">
                  {uploadingCount > 0 && (
                    <p role="status" className="rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
                      Uploading {uploadingCount} file{uploadingCount === 1 ? '' : 's'}… You can keep browsing; the new file will be selected when ready.
                    </p>
                  )}
                  {failedUploads.map((u) => (
                    <p key={u.key} role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                      {u.file.name}: {u.error}
                    </p>
                  ))}
                  {failedUploads.some((u) => !validateLocalFile(u.file)) && (
                    <Button type="button" variant="outline" size="sm" onClick={() => void retryFailed()}>
                      Retry failed uploads
                    </Button>
                  )}
                </div>

                {filesLoading && <p role="status" className="text-sm text-slate-500">Loading files…</p>}
                {filesError && (
                  <p role="alert" className="text-sm text-red-600">
                    Could not load files. Close this picker and try again.
                  </p>
                )}
                {!filesLoading && !filesError && visibleFiles.length === 0 && (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/70 p-6 text-center">
                    <p className="text-sm font-medium text-slate-800">
                      {files.length === 0 ? (imageOnly ? 'No images in the library yet' : pdfOnly ? 'No PDFs in the library yet' : 'No files in the library yet') : 'No matches'}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {files.length === 0
                        ? 'Upload an image or PDF above — it stays in the library and can be selected right away.'
                        : 'Try a different search or filter, or upload a new file above.'}
                    </p>
                    {files.length > 0 && (fileSearch || typeFilter !== 'all') && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-3 min-h-[44px]"
                        onClick={() => {
                          setFileSearch('');
                          setTypeFilter('all');
                        }}
                      >
                        Clear filters
                      </Button>
                    )}
                  </div>
                )}

                <ul className="space-y-2" aria-label="Files">
                  {visibleFiles.map((file) => {
                    const selected = file.id === selectedFileId;
                    const alreadyAttached = alreadyAttachedIds.includes(file.id);
                    return (
                      <li key={file.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedFileId(file.id);
                            setSelectedPageId(null);
                          }}
                          aria-pressed={selected}
                          className={`flex w-full items-center gap-3 rounded-md border p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${selected ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50'}`}
                        >
                          <FileThumb url={file.url} filename={file.filename} mimeType={file.mime_type} size="sm" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-slate-900" title={file.filename}>
                              {file.filename}
                            </span>
                            <span className="block text-xs text-slate-500">
                              {fileExtension(file.filename)} · {formatBytes(file.size_bytes)}
                              {alreadyAttached ? ' · already in draft' : ''}
                            </span>
                          </span>
                          {selected && (
                            <span className="shrink-0 rounded-full bg-indigo-600 px-2 py-0.5 text-[11px] font-medium text-white">
                              Selected
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {tab === 'pages' && (
              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                  <Input
                    aria-label="Search landing pages"
                    placeholder="Search landing pages by title…"
                    value={pageSearch}
                    onChange={(e) => setPageSearch(e.target.value)}
                    className="pl-10"
                  />
                </div>
                {pagesLoading && <p role="status" className="text-sm text-slate-500">Loading pages…</p>}
                {!pagesLoading && publishedPages.length === 0 && (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/70 p-6 text-center">
                    <p className="text-sm font-medium text-slate-800">No published pages to share yet</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {pages.length === 0
                        ? 'Create a landing page first, then publish it before adding it to a template.'
                        : 'Only published pages can be inserted. Drafts stay private until you publish them.'}
                    </p>
                  </div>
                )}
                {!pagesLoading && publishedPages.length > 0 && visiblePublished.length === 0 && (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/70 p-6 text-center">
                    <p className="text-sm font-medium text-slate-800">No matches</p>
                    <p className="mt-1 text-xs text-slate-500">Try a different search term.</p>
                    <Button type="button" variant="outline" size="sm" className="mt-3 min-h-[44px]" onClick={() => setPageSearch('')}>
                      Clear search
                    </Button>
                  </div>
                )}
                {visiblePublished.length > 0 && (
                  <ul className="space-y-2" aria-label="Published landing pages">
                    {visiblePublished.map((page) => {
                      const selected = page.id === selectedPageId;
                      return (
                        <li key={page.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedPageId(page.id);
                              setSelectedFileId(null);
                              setPageLabel(`View ${page.title}`);
                            }}
                            aria-pressed={selected}
                            className={`flex w-full items-center gap-3 rounded-md border p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${selected ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50'}`}
                          >
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-indigo-50">
                              <FileText className="h-4 w-4 text-indigo-600" aria-hidden="true" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-slate-900" title={page.title}>
                                {page.title}
                              </span>
                              <span className="block truncate font-mono text-xs text-slate-500">/p/{page.slug}</span>
                            </span>
                            {selected && (
                              <span className="shrink-0 rounded-full bg-indigo-600 px-2 py-0.5 text-[11px] font-medium text-white">
                                Selected
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {draftPages.length > 0 && (
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="text-xs font-medium text-slate-700">
                      {draftPages.length} draft{draftPages.length === 1 ? '' : 's'} not shown for sharing
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Publish a page before sharing — drafts cannot be inserted as public links.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          <aside className="flex min-h-0 flex-col border-t border-slate-200 bg-slate-50/60 md:border-l md:border-t-0" aria-label="Selection preview">
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {tab === 'files' && !selectedFile && (
                <p className="text-sm text-slate-500">Choose a file to preview it and pick how to add it.</p>
              )}
              {tab === 'files' && selectedFile && (
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <FileThumb url={selectedFile.url} filename={selectedFile.filename} mimeType={selectedFile.mime_type} size="lg" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900" title={selectedFile.filename}>
                        {selectedFile.filename}
                      </p>
                      <p className="text-xs text-slate-500">
                        {fileExtension(selectedFile.filename)} · {formatBytes(selectedFile.size_bytes)}
                      </p>
                      {(selectedFile.tags ?? []).length > 0 && (
                        <p className="mt-1 text-xs text-slate-500">Tags: {(selectedFile.tags ?? []).join(', ')}</p>
                      )}
                    </div>
                  </div>
                  <fieldset className="space-y-2">
                    <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">How to add it</legend>
                    {placementOptions.map((opt) => (
                      <label
                        key={opt.value}
                        className={`flex cursor-pointer items-start gap-2 rounded-md border p-2 ${opt.disabled ? 'cursor-not-allowed border-slate-200 bg-slate-100 opacity-70' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                      >
                        <input
                          type="radio"
                          name="placement"
                          value={opt.value}
                          checked={placement === opt.value}
                          disabled={opt.disabled}
                          onChange={() => setPlacement(opt.value)}
                          className="mt-1"
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-slate-900">{opt.label}</span>
                          <span className="block text-xs text-slate-500">{opt.disabled && opt.disabledReason ? opt.disabledReason : opt.hint}</span>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  {placement === 'page-link' || placement === 'link' || placement === 'attach' || placement === 'image' ? (
                    <p role="status" className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                      {describeRecipientResult(channel, placement, selectedFile, null)}
                    </p>
                  ) : null}
                </div>
              )}
              {tab === 'pages' && !selectedPage && (
                <p className="text-sm text-slate-500">Choose a published page to preview its link.</p>
              )}
              {tab === 'pages' && selectedPage && (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-slate-900">{selectedPage.title}</p>
                  <p className="break-all font-mono text-xs text-slate-500">{pagePublicUrl(selectedPage.slug)}</p>
                  {selectedPage.description && (
                    <p className="text-xs text-slate-500">{selectedPage.description}</p>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="picker-page-label">Link label</Label>
                    <Input
                      id="picker-page-label"
                      value={pageLabel}
                      onChange={(e) => setPageLabel(e.target.value)}
                      placeholder={`View ${selectedPage.title}`}
                    />
                  </div>
                  <p role="status" className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                    {describeRecipientResult(channel, 'page-link', null, selectedPage)}
                  </p>
                </div>
              )}
            </div>
            <div className="sticky bottom-0 flex gap-2 border-t border-slate-200 bg-white p-3">
              <Button type="button" variant="outline" className="min-h-[44px] flex-1" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                className="min-h-[44px] flex-1"
                disabled={tab === 'files' ? !canAddFile : !canAddPage}
                onClick={handleAdd}
              >
                Add selected
              </Button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

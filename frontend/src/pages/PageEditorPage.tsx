import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  usePage,
  useCreatePage,
  useUpdatePage,
  usePublishPage,
  useUnpublishPage,
  type PageBlock,
} from '@/api/pages';
import { useFiles, type LibraryFile } from '@/api/files';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { AddContentPicker } from '@/components/content/AddContentPicker';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
import { resolveAssetUrl } from '@/lib/contentLinks';
import { AICopyModal } from '@/components/AICopyModal';
import { SeoSocialPreviewCard } from '@/components/SeoSocialPreviewCard';
import {
  ArrowLeft,
  FileText,
  Images,
  Link2,
  MapPin,
  Paperclip,
  Save,
  Sparkles,
  Trash2,
  Video,
  X,
} from 'lucide-react';

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ── File selection reuses the shared AddContentPicker (with in-picker upload).
// Gallery blocks select images only; attachment blocks accept any library file.

const PAGE_PRESETS: Array<{
  key: string;
  name: string;
  title: string;
  description: string;
  blocks: PageBlock[];
}> = [
  {
    key: 'product-overview',
    name: 'Product overview',
    title: 'Product overview',
    description: 'A short summary of what you offer and who it is for. Replace this text with your own copy.',
    blocks: [
      { type: 'link', label: 'Visit our website', url: 'https://example.com' },
      { type: 'map', address: 'Your street address, City' },
    ],
  },
  {
    key: 'pricing',
    name: 'Pricing',
    title: 'Pricing',
    description: 'Summarize your plans and what each includes. Replace the example link with your pricing page.',
    blocks: [
      { type: 'link', label: 'See full pricing', url: 'https://example.com/pricing' },
    ],
  },
  {
    key: 'offer',
    name: 'Offer',
    title: 'Special offer',
    description: 'Describe the offer, who is eligible, and when it ends. Replace the example link with your offer page.',
    blocks: [
      { type: 'link', label: 'Claim the offer', url: 'https://example.com/offer' },
    ],
  },
];

// ── Block editors ─────────────────────────────────────────────────────────────

function BlockCard({
  icon,
  label,
  onRemove,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
          {icon}
          {label}
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={onRemove}>
          <Trash2 className="h-4 w-4 text-red-500" />
        </Button>
      </div>
      {children}
    </div>
  );
}

function GalleryImage({ file }: { file: LibraryFile }): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="flex h-16 w-16 items-center justify-center rounded bg-slate-100 px-1 text-center text-[10px] text-slate-400" title={file.filename}>
        unavailable
      </div>
    );
  }
  return (
    <img src={resolveAssetUrl(file.url)} alt={file.filename} title={file.filename} className="h-16 w-16 rounded object-cover" loading="lazy" onError={() => setFailed(true)} />
  );
}

function GalleryBlockEditor({
  block,
  filesById,
  onChange,
  onRemove,
}: {
  block: Extract<PageBlock, { type: 'gallery' }>;
  filesById: Map<string, LibraryFile>;
  onChange: (block: PageBlock) => void;
  onRemove: () => void;
}) {
  const [picking, setPicking] = useState(false);

  return (
    <BlockCard icon={<Images className="h-4 w-4" />} label="Image Gallery" onRemove={onRemove}>
      <div className="flex flex-wrap gap-2">
        {block.fileIds.map((id) => {
          const file = filesById.get(id);
          return (
            <div key={id} className="relative">
              {file ? (
                <GalleryImage file={file} />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded bg-slate-100 text-xs text-slate-400">
                  missing
                </div>
              )}
              <button
                type="button"
                onClick={() => onChange({ ...block, fileIds: block.fileIds.filter((f) => f !== id) })}
                className="absolute -right-1.5 -top-1.5 min-h-[44px] min-w-[44px] rounded-full bg-white p-2 shadow ring-1 ring-slate-200"
                aria-label={`Remove ${file?.filename ?? 'image'}`}
              >
                <X className="h-3 w-3 text-slate-500" />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => setPicking(true)}
          aria-label="Add images from library"
          className="flex h-16 min-h-[44px] w-16 items-center justify-center rounded border border-dashed border-slate-300 text-slate-400 hover:border-slate-400 hover:text-slate-600"
        >
          +
        </button>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">Images only. Upload new files without leaving this editor.</p>
      {picking && (
        <AddContentPicker
          open
          channel="email"
          editorMode="simple"
          fileFilter="image"
          allowPages={false}
          dialogTitle="Choose images from library"
          onClose={() => setPicking(false)}
          onAddFile={(file) => {
            setPicking(false);
            onChange({ ...block, fileIds: Array.from(new Set([...block.fileIds, file.id])) });
          }}
          onAddPage={() => undefined}
        />
      )}
    </BlockCard>
  );
}

function LinkBlockEditor({
  block,
  onChange,
  onRemove,
}: {
  block: Extract<PageBlock, { type: 'link' }>;
  onChange: (block: PageBlock) => void;
  onRemove: () => void;
}) {
  return (
    <BlockCard icon={<Link2 className="h-4 w-4" />} label="Website Link" onRemove={onRemove}>
      <div className="space-y-2">
        <Input
          placeholder="Label, e.g. Visit our website"
          value={block.label}
          onChange={(e) => onChange({ ...block, label: e.target.value })}
        />
        <Input
          placeholder="https://…"
          value={block.url}
          onChange={(e) => onChange({ ...block, url: e.target.value })}
        />
      </div>
    </BlockCard>
  );
}

function AttachmentBlockEditor({
  block,
  filesById,
  onChange,
  onRemove,
}: {
  block: Extract<PageBlock, { type: 'attachment' }>;
  filesById: Map<string, LibraryFile>;
  onChange: (block: PageBlock) => void;
  onRemove: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const file = filesById.get(block.fileId);

  return (
    <BlockCard icon={<Paperclip className="h-4 w-4" />} label="File Attachment" onRemove={onRemove}>
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="flex w-full items-center gap-2 rounded-md border border-slate-200 p-2 text-left text-sm hover:bg-slate-50"
        >
          <FileText className="h-4 w-4 shrink-0 text-slate-500" />
          {file ? file.filename : 'Choose a file…'}
        </button>
        <Input
          placeholder="Display label (optional)"
          value={block.label ?? ''}
          onChange={(e) => onChange({ ...block, label: e.target.value })}
        />
      </div>
      {picking && (
        <AddContentPicker
          open
          channel="email"
          editorMode="simple"
          allowPages={false}
          dialogTitle="Choose a file from library"
          onClose={() => setPicking(false)}
          onAddFile={(file) => {
            setPicking(false);
            onChange({ ...block, fileId: file.id });
          }}
          onAddPage={() => undefined}
        />
      )}
    </BlockCard>
  );
}

function VideoBlockEditor({
  block,
  onChange,
  onRemove,
}: {
  block: Extract<PageBlock, { type: 'video' }>;
  onChange: (block: PageBlock) => void;
  onRemove: () => void;
}) {
  return (
    <BlockCard icon={<Video className="h-4 w-4" />} label="YouTube Video" onRemove={onRemove}>
      <Input
        placeholder="https://www.youtube.com/watch?v=…"
        value={block.youtubeUrl}
        onChange={(e) => onChange({ ...block, youtubeUrl: e.target.value })}
      />
    </BlockCard>
  );
}

function MapBlockEditor({
  block,
  onChange,
  onRemove,
}: {
  block: Extract<PageBlock, { type: 'map' }>;
  onChange: (block: PageBlock) => void;
  onRemove: () => void;
}) {
  return (
    <BlockCard icon={<MapPin className="h-4 w-4" />} label="Google Map" onRemove={onRemove}>
      <Input
        placeholder="Address, e.g. 1 Infinite Loop, Cupertino, CA"
        value={block.address}
        onChange={(e) => onChange({ ...block, address: e.target.value })}
      />
    </BlockCard>
  );
}

const ADD_BLOCK_OPTIONS: Array<{ type: PageBlock['type']; label: string; icon: React.ReactNode }> = [
  { type: 'gallery', label: 'Image Gallery', icon: <Images className="mr-1.5 h-3.5 w-3.5" /> },
  { type: 'link', label: 'Website Link', icon: <Link2 className="mr-1.5 h-3.5 w-3.5" /> },
  { type: 'attachment', label: 'Attachment', icon: <Paperclip className="mr-1.5 h-3.5 w-3.5" /> },
  { type: 'video', label: 'YouTube Video', icon: <Video className="mr-1.5 h-3.5 w-3.5" /> },
  { type: 'map', label: 'Google Map', icon: <MapPin className="mr-1.5 h-3.5 w-3.5" /> },
];

function newBlock(type: PageBlock['type']): PageBlock {
  switch (type) {
    case 'gallery':
      return { type: 'gallery', fileIds: [] };
    case 'link':
      return { type: 'link', label: '', url: '' };
    case 'attachment':
      return { type: 'attachment', fileId: '', label: '' };
    case 'video':
      return { type: 'video', youtubeUrl: '' };
    case 'map':
      return { type: 'map', address: '' };
  }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function PageEditorPage() {
  const { id } = useParams<{ id?: string }>();
  const isEdit = !!id;
  const navigate = useNavigate();
  const { showToast } = useToast();

  const { data: existing } = usePage(id ?? '');
  const { data: files = [] } = useFiles();
  const createPage = useCreatePage();
  const updatePage = useUpdatePage();
  const publishPage = usePublishPage();
  const unpublishPage = useUnpublishPage();

  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [blocks, setBlocks] = useState<PageBlock[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showAiModal, setShowAiModal] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const filesById = new Map(files.map((f) => [f.id, f]));

  useEffect(() => {
    if (existing) {
      setTitle(existing.title);
      setSlug(existing.slug);
      setDescription(existing.description ?? '');
      setBlocks(existing.blocks ?? []);
      setSlugTouched(true);
      setDirty(false);
    }
  }, [existing]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const markDirty = () => setDirty(true);

  const applyPreset = (key: string) => {
    const preset = PAGE_PRESETS.find((p) => p.key === key);
    if (!preset) return;
    setTitle(preset.title);
    if (!slugTouched) setSlug(slugify(preset.title));
    setDescription(preset.description);
    setBlocks(JSON.parse(JSON.stringify(preset.blocks)) as PageBlock[]);
    markDirty();
    showToast(`“${preset.name}” preset applied — edit the placeholders before publishing.`, 'success');
  };

  const handleTitleChange = (value: string) => {
    setTitle(value);
    markDirty();
    if (!slugTouched) setSlug(slugify(value));
  };

  const handleApplyAiCopy = (generated: { title: string; description: string; blocks: PageBlock[] }) => {
    setTitle(generated.title);
    if (!slugTouched) setSlug(slugify(generated.title));
    setDescription(generated.description);
    if (generated.blocks.length > 0) {
      setBlocks((prev) => [...prev, ...generated.blocks]);
    }
    markDirty();
    showToast('AI copy applied to page editor.', 'success');
  };

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!title.trim()) errs.title = 'Title is required';
    if (!slug.trim()) errs.slug = 'Slug is required';
    else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
      errs.slug = 'Slug must be lowercase letters, numbers, and hyphens only';
    }
    const invalidBlock = blocks.find((b) => {
      if (b.type === 'gallery') return b.fileIds.length === 0;
      if (b.type === 'link') return !b.label.trim() || !b.url.trim();
      if (b.type === 'attachment') return !b.fileId;
      if (b.type === 'video') return !b.youtubeUrl.trim();
      if (b.type === 'map') return !b.address.trim();
      return false;
    });
    if (invalidBlock) errs.blocks = 'Fill in or remove any incomplete content block';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const input = { title: title.trim(), slug: slug.trim(), description: description.trim() || null, blocks };

    try {
      if (isEdit && id) {
        await updatePage.mutateAsync({ id, input });
        showToast('Draft saved. Publishing is a separate step — nothing goes public until you publish.', 'success');
        setDirty(false);
      } else {
        const created = await createPage.mutateAsync(input);
        showToast('Draft saved. Publish it from the editor when it is ready to share.', 'success');
        setDirty(false);
        if (created) navigate(`/pages/${created.id}/edit`, { replace: true });
      }
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to save page.'), 'error');
    }
  };

  const handlePublish = async () => {
    if (!isEdit || !id) {
      showToast('Save the draft first, then publish it from the editor.', 'error');
      return;
    }
    if (!validate()) return;
    try {
      const input = { title: title.trim(), slug: slug.trim(), description: description.trim() || null, blocks };
      await updatePage.mutateAsync({ id, input });
      await publishPage.mutateAsync(id);
      showToast('Page published. It can now be shared from templates.', 'success');
      setDirty(false);
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to publish page.'), 'error');
    }
  };

  const handleTogglePublish = async () => {
    if (!id || !existing) return;
    try {
      if (existing.status === 'published') {
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

  const updateBlock = (index: number, next: PageBlock) => {
    setBlocks((current) => current.map((b, i) => (i === index ? next : b)));
    markDirty();
  };

  const removeBlock = (index: number) => {
    setBlocks((current) => current.filter((_, i) => i !== index));
    markDirty();
  };

  const addBlock = (type: PageBlock['type']) => {
    setBlocks((current) => [...current, newBlock(type)]);
    markDirty();
  };

  const saving = createPage.isPending || updatePage.isPending;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Content"
        title={isEdit ? 'Edit Page' : 'New Page'}
        description={isEdit ? 'Update this page. Saving keeps it as a draft until you publish.' : 'Create a new page. It stays a private draft until you publish it.'}
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowAiModal(true)}
              className="border-indigo-200 bg-indigo-50/50 text-indigo-700 hover:bg-indigo-100"
            >
              <Sparkles className="mr-2 h-4 w-4 text-indigo-600" />
              AI Generate Copy
            </Button>
            <Button variant="outline" size="sm" onClick={() => (dirty ? setConfirmCancel(true) : navigate('/pages'))}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Cancel
            </Button>
          </div>
        }
      />
      {dirty && (
        <p role="status" className="text-xs text-amber-700">Unsaved changes — save the draft before leaving.</p>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardContent className="pt-6">
              <form onSubmit={handleSubmit} className="space-y-5">
                {isEdit && existing && (
                  <div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <StatusBadge tone={existing.status === 'published' ? 'green' : 'gray'}>
                        {existing.status}
                      </StatusBadge>
                      {existing.status === 'published' && (
                        <a
                          href={`/p/${existing.slug}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-indigo-600 hover:underline"
                        >
                          View public page
                        </a>
                      )}
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={handleTogglePublish}>
                      {existing.status === 'published' ? 'Unpublish' : 'Publish'}
                    </Button>
                  </div>
                )}

                {!isEdit && blocks.length === 0 && (
                  <div className="rounded-md border border-dashed border-slate-300 bg-slate-50/60 p-3">
                    <p className="text-xs font-medium text-slate-700">Start from a preset (optional)</p>
                    <p className="mt-0.5 text-xs text-slate-500">Neutral placeholders you edit before publishing — no customer claims.</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {PAGE_PRESETS.map((p) => (
                        <Button key={p.key} type="button" variant="outline" size="sm" className="min-h-[44px] text-xs" onClick={() => applyPreset(p.key)}>
                          {p.name}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="title">Title *</Label>
                    <button
                      type="button"
                      onClick={() => setShowAiModal(true)}
                      className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline"
                    >
                      <Sparkles className="h-3 w-3" />
                      Auto-fill with AI
                    </button>
                  </div>
                  <Input
                    id="title"
                    value={title}
                    onChange={(e) => handleTitleChange(e.target.value)}
                    placeholder="e.g. Pricing"
                  />
                  {errors.title && <p className="text-xs text-red-600">{errors.title}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="slug">Slug *</Label>
                  <div className="flex items-center gap-1 text-sm text-slate-500">
                    <span>/p/</span>
                    <Input
                      id="slug"
                      value={slug}
                      onChange={(e) => {
                        setSlug(e.target.value);
                        setSlugTouched(true);
                        markDirty();
                      }}
                      placeholder="pricing"
                      className="flex-1"
                    />
                  </div>
                  {errors.slug && <p className="text-xs text-red-600">{errors.slug}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => { setDescription(e.target.value); markDirty(); }}
                    rows={4}
                    placeholder="A short summary shown at the top of the page."
                  />
                </div>

                <div className="space-y-3">
                  <Label>Content Blocks</Label>
                  {blocks.map((block, index) => {
                    const key = `${block.type}-${index}`;
                    if (block.type === 'gallery') {
                      return (
                        <GalleryBlockEditor
                          key={key}
                          block={block}
                          filesById={filesById}
                          onChange={(next) => updateBlock(index, next)}
                          onRemove={() => removeBlock(index)}
                        />
                      );
                    }
                    if (block.type === 'link') {
                      return (
                        <LinkBlockEditor
                          key={key}
                          block={block}
                          onChange={(next) => updateBlock(index, next)}
                          onRemove={() => removeBlock(index)}
                        />
                      );
                    }
                    if (block.type === 'attachment') {
                      return (
                        <AttachmentBlockEditor
                          key={key}
                          block={block}
                          filesById={filesById}
                          onChange={(next) => updateBlock(index, next)}
                          onRemove={() => removeBlock(index)}
                        />
                      );
                    }
                    if (block.type === 'video') {
                      return (
                        <VideoBlockEditor
                          key={key}
                          block={block}
                          onChange={(next) => updateBlock(index, next)}
                          onRemove={() => removeBlock(index)}
                        />
                      );
                    }
                    return (
                      <MapBlockEditor
                        key={key}
                        block={block}
                        onChange={(next) => updateBlock(index, next)}
                        onRemove={() => removeBlock(index)}
                      />
                    );
                  })}
                  {errors.blocks && <p className="text-xs text-red-600">{errors.blocks}</p>}

                  <div className="flex flex-wrap gap-2">
                    {ADD_BLOCK_OPTIONS.map((opt) => (
                      <Button
                        key={opt.type}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => addBlock(opt.type)}
                      >
                        {opt.icon}
                        {opt.label}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 pt-2">
                  <Button type="submit" disabled={saving} className="min-h-[44px]">
                    <Save className="mr-2 h-4 w-4" />
                    {saving ? 'Saving…' : isEdit ? 'Save draft' : 'Save draft'}
                  </Button>
                  <Button type="button" variant="outline" className="min-h-[44px]" onClick={() => setShowPreview(true)}>
                    Preview
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-[44px]"
                    disabled={publishPage.isPending || (!isEdit && blocks.length === 0 && !title.trim())}
                    title={!isEdit ? 'Save the draft first, then publish' : undefined}
                    onClick={() => void handlePublish()}
                  >
                    {existing?.status === 'published' ? 'Publish changes' : 'Publish'}
                  </Button>
                  <Button type="button" variant="ghost" className="min-h-[44px]" onClick={() => (dirty ? setConfirmCancel(true) : navigate('/pages'))}>
                    Cancel
                  </Button>
                </div>
                {!isEdit && (
                  <p className="text-xs text-slate-500">New pages are saved as private drafts. Publishing is a separate, explicit step.</p>
                )}
              </form>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-1 space-y-6">
          <SeoSocialPreviewCard
            title={title}
            slug={slug}
            description={description}
            blocks={blocks}
            filesById={filesById}
          />
        </div>
      </div>

      <AICopyModal
        isOpen={showAiModal}
        onClose={() => setShowAiModal(false)}
        onApply={handleApplyAiCopy}
      />

      {showPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowPreview(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Draft preview: ${title || 'Untitled page'}`}
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-slate-900">{title || 'Untitled page'}</h2>
                <p className="mt-0.5 font-mono text-xs text-slate-500">/p/{slug || '…'}</p>
              </div>
              <Button variant="ghost" size="icon" className="min-h-[44px] min-w-[44px]" onClick={() => setShowPreview(false)} aria-label="Close draft preview">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Draft preview — not publicly shareable until you publish.
            </p>
            {description && <p className="mt-3 text-sm text-slate-700">{description}</p>}
            <div className="mt-3 space-y-2">
              {blocks.map((b, i) => (
                <div key={`${b.type}-${i}`} className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  {b.type === 'gallery' && `Image gallery · ${b.fileIds.length} image${b.fileIds.length === 1 ? '' : 's'}`}
                  {b.type === 'link' && `Link · ${b.label || '(no label)'} → ${b.url || '(no URL)'}`}
                  {b.type === 'attachment' && `Attachment · ${b.label || filesById.get(b.fileId)?.filename || '(no file)'}`}
                  {b.type === 'video' && `Video · ${b.youtubeUrl || '(no URL)'}`}
                  {b.type === 'map' && `Map · ${b.address || '(no address)'}`}
                </div>
              ))}
              {blocks.length === 0 && <p className="text-xs text-slate-500">No content blocks yet.</p>}
            </div>
          </div>
        </div>
      )}

      <AlertDialog
        open={confirmCancel}
        title="Discard unsaved changes?"
        description="You have unsaved changes in this page editor. Leaving now discards them."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        variant="destructive"
        onConfirm={() => { setConfirmCancel(false); navigate('/pages'); }}
        onCancel={() => setConfirmCancel(false)}
      />
    </div>
  );
}


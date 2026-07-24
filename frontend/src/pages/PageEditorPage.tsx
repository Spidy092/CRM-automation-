import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
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
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
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

// ── File picker modal (shared by gallery + attachment blocks) ────────────────

function FilePickerModal({
  multiple,
  onSelect,
  onClose,
}: {
  multiple: boolean;
  onSelect: (fileIds: string[]) => void;
  onClose: () => void;
}) {
  const { data: files = [], isLoading } = useFiles();
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (file: LibraryFile) => {
    if (!multiple) {
      onSelect([file.id]);
      return;
    }
    setSelected((current) =>
      current.includes(file.id) ? current.filter((id) => id !== file.id) : [...current, file.id],
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">
            Choose {multiple ? 'images' : 'a file'} from library
          </h3>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
        {!isLoading && files.length === 0 && (
          <p className="text-sm text-slate-500">
            No files in the library yet. Upload some from the Files tab first.
          </p>
        )}
        <div className="space-y-2">
          {files.map((file) => (
            <button
              key={file.id}
              type="button"
              onClick={() => toggle(file)}
              className={`flex w-full items-center gap-3 rounded-md border p-2 text-left hover:bg-slate-50 ${
                selected.includes(file.id) ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200'
              }`}
            >
              {file.mime_type.startsWith('image/') ? (
                <img src={file.url} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
              ) : (
                <FileText className="h-6 w-6 shrink-0 text-slate-500" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-900">{file.filename}</div>
                <div className="text-xs text-slate-500">{(file.size_bytes / 1024).toFixed(0)} KB</div>
              </div>
            </button>
          ))}
        </div>
        {multiple && (
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" size="sm" disabled={selected.length === 0} onClick={() => onSelect(selected)}>
              Add {selected.length || ''} image{selected.length === 1 ? '' : 's'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

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
                <img src={file.url} alt="" className="h-16 w-16 rounded object-cover" />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded bg-slate-100 text-xs text-slate-400">
                  missing
                </div>
              )}
              <button
                type="button"
                onClick={() => onChange({ ...block, fileIds: block.fileIds.filter((f) => f !== id) })}
                className="absolute -right-1.5 -top-1.5 rounded-full bg-white p-0.5 shadow ring-1 ring-slate-200"
              >
                <X className="h-3 w-3 text-slate-500" />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="flex h-16 w-16 items-center justify-center rounded border border-dashed border-slate-300 text-slate-400 hover:border-slate-400 hover:text-slate-600"
        >
          +
        </button>
      </div>
      {picking && (
        <FilePickerModal
          multiple
          onClose={() => setPicking(false)}
          onSelect={(ids) => {
            setPicking(false);
            onChange({ ...block, fileIds: Array.from(new Set([...block.fileIds, ...ids])) });
          }}
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
        <FilePickerModal
          multiple={false}
          onClose={() => setPicking(false)}
          onSelect={([id]) => {
            setPicking(false);
            onChange({ ...block, fileId: id });
          }}
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

  const filesById = new Map(files.map((f) => [f.id, f]));

  useEffect(() => {
    if (existing) {
      setTitle(existing.title);
      setSlug(existing.slug);
      setDescription(existing.description ?? '');
      setBlocks(existing.blocks ?? []);
      setSlugTouched(true);
    }
  }, [existing]);

  const handleTitleChange = (value: string) => {
    setTitle(value);
    if (!slugTouched) setSlug(slugify(value));
  };

  const handleApplyAiCopy = (generated: { title: string; description: string; blocks: PageBlock[] }) => {
    setTitle(generated.title);
    if (!slugTouched) setSlug(slugify(generated.title));
    setDescription(generated.description);
    if (generated.blocks.length > 0) {
      setBlocks((prev) => [...prev, ...generated.blocks]);
    }
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
        showToast('Page updated.', 'success');
        navigate('/pages');
      } else {
        await createPage.mutateAsync(input);
        showToast('Page created.', 'success');
        navigate('/pages');
      }
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to save page.'), 'error');
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
  };

  const removeBlock = (index: number) => {
    setBlocks((current) => current.filter((_, i) => i !== index));
  };

  const addBlock = (type: PageBlock['type']) => {
    setBlocks((current) => [...current, newBlock(type)]);
  };

  const saving = createPage.isPending || updatePage.isPending;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Content"
        title={isEdit ? 'Edit Page' : 'New Page'}
        description={isEdit ? 'Update this page.' : 'Create a new published page.'}
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
            <Button variant="outline" size="sm" asChild>
              <Link to="/pages">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Cancel
              </Link>
            </Button>
          </div>
        }
      />

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
                    onChange={(e) => setDescription(e.target.value)}
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

                <div className="flex gap-3 pt-2">
                  <Button type="submit" disabled={saving}>
                    <Save className="mr-2 h-4 w-4" />
                    {saving ? 'Saving…' : isEdit ? 'Update Page' : 'Create Page'}
                  </Button>
                  <Button type="button" variant="outline" asChild>
                    <Link to="/pages">Cancel</Link>
                  </Button>
                </div>
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
    </div>
  );
}


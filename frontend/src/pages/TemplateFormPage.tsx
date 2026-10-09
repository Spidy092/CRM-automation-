import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  useTemplate,
  useCreateTemplate,
  useUpdateTemplate,
  useUploadTemplateAttachment,
  useAttachTemplateFromLibrary,
  useDeleteTemplateAttachment,
  type TemplateInput,
} from '@/api/templates';
import { useFiles, type LibraryFile } from '@/api/files';
import { usePages } from '@/api/pages';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
import { buildPortfolioButton, extractVariables, splitPortfolioButton } from '@/lib/templateVars';
import {
  defaultDesign,
  starterTemplates,
  type EmailDesign,
  type StarterTemplate,
} from '@/lib/emailDesign';
import { VisualEmailEditor, type VisualEditorInitial } from '@/components/templates/VisualEmailEditor';
import { SmsEditor, WhatsappEditor } from '@/components/templates/ChannelEditors';
import { TemplatePreviewModal, TestSendModal } from '@/components/templates/TemplatePreviewModal';
import type { MessageChannel, Template, TemplateAttachment } from '@/types';
import { ArrowLeft, Eye, FileStack, FileText, FolderOpen, Image as ImageIcon, Link as LinkIcon, Mail, Paperclip, Save, Trash2, Upload, X } from 'lucide-react';

const ATTACHMENT_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,application/pdf';
const MAX_ATTACHMENTS = 3;

type EmailMode = 'simple' | 'visual' | 'html';

// ── Shared pickers + attachments (unchanged behavior from the original editor) ──

function AttachmentThumb({ attachment }: { attachment: TemplateAttachment }) {
  const isImage = attachment.mimeType.startsWith('image/');
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-slate-100">
      {isImage ? (
        <img src={attachment.url} alt="" className="h-8 w-8 rounded object-cover" />
      ) : (
        <FileText className="h-4 w-4 text-slate-500" />
      )}
    </div>
  );
}

function PagePickerModal({ onSelect, onClose }: { onSelect: (slug: string) => void; onClose: () => void }) {
  const { data: pages = [], isLoading } = usePages();
  const publishedPages = pages.filter((p) => p.status === 'published');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Insert Public Page Link</h3>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
        {!isLoading && publishedPages.length === 0 && (
          <p className="text-sm text-slate-500">No published pages found. Create & publish a page in Content &gt; Pages first.</p>
        )}
        <div className="space-y-2">
          {publishedPages.map((page) => (
            <button key={page.id} type="button" onClick={() => onSelect(page.slug)} className="flex w-full items-center gap-3 rounded-md border border-slate-200 p-2 text-left hover:bg-slate-50">
              <FileStack className="h-5 w-5 shrink-0 text-indigo-600" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-900">{page.title}</div>
                <div className="font-mono text-xs text-slate-500">/p/{page.slug}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function FileLinkPickerModal({ onSelect, onClose, portfolioOnly = false }: {
  onSelect: (file: LibraryFile) => void; onClose: () => void; portfolioOnly?: boolean;
}) {
  const { data: allFiles = [], isLoading, error } = useFiles();
  const files = portfolioOnly ? allFiles.filter((file) => file.mime_type === 'application/pdf') : allFiles;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">{portfolioOnly ? 'Choose your portfolio PDF' : 'Insert Library File Link'}</h3>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close file picker"><X className="h-4 w-4" /></Button>
        </div>
        {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
        {error && <p role="alert" className="text-sm text-red-600">Could not load files. Close this picker and try again.</p>}
        {!isLoading && !error && files.length === 0 && (
          <p className="text-sm text-slate-500">
            {portfolioOnly ? 'Upload your portfolio PDF to the Files library, then choose it here.' : 'No files in library. Upload files in Content > Files first.'}{' '}
            <Link to="/files" target="_blank" rel="noopener noreferrer" className="underline">Open Files library (new tab)</Link>
          </p>
        )}
        <div className="space-y-2">
          {files.map((file) => (
            <button key={file.id} type="button" onClick={() => onSelect(file)} className="flex w-full items-center gap-3 rounded-md border border-slate-200 p-2 text-left hover:bg-slate-50">
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
      </div>
    </div>
  );
}

function LibraryPickerModal({ onSelect, onClose }: { onSelect: (fileId: string) => void; onClose: () => void }) {
  const { data: files = [], isLoading } = useFiles();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Choose from Files library</h3>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
        {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
        {!isLoading && files.length === 0 && (
          <p className="text-sm text-slate-500">No files in the library yet. Upload some from the Files page first.</p>
        )}
        <div className="space-y-2">
          {files.map((file) => (
            <button key={file.id} type="button" onClick={() => onSelect(file.id)} className="flex w-full items-center gap-3 rounded-md border border-slate-200 p-2 text-left hover:bg-slate-50">
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
      </div>
    </div>
  );
}

function AttachmentsPanel({ templateId }: { templateId: string }) {
  const { data: template } = useTemplate(templateId);
  const uploadAttachment = useUploadTemplateAttachment();
  const attachFromLibrary = useAttachTemplateFromLibrary();
  const deleteAttachment = useDeleteTemplateAttachment();
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showLibraryPicker, setShowLibraryPicker] = useState(false);

  const attachments = template?.attachments ?? [];
  const atLimit = attachments.length >= MAX_ATTACHMENTS;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      await uploadAttachment.mutateAsync({ id: templateId, file });
      showToast('Attachment uploaded.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : getApiErrorMessage(error, 'Failed to upload attachment.'), 'error');
    }
  };

  const handleSelectFromLibrary = async (fileId: string) => {
    setShowLibraryPicker(false);
    try {
      await attachFromLibrary.mutateAsync({ id: templateId, fileId });
      showToast('Attachment added from library.', 'success');
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to attach file from library.'), 'error');
    }
  };

  const handleRemove = async (attachmentId: string) => {
    try {
      await deleteAttachment.mutateAsync({ id: templateId, attachmentId });
      showToast('Attachment removed.', 'success');
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to remove attachment.'), 'error');
    }
  };

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Paperclip className="h-4 w-4" />Attachments</CardTitle>
        <CardDescription>
          Images or PDFs sent along with this message (WhatsApp media / email attachments). Max {MAX_ATTACHMENTS}, 10MB each.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {attachments.length > 0 && (
          <div className="space-y-2">
            {attachments.map((attachment) => (
              <div key={attachment.id} className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-2">
                <AttachmentThumb attachment={attachment} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-900">{attachment.filename}</div>
                  <div className="text-xs text-slate-500">{(attachment.sizeBytes / 1024).toFixed(0)} KB</div>
                </div>
                <Button type="button" variant="outline" size="sm" aria-label={`Remove ${attachment.filename}`} className="h-7 shrink-0 text-xs text-red-600 hover:bg-red-50" onClick={() => handleRemove(attachment.id)} disabled={deleteAttachment.isPending}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
        <input ref={fileInputRef} type="file" accept={ATTACHMENT_ACCEPT} className="hidden" onChange={handleFileChange} />
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploadAttachment.isPending || atLimit}>
            {uploadAttachment.isPending ? (<><ImageIcon className="mr-2 h-3.5 w-3.5 animate-pulse" />Uploading…</>) : atLimit ? (`Limit reached (${MAX_ATTACHMENTS})`) : (<><Upload className="mr-2 h-3.5 w-3.5" />Add attachment</>)}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setShowLibraryPicker(true)} disabled={attachFromLibrary.isPending || atLimit}>
            <FolderOpen className="mr-2 h-3.5 w-3.5" />Browse Library
          </Button>
        </div>
        {showLibraryPicker && <LibraryPickerModal onSelect={handleSelectFromLibrary} onClose={() => setShowLibraryPicker(false)} />}
      </CardContent>
    </Card>
  );
}

// ── Simple email form (original personal-outreach editor, preserved) ─────────
// Controlled by the shell's shared draft so switching channels never loses
// text. Legacy templates without an editor_mode are treated as simple.

interface SimpleDraft {
  name: string;
  subject: string;
  body: string;
}

function simpleBodyFor(existing: Template): string {
  const mode = (existing.editor_mode ?? 'simple') as EmailMode;
  if (mode === 'simple') return existing.body;
  return existing.text_body ?? existing.body;
}

function SimpleEmailForm({ channel, draft, setDraft, onDirty }: {
  channel: MessageChannel;
  draft: SimpleDraft;
  setDraft: (patch: Partial<SimpleDraft>) => void;
  onDirty: () => void;
}) {
  const { id } = useParams<{ id?: string }>();
  const isEdit = !!id;
  const navigate = useNavigate();
  const { showToast } = useToast();
  const createTemplate = useCreateTemplate();
  const updateTemplate = useUpdateTemplate();

  const { name, subject, body } = draft;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPagePicker, setShowPagePicker] = useState(false);
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [portfolioPicker, setPortfolioPicker] = useState(false);

  const touch = () => onDirty();
  const setBody = (v: string | ((prev: string) => string)) => {
    setDraft({ body: typeof v === 'function' ? (v as (p: string) => string)(body) : v });
    touch();
  };
  const setName = (v: string) => { setDraft({ name: v }); touch(); };
  const setSubject = (v: string) => { setDraft({ subject: v }); touch(); };
  const handleInsertPageLink = (slug: string) => {
    setShowPagePicker(false);
    const linkUrl = `${window.location.origin}/p/${slug}`;
    setBody((prev) => (prev ? `${prev}\n${linkUrl}` : linkUrl));
    touch();
    showToast('Page link inserted into body text.', 'success');
  };

  const handleInsertFileLink = (file: LibraryFile) => {
    setShowFilePicker(false);
    if (portfolioPicker) {
      try {
        const button = buildPortfolioButton(file.url);
        setBody((prev) => `${splitPortfolioButton(prev).text}\n\n${button}`.trim());
        touch();
        showToast('View portfolio button added. Save the template to keep it.', 'success');
      } catch (error) {
        showToast(getApiErrorMessage(error, 'Could not add this portfolio link.'), 'error');
      }
      return;
    }
    setBody((prev) => (prev ? `${prev}\n${file.url}` : file.url));
    touch();
    showToast('File URL inserted into body text.', 'success');
  };

  const detectedVars = extractVariables(body);
  const portfolioPreview = splitPortfolioButton(body);

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Name is required';
    if (!body.trim()) errs.body = 'Body is required';
    if (channel === 'email' && !subject.trim()) errs.subject = 'Subject is required for email templates';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    const input: TemplateInput = {
      name: name.trim(),
      channel,
      subject: channel === 'email' ? subject.trim() || null : null,
      body: body.trim(),
      variables: detectedVars,
      editor_mode: 'simple',
    };
    try {
      if (isEdit && id) {
        await updateTemplate.mutateAsync({ id, input });
        showToast('Template updated.', 'success');
        navigate('/templates');
      } else {
        const created = await createTemplate.mutateAsync(input);
        showToast('Template created. Add attachments below, or go back to the list.', 'success');
        if (created) navigate(`/templates/${created.id}/edit`, { replace: true });
      }
    } catch {
      showToast('Failed to save template.', 'error');
    }
  };

  const saving = createTemplate.isPending || updateTemplate.isPending;

  return (
    <>
      <Card className="max-w-2xl">
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="name">Template name *</Label>
              <Input id="name" value={name} onChange={(e) => { setName(e.target.value); touch(); }} placeholder="e.g. Cold outreach - WhatsApp intro" />
              {errors.name && <p className="text-xs text-red-600">{errors.name}</p>}
            </div>
            {channel === 'email' && (
              <div className="space-y-1.5">
                <Label htmlFor="subject">Subject *</Label>
                <Input id="subject" value={subject} onChange={(e) => { setSubject(e.target.value); touch(); }} placeholder="e.g. Quick intro — {{business_name}}" />
                {errors.subject && <p className="text-xs text-red-600">{errors.subject}</p>}
              </div>
            )}
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="body">{channel === 'phone_call' ? 'Call script *' : 'Message body *'}</Label>
                <div className="flex items-center gap-1.5">
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowPagePicker(true)}>
                    <FileStack className="mr-1 h-3.5 w-3.5 text-indigo-600" />Insert Page Link
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setPortfolioPicker(false); setShowFilePicker(true); }}>
                    <LinkIcon className="mr-1 h-3.5 w-3.5 text-blue-600" />Insert File Link
                  </Button>
                  {channel === 'email' && (
                    <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setPortfolioPicker(true); setShowFilePicker(true); }}>
                      Add portfolio button
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-xs text-slate-500">
                Use <code className="rounded bg-slate-100 px-1">{'{{variable}}'}</code> placeholders.
                Available: <code>{'{{business_name}}'}</code>, <code>{'{{contact_name}}'}</code>, <code>{'{{industry}}'}</code>, <code>{'{{location}}'}</code>
              </p>
              <Textarea
                id="body"
                value={portfolioPreview.url ? portfolioPreview.text : body}
                onChange={(e) => { setBody(portfolioPreview.url ? `${e.target.value}\n\n${buildPortfolioButton(portfolioPreview.url)}` : e.target.value); touch(); }}
                rows={8}
                placeholder="Hi {{contact_name}}, I noticed {{business_name}} is in the {{industry}} space…"
              />
              {errors.body && <p className="text-xs text-red-600">{errors.body}</p>}
              {channel === 'email' && portfolioPreview.url && (
                <div className="space-y-2 pt-3">
                  <p className="text-sm text-slate-600">This button appears in your email and opens the selected PDF.</p>
                  <a href={portfolioPreview.url} target="_blank" rel="noopener noreferrer" className="inline-block rounded-md bg-indigo-700 px-5 py-3 text-sm font-semibold text-white">View portfolio</a>
                  <Button type="button" variant="outline" size="sm" onClick={() => { setBody(portfolioPreview.text); touch(); }}>Remove portfolio button</Button>
                </div>
              )}
            </div>
            {detectedVars.length > 0 && (
              <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
                <p className="text-xs font-medium text-blue-700">Detected variables:</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {detectedVars.map((v) => (
                    <code key={v} className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">{`{{${v}}}`}</code>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={saving}><Save className="mr-2 h-4 w-4" />{saving ? 'Saving…' : isEdit ? 'Update Template' : 'Create Template'}</Button>
              <Button type="button" variant="outline" asChild><Link to="/templates">Cancel</Link></Button>
            </div>
          </form>
        </CardContent>
      </Card>
      {showPagePicker && <PagePickerModal onSelect={handleInsertPageLink} onClose={() => setShowPagePicker(false)} />}
      {showFilePicker && <FileLinkPickerModal portfolioOnly={portfolioPicker} onSelect={handleInsertFileLink} onClose={() => setShowFilePicker(false)} />}
    </>
  );
}

// ── Custom HTML email editor ─────────────────────────────────────────────────

function HtmlEmailEditor({ existing, onDirty, onSaved }: {
  existing?: Template | null;
  onDirty: () => void;
  onSaved: (id: string) => void;
}) {
  const { id } = useParams<{ id?: string }>();
  const isEdit = !!id;
  const { showToast } = useToast();
  const createTemplate = useCreateTemplate();
  const updateTemplate = useUpdateTemplate();

  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [preheader, setPreheader] = useState('');
  const [html, setHtml] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPreview, setShowPreview] = useState(false);
  const [showTest, setShowTest] = useState(false);

  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setSubject(existing.subject ?? '');
      setPreheader(existing.preheader ?? '');
      setHtml(existing.editor_mode === 'html' && existing.html_body ? existing.html_body : existing.body);
    }
  }, [existing]);

  const touch = () => onDirty();
  const detectedVars = extractVariables(`${subject}\n${preheader}\n${html}`);

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Template name is required';
    if (!subject.trim()) errs.subject = 'Subject is required for email templates';
    if (!html.trim()) errs.html = 'HTML content is required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    const input: TemplateInput = {
      name: name.trim(),
      channel: 'email',
      subject: subject.trim(),
      body: html,
      variables: detectedVars,
      editor_mode: 'html',
      preheader: preheader.trim() || null,
    };
    try {
      if (isEdit && id) {
        await updateTemplate.mutateAsync({ id, input });
        showToast('Custom HTML template saved — sanitized on the server.', 'success');
      } else {
        const created = await createTemplate.mutateAsync(input);
        showToast('Custom HTML template created.', 'success');
        if (created) onSaved(created.id);
      }
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to save template. Unsupported content is stripped or rejected — see the message.'), 'error');
    }
  };

  const saving = createTemplate.isPending || updateTemplate.isPending;

  return (
    <div className="space-y-4">
      <Card className="max-w-3xl">
        <CardContent className="space-y-5 pt-6">
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Custom HTML is <strong>not</strong> convertible into editable visual blocks. Paste final HTML here;
            it is sanitized on save (scripts, event handlers, and unsafe links are stripped or rejected).
            Preview runs in an isolated frame.
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="html-name">Template name *</Label>
              <Input id="html-name" value={name} onChange={(e) => { setName(e.target.value); touch(); }} placeholder="e.g. Launch announcement (HTML)" />
              {errors.name && <p className="text-xs text-red-600">{errors.name}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="html-subject">Subject *</Label>
              <Input id="html-subject" value={subject} onChange={(e) => { setSubject(e.target.value); touch(); }} placeholder="e.g. News for {{business_name}}" />
              {errors.subject && <p className="text-xs text-red-600">{errors.subject}</p>}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="html-preheader">Preheader</Label>
            <Input id="html-preheader" value={preheader} maxLength={300} onChange={(e) => { setPreheader(e.target.value); touch(); }} placeholder="Short summary shown next to the subject" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="html-body">HTML content *</Label>
            <Textarea id="html-body" value={html} rows={16} onChange={(e) => { setHtml(e.target.value); touch(); }} placeholder="<p>Hi {{first_name}},</p>" className="font-mono text-xs" spellCheck={false} />
            {errors.html && <p className="text-xs text-red-600">{errors.html}</p>}
            <p className="text-xs text-slate-500">Allowed: text, links (http/https), images (http/https), tables, inline email-safe styles. Variables like <code>{'{{first_name}}'}</code> work in text, subject, and URLs.</p>
          </div>
          {detectedVars.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {detectedVars.map((v) => <code key={v} className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">{`{{${v}}}`}</code>)}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleSave} disabled={saving}><Save className="mr-2 h-4 w-4" />{saving ? 'Saving…' : isEdit ? 'Save HTML template' : 'Create HTML template'}</Button>
            {isEdit && id && (
              <>
                <Button variant="outline" onClick={() => setShowPreview(true)}><Eye className="mr-2 h-4 w-4" />Preview</Button>
                <Button variant="outline" onClick={() => setShowTest(true)}><Mail className="mr-2 h-4 w-4" />Test email</Button>
              </>
            )}
            {!isEdit && <p className="w-full text-xs text-slate-500">Save first to enable preview and test email.</p>}
          </div>
        </CardContent>
      </Card>
      {isEdit && id && showPreview && <TemplatePreviewModal templateId={id} templateName={name || 'Custom HTML'} onClose={() => setShowPreview(false)} />}
      {isEdit && id && showTest && <TestSendModal templateId={id} onClose={() => setShowTest(false)} />}
    </div>
  );
}

// ── WhatsApp / SMS / phone-call editor ───────────────────────────────────────

function StructuredChannelForm({ channel, draft, setDraft, onDirty, attachmentCount }: {
  channel: MessageChannel;
  draft: SimpleDraft;
  setDraft: (patch: Partial<SimpleDraft>) => void;
  onDirty: () => void;
  attachmentCount: number;
}) {
  const { id } = useParams<{ id?: string }>();
  const isEdit = !!id;
  const navigate = useNavigate();
  const { showToast } = useToast();
  const createTemplate = useCreateTemplate();
  const updateTemplate = useUpdateTemplate();

  const { name, body } = draft;
  const [errors, setErrors] = useState<Record<string, string>>({});

  const touch = () => onDirty();
  const setName = (v: string) => { setDraft({ name: v }); touch(); };
  const setBody = (v: string) => { setDraft({ body: v }); touch(); };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Template name is required';
    if (!body.trim()) errs.body = 'Message text is required';
    if (channel === 'whatsapp' && body.length > 4096) errs.body = 'WhatsApp text exceeds the 4096-character Cloud API limit';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    const input: TemplateInput = {
      name: name.trim(),
      channel,
      subject: null,
      body: body.trim(),
      variables: extractVariables(body),
      editor_mode: 'simple',
    };
    try {
      if (isEdit && id) {
        await updateTemplate.mutateAsync({ id, input });
        showToast('Template updated.', 'success');
        navigate('/templates');
      } else {
        const created = await createTemplate.mutateAsync(input);
        showToast('Template created.', 'success');
        if (created) navigate(`/templates/${created.id}/edit`, { replace: true });
      }
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to save template.'), 'error');
    }
  };

  const saving = createTemplate.isPending || updateTemplate.isPending;

  return (
    <Card className="max-w-2xl">
      <CardContent className="space-y-5 pt-6">
        <div className="space-y-1.5">
          <Label htmlFor="ch-name">Template name *</Label>
          <Input id="ch-name" value={name} onChange={(e) => { setName(e.target.value); touch(); }} placeholder={channel === 'sms' ? 'e.g. Appointment reminder (SMS)' : 'e.g. Intro (WhatsApp)'} />
          {errors.name && <p className="text-xs text-red-600">{errors.name}</p>}
        </div>
        {channel === 'whatsapp' && <WhatsappEditor body={body} onChange={(v) => { setBody(v); touch(); }} attachmentCount={attachmentCount} error={errors.body} />}
        {channel === 'sms' && <SmsEditor body={body} onChange={(v) => { setBody(v); touch(); }} error={errors.body} />}
        {channel === 'phone_call' && (
          <div className="space-y-1.5">
            <Label htmlFor="call-script">Call script *</Label>
            <Textarea id="call-script" value={body} rows={8} onChange={(e) => { setBody(e.target.value); touch(); }} placeholder="Opening, key points, objection handling, next step…" />
            {errors.body && <p className="text-xs text-red-600">{errors.body}</p>}
          </div>
        )}
        <div className="flex gap-3">
          <Button onClick={handleSave} disabled={saving}><Save className="mr-2 h-4 w-4" />{saving ? 'Saving…' : isEdit ? 'Update Template' : 'Create Template'}</Button>
          <Button variant="outline" asChild><Link to="/templates">Cancel</Link></Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Page shell ───────────────────────────────────────────────────────────────

function seedDesignFromBody(body: string): EmailDesign {
  const design = defaultDesign();
  const text = body.trim();
  if (text) {
    design.blocks = [
      design.blocks[0],
      { id: `seed-${Date.now().toString(36)}`, type: 'text', props: { text, fontSize: 16, color: '#1e293b', align: 'left', bold: false, italic: false } },
      design.blocks[design.blocks.length - 1],
    ];
  }
  return design;
}

export function TemplateFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEdit = !!id;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const { data: existing, isLoading } = useTemplate(id ?? '');

  const queryChannel = searchParams.get('channel') as MessageChannel | null;
  const queryMode = searchParams.get('mode') as EmailMode | null;
  const starterKey = searchParams.get('starter');
  const starter: StarterTemplate | null = starterKey
    ? (starterTemplates().find((s) => s.key === starterKey) ?? null)
    : null;

  const [channel, setChannel] = useState<MessageChannel>('email');
  const [mode, setMode] = useState<EmailMode>('simple');
  const [initialized, setInitialized] = useState(false);
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const [pendingMode, setPendingMode] = useState<EmailMode | null>(null);
  const [pendingChannel, setPendingChannel] = useState<MessageChannel | null>(null);
  const [draft, setDraftState] = useState<SimpleDraft>({ name: '', subject: '', body: '' });

  const setDraft = (patch: Partial<SimpleDraft>) => setDraftState((d) => ({ ...d, ...patch }));

  useEffect(() => {
    if (initialized) return;
    if (isEdit && !existing) return;
    if (existing) {
      setChannel(existing.channel);
      // Legacy rows predate editor_mode — treat a missing mode as simple.
      setMode(existing.channel === 'email' ? (((existing.editor_mode ?? 'simple') as EmailMode) ?? 'simple') : 'simple');
      setDraftState({ name: existing.name, subject: existing.subject ?? '', body: simpleBodyFor(existing) });
    } else {
      if (queryChannel) setChannel(queryChannel);
      const initialMode: EmailMode =
        queryMode ?? (starter ? 'visual' : queryChannel && queryChannel !== 'email' ? 'simple' : 'simple');
      setMode((queryChannel ?? 'email') === 'email' ? initialMode : 'simple');
    }
    setInitialized(true);
  }, [existing, initialized, isEdit, queryChannel, queryMode, starter]);

  useEffect(() => {
    if (!hasUnsaved) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsaved]);

  const requestModeSwitch = (next: EmailMode) => {
    if (next === mode) return;
    if (hasUnsaved) {
      setPendingMode(next);
      return;
    }
    setMode(next);
  };

  const confirmModeSwitch = () => {
    if (pendingMode) setMode(pendingMode);
    if (pendingChannel) applyChannelChange(pendingChannel);
    setPendingChannel(null);
    setPendingMode(null);
    setHasUnsaved(false);
  };

  const handleChannelChange = (next: MessageChannel) => {
    if (next === channel) return;
    if (hasUnsaved && channel === 'email' && mode !== 'simple') {
      setPendingChannel(next);
      return;
    }
    applyChannelChange(next);
  };

  const applyChannelChange = (next: MessageChannel) => {
    // Preserve the original behavior: a portfolio button becomes a visible
    // plain link when leaving email — text is never silently dropped.
    if (channel === 'email' && next !== 'email') {
      const { text, url } = splitPortfolioButton(draft.body);
      if (url) setDraftState((d) => ({ ...d, body: `${text}\n\nView portfolio: ${url}`.trim() }));
    }
    setChannel(next);
    if (next !== 'email') setMode('simple');
    setHasUnsaved(true);
  };

  const visualInitial: VisualEditorInitial | null = (() => {
    if (channel !== 'email' || mode !== 'visual') return null;
    if (starter) return null; // passed separately
    if (existing) {
      const design = (existing.design as EmailDesign | null) ??
        (existing.editor_mode === 'visual' ? defaultDesign() : seedDesignFromBody(existing.text_body ?? existing.body));
      return {
        name: existing.name,
        subject: existing.subject ?? '',
        preheader: existing.preheader ?? '',
        design: JSON.parse(JSON.stringify(design)) as EmailDesign,
      };
    }
    return null;
  })();

  const showAttachments = isEdit && id;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Outreach"
        title={isEdit ? 'Edit Template' : 'New Template'}
        description={
          isEdit
            ? 'Update this message template. Saving content changes on an approved template resets it to pending.'
            : starter
              ? `Starting from the “${starter.name}” design — the original starter is never modified.`
              : 'Create a new message template. It is ready to use in a sequence straight away.'
        }
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/templates"><ArrowLeft className="mr-2 h-4 w-4" />Cancel</Link>
          </Button>
        }
      />

      {isLoading && <p className="text-sm text-slate-500" role="status">Loading template…</p>}

      {(!isEdit || existing) && initialized && (
        <>
          <Card className="max-w-2xl">
            <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="channel">Channel *</Label>
                <select
                  id="channel"
                  value={channel}
                  onChange={(e) => handleChannelChange(e.target.value as MessageChannel)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="email">✉️ Email</option>
                  <option value="whatsapp">💬 WhatsApp</option>
                  <option value="sms">📱 SMS</option>
                  <option value="phone_call">📞 Phone Call (script)</option>
                </select>
              </div>
              {channel === 'email' && (
                <div className="flex-1 space-y-1.5">
                  <Label>Editor</Label>
                  <div className="flex gap-1" role="tablist" aria-label="Email editor mode">
                    {(['simple', 'visual', 'html'] as const).map((m) => (
                      <Button
                        key={m}
                        type="button"
                        role="tab"
                        aria-selected={mode === m}
                        variant={mode === m ? 'default' : 'outline'}
                        size="sm"
                        className="flex-1 text-xs"
                        onClick={() => requestModeSwitch(m)}
                      >
                        {m === 'simple' ? 'Simple' : m === 'visual' ? 'Visual design' : 'Custom HTML'}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {channel === 'email' && mode === 'simple' && (
            <SimpleEmailForm channel={channel} draft={draft} setDraft={setDraft} onDirty={() => setHasUnsaved(true)} />
          )}
          {channel === 'email' && mode === 'visual' && (
            <VisualEmailEditor
              templateId={id}
              initial={visualInitial}
              starter={starter}
              approvalStatus={existing?.approval_status}
              onDirtyChange={setHasUnsaved}
              onSaved={(newId) => navigate(`/templates/${newId}/edit`, { replace: true })}
            />
          )}
          {channel === 'email' && mode === 'html' && (
            <HtmlEmailEditor existing={existing} onDirty={() => setHasUnsaved(true)} onSaved={(newId) => navigate(`/templates/${newId}/edit`, { replace: true })} />
          )}
          {channel !== 'email' && (
            <StructuredChannelForm
              channel={channel}
              draft={draft}
              setDraft={setDraft}
              onDirty={() => setHasUnsaved(true)}
              attachmentCount={existing?.attachments?.length ?? 0}
            />
          )}

          {showAttachments && id && (
            <AttachmentsPanel templateId={id} />
          )}
          {!isEdit && (
            <Card className="max-w-2xl border-dashed">
              <CardContent className="flex items-center gap-2 pt-6 text-sm text-slate-500">
                <Paperclip className="h-4 w-4 shrink-0" />
                Save the template first to attach images or PDFs.
              </CardContent>
            </Card>
          )}
        </>
      )}

      <AlertDialog
        open={pendingMode !== null || pendingChannel !== null}
        title="Switch editor?"
        description="Switching views discards unsaved edits in the current view. Anything you already saved is preserved — including the other mode's content, which is restored when you switch back."
        confirmLabel="Switch (discard unsaved edits)"
        cancelLabel="Stay here"
        onConfirm={confirmModeSwitch}
        onCancel={() => { setPendingMode(null); setPendingChannel(null); }}
      />
    </div>
  );
}

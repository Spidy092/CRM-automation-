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
import { usePages, type LandingPage } from '@/api/pages';
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
import { AddContentPicker } from '@/components/content/AddContentPicker';
import {
  ATTACHMENT_LIMITS,
  buildFileDownloadLine,
  channelSupportsAttachments,
  pagePublicUrl,
  resolveAssetUrl,
  type ContentPlacement,
} from '@/lib/contentLinks';
import { TemplatePreviewModal, TestSendModal } from '@/components/templates/TemplatePreviewModal';
import type { MessageChannel, Template, TemplateAttachment } from '@/types';
import { ArrowLeft, Eye, FileText, FolderOpen, Image as ImageIcon, Mail, Paperclip, Save, Trash2, Upload } from 'lucide-react';

const ATTACHMENT_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,application/pdf';
const MAX_ATTACHMENTS = 3;

type EmailMode = 'simple' | 'visual' | 'html';

// ── Shared pickers + attachments (unchanged behavior from the original editor) ──

function AttachmentThumb({ attachment }: { attachment: TemplateAttachment }) {
  const isImage = attachment.mimeType.startsWith('image/');
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-slate-100" title={attachment.filename}>
      {isImage && !failed ? (
        <img src={resolveAssetUrl(attachment.url)} alt={attachment.filename} className="h-8 w-8 rounded object-cover" onError={() => setFailed(true)} loading="lazy" />
      ) : (
        <FileText className="h-4 w-4 text-slate-500" aria-hidden="true" />
      )}
    </div>
  );
}

// Shared AddContentPicker (components/content/AddContentPicker.tsx) replaces the
// three duplicated inline pickers that used to live here.

function AttachmentsPanel({ templateId, channel }: { templateId: string; channel: MessageChannel }) {
  const { data: template } = useTemplate(templateId);
  const uploadAttachment = useUploadTemplateAttachment();
  const attachFromLibrary = useAttachTemplateFromLibrary();
  const deleteAttachment = useDeleteTemplateAttachment();
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showPicker, setShowPicker] = useState(false);

  const attachments = template?.attachments ?? [];
  const atLimit = attachments.length >= MAX_ATTACHMENTS;
  const attachedNames = new Set(attachments.map((a) => a.filename));

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

  const handlePickFile = async (file: LibraryFile, placement: ContentPlacement) => {
    if (placement !== 'attach') return;
    setShowPicker(false);
    if (attachedNames.has(file.filename) && attachments.some((a) => a.filename === file.filename)) {
      showToast('This file is already attached to this template.', 'error');
      return;
    }
    try {
      await attachFromLibrary.mutateAsync({ id: templateId, fileId: file.id });
      showToast('Attachment added from library. Saved immediately.', 'success');
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to attach file from library.'), 'error');
    }
  };

  const handleRemove = async (attachmentId: string) => {
    try {
      await deleteAttachment.mutateAsync({ id: templateId, attachmentId });
      showToast('Attachment removed. Saved immediately.', 'success');
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to remove attachment.'), 'error');
    }
  };

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Paperclip className="h-4 w-4" />Content / Attachments</CardTitle>
        <CardDescription>
          {channel === 'email'
            ? `Files send as email attachments. A download link in the body is just text — attachments ride along. Max ${MAX_ATTACHMENTS}, 10MB each. Changes save immediately.`
            : channel === 'whatsapp'
              ? `Only the first attachment is sent as WhatsApp media (Cloud API). A download link in the body is plain text. Max ${MAX_ATTACHMENTS}, 10MB each. Changes save immediately.`
              : 'Attachments are not sent on this channel — use “Add content” to insert a download link instead. Changes save immediately.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {attachments.length > 0 && (
          <div className="space-y-2">
            {attachments.map((attachment) => (
              <div key={attachment.id} className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-2">
                <AttachmentThumb attachment={attachment} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-900" title={attachment.filename}>{attachment.filename}</div>
                  <div className="text-xs text-slate-500">{(attachment.sizeBytes / 1024).toFixed(0)} KB · saved</div>
                </div>
                <Button type="button" variant="outline" size="sm" aria-label={`Remove ${attachment.filename}`} className="h-7 shrink-0 text-xs text-red-600 hover:bg-red-50" onClick={() => handleRemove(attachment.id)} disabled={deleteAttachment.isPending}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
        <input ref={fileInputRef} type="file" accept={ATTACHMENT_ACCEPT} className="hidden" onChange={handleFileChange} />
        <div className="flex flex-wrap gap-2">
          {channelSupportsAttachments(channel) && (
            <>
              <Button type="button" variant="outline" size="sm" className="min-h-[44px]" onClick={() => fileInputRef.current?.click()} disabled={uploadAttachment.isPending || atLimit}>
                {uploadAttachment.isPending ? (<><ImageIcon className="mr-2 h-3.5 w-3.5 animate-pulse" />Uploading…</>) : atLimit ? (`Limit reached (${MAX_ATTACHMENTS})`) : (<><Upload className="mr-2 h-3.5 w-3.5" />Add attachment</>)}
              </Button>
              <Button type="button" variant="outline" size="sm" className="min-h-[44px]" onClick={() => setShowPicker(true)} disabled={attachFromLibrary.isPending || atLimit}>
                <FolderOpen className="mr-2 h-3.5 w-3.5" />Browse Library
              </Button>
            </>
          )}
        </div>
        {showPicker && (
          <AddContentPicker
            open
            channel={channel}
            editorMode="simple"
            allowPages={false}
            alreadyAttachedIds={attachments.map((a) => a.libraryFileId ?? '').filter((v) => v.length > 0)}
            onClose={() => setShowPicker(false)}
            onAddFile={(file, placement) => void handlePickFile(file, placement)}
            onAddPage={() => undefined}
          />
        )}
      </CardContent>
    </Card>
  );
}

/** Staged attachments for a not-yet-saved template. Editor-local only — nothing is written until Save. */
function StagedAttachmentsCard({
  channel,
  stagedFiles,
  onRemove,
  pendingCount,
}: {
  channel: MessageChannel;
  stagedFiles: LibraryFile[];
  onRemove: (id: string) => void;
  pendingCount: number;
}): React.JSX.Element {
  void pendingCount;
  return (
    <Card className="max-w-2xl border-dashed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Paperclip className="h-4 w-4" />Content / Attachments</CardTitle>
        <CardDescription>
          {channelSupportsAttachments(channel)
            ? `Staged files attach when you save (max ${ATTACHMENT_LIMITS.maxCount}, 10MB each). A download link in the body stays editable text — it is not the same as an attachment.`
            : 'Attachments are not sent on this channel. Stage a download link with “Add content” instead — staged attachments would be ignored at send time.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {stagedFiles.length === 0 && (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Paperclip className="h-4 w-4 shrink-0" aria-hidden="true" />
            No staged attachments. Use “Add content” in the editor, then save the template.
          </p>
        )}
        {stagedFiles.map((f) => (
          <div key={f.id} className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50/50 px-3 py-2">
            <AttachmentThumb attachment={{ id: f.id, filename: f.filename, mimeType: f.mime_type, sizeBytes: f.size_bytes, url: f.url }} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-slate-900" title={f.filename}>{f.filename}</div>
              <div className="text-xs text-slate-500">Pending — attaches on save</div>
            </div>
            <Button type="button" variant="outline" size="sm" aria-label={`Remove staged ${f.filename}`} className="h-7 shrink-0 text-xs" onClick={() => onRemove(f.id)}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
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

function SimpleEmailForm({ channel, draft, setDraft, onDirty, stagedFiles, onStageFile, onUnstageFile, existingAttachments }: {
  channel: MessageChannel;
  draft: SimpleDraft;
  setDraft: (patch: Partial<SimpleDraft>) => void;
  onDirty: () => void;
  stagedFiles: LibraryFile[];
  onStageFile: (file: LibraryFile) => void;
  onUnstageFile: (id: string) => void;
  existingAttachments: TemplateAttachment[];
}) {
  const { id } = useParams<{ id?: string }>();
  const isEdit = !!id;
  const navigate = useNavigate();
  const { showToast } = useToast();
  const createTemplate = useCreateTemplate();
  const updateTemplate = useUpdateTemplate();
  const attachFromLibrary = useAttachTemplateFromLibrary();

  const { name, subject, body } = draft;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pickerOpen, setPickerOpen] = useState<null | 'content' | 'portfolio'>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [failedIds, setFailedIds] = useState<string[]>([]);
  const [retrying, setRetrying] = useState(false);

  const touch = () => onDirty();
  const setBody = (v: string | ((prev: string) => string)) => {
    setDraft({ body: typeof v === 'function' ? (v as (p: string) => string)(body) : v });
    touch();
  };
  const setName = (v: string) => { setDraft({ name: v }); touch(); };
  const setSubject = (v: string) => { setDraft({ subject: v }); touch(); };

  const handleAddPage = (page: LandingPage, label: string) => {
    setPickerOpen(null);
    const line = `${label}: ${pagePublicUrl(page.slug)}`;
    setBody((prev) => (prev ? `${prev}\n${line}` : line));
    touch();
    showToast('Page link inserted. Save the template to keep it.', 'success');
  };

  const handleAddFile = (file: LibraryFile, placement: ContentPlacement) => {
    const isPortfolio = pickerOpen === 'portfolio';
    setPickerOpen(null);
    if (isPortfolio) {
      if (file.mime_type !== 'application/pdf') {
        showToast('Choose a PDF for the portfolio button.', 'error');
        return;
      }
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
    if (placement === 'attach') {
      if (!channelSupportsAttachments(channel)) {
        showToast('Attachments are not sent on this channel — added as a download link instead.', 'error');
      }
      if (isEdit && id) {
        if (existingAttachments.some((a) => a.filename === file.filename)) {
          showToast('This file is already attached to this template.', 'error');
          return;
        }
        if (existingAttachments.length >= MAX_ATTACHMENTS) {
          showToast(`Attachment limit reached (${MAX_ATTACHMENTS}).`, 'error');
          return;
        }
        void attachFromLibrary.mutateAsync({ id, fileId: file.id }).then(
          () => showToast('Attachment added from library. Saved immediately.', 'success'),
          (err) => showToast(getApiErrorMessage(err, 'Failed to attach file from library.'), 'error'),
        );
        return;
      }
      if (stagedFiles.some((f) => f.id === file.id)) {
        showToast('This file is already staged in the current draft.', 'error');
        return;
      }
      if (stagedFiles.length >= MAX_ATTACHMENTS) {
        showToast(`Attachment limit reached (${MAX_ATTACHMENTS}).`, 'error');
        return;
      }
      onStageFile(file);
      showToast('File staged. It attaches when you save the template.', 'success');
      return;
    }
    const line = buildFileDownloadLine(file);
    setBody((prev) => (prev ? `${prev}\n${line}` : line));
    touch();
    showToast('File link inserted. Save the template to keep it.', 'success');
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

  const attachStaged = async (templateId: string, ids: string[]): Promise<string[]> => {
    const failed: string[] = [];
    for (const fileId of ids) {
      try {
        await attachFromLibrary.mutateAsync({ id: templateId, fileId });
      } catch {
        failed.push(fileId);
      }
    }
    return failed;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSaveError(null);
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
        return;
      }
      // New template: reuse the in-progress id on retry so we never duplicate.
      const templateId = createdId ?? (await createTemplate.mutateAsync(input))?.id ?? null;
      if (!templateId) throw new Error('Template was not created.');
      setCreatedId(templateId);
      const pending = failedIds.length > 0
        ? stagedFiles.filter((f) => failedIds.includes(f.id))
        : stagedFiles;
      if (pending.length === 0) {
        showToast('Template created.', 'success');
        navigate(`/templates/${templateId}/edit`, { replace: true });
        return;
      }
      const failed = await attachStaged(templateId, pending.map((f) => f.id));
      if (failed.length > 0) {
        setFailedIds(failed);
        const okCount = pending.length - failed.length;
        setSaveError(
          `Template saved, but ${failed.length} attachment${failed.length === 1 ? '' : 's'} failed${okCount > 0 ? ` (${okCount} attached)` : ''}. Retry below — this will not create another template or duplicate attachments.`,
        );
        showToast('Template saved; some attachments failed. Retry below.', 'error');
        return;
      }
      setFailedIds([]);
      stagedFiles.forEach((f) => onUnstageFile(f.id));
      showToast('Template created with attachments.', 'success');
      navigate(`/templates/${templateId}/edit`, { replace: true });
    } catch {
      if (!createdId) showToast('Failed to save template.', 'error');
    }
  };

  const handleRetryAttachments = async () => {
    if (!createdId) return;
    setRetrying(true);
    setSaveError(null);
    try {
      const pending = stagedFiles.filter((f) => failedIds.includes(f.id));
      const failed = await attachStaged(createdId, pending.map((f) => f.id));
      setFailedIds(failed);
      if (failed.length > 0) {
        setSaveError('Some attachments still failed. Check the file type and size, then retry — no duplicate template is created.');
        showToast('Attachments retry failed.', 'error');
      } else {
        stagedFiles.forEach((f) => onUnstageFile(f.id));
        showToast('Attachments saved.', 'success');
        navigate(`/templates/${createdId}/edit`, { replace: true });
      }
    } finally {
      setRetrying(false);
    }
  };

  const saving = createTemplate.isPending || updateTemplate.isPending || attachFromLibrary.isPending;

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
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button type="button" variant="outline" size="sm" className="min-h-[44px] text-xs" onClick={() => setPickerOpen('content')}>
                    <FolderOpen className="mr-1 h-3.5 w-3.5 text-indigo-600" />Add content
                  </Button>
                  {channel === 'email' && (
                    <Button type="button" variant="outline" size="sm" className="min-h-[44px] text-xs" onClick={() => setPickerOpen('portfolio')}>
                      Add portfolio button
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-xs text-slate-500">
                Attachments ride along with the message; download links stay editable text in the body.
              </p>
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
            <div className="flex flex-wrap gap-3 pt-2">
              <Button type="submit" disabled={saving} className="min-h-[44px]"><Save className="mr-2 h-4 w-4" />{saving ? 'Saving…' : isEdit ? 'Update Template' : createdId ? 'Retry attachments' : 'Create Template'}</Button>
              <Button type="button" variant="outline" className="min-h-[44px]" asChild><Link to="/templates">Cancel</Link></Button>
            </div>
            {saveError && (
              <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                <p>{saveError}</p>
                {createdId && failedIds.length > 0 && (
                  <Button type="button" variant="outline" size="sm" className="mt-2 min-h-[44px]" disabled={retrying} onClick={() => void handleRetryAttachments()}>
                    {retrying ? 'Retrying…' : `Retry ${failedIds.length} failed attachment${failedIds.length === 1 ? '' : 's'}`}
                  </Button>
                )}
              </div>
            )}
          </form>
        </CardContent>
      </Card>
      {pickerOpen && (
        <AddContentPicker
          open
          channel={channel}
          editorMode="simple"
          fileFilter={pickerOpen === 'portfolio' ? 'pdf' : 'all'}
          dialogTitle={pickerOpen === 'portfolio' ? 'Choose your portfolio PDF' : 'Add content to template'}
          alreadyAttachedIds={isEdit ? existingAttachments.map((a) => a.libraryFileId ?? '').filter((v) => v.length > 0) : stagedFiles.map((f) => f.id)}
          onClose={() => setPickerOpen(null)}
          onAddFile={handleAddFile}
          onAddPage={handleAddPage}
        />
      )}
    </>
  );
}

// ── Custom HTML email editor ─────────────────────────────────────────────────

function HtmlEmailEditor({ existing, onDirty, onSaved, stagedFiles, onUnstageFile }: {
  existing?: Template | null;
  onDirty: () => void;
  onSaved: (id: string) => void;
  stagedFiles: LibraryFile[];
  onUnstageFile: (id: string) => void;
}) {
  const { id } = useParams<{ id?: string }>();
  const isEdit = !!id;
  const { showToast } = useToast();
  const createTemplate = useCreateTemplate();
  const updateTemplate = useUpdateTemplate();
  const attachFromLibrary = useAttachTemplateFromLibrary();

  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [preheader, setPreheader] = useState('');
  const [html, setHtml] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPreview, setShowPreview] = useState(false);
  const [showTest, setShowTest] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [failedIds, setFailedIds] = useState<string[]>([]);
  const [retrying, setRetrying] = useState(false);

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

  const attachStaged = async (templateId: string, ids: string[]): Promise<string[]> => {
    const failed: string[] = [];
    for (const fileId of ids) {
      try {
        await attachFromLibrary.mutateAsync({ id: templateId, fileId });
      } catch {
        failed.push(fileId);
      }
    }
    return failed;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaveError(null);
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
        return;
      }
      const templateId = createdId ?? (await createTemplate.mutateAsync(input))?.id ?? null;
      if (!templateId) throw new Error('Template was not created.');
      setCreatedId(templateId);
      const pending = failedIds.length > 0
        ? stagedFiles.filter((f) => failedIds.includes(f.id))
        : stagedFiles;
      if (pending.length === 0) {
        showToast('Custom HTML template created.', 'success');
        onSaved(templateId);
        return;
      }
      const failed = await attachStaged(templateId, pending.map((f) => f.id));
      if (failed.length > 0) {
        setFailedIds(failed);
        setSaveError('Template saved, but some attachments failed. Retry below — this will not create another template or duplicate attachments.');
        showToast('Template saved; some attachments failed. Retry below.', 'error');
        return;
      }
      setFailedIds([]);
      stagedFiles.forEach((f) => onUnstageFile(f.id));
      showToast('Custom HTML template created with attachments.', 'success');
      onSaved(templateId);
    } catch (err) {
      if (!createdId) showToast(getApiErrorMessage(err, 'Failed to save template. Unsupported content is stripped or rejected — see the message.'), 'error');
    }
  };

  const handleRetryAttachments = async () => {
    if (!createdId) return;
    setRetrying(true);
    setSaveError(null);
    try {
      const pending = stagedFiles.filter((f) => failedIds.includes(f.id));
      const failed = await attachStaged(createdId, pending.map((f) => f.id));
      setFailedIds(failed);
      if (failed.length > 0) {
        setSaveError('Some attachments still failed. Retry again — no duplicate template is created.');
      } else {
        stagedFiles.forEach((f) => onUnstageFile(f.id));
        showToast('Attachments saved.', 'success');
        onSaved(createdId);
      }
    } finally {
      setRetrying(false);
    }
  };

  const saving = createTemplate.isPending || updateTemplate.isPending || attachFromLibrary.isPending;

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
            <Button onClick={handleSave} disabled={saving} className="min-h-[44px]"><Save className="mr-2 h-4 w-4" />{saving ? 'Saving…' : isEdit ? 'Save HTML template' : createdId ? 'Retry attachments' : 'Create HTML template'}</Button>
            {isEdit && id && (
              <>
                <Button variant="outline" onClick={() => setShowPreview(true)}><Eye className="mr-2 h-4 w-4" />Preview</Button>
                <Button variant="outline" onClick={() => setShowTest(true)}><Mail className="mr-2 h-4 w-4" />Test email</Button>
              </>
            )}
            {!isEdit && <p className="w-full text-xs text-slate-500">Save first to enable preview and test email.</p>}
            {saveError && (
              <div role="alert" className="w-full rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                <p>{saveError}</p>
                {createdId && failedIds.length > 0 && (
                  <Button type="button" variant="outline" size="sm" className="mt-2 min-h-[44px]" disabled={retrying} onClick={() => void handleRetryAttachments()}>
                    {retrying ? 'Retrying…' : `Retry ${failedIds.length} failed attachment${failedIds.length === 1 ? '' : 's'}`}
                  </Button>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      {isEdit && id && showPreview && <TemplatePreviewModal templateId={id} templateName={name || 'Custom HTML'} onClose={() => setShowPreview(false)} />}
      {isEdit && id && showTest && <TestSendModal templateId={id} onClose={() => setShowTest(false)} />}
    </div>
  );
}

// ── WhatsApp / SMS / phone-call editor ───────────────────────────────────────

function StructuredChannelForm({ channel, draft, setDraft, onDirty, attachmentCount, stagedFiles, onStageFile, onUnstageFile, existingAttachments }: {
  channel: MessageChannel;
  draft: SimpleDraft;
  setDraft: (patch: Partial<SimpleDraft>) => void;
  onDirty: () => void;
  attachmentCount: number;
  stagedFiles: LibraryFile[];
  onStageFile: (file: LibraryFile) => void;
  onUnstageFile: (id: string) => void;
  existingAttachments: TemplateAttachment[];
}) {
  const { id } = useParams<{ id?: string }>();
  const isEdit = !!id;
  const navigate = useNavigate();
  const { showToast } = useToast();
  const createTemplate = useCreateTemplate();
  const updateTemplate = useUpdateTemplate();
  const attachFromLibrary = useAttachTemplateFromLibrary();

  const { name, body } = draft;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [failedIds, setFailedIds] = useState<string[]>([]);
  const [retrying, setRetrying] = useState(false);

  const touch = () => onDirty();
  const setName = (v: string) => { setDraft({ name: v }); touch(); };
  const setBody = (v: string) => { setDraft({ body: v }); touch(); };

  const handleAddFile = (file: LibraryFile, placement: ContentPlacement) => {
    setPickerOpen(false);
    if (placement === 'attach') {
      if (!channelSupportsAttachments(channel)) {
        const line = buildFileDownloadLine(file);
        setBody(body ? `${body}\n${line}` : line);
        touch();
        showToast('Attachments are not sent on this channel — added as a download link instead.', 'success');
        return;
      }
      if (isEdit && id) {
        if (existingAttachments.some((a) => a.filename === file.filename)) {
          showToast('This file is already attached to this template.', 'error');
          return;
        }
        if (existingAttachments.length >= MAX_ATTACHMENTS) {
          showToast(`Attachment limit reached (${MAX_ATTACHMENTS}).`, 'error');
          return;
        }
        void attachFromLibrary.mutateAsync({ id, fileId: file.id }).then(
          () => showToast('Attachment added from library. Saved immediately.', 'success'),
          (err) => showToast(getApiErrorMessage(err, 'Failed to attach file from library.'), 'error'),
        );
        return;
      }
      if (stagedFiles.some((f) => f.id === file.id)) {
        showToast('This file is already staged in the current draft.', 'error');
        return;
      }
      if (stagedFiles.length >= MAX_ATTACHMENTS) {
        showToast(`Attachment limit reached (${MAX_ATTACHMENTS}).`, 'error');
        return;
      }
      onStageFile(file);
      showToast('File staged. It attaches when you save the template.', 'success');
      return;
    }
    const line = buildFileDownloadLine(file);
    setBody(body ? `${body}\n${line}` : line);
    touch();
    showToast('File link inserted. Save the template to keep it.', 'success');
  };

  const handleAddPage = (page: LandingPage, label: string) => {
    setPickerOpen(false);
    const line = `${label}: ${pagePublicUrl(page.slug)}`;
    setBody(body ? `${body}\n${line}` : line);
    touch();
    showToast('Page link inserted. Save the template to keep it.', 'success');
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Template name is required';
    if (!body.trim()) errs.body = 'Message text is required';
    if (channel === 'whatsapp' && body.length > 4096) errs.body = 'WhatsApp text exceeds the 4096-character Cloud API limit';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const attachStaged = async (templateId: string, ids: string[]): Promise<string[]> => {
    const failed: string[] = [];
    for (const fileId of ids) {
      try {
        await attachFromLibrary.mutateAsync({ id: templateId, fileId });
      } catch {
        failed.push(fileId);
      }
    }
    return failed;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaveError(null);
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
        return;
      }
      const templateId = createdId ?? (await createTemplate.mutateAsync(input))?.id ?? null;
      if (!templateId) throw new Error('Template was not created.');
      setCreatedId(templateId);
      const pending = failedIds.length > 0
        ? stagedFiles.filter((f) => failedIds.includes(f.id))
        : stagedFiles;
      if (pending.length === 0) {
        showToast('Template created.', 'success');
        navigate(`/templates/${templateId}/edit`, { replace: true });
        return;
      }
      const failed = await attachStaged(templateId, pending.map((f) => f.id));
      if (failed.length > 0) {
        setFailedIds(failed);
        setSaveError('Template saved, but some attachments failed. Retry below — this will not create another template or duplicate attachments.');
        showToast('Template saved; some attachments failed. Retry below.', 'error');
        return;
      }
      setFailedIds([]);
      stagedFiles.forEach((f) => onUnstageFile(f.id));
      showToast('Template created with attachments.', 'success');
      navigate(`/templates/${templateId}/edit`, { replace: true });
    } catch (err) {
      if (!createdId) showToast(getApiErrorMessage(err, 'Failed to save template.'), 'error');
    }
  };

  const handleRetry = async () => {
    if (!createdId) return;
    setRetrying(true);
    try {
      const pending = stagedFiles.filter((f) => failedIds.includes(f.id));
      const failed = await attachStaged(createdId, pending.map((f) => f.id));
      setFailedIds(failed);
      if (failed.length > 0) {
        setSaveError('Some attachments still failed. Retry again — no duplicate template is created.');
      } else {
        stagedFiles.forEach((f) => onUnstageFile(f.id));
        showToast('Attachments saved.', 'success');
        navigate(`/templates/${createdId}/edit`, { replace: true });
      }
    } finally {
      setRetrying(false);
    }
  };

  const saving = createTemplate.isPending || updateTemplate.isPending || attachFromLibrary.isPending;

  return (
    <Card className="max-w-2xl">
      <CardContent className="space-y-5 pt-6">
        <div className="space-y-1.5">
          <Label htmlFor="ch-name">Template name *</Label>
          <Input id="ch-name" value={name} onChange={(e) => { setName(e.target.value); touch(); }} placeholder={channel === 'sms' ? 'e.g. Appointment reminder (SMS)' : 'e.g. Intro (WhatsApp)'} />
          {errors.name && <p className="text-xs text-red-600">{errors.name}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" className="min-h-[44px] text-xs" onClick={() => setPickerOpen(true)}>
            <FolderOpen className="mr-1 h-3.5 w-3.5 text-indigo-600" />Add content
          </Button>
          {!channelSupportsAttachments(channel) && (
            <p className="w-full text-xs text-slate-500">Attachments are not sent on this channel — “Attach file” is hidden and links are inserted as plain text with the URL.</p>
          )}
        </div>
        {channel === 'whatsapp' && <WhatsappEditor body={body} onChange={(v) => { setBody(v); touch(); }} attachmentCount={attachmentCount + stagedFiles.length} error={errors.body} />}
        {channel === 'sms' && <SmsEditor body={body} onChange={(v) => { setBody(v); touch(); }} error={errors.body} />}
        {channel === 'phone_call' && (
          <div className="space-y-1.5">
            <Label htmlFor="call-script">Call script *</Label>
            <Textarea id="call-script" value={body} rows={8} onChange={(e) => { setBody(e.target.value); touch(); }} placeholder="Opening, key points, objection handling, next step…" />
            {errors.body && <p className="text-xs text-red-600">{errors.body}</p>}
          </div>
        )}
        {saveError && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <p>{saveError}</p>
            {createdId && failedIds.length > 0 && (
              <Button type="button" variant="outline" size="sm" className="mt-2 min-h-[44px]" disabled={retrying} onClick={() => void handleRetry()}>
                {retrying ? 'Retrying…' : `Retry ${failedIds.length} failed attachment${failedIds.length === 1 ? '' : 's'}`}
              </Button>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          <Button onClick={handleSave} disabled={saving} className="min-h-[44px]"><Save className="mr-2 h-4 w-4" />{saving ? 'Saving…' : isEdit ? 'Update Template' : createdId ? 'Retry attachments' : 'Create Template'}</Button>
          <Button variant="outline" className="min-h-[44px]" asChild><Link to="/templates">Cancel</Link></Button>
        </div>
      </CardContent>
      {pickerOpen && (
        <AddContentPicker
          open
          channel={channel}
          editorMode="simple"
          onClose={() => setPickerOpen(false)}
          onAddFile={handleAddFile}
          onAddPage={handleAddPage}
          alreadyAttachedIds={isEdit ? existingAttachments.map((a) => a.libraryFileId ?? '').filter((v) => v.length > 0) : stagedFiles.map((f) => f.id)}
        />
      )}
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
  const [searchParams, setSearchParams] = useSearchParams();
  const { showToast } = useToast();

  const { data: existing, isLoading } = useTemplate(id ?? '');
  const { data: libraryFiles = [] } = useFiles();
  const { data: libraryPages = [] } = usePages();

  const queryChannel = searchParams.get('channel') as MessageChannel | null;
  const queryMode = searchParams.get('mode') as EmailMode | null;
  const pendingFileId = searchParams.get('addFile');
  const pendingPageSlug = searchParams.get('addPage');
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
  const [stagedFiles, setStagedFiles] = useState<LibraryFile[]>([]);
  const [pendingLabel, setPendingLabel] = useState('');
  const [shellPickerOpen, setShellPickerOpen] = useState(false);
  const attachFromLibraryShell = useAttachTemplateFromLibrary();

  const setDraft = (patch: Partial<SimpleDraft>) => setDraftState((d) => ({ ...d, ...patch }));
  const stageFile = (file: LibraryFile) => {
    setStagedFiles((prev) => (prev.some((f) => f.id === file.id) ? prev : [...prev, file]));
    setHasUnsaved(true);
  };
  const unstageFile = (fileId: string) => setStagedFiles((prev) => prev.filter((f) => f.id !== fileId));
  /** Library file IDs already attached to the saved template (live references). */
  const savedLibraryIds = (existing?.attachments ?? [])
    .map((a) => a.libraryFileId)
    .filter((v): v is string => typeof v === 'string' && v.length > 0);

  const pendingFile: LibraryFile | null = pendingFileId
    ? (libraryFiles.find((f) => f.id === pendingFileId) ?? stagedFiles.find((f) => f.id === pendingFileId) ?? null)
    : null;
  const pendingPage: LandingPage | null = pendingPageSlug
    ? (libraryPages.find((p) => p.slug === pendingPageSlug) ?? null)
    : null;

  const clearPendingParams = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('addFile');
    next.delete('addPage');
    setSearchParams(next, { replace: true });
    setPendingLabel('');
  };

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
    const stagedIncompatible = stagedFiles.length > 0 && !channelSupportsAttachments(next);
    if ((hasUnsaved && channel === 'email' && mode !== 'simple') || stagedIncompatible) {
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
      // Staged attachments would be ignored at send time on SMS/phone —
      // convert them to visible download links instead of discarding.
      if (stagedFiles.length > 0 && !channelSupportsAttachments(next)) {
        const lines = stagedFiles.map((f) => buildFileDownloadLine(f));
        setDraftState((d) => ({ ...d, body: `${d.body}\n${lines.join('\n')}`.trim() }));
        setStagedFiles([]);
        showToast('Staged attachments were kept as download links — this channel does not send attachments.', 'success');
      }
    }
    setChannel(next);
    if (next !== 'email') setMode('simple');
    setHasUnsaved(true);
  };

  const confirmPendingFileLink = () => {
    if (!pendingFile) return;
    setDraftState((d) => {
      const line = buildFileDownloadLine(pendingFile);
      return { ...d, body: d.body ? `${d.body}\n${line}` : line };
    });
    setHasUnsaved(true);
    showToast('File link added to the draft. Save the template to keep it.', 'success');
    clearPendingParams();
  };

  const confirmPendingFileAttach = () => {
    if (!pendingFile) return;
    if (stagedFiles.some((f) => f.id === pendingFile.id)) {
      showToast('This file is already staged in the current draft.', 'error');
      return;
    }
    if (stagedFiles.length >= MAX_ATTACHMENTS) {
      showToast(`Attachment limit reached (${MAX_ATTACHMENTS}).`, 'error');
      return;
    }
    stageFile(pendingFile);
    showToast('File staged. It attaches when you save the template.', 'success');
    clearPendingParams();
  };

  const confirmPendingPage = () => {
    if (!pendingPage) return;
    const label = pendingLabel.trim() || `View ${pendingPage.title}`;
    setDraftState((d) => {
      const labelled = `${label}: ${pagePublicUrl(pendingPage.slug)}`;
      return { ...d, body: d.body ? `${d.body}\n${labelled}` : labelled };
    });
    setHasUnsaved(true);
    showToast('Page link added to the draft. Save the template to keep it.', 'success');
    clearPendingParams();
  };

  /** Attach a library file to the already-saved template right away (edit mode). */
  const attachFileNow = async (file: LibraryFile): Promise<void> => {
    if (!isEdit || !id) return;
    if (!channelSupportsAttachments(channel)) {
      showToast('Attachments are not sent on this channel — use a download link instead.', 'error');
      return;
    }
    const current = existing?.attachments ?? [];
    if (current.some((a) => a.libraryFileId === file.id || a.filename === file.filename)) {
      showToast('This file is already attached to this template.', 'error');
      return;
    }
    if (current.length >= MAX_ATTACHMENTS) {
      showToast(`Attachment limit reached (${MAX_ATTACHMENTS}).`, 'error');
      return;
    }
    try {
      await attachFromLibraryShell.mutateAsync({ id, fileId: file.id });
      showToast('Attachment added from library. Saved immediately.', 'success');
      clearPendingParams();
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to attach file from library.'), 'error');
    }
  };

  const confirmPendingFileAttachNow = () => {
    if (!pendingFile) return;
    void attachFileNow(pendingFile);
  };

  /** Shared file handler for the visual/HTML shell picker (attach-only context). */
  const handleShellPickFile = (file: LibraryFile, placement: ContentPlacement) => {
    if (placement !== 'attach') return;
    setShellPickerOpen(false);
    if (isEdit) {
      void attachFileNow(file);
      return;
    }
    if (stagedFiles.some((f) => f.id === file.id)) {
      showToast('This file is already staged in the current draft.', 'error');
      return;
    }
    if (stagedFiles.length >= MAX_ATTACHMENTS) {
      showToast(`Attachment limit reached (${MAX_ATTACHMENTS}).`, 'error');
      return;
    }
    stageFile(file);
    showToast('File staged. It attaches when you save the template.', 'success');
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

          {(pendingFileId || pendingPageSlug) && (pendingFile || pendingPage) && (pendingFile != null || channel !== 'email' || mode === 'simple') && (
            <Card className="max-w-2xl border-indigo-200 bg-indigo-50/50">
              <CardContent className="space-y-3 pt-6">
                {pendingFile && (
                  <>
                    <p className="text-sm font-medium text-slate-900">
                      Selected file: <span title={pendingFile.filename}>{pendingFile.filename}</span>
                    </p>
                    <p className="text-xs text-slate-600">
                      {isEdit
                        ? (channel !== 'email' || mode === 'simple')
                          ? 'Confirm how to add it. Links insert into the draft text; Attach saves immediately to this template.'
                          : 'Confirm how to attach it. Attach saves immediately to this template; links can only be inserted in the Simple editor.'
                        : 'Confirm how to add it. Nothing is saved until you press Save — cancelling keeps your draft unchanged.'}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {(channel !== 'email' || mode === 'simple') && (
                        <Button type="button" size="sm" className="min-h-[44px]" onClick={confirmPendingFileLink}>
                          Add download link
                        </Button>
                      )}
                      {channelSupportsAttachments(channel) && !isEdit && (
                        <Button type="button" variant="outline" size="sm" className="min-h-[44px]" onClick={confirmPendingFileAttach}>
                          Stage attachment
                        </Button>
                      )}
                      {channelSupportsAttachments(channel) && isEdit && (
                        <Button type="button" variant="outline" size="sm" className="min-h-[44px]" disabled={attachFromLibraryShell.isPending} onClick={confirmPendingFileAttachNow}>
                          {attachFromLibraryShell.isPending ? 'Attaching…' : 'Attach now'}
                        </Button>
                      )}
                      <Button type="button" variant="ghost" size="sm" className="min-h-[44px]" onClick={clearPendingParams}>
                        Dismiss
                      </Button>
                    </div>
                  </>
                )}
                {pendingPage && !pendingFile && (
                  <>
                    <p className="text-sm font-medium text-slate-900">
                      Selected page: {pendingPage.title} {pendingPage.status !== 'published' ? '(draft)' : ''}
                    </p>
                    {pendingPage.status !== 'published' ? (
                      <>
                        <p className="text-xs text-amber-700">
                          This page is still a draft. Publish it before sharing — drafts cannot be inserted as public links.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" variant="outline" size="sm" className="min-h-[44px]" asChild>
                            <Link to={`/pages/${pendingPage.id}/edit`}>Edit and publish</Link>
                          </Button>
                          <Button type="button" variant="ghost" size="sm" className="min-h-[44px]" onClick={clearPendingParams}>
                            Dismiss
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="space-y-1.5">
                          <Label htmlFor="pending-page-label">Link label</Label>
                          <Input
                            id="pending-page-label"
                            value={pendingLabel || `View ${pendingPage.title}`}
                            onChange={(e) => setPendingLabel(e.target.value)}
                          />
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" size="sm" className="min-h-[44px]" onClick={confirmPendingPage}>
                            Add page link
                          </Button>
                          <Button type="button" variant="ghost" size="sm" className="min-h-[44px]" onClick={clearPendingParams}>
                            Dismiss
                          </Button>
                        </div>
                      </>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          )}
          {(channel === 'email' && (mode === 'visual' || mode === 'html') && (pendingFileId || pendingPageSlug)) && (
            <Card className="max-w-2xl border-amber-200 bg-amber-50">
              <CardContent className="pt-6 text-sm text-amber-800">
                File and page links insert into the Simple editor. Switch to Simple to add this item as a link, use “Add content” below to attach the file, or use the block pickers in Visual design.
              </CardContent>
            </Card>
          )}
          {channel === 'email' && (mode === 'visual' || mode === 'html') && (
            <Card className="max-w-2xl">
              <CardContent className="flex flex-wrap items-center gap-2 pt-6">
                <Button type="button" variant="outline" size="sm" className="min-h-[44px] text-xs" onClick={() => setShellPickerOpen(true)}>
                  <FolderOpen className="mr-1 h-3.5 w-3.5 text-indigo-600" />Add content
                </Button>
                <p className="w-full text-xs text-slate-500">
                  Attachments ride along with the message and can be staged before the first save. Download links can only be inserted in the Simple editor.
                </p>
              </CardContent>
            </Card>
          )}
          {shellPickerOpen && (
            <AddContentPicker
              open
              channel={channel}
              editorMode={mode}
              fileFilter="all"
              allowPages={false}
              allowedPlacements={['attach']}
              dialogTitle="Attach a file to this template"
              alreadyAttachedIds={[...savedLibraryIds, ...stagedFiles.map((f) => f.id)]}
              onClose={() => setShellPickerOpen(false)}
              onAddFile={handleShellPickFile}
              onAddPage={() => undefined}
            />
          )}

          {channel === 'email' && mode === 'simple' && (
            <SimpleEmailForm channel={channel} draft={draft} setDraft={setDraft} onDirty={() => setHasUnsaved(true)} stagedFiles={stagedFiles} onStageFile={stageFile} onUnstageFile={unstageFile} existingAttachments={existing?.attachments ?? []} />
          )}
          {channel === 'email' && mode === 'visual' && (
            <VisualEmailEditor
              templateId={id}
              initial={visualInitial}
              starter={starter}
              approvalStatus={existing?.approval_status}
              onDirtyChange={setHasUnsaved}
              onSaved={(newId) => navigate(`/templates/${newId}/edit`, { replace: true })}
              stagedFiles={stagedFiles}
              onUnstageFile={unstageFile}
            />
          )}
          {channel === 'email' && mode === 'html' && (
            <HtmlEmailEditor existing={existing} onDirty={() => setHasUnsaved(true)} onSaved={(newId) => navigate(`/templates/${newId}/edit`, { replace: true })} stagedFiles={stagedFiles} onUnstageFile={unstageFile} />
          )}
          {channel !== 'email' && (
            <StructuredChannelForm
              channel={channel}
              draft={draft}
              setDraft={setDraft}
              onDirty={() => setHasUnsaved(true)}
              attachmentCount={existing?.attachments?.length ?? 0}
              stagedFiles={stagedFiles}
              onStageFile={stageFile}
              onUnstageFile={unstageFile}
              existingAttachments={existing?.attachments ?? []}
            />
          )}

          {(channel === 'email' || channel === 'whatsapp') && showAttachments && id && (
            <AttachmentsPanel templateId={id} channel={channel} />
          )}
          {(channel === 'email' || channel === 'whatsapp') && !isEdit && (
            <StagedAttachmentsCard channel={channel} stagedFiles={stagedFiles} onRemove={unstageFile} pendingCount={stagedFiles.length} />
          )}
          {!channelSupportsAttachments(channel) && (
            <Card className="max-w-2xl border-dashed">
              <CardContent className="pt-6 text-sm text-slate-500">
                Attachments are not sent on {channel === 'sms' ? 'SMS' : 'phone calls'}. Use “Add content” to insert a download link with the full URL instead.
              </CardContent>
            </Card>
          )}
        </>
      )}

      <AlertDialog
        open={pendingMode !== null || pendingChannel !== null}
        title="Switch editor?"
        description={
          pendingChannel && stagedFiles.length > 0 && !channelSupportsAttachments(pendingChannel)
            ? `Switching to ${pendingChannel} keeps your text, but staged attachments are not sent on that channel — they will be kept as download links. Unsaved edits in the current view are discarded.`
            : 'Switching views discards unsaved edits in the current view. Anything you already saved is preserved — including the other mode\'s content, which is restored when you switch back.'
        }
        confirmLabel="Switch (discard unsaved edits)"
        cancelLabel="Stay here"
        onConfirm={confirmModeSwitch}
        onCancel={() => { setPendingMode(null); setPendingChannel(null); }}
      />
    </div>
  );
}

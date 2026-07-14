import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  useTemplate,
  useCreateTemplate,
  useUpdateTemplate,
  useUploadTemplateAttachment,
  useDeleteTemplateAttachment,
  type TemplateInput,
} from '@/api/templates';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
import type { MessageChannel, TemplateAttachment } from '@/types';
import { ArrowLeft, FileText, Image as ImageIcon, Paperclip, Save, Trash2, Upload } from 'lucide-react';

const ATTACHMENT_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,application/pdf';
const MAX_ATTACHMENTS = 3;

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

function AttachmentsPanel({ templateId }: { templateId: string }) {
  const { data: template } = useTemplate(templateId);
  const uploadAttachment = useUploadTemplateAttachment();
  const deleteAttachment = useDeleteTemplateAttachment();
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        <CardTitle className="flex items-center gap-2 text-base">
          <Paperclip className="h-4 w-4" />
          Attachments
        </CardTitle>
        <CardDescription>
          Images or PDFs sent along with this message (WhatsApp media / email attachments). Max{' '}
          {MAX_ATTACHMENTS}, 10MB each.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {attachments.length > 0 && (
          <div className="space-y-2">
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-2"
              >
                <AttachmentThumb attachment={attachment} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-900">{attachment.filename}</div>
                  <div className="text-xs text-slate-500">
                    {(attachment.sizeBytes / 1024).toFixed(0)} KB
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`Remove ${attachment.filename}`}
                  className="h-7 shrink-0 text-xs text-red-600 hover:bg-red-50"
                  onClick={() => handleRemove(attachment.id)}
                  disabled={deleteAttachment.isPending}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept={ATTACHMENT_ACCEPT}
          className="hidden"
          onChange={handleFileChange}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadAttachment.isPending || atLimit}
        >
          {uploadAttachment.isPending ? (
            <>
              <ImageIcon className="mr-2 h-3.5 w-3.5 animate-pulse" />
              Uploading…
            </>
          ) : atLimit ? (
            `Limit reached (${MAX_ATTACHMENTS})`
          ) : (
            <>
              <Upload className="mr-2 h-3.5 w-3.5" />
              Add attachment
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

const VARIABLE_PATTERN = /\{\{(\w+)\}\}/g;

function extractVariables(body: string): string[] {
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  VARIABLE_PATTERN.lastIndex = 0;
  while ((m = VARIABLE_PATTERN.exec(body)) !== null) {
    found.add(m[1]);
  }
  return Array.from(found);
}

export function TemplateFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEdit = !!id;
  const navigate = useNavigate();
  const { showToast } = useToast();

  const { data: existing } = useTemplate(id ?? '');
  const createTemplate = useCreateTemplate();
  const updateTemplate = useUpdateTemplate();

  const [name, setName] = useState('');
  const [channel, setChannel] = useState<MessageChannel>('email');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (existing) {
      setName(existing.name);
      setChannel(existing.channel);
      setSubject(existing.subject ?? '');
      setBody(existing.body);
    }
  }, [existing]);

  const detectedVars = extractVariables(body);

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
    };

    try {
      if (isEdit && id) {
        await updateTemplate.mutateAsync({ id, input });
        showToast('Template updated.', 'success');
        navigate('/templates');
      } else {
        const created = await createTemplate.mutateAsync(input);
        showToast('Template created. Add attachments below, or go back to the list.', 'success');
        // Stay on the page (now in edit mode) so attachments can be added —
        // the upload endpoint needs an existing template id.
        if (created) navigate(`/templates/${created.id}/edit`, { replace: true });
      }
    } catch {
      showToast('Failed to save template.', 'error');
    }
  };

  const saving = createTemplate.isPending || updateTemplate.isPending;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Outreach"
        title={isEdit ? 'Edit Template' : 'New Template'}
        description={isEdit ? 'Update this message template.' : 'Create a new message template. It will require approval before use.'}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/templates">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Cancel
            </Link>
          </Button>
        }
      />

      <Card className="max-w-2xl">
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="name">Template name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Cold outreach - WhatsApp intro"
              />
              {errors.name && <p className="text-xs text-red-600">{errors.name}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="channel">Channel *</Label>
              <select
                id="channel"
                value={channel}
                onChange={(e) => setChannel(e.target.value as MessageChannel)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="email">✉️ Email</option>
                <option value="whatsapp">💬 WhatsApp</option>
                <option value="sms">📱 SMS</option>
                <option value="phone_call">📞 Phone Call (script)</option>
              </select>
            </div>

            {channel === 'email' && (
              <div className="space-y-1.5">
                <Label htmlFor="subject">Subject *</Label>
                <Input
                  id="subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. Quick intro — {{business_name}}"
                />
                {errors.subject && <p className="text-xs text-red-600">{errors.subject}</p>}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="body">Message body *</Label>
              <p className="text-xs text-slate-500">
                Use <code className="rounded bg-slate-100 px-1">{'{{variable}}'}</code> placeholders.
                Available: <code>{'{{business_name}}'}</code>, <code>{'{{contact_name}}'}</code>,{' '}
                <code>{'{{industry}}'}</code>, <code>{'{{location}}'}</code>
              </p>
              <Textarea
                id="body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={8}
                placeholder="Hi {{contact_name}}, I noticed {{business_name}} is in the {{industry}} space…"
              />
              {errors.body && <p className="text-xs text-red-600">{errors.body}</p>}
            </div>

            {detectedVars.length > 0 && (
              <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
                <p className="text-xs font-medium text-blue-700">Detected variables:</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {detectedVars.map((v) => (
                    <code key={v} className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">
                      {`{{${v}}}`}
                    </code>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={saving}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? 'Saving…' : isEdit ? 'Update Template' : 'Create Template'}
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link to="/templates">Cancel</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {isEdit && id ? (
        <AttachmentsPanel templateId={id} />
      ) : (
        <Card className="max-w-2xl border-dashed">
          <CardContent className="flex items-center gap-2 pt-6 text-sm text-slate-500">
            <Paperclip className="h-4 w-4 shrink-0" />
            Save the template first to attach images or PDFs.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

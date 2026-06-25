import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTemplate, useCreateTemplate, useUpdateTemplate, type TemplateInput } from '@/api/templates';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/Toast';
import type { MessageChannel } from '@/types';
import { ArrowLeft, Save } from 'lucide-react';

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
      } else {
        await createTemplate.mutateAsync(input);
        showToast('Template created. Pending approval.', 'success');
      }
      navigate('/templates');
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
    </div>
  );
}

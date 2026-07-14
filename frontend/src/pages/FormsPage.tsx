import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useListForms, useDeleteForm, type Form } from '@/api/forms';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingTable } from '@/components/ui/LoadingTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
import { Plus, FormInput, Trash2, BarChart3, ExternalLink, Copy, Check, Code2, Link2 } from 'lucide-react';

export function FormsPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const { data, isLoading, error } = useListForms();
  const deleteForm = useDeleteForm();

  const forms = data?.data ?? [];

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete form "${name}"? This cannot be undone.`)) return;
    try {
      await deleteForm.mutateAsync(id);
      showToast('Form deleted', 'success');
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to delete form'), 'error');
    }
  };

  const copyToClipboard = (key: string, value: string, label: string) => {
    navigator.clipboard.writeText(value);
    setCopiedKey(key);
    showToast(`${label} copied`, 'success');
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const hostedUrl = (slug: string) => `${window.location.origin}/forms/${slug}`;
  const apiEndpoint = (formId: string) => `${window.location.origin}/api/v1/forms/${formId}/submit`;
  const samplePayload = (form: Form) => {
    const entries = form.fields
      .filter((field) => field.type !== 'hidden')
      .slice(0, 8)
      .map((field) => {
        const sample = field.type === 'email'
          ? 'person@example.com'
          : field.type === 'phone'
            ? '+919876543210'
            : field.type === 'number'
              ? 1
              : field.type === 'checkbox'
                ? true
                : field.placeholder || field.label || field.name;
        return [field.name, sample] as const;
      });
    return JSON.stringify(Object.fromEntries(entries), null, 2);
  };

  const integrationExample = (form: Form) => `fetch('${apiEndpoint(form.id)}', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(${samplePayload(form)})
});`;

  if (isLoading) return <LoadingTable rows={5} cols={5} />;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Capture"
        title="Web Forms"
        description="Define lead fields once, then use either the hosted form or your own website design."
        actions={
          <Button onClick={() => navigate('/forms/new')}>
            <Plus className="mr-2 h-4 w-4" /> New Form
          </Button>
        }
      />

      {error && (
        <ErrorState message={getApiErrorMessage(error, 'Failed to load forms')} />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-slate-200">
          <CardContent className="flex gap-3 p-5">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-slate-950 text-white">
              <Link2 className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base">Hosted form</CardTitle>
              <p className="mt-1 text-sm text-slate-600">
                Use CRM's ready-made public form when you need a quick link for ads, WhatsApp, email, or a simple website button.
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-200">
          <CardContent className="flex gap-3 p-5">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-emerald-600 text-white">
              <Code2 className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base">Custom website API</CardTitle>
              <p className="mt-1 text-sm text-slate-600">
                Keep your website's custom design. Submit only JSON data to CRM so leads, analytics, scoring, and assignment still work.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {forms.length === 0 ? (
        <EmptyState
          icon={<FormInput className="h-6 w-6" />}
          title="No forms yet"
          description="Create your first web form to start capturing leads from your website."
          action={
            <Button onClick={() => navigate('/forms/new')}>
              <Plus className="mr-2 h-4 w-4" /> Create Form
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {forms.map((form: Form) => (
            <Card key={form.id} className="relative overflow-hidden">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-lg">{form.name}</CardTitle>
                    <p className="text-sm text-slate-500">/{form.slug}</p>
                  </div>
                  <StatusBadge tone={form.is_active ? 'green' : 'gray'}>
                    {form.is_active ? 'Active' : 'Inactive'}
                  </StatusBadge>
                </div>

                {form.description && (
                  <p className="mt-3 line-clamp-2 text-sm text-slate-600">{form.description}</p>
                )}

                <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
                  <span>{form.fields.length} fields</span>
                  <span>·</span>
                  <span>{form.submit_action === 'create_lead' ? 'Creates lead' : form.submit_action}</span>
                </div>

                <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <Link2 className="h-3.5 w-3.5" /> Hosted form
                  </div>
                  <p className="mt-1 break-all text-xs text-slate-600">{hostedUrl(form.slug)}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => copyToClipboard(`hosted-${form.id}`, hostedUrl(form.slug), 'Hosted form link')}
                    >
                      {copiedKey === `hosted-${form.id}` ? <Check className="mr-1 h-3 w-3 text-green-600" /> : <Copy className="mr-1 h-3 w-3" />}
                      Copy Link
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.open(`/forms/${form.slug}`, '_blank')}
                    >
                      <ExternalLink className="mr-1 h-3 w-3" /> Preview
                    </Button>
                  </div>
                </div>

                <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                    <Code2 className="h-3.5 w-3.5" /> Custom website API
                  </div>
                  <p className="mt-1 break-all text-xs text-emerald-800">POST {apiEndpoint(form.id)}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => copyToClipboard(`endpoint-${form.id}`, apiEndpoint(form.id), 'API endpoint')}
                    >
                      {copiedKey === `endpoint-${form.id}` ? <Check className="mr-1 h-3 w-3 text-green-600" /> : <Copy className="mr-1 h-3 w-3" />}
                      Copy Endpoint
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => copyToClipboard(`example-${form.id}`, integrationExample(form), 'Fetch example')}
                    >
                      {copiedKey === `example-${form.id}` ? <Check className="mr-1 h-3 w-3 text-green-600" /> : <Code2 className="mr-1 h-3 w-3" />}
                      Copy Code
                    </Button>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => navigate(`/forms/${form.id}/edit`)}
                  >
                    Edit Fields
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => navigate(`/forms/${form.id}/analytics`)}
                  >
                    <BarChart3 className="mr-1 h-3 w-3" /> Analytics
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-red-600 hover:bg-red-50"
                    onClick={() => handleDelete(form.id, form.name)}
                    disabled={deleteForm.isPending}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useListForms, useDeleteForm, useFormEmbed, type Form } from '@/api/forms';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingTable } from '@/components/ui/LoadingTable';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
import { Plus, FormInput, Trash2, BarChart3, ExternalLink, Copy, Check, Code2, Link2, Loader2, X } from 'lucide-react';

function EmbedModal({ formId, onClose }: { formId: string; onClose: () => void }) {
  const { data, isLoading } = useFormEmbed(formId);
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);

  const snippet = data?.data?.snippet ?? '';

  const handleCopy = () => {
    if (!snippet) return;
    navigator.clipboard.writeText(snippet);
    setCopied(true);
    showToast('Embed HTML snippet copied to clipboard', 'success');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Embed Form Code</h2>
          <Button variant="outline" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-sm text-slate-600">
          Copy and paste this snippet into your website HTML to embed this form.
        </p>

        {isLoading ? (
          <LoadingSpinner />
        ) : (
          <div className="space-y-3">
            <textarea
              readOnly
              value={snippet}
              className="h-32 w-full rounded-md border border-slate-300 bg-slate-50 p-3 font-mono text-xs text-slate-800 outline-none"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button onClick={handleCopy}>
                {copied ? <Check className="mr-2 h-4 w-4 text-green-500" /> : <Copy className="mr-2 h-4 w-4" />}
                {copied ? 'Copied' : 'Copy Snippet'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function FormsPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [embedFormId, setEmbedFormId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const limit = 12;
  const offset = (page - 1) * limit;

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const { data, isLoading, error } = useListForms(limit, offset);
  const deleteForm = useDeleteForm();

  const forms = data?.data ?? [];
  const meta = data?.meta;
  const total = typeof meta?.total === 'number' ? meta.total : 0;
  const totalPages = Math.ceil(total / limit) || 1;

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete form "${name}"? This cannot be undone.`)) return;
    setDeletingId(id);
    try {
      await deleteForm.mutateAsync(id);
      showToast('Form deleted', 'success');
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to delete form'), 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const copyToClipboard = (key: string, value: string, label: string) => {
    navigator.clipboard.writeText(value);
    setCopiedKey(key);
    showToast(`${label} copied`, 'success');
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopiedKey(null), 2000);
  };

  const hostedUrl = (slug: string) => `${window.location.origin}/forms/${slug}`;
  const apiEndpoint = (formId: string) => `${window.location.origin}/api/v1/forms/${formId}/submit`;

  if (isLoading) return <LoadingTable rows={5} cols={4} />;

  return (
    <div className="space-y-6">
      {embedFormId && (
        <EmbedModal formId={embedFormId} onClose={() => setEmbedFormId(null)} />
      )}

      <PageHeader
        eyebrow="Capture"
        title="Web Forms"
        description="Build embeddable lead forms and view submission analytics"
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
                Use CRM's ready-made public form when you need a quick link for ads, WhatsApp, email, or a website button.
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
              <CardTitle className="text-base">Custom website API & Embed</CardTitle>
              <p className="mt-1 text-sm text-slate-600">
                Embed directly into your web pages or submit JSON to CRM for automated lead scoring and pipeline assignment.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {forms.length === 0 ? (
        <EmptyState
          icon={<FormInput className="h-6 w-6" />}
          title="No lead forms created yet"
          description="Create your first form to start collecting leads from your website or landing pages."
          action={
            <Button onClick={() => navigate('/forms/new')}>
              <Plus className="mr-2 h-4 w-4" /> Create Form
            </Button>
          }
        />
      ) : (
        <>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {forms.map((form: Form) => (
              <Card key={form.id} className="flex flex-col justify-between">
                <CardContent className="p-5 space-y-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base font-semibold text-slate-900">
                        {form.name}
                      </CardTitle>
                      {form.description && (
                        <p className="mt-1 text-xs text-slate-500 line-clamp-2">
                          {form.description}
                        </p>
                      )}
                    </div>
                    <StatusBadge tone={form.is_active ? 'green' : 'gray'}>
                      {form.is_active ? 'Active' : 'Inactive'}
                    </StatusBadge>
                  </div>

                  <div className="space-y-1 text-xs text-slate-500 border-t border-slate-100 pt-3">
                    <div className="flex justify-between">
                      <span>Fields:</span>
                      <span className="font-medium text-slate-700">{form.fields.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Action:</span>
                      <span className="font-medium text-slate-700">{form.submit_action}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Slug:</span>
                      <span className="font-mono text-slate-700">{form.slug}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        copyToClipboard(
                          `link-${form.id}`,
                          hostedUrl(form.slug),
                          'Form link',
                        )
                      }
                    >
                      {copiedKey === `link-${form.id}` ? (
                        <Check className="mr-1 h-3 w-3 text-green-500" />
                      ) : (
                        <Link2 className="mr-1 h-3 w-3" />
                      )}
                      Copy Link
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        copyToClipboard(
                          `api-${form.id}`,
                          apiEndpoint(form.id),
                          'API Endpoint',
                        )
                      }
                    >
                      {copiedKey === `api-${form.id}` ? (
                        <Check className="mr-1 h-3 w-3 text-green-500" />
                      ) : (
                        <Copy className="mr-1 h-3 w-3" />
                      )}
                      API URL
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEmbedFormId(form.id)}
                    >
                      <Code2 className="mr-1 h-3 w-3" /> Embed
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.open(`/forms/${form.slug}`, '_blank')}
                    >
                      <ExternalLink className="mr-1 h-3 w-3" /> Preview
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => navigate(`/forms/${form.id}/edit`)}
                    >
                      Edit
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
                      disabled={deletingId === form.id || deleteForm.isPending}
                    >
                      {deletingId === form.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {total > limit && (
            <div className="flex items-center justify-between border-t border-slate-200 pt-4">
              <p className="text-sm text-slate-600">
                Showing <span className="font-medium">{offset + 1}</span> to{' '}
                <span className="font-medium">{Math.min(offset + limit, total)}</span> of{' '}
                <span className="font-medium">{total}</span> forms
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || isLoading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages || isLoading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useListForms, useDeleteForm, useForm } from "@/api/forms";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingTable } from "@/components/ui/LoadingTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/Toast";
import { getApiErrorMessage } from "@/lib/apiError";
import { FormPublishPanel } from "@/components/forms/FormPublishPanel";
import { formTemplates } from "@/components/forms/formTemplates";
import {
  Plus,
  ArrowRight,
  Trash2,
  BarChart3,
  Pencil,
  Send,
} from "lucide-react";

export function FormsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const publishId = searchParams.get("publish") ?? "";
  const publishedForm = useForm(publishId);
  const { showToast } = useToast();
  const [page, setPage] = useState(1);
  const limit = 12;
  const offset = (page - 1) * limit;
  const { data, isLoading, error, refetch } = useListForms(limit, offset);
  const deleteForm = useDeleteForm();
  const forms = data?.data ?? [];
  const total = typeof data?.meta?.total === "number" ? data.meta.total : 0;

  const handleDelete = async (id: string, name: string): Promise<void> => {
    if (
      !confirm(
        `Remove "${name}"? Its public link will stop accepting submissions.`,
      )
    )
      return;
    try {
      await deleteForm.mutateAsync(id);
      if (publishId === id) setSearchParams({});
      if (forms.length === 1 && page > 1) setPage(page - 1);
      showToast("Form removed", "success");
    } catch (err) {
      showToast(getApiErrorMessage(err, "Failed to remove form"), "error");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Web Forms"
        description="Turn website enquiries into CRM leads."
        actions={
          <Button onClick={() => navigate("/forms/new")}>
            <Plus className="mr-2 h-4 w-4" />
            Create form
          </Button>
        }
      />
      {publishId && publishedForm.isLoading && (
        <p role="status">Loading publishing options…</p>
      )}
      {publishId && publishedForm.error && (
        <ErrorState
          message={getApiErrorMessage(
            publishedForm.error,
            "Could not load publishing options",
          )}
        />
      )}
      {publishId && publishedForm.data?.data && (
        <FormPublishPanel
          key={publishId}
          form={publishedForm.data.data}
          onClose={() => setSearchParams({})}
        />
      )}
      {error ? (
        <div className="space-y-3">
          <ErrorState
            message={getApiErrorMessage(error, "Failed to load forms")}
          />
          <Button variant="outline" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : isLoading ? (
        <LoadingTable rows={5} cols={4} />
      ) : forms.length === 0 ? (
        <section className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
          <div className="max-w-2xl">
            <h2 className="text-xl font-semibold text-slate-950">
              Start with a form that is ready to customise
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Choose a template with contact fields already connected to your
              CRM. Then share a link or add the form to your website.
            </p>
          </div>
          <div className="mt-6 divide-y divide-slate-200">
            {formTemplates.map((template) => (
              <div
                key={template.key}
                className="flex flex-wrap items-center justify-between gap-4 py-5"
              >
                <div>
                  <h3 className="font-semibold text-slate-900">
                    {template.name}
                  </h3>
                  <p className="mt-1 text-sm text-slate-600">
                    {template.description}
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() =>
                    navigate(`/forms/new?template=${template.key}`)
                  }
                >
                  Use {template.name.toLowerCase()}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          <div className="mt-5 border-t border-slate-200 pt-5">
            <Button
              variant="outline"
              onClick={() => navigate("/forms/new?template=blank")}
            >
              Start from scratch
            </Button>
          </div>
        </section>
      ) : (
        <section
          aria-label="Your forms"
          className="overflow-hidden rounded-xl border border-slate-200 bg-white"
        >
          {forms.map((form) => (
            <div
              key={form.id}
              className="flex flex-col gap-4 border-b border-slate-200 p-5 last:border-b-0 lg:flex-row lg:items-center lg:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="break-words text-base font-semibold text-slate-950">
                    {form.name}
                  </h2>
                  <StatusBadge tone={form.is_active ? "green" : "gray"}>
                    {form.is_active ? "Accepting submissions" : "Inactive"}
                  </StatusBadge>
                </div>
                {form.description && (
                  <p className="mt-1 text-sm text-slate-600">
                    {form.description}
                  </p>
                )}
                <p className="mt-2 text-xs text-slate-600">
                  {form.fields.length} fields ·{" "}
                  {form.submit_action === "create_lead"
                    ? "Creates CRM leads"
                    : form.submit_action === "send_email"
                      ? "Saves submissions and sends configured emails"
                      : "Saves submissions and redirects"}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => setSearchParams({ publish: form.id })}
                >
                  <Send className="mr-2 h-4 w-4" />
                  Publish & test
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate(`/forms/${form.id}/edit`)}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate(`/forms/${form.id}/analytics`)}
                >
                  <BarChart3 className="mr-2 h-4 w-4" />
                  Results
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Remove ${form.name}`}
                  disabled={deleteForm.isPending}
                  onClick={() => void handleDelete(form.id, form.name)}
                >
                  <Trash2 className="h-4 w-4 text-red-600" />
                </Button>
              </div>
            </div>
          ))}
        </section>
      )}
      {!error && total > limit && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">
            {offset + 1}–{Math.min(offset + limit, total)} of {total} forms
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={page === 1 || isLoading}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              disabled={offset + limit >= total || isLoading}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
      <aside className="max-w-3xl text-sm leading-6 text-slate-600">
        <strong className="text-slate-800">
          One form, three ways to collect enquiries.
        </strong>{" "}
        Share a hosted link without changing your website, paste an embed into a
        page, or connect a custom form through the API. Scoring and assignment
        run through your configured workflows.
      </aside>
    </div>
  );
}

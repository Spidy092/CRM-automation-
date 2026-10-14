import { useEffect, useState } from "react";
import { useFormEmbed, type Form } from "@/api/forms";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/Toast";
import { getApiErrorMessage } from "@/lib/apiError";
import { Copy, ExternalLink, X } from "lucide-react";

export function FormPublishPanel({
  form,
  onClose,
}: {
  form: Form;
  onClose: () => void;
}) {
  const [method, setMethod] = useState<"link" | "embed" | "api">("link");
  const { data, isLoading, error, refetch } = useFormEmbed(
    method === "embed" ? form.id : "",
  );
  const { showToast } = useToast();
  const url = `${window.location.origin}/forms/${form.slug}`;
  const endpoint = `${window.location.origin}/api/v1/forms/${form.id}/submit`;
  const sample = Object.fromEntries(
    form.fields.map((field) => [
      field.name,
      field.type === "checkbox"
        ? true
        : field.type === "number"
          ? 1
          : field.type === "select"
            ? (field.options?.[0] ?? "")
            : field.type === "email"
              ? "visitor@example.com"
              : field.placeholder || field.label,
    ]),
  );
  const code =
    method === "link"
      ? url
      : method === "embed"
        ? (data?.data?.snippet ?? "")
        : `POST ${endpoint}\nContent-Type: application/json\n\n${JSON.stringify(sample, null, 2)}`;

  useEffect(() => {
    document.getElementById("form-publish-heading")?.focus();
  }, [form.id]);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
      showToast(
        method === "link" ? "Form link copied" : "Code copied",
        "success",
      );
    } catch {
      showToast(
        "Could not copy. Select the text below and copy it manually.",
        "error",
      );
    }
  };

  return (
    <section
      className="rounded-xl border border-slate-300 bg-white p-5 sm:p-6"
      aria-labelledby="form-publish-heading"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2
            id="form-publish-heading"
            tabIndex={-1}
            className="text-lg font-semibold focus:outline-none"
          >
            Publish {form.name}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Choose how visitors will reach your form.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          aria-label="Close publishing options"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      {!form.is_active && (
        <p
          role="status"
          className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900"
        >
          This form is inactive. Enable it in the form editor before sharing.
        </p>
      )}
      <div className="mt-5 flex flex-wrap gap-2" aria-label="Publishing method">
        {(["link", "embed", "api"] as const).map((value) => (
          <Button
            key={value}
            variant={method === value ? "default" : "outline"}
            aria-pressed={method === value}
            onClick={() => setMethod(value)}
          >
            {value === "link"
              ? "Share a link"
              : value === "embed"
                ? "Embed on website"
                : "Connect your own form"}
          </Button>
        ))}
      </div>
      <p className="my-4 max-w-3xl text-sm text-slate-600">
        {method === "link"
          ? "Paste this link into WhatsApp, email, an ad, or a website button. No website changes are needed."
          : method === "embed"
            ? "Paste this HTML into your website where the form should appear. Adjust the iframe height to fit your fields, then check it on mobile."
            : "For developers: send your field names as JSON to this public endpoint. Never put private CRM credentials in website code. Cross-origin browser requests require the website origin to be allowed by your server configuration."}
      </p>
      {isLoading && method === "embed" ? (
        <p role="status">Loading embed code…</p>
      ) : error && method === "embed" ? (
        <div role="alert">
          <p>{getApiErrorMessage(error, "Could not load embed code.")}</p>
          <Button variant="outline" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          <label htmlFor="publish-code" className="sr-only">
            {method === "link" ? "Public form link" : "Integration code"}
          </label>
          <textarea
            id="publish-code"
            readOnly
            value={code}
            rows={method === "link" ? 2 : 9}
            className="w-full rounded-md border border-slate-300 bg-slate-50 p-3 font-mono text-xs text-slate-800"
          />
          <Button className="mt-3" disabled={!code} onClick={() => void copy()}>
            <Copy className="mr-2 h-4 w-4" />
            {method === "link" ? "Copy link" : "Copy code"}
          </Button>
        </>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-slate-900 underline underline-offset-4"
        >
          <ExternalLink className="h-4 w-4" />
          Open form and test
        </a>
        <p className="text-sm text-slate-600">
          A test submission creates real data. Check Leads afterward.
        </p>
      </div>
    </section>
  );
}

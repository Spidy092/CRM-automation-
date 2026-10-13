import type { FormField } from "@/api/forms";

export function FormPreview({
  name,
  description,
  fields,
}: {
  name: string;
  description: string;
  fields: FormField[];
}) {
  return (
    <section
      aria-label="Form preview"
      className="rounded-xl border border-slate-200 bg-white p-6"
    >
      <p className="mb-4 text-sm font-medium text-slate-600">
        Visitor preview · no data is submitted
      </p>
      <h2 className="text-xl font-semibold text-slate-950">
        {name || "Your form"}
      </h2>
      {description && (
        <p className="mt-2 text-sm text-slate-600">{description}</p>
      )}
      <div className="mt-6 space-y-4">
        {fields
          .filter((field) => field.type !== "hidden")
          .map((field, index) => (
            <div key={index} className="space-y-1.5">
              <label
                htmlFor={`preview-${index}`}
                className="block text-sm font-medium text-slate-800"
              >
                {field.label || "Untitled field"}
                {field.required ? " *" : " (optional)"}
              </label>
              {field.type === "textarea" ? (
                <textarea
                  id={`preview-${index}`}
                  placeholder={field.placeholder}
                  className="min-h-24 w-full rounded-md border border-slate-300 p-3 text-sm"
                />
              ) : field.type === "select" ? (
                <select
                  id={`preview-${index}`}
                  className="w-full rounded-md border border-slate-300 p-3 text-sm"
                >
                  <option>Select an option</option>
                  {field.options?.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              ) : field.type === "checkbox" ? (
                <input
                  id={`preview-${index}`}
                  type="checkbox"
                  className="h-5 w-5"
                />
              ) : (
                <input
                  id={`preview-${index}`}
                  type={field.type === "phone" ? "tel" : field.type}
                  placeholder={field.placeholder}
                  className="w-full rounded-md border border-slate-300 p-3 text-sm"
                />
              )}
            </div>
          ))}
      </div>
      <button
        type="button"
        disabled
        className="mt-6 rounded-md bg-slate-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
      >
        Submit enquiry
      </button>
    </section>
  );
}

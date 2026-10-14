import { useState, useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  useCreateForm,
  useUpdateForm,
  useForm,
  useListForms,
  type FormField,
  type EmailSettings,
} from "@/api/forms";
import { PageHeader } from "@/components/ui/PageHeader";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/Toast";
import { getApiErrorMessage } from "@/lib/apiError";
import { useForm as useHookForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { builderSchema, type BuilderValues } from "@/lib/formValidation";
import { FormPreview } from "@/components/forms/FormPreview";
import { formTemplates } from "@/components/forms/formTemplates";
import { ErrorState } from "@/components/ui/ErrorState";
import { Plus, Trash2, ArrowUp, ArrowDown, ArrowLeft } from "lucide-react";

const FIELD_TYPES: { value: FormField["type"]; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "number", label: "Number" },
  { value: "textarea", label: "Text Area" },
  { value: "select", label: "Dropdown" },
  { value: "checkbox", label: "Checkbox" },
  { value: "hidden", label: "Hidden" },
];

const LEAD_FIELDS = [
  { value: "contact_name", label: "Contact Name" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "business_name", label: "Company Name" },
  { value: "industry", label: "Industry" },
  { value: "location", label: "Location" },
  { value: "website", label: "Website" },
];

function createEmptyField(): FormField {
  return {
    name: `field_${Date.now()}`,
    label: "",
    type: "text",
    required: false,
    placeholder: "",
    leadField: "",
  };
}

export function FormBuilderPage() {
  const { id } = useParams();
  const isEditMode = Boolean(id);
  const [searchParams] = useSearchParams();
  const template = formTemplates.find(
    (item) => item.key === (searchParams.get("template") ?? "contact"),
  );
  const [step, setStep] = useState(0);
  const [saveError, setSaveError] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const navigate = useNavigate();
  const { showToast } = useToast();

  const {
    data: existingForm,
    isLoading: loadingForm,
    error: loadError,
  } = useForm(id ?? "");
  const { data: allFormsData } = useListForms(100, 0);
  const createForm = useCreateForm();
  const updateForm = useUpdateForm();

  const {
    watch,
    setValue,
    reset,
    handleSubmit: validateSave,
    formState: { errors },
  } = useHookForm<BuilderValues>({
    resolver: zodResolver(builderSchema),
    defaultValues: {
      name: isEditMode ? "" : (template?.name ?? ""),
      slug: isEditMode
        ? ""
        : (template?.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") ?? ""),
      description: "",
      fields:
        isEditMode || !template
          ? [createEmptyField()]
          : template.fields.map((field) => ({ ...field })),
      submitAction: "create_lead",
      submitMessage: "Thank you for your submission!",
      redirectUrl: "",
      isActive: true,
      emailSettings: {},
    },
  });
  const name = watch("name");
  const slug = watch("slug");
  const description = watch("description");
  const fields = watch("fields");
  const submitAction = watch("submitAction");
  const submitMessage = watch("submitMessage");
  const redirectUrl = watch("redirectUrl");
  const isActive = watch("isActive");
  const setName = (value: string): void =>
    setValue("name", value, { shouldDirty: true });
  const setSlug = (value: string): void =>
    setValue("slug", value, { shouldDirty: true });
  const setDescription = (value: string): void =>
    setValue("description", value, { shouldDirty: true });
  const setSubmitAction = (value: string): void =>
    setValue("submitAction", value as BuilderValues["submitAction"], {
      shouldDirty: true,
    });
  const setSubmitMessage = (value: string): void =>
    setValue("submitMessage", value, { shouldDirty: true });
  const setRedirectUrl = (value: string): void =>
    setValue("redirectUrl", value, { shouldDirty: true });
  const setIsActive = (value: boolean): void =>
    setValue("isActive", value, { shouldDirty: true });
  const setFields = (
    value: FormField[] | ((current: FormField[]) => FormField[]),
  ): void =>
    setValue("fields", typeof value === "function" ? value(fields) : value, {
      shouldDirty: true,
    });
  const emailSettings = watch("emailSettings");
  const setEmailSettings = (
    value: EmailSettings | ((current: EmailSettings) => EmailSettings),
  ): void =>
    setValue(
      "emailSettings",
      typeof value === "function" ? value(emailSettings) : value,
      { shouldDirty: true },
    );

  const allForms = allFormsData?.data ?? [];
  const normalizedSlug = slug.trim();
  const isSlugTaken = Boolean(
    normalizedSlug &&
    allForms.some((f) => f.slug === normalizedSlug && f.id !== id),
  );

  useEffect(() => {
    if (existingForm?.data) {
      const f = existingForm.data;
      reset({
        name: f.name,
        slug: f.slug,
        description: f.description ?? "",
        fields: f.fields.length > 0 ? f.fields : [createEmptyField()],
        submitAction: f.submit_action as BuilderValues["submitAction"],
        redirectUrl: f.redirect_url ?? "",
        submitMessage: f.submit_message,
        isActive: f.is_active,
        emailSettings: f.email_settings ?? {},
      });
    }
  }, [existingForm, reset]);

  const autoSlug = (value: string) => {
    setSlug(
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 100),
    );
  };

  const updateField = (index: number, updates: Partial<FormField>) => {
    setFields((prev) =>
      prev.map((f, i) => (i === index ? { ...f, ...updates } : f)),
    );
  };

  const removeField = (index: number) => {
    if (fields.length <= 1) return;
    setFields((prev) => prev.filter((_, i) => i !== index));
  };

  const moveField = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= fields.length) return;
    setFields((prev) => {
      const arr = [...prev];
      [arr[index], arr[newIndex]] = [arr[newIndex], arr[index]];
      return arr;
    });
  };

  const handleSave = async (): Promise<void> => {
    setSaveError("");
    if (!name.trim()) {
      setSaveError("Give your form a name.");
      setStep(0);
      return;
    }
    if (isSlugTaken) {
      setSaveError(
        `The address ${slug} is already in use. Choose another address.`,
      );
      setStep(0);
      return;
    }
    if (fields.some((f) => !f.label.trim())) {
      setSaveError("Give every field a label so visitors know what to enter.");
      setStep(0);
      return;
    }

    const names = fields.map((field) => field.name);
    if (
      names.some(
        (value) =>
          !/^[a-zA-Z0-9_]+$/.test(value) ||
          ["__proto__", "constructor", "prototype"].includes(value),
      ) ||
      new Set(names).size !== names.length
    ) {
      setSaveError(
        "Each field needs a unique name using letters, numbers, or underscores.",
      );
      setStep(0);
      return;
    }
    if (
      fields.some((field) => field.type === "select" && !field.options?.length)
    ) {
      setSaveError("Add at least one option to each dropdown.");
      setStep(0);
      return;
    }
    if (redirectUrl && !/^https?:\/\//i.test(redirectUrl)) {
      setSaveError(
        "Use a full website address beginning with https:// or http://.",
      );
      setStep(1);
      return;
    }
    if (submitAction === "redirect" && !redirectUrl.trim()) {
      setSaveError(
        "Add the website address visitors should open after submitting.",
      );
      setStep(1);
      return;
    }
    const payload = {
      name: name.trim(),
      slug: slug.trim() || undefined,
      description: description.trim() || null,
      fields,
      submit_action: submitAction,
      submit_message: submitMessage,
      redirect_url: redirectUrl.trim() || null,
      is_active: isActive,
      email_settings: emailSettings,
    };

    try {
      if (isEditMode && id) {
        await updateForm.mutateAsync({ id, data: payload });
        showToast("Form updated", "success");
      } else {
        const result = await createForm.mutateAsync(payload);
        showToast("Form created. Choose how to share it next.", "success");
        navigate(`/forms?publish=${result.data.id}`);
        return;
      }
      navigate(`/forms?publish=${id}`);
    } catch (err) {
      setSaveError(
        getApiErrorMessage(
          err,
          "Failed to save form. Your changes are still here.",
        ),
      );
    }
  };

  if (isEditMode && loadingForm) {
    return <LoadingSpinner />;
  }

  if (isEditMode && loadError)
    return (
      <ErrorState
        message={getApiErrorMessage(loadError, "Could not load this form")}
      />
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEditMode ? "Edit Form" : "New Form"}
        description="Build your form, choose what happens next, then preview and publish."
        actions={
          <Button variant="outline" onClick={() => navigate("/forms")}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Forms
          </Button>
        }
      />

      <nav aria-label="Form setup" className="flex flex-wrap gap-2">
        {["1. Build your form", "2. Follow-up", "3. Review & save"].map(
          (label, index) => (
            <Button
              key={label}
              variant={step === index ? "default" : "outline"}
              aria-current={step === index ? "step" : undefined}
              onClick={() => setStep(index)}
            >
              {label}
            </Button>
          ),
        )}
      </nav>
      {Object.keys(errors).length > 0 && (
        <div
          role="alert"
          className="rounded-md bg-red-50 p-4 text-sm text-red-800"
        >
          {Object.values(errors).map((error, index) => (
            <p key={index}>
              {error?.message
                ? String(error.message)
                : "Check the field labels, names, and dropdown options in Build your form."}
            </p>
          ))}
        </div>
      )}
      {saveError && (
        <p
          role="alert"
          className="rounded-md bg-red-50 p-4 text-sm text-red-800"
        >
          {saveError}
        </p>
      )}
      {step === 2 && (
        <div className="grid gap-6 lg:grid-cols-2">
          <FormPreview name={name} description={description} fields={fields} />
          <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold">
              Ready to collect enquiries?
            </h2>
            <p className="text-sm text-slate-600">
              {isActive
                ? "This form will accept submissions as soon as you save it."
                : "This form is inactive. You can enable it later."}
            </p>
            <ul className="space-y-3 text-sm text-slate-700">
              <li>
                {fields.filter((field) => field.type !== "hidden").length}{" "}
                visible fields ·{" "}
                {fields.filter((field) => field.required).length} required
              </li>
              <li>
                {submitAction === "create_lead"
                  ? "New submissions create CRM leads."
                  : "Submissions are saved without creating CRM leads."}
              </li>
              <li>
                Scoring and assignment depend on your configured workflows.
              </li>
              <li>
                {emailSettings.autoReply?.enabled
                  ? "Confirmation email enabled."
                  : "No confirmation email configured."}
              </li>
            </ul>
            {submitAction === "create_lead" &&
              !fields.some(
                (field) =>
                  field.leadField === "email" || field.name === "email",
              ) && (
                <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
                  No email field is connected to the lead. Add one so your team
                  can contact visitors by email.
                </p>
              )}
            <p className="text-sm text-slate-600">
              After saving, you can copy a link, embed the form, or connect your
              website.
            </p>
          </section>
        </div>
      )}
      <div className={step === 2 ? "hidden" : "grid gap-6 lg:grid-cols-3"}>
        {/* Form settings */}
        <div
          className={
            step === 1 ? "lg:col-span-3 space-y-4" : "lg:col-span-1 space-y-4"
          }
        >
          <Card className={step === 0 ? "" : "hidden"}>
            <CardContent className="p-5 space-y-4">
              <CardTitle className="text-base">Form details</CardTitle>
              <p className="text-sm text-slate-600">
                Keep it short. Only ask for information your team needs.
              </p>

              <div className="space-y-2">
                <Label htmlFor="name">Form Name *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!isEditMode && !slugEdited) autoSlug(e.target.value);
                  }}
                  placeholder="Contact Us"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="slug">URL Slug</Label>
                <Input
                  id="slug"
                  value={slug}
                  onChange={(e) => {
                    setSlugEdited(true);
                    setSlug(e.target.value);
                  }}
                  placeholder="contact-us"
                  className={
                    isSlugTaken ? "border-red-500 focus:ring-red-500" : ""
                  }
                />
                {isSlugTaken ? (
                  <p className="text-xs text-red-500 font-medium">
                    This slug is already in use by another form.
                  </p>
                ) : (
                  <p className="text-xs text-slate-500">
                    Your form will be at /forms/{slug || "..."}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <textarea
                  id="description"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional description"
                />
              </div>
            </CardContent>
          </Card>

          {step === 0 && (
            <div className="hidden lg:block">
              <FormPreview
                name={name}
                description={description}
                fields={fields}
              />
            </div>
          )}

          {/* Email Settings */}
          <Card className={step === 1 ? "" : "hidden"}>
            <CardContent className="p-5 space-y-6">
              {" "}
              <div className="space-y-2">
                <Label htmlFor="submit_action">On Submit</Label>
                <select
                  id="submit_action"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  value={submitAction}
                  onChange={(e) => setSubmitAction(e.target.value)}
                >
                  <option value="create_lead">Create Lead</option>
                  <option value="send_email">Save submission only</option>
                  <option value="redirect">Save submission and redirect</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="redirect_url">
                  After-submit website address
                  {submitAction === "redirect" ? " *" : " (optional)"}
                </Label>
                <Input
                  id="redirect_url"
                  type="url"
                  value={redirectUrl}
                  onChange={(event) => setRedirectUrl(event.target.value)}
                  placeholder="https://your-website.com/thank-you"
                />
                <p className="text-xs text-slate-600">
                  Leave empty to show the thank-you message.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="submit_message">Success Message</Label>
                <Input
                  id="submit_message"
                  value={submitMessage}
                  onChange={(e) => setSubmitMessage(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_active"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                <Label htmlFor="is_active" className="text-sm">
                  Active (accepting submissions)
                </Label>
              </div>
              <CardTitle className="text-base">Email Notifications</CardTitle>
              {/* Auto Reply */}
              <div className="space-y-3 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold">Auto-Reply to Lead</h4>
                  <input
                    type="checkbox"
                    aria-label="Enable confirmation email"
                    checked={emailSettings.autoReply?.enabled || false}
                    onChange={(e) =>
                      setEmailSettings((s) => ({
                        ...s,
                        autoReply: {
                          ...s.autoReply!,
                          enabled: e.target.checked,
                        },
                      }))
                    }
                  />
                </div>
                {emailSettings.autoReply?.enabled && (
                  <div className="space-y-3 pt-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">From Name</Label>
                        <Input
                          aria-label="Confirmation email fromName"
                          value={emailSettings.autoReply.fromName || ""}
                          onChange={(e) =>
                            setEmailSettings((s) => ({
                              ...s,
                              autoReply: {
                                ...s.autoReply!,
                                fromName: e.target.value,
                              },
                            }))
                          }
                          placeholder="Brand Name"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">From Email</Label>
                        <Input
                          aria-label="Confirmation email fromEmail"
                          value={emailSettings.autoReply.fromEmail || ""}
                          onChange={(e) =>
                            setEmailSettings((s) => ({
                              ...s,
                              autoReply: {
                                ...s.autoReply!,
                                fromEmail: e.target.value,
                              },
                            }))
                          }
                          placeholder="hello@brand.com"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Subject</Label>
                      <Input
                        aria-label="Confirmation email subject"
                        value={emailSettings.autoReply.subject || ""}
                        onChange={(e) =>
                          setEmailSettings((s) => ({
                            ...s,
                            autoReply: {
                              ...s.autoReply!,
                              subject: e.target.value,
                            },
                          }))
                        }
                        placeholder="Thank you!"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Message (HTML/Text)</Label>
                      <textarea
                        aria-label="Confirmation email message"
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        rows={4}
                        value={emailSettings.autoReply.body || ""}
                        onChange={(e) =>
                          setEmailSettings((s) => ({
                            ...s,
                            autoReply: {
                              ...s.autoReply!,
                              body: e.target.value,
                            },
                          }))
                        }
                      />
                    </div>
                  </div>
                )}
              </div>
              {/* Team Notification */}
              <div className="space-y-3 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold">Team Alert</h4>
                  <input
                    type="checkbox"
                    aria-label="Enable team alert"
                    checked={emailSettings.teamNotification?.enabled || false}
                    onChange={(e) =>
                      setEmailSettings((s) => ({
                        ...s,
                        teamNotification: {
                          ...s.teamNotification!,
                          enabled: e.target.checked,
                        },
                      }))
                    }
                  />
                </div>
                {emailSettings.teamNotification?.enabled && (
                  <div className="space-y-3 pt-2">
                    <div className="space-y-1">
                      <Label className="text-xs">To Emails</Label>
                      <Input
                        aria-label="Team alert emails"
                        value={emailSettings.teamNotification.emails || ""}
                        onChange={(e) =>
                          setEmailSettings((s) => ({
                            ...s,
                            teamNotification: {
                              ...s.teamNotification!,
                              emails: e.target.value,
                            },
                          }))
                        }
                        placeholder="team@example.com"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Subject</Label>
                      <Input
                        aria-label="Team alert subject"
                        value={emailSettings.teamNotification.subject || ""}
                        onChange={(e) =>
                          setEmailSettings((s) => ({
                            ...s,
                            teamNotification: {
                              ...s.teamNotification!,
                              subject: e.target.value,
                            },
                          }))
                        }
                        placeholder="New Lead: {contact_name}"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Message</Label>
                      <textarea
                        aria-label="Team alert message"
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        rows={4}
                        value={emailSettings.teamNotification.body || ""}
                        onChange={(e) =>
                          setEmailSettings((s) => ({
                            ...s,
                            teamNotification: {
                              ...s.teamNotification!,
                              body: e.target.value,
                            },
                          }))
                        }
                      />
                    </div>
                  </div>
                )}
              </div>
              {/* Partner Notification */}
              <div className="space-y-3 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold">
                    Partner Notification
                  </h4>
                  <input
                    type="checkbox"
                    aria-label="Enable partner notification"
                    checked={
                      emailSettings.partnerNotification?.enabled || false
                    }
                    onChange={(e) =>
                      setEmailSettings((s) => ({
                        ...s,
                        partnerNotification: {
                          ...s.partnerNotification!,
                          enabled: e.target.checked,
                        },
                      }))
                    }
                  />
                </div>
                {emailSettings.partnerNotification?.enabled && (
                  <div className="space-y-3 pt-2">
                    <div className="space-y-1">
                      <Label className="text-xs">To Emails</Label>
                      <Input
                        aria-label="Partner notification emails"
                        value={emailSettings.partnerNotification.emails || ""}
                        onChange={(e) =>
                          setEmailSettings((s) => ({
                            ...s,
                            partnerNotification: {
                              ...s.partnerNotification!,
                              emails: e.target.value,
                            },
                          }))
                        }
                        placeholder="{partner_email} or list"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Subject</Label>
                      <Input
                        aria-label="Partner notification subject"
                        value={emailSettings.partnerNotification.subject || ""}
                        onChange={(e) =>
                          setEmailSettings((s) => ({
                            ...s,
                            partnerNotification: {
                              ...s.partnerNotification!,
                              subject: e.target.value,
                            },
                          }))
                        }
                        placeholder="Lead submitted"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Message</Label>
                      <textarea
                        aria-label="Partner notification message"
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        rows={4}
                        value={emailSettings.partnerNotification.body || ""}
                        onChange={(e) =>
                          setEmailSettings((s) => ({
                            ...s,
                            partnerNotification: {
                              ...s.partnerNotification!,
                              body: e.target.value,
                            },
                          }))
                        }
                      />
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Field editor */}
        <div className={step === 0 ? "lg:col-span-2 space-y-4" : "hidden"}>
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Form Fields</h3>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setFields((prev) => [...prev, createEmptyField()])}
            >
              <Plus className="mr-1 h-3 w-3" /> Add Field
            </Button>
          </div>

          {fields.map((field, index) => (
            <Card key={index} className="relative">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex flex-col gap-1 pt-2">
                    <button
                      aria-label={`Move ${field.label || "field"} up`}
                      onClick={() => moveField(index, -1)}
                      disabled={index === 0}
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-md text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-slate-900 disabled:opacity-30"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button
                      aria-label={`Move ${field.label || "field"} down`}
                      onClick={() => moveField(index, 1)}
                      disabled={index === fields.length - 1}
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-md text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-slate-900 disabled:opacity-30"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="flex-1 grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label
                        htmlFor={`field-label-${index}`}
                        className="text-xs"
                      >
                        Label *
                      </Label>
                      <Input
                        id={`field-label-${index}`}
                        value={field.label}
                        onChange={(e) =>
                          updateField(index, { label: e.target.value })
                        }
                        placeholder="Full Name"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label
                        htmlFor={`field-type-${index}`}
                        className="text-xs"
                      >
                        Type
                      </Label>
                      <select
                        id={`field-type-${index}`}
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        value={field.type}
                        onChange={(e) =>
                          updateField(index, {
                            type: e.target.value as FormField["type"],
                          })
                        }
                      >
                        {FIELD_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center gap-2 pt-6">
                      <input
                        type="checkbox"
                        id={`req-${index}`}
                        checked={field.required}
                        onChange={(e) =>
                          updateField(index, { required: e.target.checked })
                        }
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      <Label htmlFor={`req-${index}`} className="text-xs">
                        Required
                      </Label>
                    </div>

                    <details className="sm:col-span-2 rounded-md border border-slate-200 p-3">
                      <summary className="cursor-pointer text-sm font-medium text-slate-700">
                        CRM mapping & advanced settings
                      </summary>
                      <p className="my-3 text-xs text-slate-600">
                        Templates are mapped already. Answers without a mapping
                        remain in the saved submission.
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {" "}
                        <div className="space-y-1">
                          <Label
                            htmlFor={`field-name-${index}`}
                            className="text-xs"
                          >
                            Field Name
                          </Label>
                          <Input
                            id={`field-name-${index}`}
                            value={field.name}
                            onChange={(e) =>
                              updateField(index, { name: e.target.value })
                            }
                            placeholder="full_name"
                          />
                        </div>{" "}
                        <div className="space-y-1">
                          <Label
                            htmlFor={`field-mapping-${index}`}
                            className="text-xs"
                          >
                            Maps to Lead Field
                          </Label>
                          <select
                            id={`field-mapping-${index}`}
                            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                            value={field.leadField ?? ""}
                            onChange={(e) =>
                              updateField(index, {
                                leadField: e.target.value || undefined,
                              })
                            }
                          >
                            <option value="">None</option>
                            {LEAD_FIELDS.map((lf) => (
                              <option key={lf.value} value={lf.value}>
                                {lf.label}
                              </option>
                            ))}
                          </select>
                        </div>{" "}
                        <div className="space-y-1">
                          <Label
                            htmlFor={`field-placeholder-${index}`}
                            className="text-xs"
                          >
                            Placeholder
                          </Label>
                          <Input
                            id={`field-placeholder-${index}`}
                            value={field.placeholder ?? ""}
                            onChange={(e) =>
                              updateField(index, {
                                placeholder: e.target.value,
                              })
                            }
                            placeholder="Enter value..."
                          />
                        </div>
                        {field.type === "hidden" && (
                          <div className="space-y-1">
                            <Label
                              htmlFor={`field-default-${index}`}
                              className="text-xs"
                            >
                              Hidden field value
                            </Label>
                            <Input
                              id={`field-default-${index}`}
                              value={field.defaultValue ?? ""}
                              onChange={(event) =>
                                updateField(index, {
                                  defaultValue: event.target.value,
                                })
                              }
                            />
                          </div>
                        )}
                      </div>
                    </details>
                    {field.type === "select" && (
                      <div className="sm:col-span-2 space-y-1">
                        <Label
                          htmlFor={`field-options-${index}`}
                          className="text-xs"
                        >
                          Dropdown Options (comma-separated)
                        </Label>
                        <Input
                          id={`field-options-${index}`}
                          value={(field.options ?? []).join(", ")}
                          onChange={(e) =>
                            updateField(index, {
                              options: e.target.value
                                .split(",")
                                .map((s) => s.trim())
                                .filter(Boolean),
                            })
                          }
                          placeholder="Option 1, Option 2, Option 3"
                        />
                      </div>
                    )}
                  </div>

                  <button
                    aria-label={`Remove ${field.label || "field"}`}
                    onClick={() => removeField(index)}
                    className="mt-2 grid h-10 w-10 shrink-0 place-items-center rounded-md text-slate-600 hover:bg-red-50 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-slate-900"
                    disabled={fields.length <= 1}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-5">
        <Button
          variant="outline"
          onClick={() => (step > 0 ? setStep(step - 1) : navigate("/forms"))}
        >
          {step > 0 ? "Previous step" : "Cancel"}
        </Button>
        {step < 2 ? (
          <Button onClick={() => setStep(step + 1)}>
            {step === 0 ? "Next: follow-up" : "Next: review"}
          </Button>
        ) : (
          <Button
            onClick={() =>
              void validateSave(handleSave, (invalid) => {
                setStep(
                  invalid.redirectUrl ||
                    invalid.submitMessage ||
                    invalid.emailSettings
                    ? 1
                    : 0,
                );
              })()
            }
            disabled={createForm.isPending || updateForm.isPending}
          >
            {createForm.isPending || updateForm.isPending
              ? "Saving…"
              : "Save & choose publishing method"}
          </Button>
        )}
      </div>
    </div>
  );
}

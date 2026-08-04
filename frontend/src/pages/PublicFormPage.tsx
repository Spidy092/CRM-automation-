import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useFormBySlug, useSubmitForm, type FormField } from '@/api/forms';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { CheckCircle, Send } from 'lucide-react';

function initialValue(field: FormField): string | boolean {
  if (field.type === 'checkbox') return field.defaultValue === 'true';
  return field.defaultValue ?? '';
}

function buildInitialValues(fields: FormField[]): Record<string, string | boolean> {
  return fields.reduce<Record<string, string | boolean>>((values, field) => {
    values[field.name] = initialValue(field);
    return values;
  }, {});
}

function isEmptyRequiredValue(value: string | boolean | undefined): boolean {
  if (typeof value === 'boolean') return !value;
  return !value || value.trim().length === 0;
}

function getAutoCompleteHint(field: FormField): string {
  if (field.leadField === 'email' || field.type === 'email' || field.name.includes('email')) return 'email';
  if (field.leadField === 'phone' || field.type === 'phone' || field.name.includes('phone') || field.name.includes('tel')) return 'tel';
  if (field.leadField === 'contact_name' || field.name.includes('name')) return 'name';
  if (field.leadField === 'business_name' || field.name.includes('company') || field.name.includes('org')) return 'organization';
  return 'on';
}

export function PublicFormPage() {
  const { slug } = useParams<{ slug: string }>();
  const { showToast } = useToast();
  const { data, isLoading, error } = useFormBySlug(slug ?? '');
  const submitForm = useSubmitForm();
  const form = data?.data;
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [submittedMessage, setSubmittedMessage] = useState<string | null>(null);

  const errorMessage = error ? getApiErrorMessage(error, '') : '';
  const isInactive = errorMessage.toLowerCase().includes('inactive') || (error as any)?.response?.status === 403;

  const visibleFields = useMemo(
    () => form?.fields.filter((field) => field.type !== 'hidden') ?? [],
    [form?.fields],
  );

  useEffect(() => {
    if (form) {
      setValues(buildInitialValues(form.fields));
    }
  }, [form]);

  const updateValue = (field: FormField, value: string | boolean) => {
    setValues((current) => ({ ...current, [field.name]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form) return;

    const missingField = form.fields.find(
      (field) => field.required && isEmptyRequiredValue(values[field.name]),
    );

    if (missingField) {
      showToast(`${missingField.label} is required`, 'error');
      return;
    }

    try {
      const response = await submitForm.mutateAsync({ formId: form.id, data: values });
      const result = response.data;
      if (result.redirectUrl) {
        window.location.assign(result.redirectUrl);
        return;
      }
      setSubmittedMessage(result.message || form.submitMessage);
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to submit form'), 'error');
    }
  };

  const renderField = (field: FormField) => {
    const id = `public-form-${field.name}`;
    const value = values[field.name];

    if (field.type === 'textarea') {
      return (
        <Textarea
          id={id}
          value={typeof value === 'string' ? value : ''}
          placeholder={field.placeholder}
          required={field.required}
          autoComplete={getAutoCompleteHint(field)}
          onChange={(event) => updateValue(field, event.target.value)}
          className="min-h-28"
        />
      );
    }

    if (field.type === 'select') {
      return (
        <select
          id={id}
          value={typeof value === 'string' ? value : ''}
          required={field.required}
          onChange={(event) => updateValue(field, event.target.value)}
          className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition-colors focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
        >
          <option value="">Select an option</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      );
    }

    if (field.type === 'checkbox') {
      return (
        <label className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            required={field.required}
            onChange={(event) => updateValue(field, event.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
          />
          <span>{field.placeholder || field.label}</span>
        </label>
      );
    }

    const inputType = field.type === 'phone' ? 'tel' : field.type;
    return (
      <Input
        id={id}
        type={inputType}
        value={typeof value === 'string' ? value : ''}
        placeholder={field.placeholder}
        required={field.required}
        autoComplete={getAutoCompleteHint(field)}
        onChange={(event) => updateValue(field, event.target.value)}
      />
    );
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <LoadingSpinner />
      </div>
    );
  }

  if (isInactive) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Card className="w-full max-w-md border-amber-200 bg-amber-50/50">
          <CardContent className="p-8 text-center">
            <h1 className="text-xl font-semibold text-amber-900">Form Inactive</h1>
            <p className="mt-2 text-sm text-amber-700">
              This form is currently inactive and no longer accepting submissions.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <h1 className="text-xl font-semibold text-slate-900">Form Not Found</h1>
            <p className="mt-2 text-sm text-slate-500">The requested form does not exist.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (submittedMessage) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <CheckCircle className="mx-auto h-12 w-12 text-green-500" />
            <h1 className="mt-4 text-xl font-semibold text-slate-900">Submission received</h1>
            <p className="mt-2 text-sm text-slate-600">{submittedMessage}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <main className="mx-auto w-full max-w-2xl">
        <Card>
          <CardContent className="p-5 sm:p-8">
            <div className="mb-8">
              <h1 className="text-2xl font-semibold text-slate-950">{form.name}</h1>
              {form.description && <p className="mt-2 text-sm leading-6 text-slate-600">{form.description}</p>}
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {visibleFields.map((field) => (
                <div key={field.name} className="space-y-2">
                  {field.type !== 'checkbox' && (
                    <Label htmlFor={`public-form-${field.name}`}>
                      {field.label}
                      {field.required && <span className="ml-1 text-red-500">*</span>}
                    </Label>
                  )}
                  {renderField(field)}
                </div>
              ))}

              <Button type="submit" disabled={submitForm.isPending} className="w-full sm:w-auto">
                <Send className="mr-2 h-4 w-4" />
                {submitForm.isPending ? 'Submitting...' : 'Submit'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

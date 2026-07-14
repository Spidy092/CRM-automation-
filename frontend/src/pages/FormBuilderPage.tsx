import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useCreateForm, useUpdateForm, useForm, type FormField } from '@/api/forms';
import { PageHeader } from '@/components/ui/PageHeader';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
import { Plus, Trash2, GripVertical, ArrowLeft } from 'lucide-react';

const FIELD_TYPES: { value: FormField['type']; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'number', label: 'Number' },
  { value: 'textarea', label: 'Text Area' },
  { value: 'select', label: 'Dropdown' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'hidden', label: 'Hidden' },
];

const LEAD_FIELDS = [
  { value: 'contact_name', label: 'Contact Name' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'business_name', label: 'Company Name' },
  { value: 'industry', label: 'Industry' },
  { value: 'location', label: 'Location' },
  { value: 'website', label: 'Website' },
];

function createEmptyField(): FormField {
  return {
    name: `field_${Date.now()}`,
    label: '',
    type: 'text',
    required: false,
    placeholder: '',
    leadField: '',
  };
}

export function FormBuilderPage() {
  const { id } = useParams();
  const isEditMode = Boolean(id);
  const navigate = useNavigate();
  const { showToast } = useToast();

  const { data: existingForm, isLoading: loadingForm } = useForm(id ?? '');
  const createForm = useCreateForm();
  const updateForm = useUpdateForm();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState<FormField[]>([createEmptyField()]);
  const [submitAction, setSubmitAction] = useState('create_lead');
  const [submitMessage, setSubmitMessage] = useState('Thank you for your submission!');
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (existingForm?.data) {
      const f = existingForm.data;
      setName(f.name);
      setSlug(f.slug);
      setDescription(f.description ?? '');
      setFields(f.fields.length > 0 ? f.fields : [createEmptyField()]);
      setSubmitAction(f.submit_action);
      setSubmitMessage(f.submit_message);
      setIsActive(f.is_active);
    }
  }, [existingForm]);

  const autoSlug = (value: string) => {
    setSlug(value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100));
  };

  const updateField = (index: number, updates: Partial<FormField>) => {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...updates } : f)));
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

  const handleSave = async () => {
    if (!name.trim()) {
      showToast('Form name is required', 'error');
      return;
    }
    if (fields.some((f) => !f.label.trim())) {
      showToast('All fields must have a label', 'error');
      return;
    }

    const payload = {
      name: name.trim(),
      slug: slug.trim() || undefined,
      description: description.trim() || null,
      fields,
      submit_action: submitAction,
      submit_message: submitMessage,
      is_active: isActive,
    };

    try {
      if (isEditMode && id) {
        await updateForm.mutateAsync({ id, data: payload });
        showToast('Form updated', 'success');
      } else {
        await createForm.mutateAsync(payload);
        showToast('Form created', 'success');
      }
      navigate('/forms');
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to save form'), 'error');
    }
  };

  if (isEditMode && loadingForm) {
    return <LoadingSpinner />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Capture"
        title={isEditMode ? 'Edit Form' : 'New Form'}
        description="Design your lead capture form"
        actions={
          <Button variant="outline" onClick={() => navigate('/forms')}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Forms
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Form settings */}
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardContent className="p-5 space-y-4">
              <CardTitle className="text-base">Form Settings</CardTitle>

              <div className="space-y-2">
                <Label htmlFor="name">Form Name *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => { setName(e.target.value); autoSlug(e.target.value); }}
                  placeholder="Contact Us"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="slug">URL Slug</Label>
                <Input
                  id="slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="contact-us"
                />
                <p className="text-xs text-slate-500">Your form will be at /forms/{slug || '...'}</p>
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

              <div className="space-y-2">
                <Label htmlFor="submit_action">On Submit</Label>
                <select
                  id="submit_action"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  value={submitAction}
                  onChange={(e) => setSubmitAction(e.target.value)}
                >
                  <option value="create_lead">Create Lead</option>
                  <option value="send_email">Send Email</option>
                  <option value="redirect">Redirect</option>
                </select>
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
                <Label htmlFor="is_active" className="text-sm">Active (accepting submissions)</Label>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Field editor */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Form Fields</h3>
            <Button size="sm" variant="outline" onClick={() => setFields((prev) => [...prev, createEmptyField()])}>
              <Plus className="mr-1 h-3 w-3" /> Add Field
            </Button>
          </div>

          {fields.map((field, index) => (
            <Card key={index} className="relative">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex flex-col gap-1 pt-2">
                    <button
                      onClick={() => moveField(index, -1)}
                      disabled={index === 0}
                      className="text-slate-400 hover:text-slate-600 disabled:opacity-30"
                    >
                      <GripVertical className="h-4 w-4 rotate-180" />
                    </button>
                    <button
                      onClick={() => moveField(index, 1)}
                      disabled={index === fields.length - 1}
                      className="text-slate-400 hover:text-slate-600 disabled:opacity-30"
                    >
                      <GripVertical className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="flex-1 grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Label *</Label>
                      <Input
                        value={field.label}
                        onChange={(e) => updateField(index, { label: e.target.value })}
                        placeholder="Full Name"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Field Name</Label>
                      <Input
                        value={field.name}
                        onChange={(e) => updateField(index, { name: e.target.value })}
                        placeholder="full_name"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Type</Label>
                      <select
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        value={field.type}
                        onChange={(e) => updateField(index, { type: e.target.value as FormField['type'] })}
                      >
                        {FIELD_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Maps to Lead Field</Label>
                      <select
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        value={field.leadField ?? ''}
                        onChange={(e) => updateField(index, { leadField: e.target.value || undefined })}
                      >
                        <option value="">None</option>
                        {LEAD_FIELDS.map((lf) => (
                          <option key={lf.value} value={lf.value}>{lf.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Placeholder</Label>
                      <Input
                        value={field.placeholder ?? ''}
                        onChange={(e) => updateField(index, { placeholder: e.target.value })}
                      />
                    </div>
                    <div className="flex items-center gap-4 pt-5">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={field.required}
                          onChange={(e) => updateField(index, { required: e.target.checked })}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                        Required
                      </label>
                    </div>
                  </div>

                  <button
                    onClick={() => removeField(index)}
                    className="mt-2 text-slate-400 hover:text-red-500"
                    disabled={fields.length <= 1}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => navigate('/forms')}>Cancel</Button>
            <Button onClick={handleSave} disabled={createForm.isPending || updateForm.isPending}>
              {createForm.isPending || updateForm.isPending ? 'Saving...' : isEditMode ? 'Update Form' : 'Create Form'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

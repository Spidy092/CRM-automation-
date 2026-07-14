import { useState } from 'react';
import { useCustomFields, useCreateCustomField, useUpdateCustomField, type CustomFieldInput } from '@/api/customFields';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { LoadingTable } from '@/components/ui/LoadingTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useToast } from '@/components/ui/Toast';
import type { CustomFieldType } from '@/types';
import { Plus, Edit, Settings2, ToggleLeft, ToggleRight } from 'lucide-react';

const fieldTypeLabels: Record<CustomFieldType, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  dropdown: 'Dropdown',
  checkbox: 'Checkbox',
};

interface FormState {
  label: string;
  field_key: string;
  field_type: CustomFieldType;
  options: string;
  is_required: boolean;
}

const emptyForm: FormState = {
  label: '',
  field_key: '',
  field_type: 'text',
  options: '',
  is_required: false,
};

export function CustomFieldsPage() {
  const { data: fields = [], isLoading, error } = useCustomFields();
  const createField = useCreateCustomField();
  const updateField = useUpdateCustomField();
  const { showToast } = useToast();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setFormErrors({});
    setShowForm(true);
  }

  function openEdit(field: (typeof fields)[0]) {
    setEditingId(field.id);
    setForm({
      label: field.label,
      field_key: field.field_key,
      field_type: field.field_type,
      options: Array.isArray(field.options) ? (field.options as string[]).join(', ') : '',
      is_required: field.is_required,
    });
    setFormErrors({});
    setShowForm(true);
  }

  function deriveKey(label: string): string {
    return label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!form.label.trim()) errs.label = 'Label is required';
    if (!form.field_key.trim()) errs.field_key = 'Key is required';
    if (!/^[a-z][a-z0-9_]*$/.test(form.field_key)) errs.field_key = 'Key must be lowercase alphanumeric with underscores';
    if (form.field_type === 'dropdown' && !form.options.trim()) errs.options = 'Dropdown options are required';
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const input: CustomFieldInput = {
      label: form.label.trim(),
      field_key: form.field_key.trim(),
      field_type: form.field_type,
      options: form.field_type === 'dropdown'
        ? form.options.split(',').map((s) => s.trim()).filter(Boolean)
        : null,
      is_required: form.is_required,
      is_active: true,
    };

    try {
      if (editingId) {
        await updateField.mutateAsync({ id: editingId, input });
        showToast('Custom field updated.', 'success');
      } else {
        await createField.mutateAsync(input);
        showToast('Custom field created.', 'success');
      }
      setShowForm(false);
      setEditingId(null);
    } catch {
      showToast('Failed to save custom field.', 'error');
    }
  };

  const handleToggleActive = async (field: (typeof fields)[0]) => {
    try {
      await updateField.mutateAsync({ id: field.id, input: { is_active: !field.is_active } });
      showToast(field.is_active ? 'Field deactivated.' : 'Field activated.', 'success');
    } catch {
      showToast('Failed to update field.', 'error');
    }
  };

  const saving = createField.isPending || updateField.isPending;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Settings"
        title="Custom Fields"
        description="Define custom data fields that appear on all lead records. Admin only."
        metrics={[
          { label: 'Total fields', value: fields.length },
          { label: 'Active', value: fields.filter((f) => f.is_active).length, tone: 'success' },
          { label: 'Required', value: fields.filter((f) => f.is_required).length },
        ]}
        actions={
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Add Field
          </Button>
        }
      />

      {/* Inline form */}
      {showForm && (
        <Card className="border-blue-200 bg-blue-50/30">
          <CardHeader>
            <h3 className="text-sm font-semibold text-slate-900">{editingId ? 'Edit Field' : 'New Field'}</h3>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cf-label">Label *</Label>
                <Input
                  id="cf-label"
                  value={form.label}
                  onChange={(e) => {
                    const l = e.target.value;
                    setForm((f) => ({ ...f, label: l, field_key: editingId ? f.field_key : deriveKey(l) }));
                  }}
                  placeholder="e.g. Annual Revenue"
                />
                {formErrors.label && <p className="text-xs text-red-600">{formErrors.label}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cf-key">Field key *</Label>
                <Input
                  id="cf-key"
                  value={form.field_key}
                  onChange={(e) => setForm((f) => ({ ...f, field_key: e.target.value }))}
                  placeholder="e.g. annual_revenue"
                  disabled={!!editingId}
                />
                {formErrors.field_key && <p className="text-xs text-red-600">{formErrors.field_key}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cf-type">Type *</Label>
                <select
                  id="cf-type"
                  value={form.field_type}
                  onChange={(e) => setForm((f) => ({ ...f, field_type: e.target.value as CustomFieldType }))}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {Object.entries(fieldTypeLabels).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>

              {form.field_type === 'dropdown' && (
                <div className="space-y-1.5">
                  <Label htmlFor="cf-options">Options (comma-separated) *</Label>
                  <Input
                    id="cf-options"
                    value={form.options}
                    onChange={(e) => setForm((f) => ({ ...f, options: e.target.value }))}
                    placeholder="e.g. Small, Medium, Large"
                  />
                  {formErrors.options && <p className="text-xs text-red-600">{formErrors.options}</p>}
                </div>
              )}

              <div className="flex items-center gap-2 sm:col-span-2">
                <input
                  id="cf-required"
                  type="checkbox"
                  checked={form.is_required}
                  onChange={(e) => setForm((f) => ({ ...f, is_required: e.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300"
                />
                <Label htmlFor="cf-required" className="cursor-pointer">Required field</Label>
              </div>

              <div className="flex gap-3 sm:col-span-2">
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving…' : editingId ? 'Update Field' : 'Create Field'}
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Fields list */}
      <Card>
        <CardContent className="pt-4">
          {isLoading && <LoadingTable />}

          {!isLoading && error && (
            <ErrorState message="Failed to load custom fields" />
          )}

          {!isLoading && !error && fields.length === 0 && !showForm && (
            <EmptyState
              icon={<Settings2 className="h-6 w-6" />}
              title="No custom fields"
              description="Add fields to capture extra data on leads — revenue, segment, priority, etc."
              action={
                <Button size="sm" onClick={openCreate}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Field
                </Button>
              }
            />
          )}

          {!isLoading && !error && fields.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="pb-3 text-left font-medium text-slate-500">Label</th>
                    <th className="pb-3 text-left font-medium text-slate-500">Key</th>
                    <th className="pb-3 text-left font-medium text-slate-500">Type</th>
                    <th className="pb-3 text-left font-medium text-slate-500">Required</th>
                    <th className="pb-3 text-left font-medium text-slate-500">Status</th>
                    <th className="pb-3 text-right font-medium text-slate-500">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((field) => (
                    <tr key={field.id} className="border-b transition-colors hover:bg-slate-50">
                      <td className="py-3 font-medium text-slate-900">{field.label}</td>
                      <td className="py-3">
                        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{field.field_key}</code>
                      </td>
                      <td className="py-3 text-slate-600">{fieldTypeLabels[field.field_type]}</td>
                      <td className="py-3">
                        {field.is_required ? (
                          <StatusBadge tone="amber">Required</StatusBadge>
                        ) : (
                          <span className="text-slate-400">Optional</span>
                        )}
                      </td>
                      <td className="py-3">
                        <StatusBadge tone={field.is_active ? 'green' : 'gray'}>
                          {field.is_active ? 'Active' : 'Inactive'}
                        </StatusBadge>
                      </td>
                      <td className="py-3 text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            title={field.is_active ? 'Deactivate' : 'Activate'}
                            onClick={() => handleToggleActive(field)}
                          >
                            {field.is_active ? (
                              <ToggleRight className="h-4 w-4 text-emerald-600" />
                            ) : (
                              <ToggleLeft className="h-4 w-4 text-slate-400" />
                            )}
                          </Button>
                          <Button variant="ghost" size="icon" title="Edit" onClick={() => openEdit(field)}>
                            <Edit className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthStore } from '@/store/authStore';
import { leadGroupFilters, leadGroupNameSchema, useLeadGroupsStore } from '@/store/leadGroupsStore';

interface Props {
  searchParams: URLSearchParams;
  onApply: (params: URLSearchParams) => void;
}

export function SavedLeadGroups({ searchParams, onApply }: Props) {
  const userId = useAuthStore((state) => state.user?.id);
  const groupsByUser = useLeadGroupsStore((state) => state.groups);
  const save = useLeadGroupsStore((state) => state.save);
  const remove = useLeadGroupsStore((state) => state.remove);
  const [saving, setSaving] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const form = useForm<z.infer<typeof leadGroupNameSchema>>({
    resolver: zodResolver(leadGroupNameSchema), defaultValues: { name: '' },
  });
  const groups = userId ? groupsByUser[userId] ?? [] : [];
  const filters = leadGroupFilters(searchParams);

  const handleSave = form.handleSubmit(({ name }) => {
    if (!userId || groups.length >= 50) return;
    if (groups.some((group) => group.name.toLowerCase() === name.toLowerCase())) {
      form.setError('name', { message: 'A group with this name already exists.' });
      return;
    }
    try {
      save(userId, name, filters);
      setSaving(false);
      form.reset();
    } catch {
      form.setError('name', { message: 'Could not save this group. Check browser storage and try again.' });
    }
  });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2" aria-label="Saved lead groups">
        <span className="text-xs font-medium text-muted-foreground">Saved groups</span>
        {groups.map((group) => (
          <div key={group.id} className="flex items-center rounded-md border border-input">
            <Button type="button" variant="ghost" size="sm" aria-pressed={group.filters === filters}
              onClick={() => onApply(new URLSearchParams(group.filters))}>{group.name}</Button>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8"
              aria-label={`Remove group ${group.name}`} onClick={() => {
                if (!userId) return;
                setRemoveError('');
                try { remove(userId, group.id); }
                catch { setRemoveError('Could not remove this group. Check browser storage and try again.'); }
              }}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" disabled={!userId || groups.length >= 50}
          onClick={() => setSaving(!saving)}>Save current filters</Button>
        {filters && <Button type="button" variant="ghost" size="sm" onClick={() => onApply(new URLSearchParams())}>Clear filters</Button>}
      </div>
      {removeError && <p role="alert" className="text-xs text-destructive">{removeError}</p>}
      {saving && (
        <form className="flex flex-wrap items-start gap-2" onSubmit={handleSave}>
          <div>
            <label className="sr-only" htmlFor="lead-group-name">Group name</label>
            <Input id="lead-group-name" placeholder="e.g., Website prospects awaiting contact" maxLength={60}
              aria-invalid={!!form.formState.errors.name} aria-describedby="lead-group-help" {...form.register('name')} />
            {form.formState.errors.name && <p role="alert" className="mt-1 text-xs text-destructive">{form.formState.errors.name.message}</p>}
          </div>
          <Button type="submit" size="sm">Save group</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setSaving(false)}>Cancel</Button>
        </form>
      )}
      <p id="lead-group-help" className="text-xs text-muted-foreground">Groups save your filters and show matching leads each time. Saved for your account in this browser.</p>
    </div>
  );
}

import { useState } from 'react';
import {
  useMessageSnippets,
  useCreateMessageSnippet,
  useUpdateMessageSnippet,
  useDeleteMessageSnippet,
  type MessageSnippet,
} from '@/api/messages';
import { PageHeader } from '@/components/ui/PageHeader';
import { ContentTabs } from '@/components/ContentTabs';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { LoadingTable } from '@/components/ui/LoadingTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
import type { MessageChannel } from '@/types';
import { Edit, MessageSquare, Plus, Save, Search, Trash2, X } from 'lucide-react';

const channelLabels: Record<MessageChannel, string> = {
  whatsapp: '💬 WhatsApp',
  email: '✉️ Email',
  sms: '📱 SMS',
  phone_call: '📞 Call',
};

const VARIABLE_PATTERN = /\{\{(\w+)\}\}/g;

function extractVariables(body: string): string[] {
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  VARIABLE_PATTERN.lastIndex = 0;
  while ((m = VARIABLE_PATTERN.exec(body)) !== null) {
    found.add(m[1]);
  }
  return Array.from(found);
}

function SnippetForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial?: MessageSnippet;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [channel, setChannel] = useState<MessageChannel | ''>(initial?.channel ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const createSnippet = useCreateMessageSnippet();
  const updateSnippet = useUpdateMessageSnippet();
  const { showToast } = useToast();

  const saving = createSnippet.isPending || updateSnippet.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) {
      showToast('Title and body are required.', 'error');
      return;
    }
    const input = {
      title: title.trim(),
      channel: channel || null,
      body: body.trim(),
      variables: extractVariables(body),
    };
    try {
      if (initial) {
        await updateSnippet.mutateAsync({ id: initial.id, input });
        showToast('Snippet updated.', 'success');
      } else {
        await createSnippet.mutateAsync(input);
        showToast('Snippet created.', 'success');
      }
      onSaved();
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to save snippet.'), 'error');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-slate-200 p-4">
      <div className="space-y-1.5">
        <Label htmlFor="snippet-title">Title *</Label>
        <Input id="snippet-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="snippet-channel">Channel</Label>
        <select
          id="snippet-channel"
          value={channel}
          onChange={(e) => setChannel(e.target.value as MessageChannel | '')}
          className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">Any channel</option>
          <option value="email">Email</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="sms">SMS</option>
          <option value="phone_call">Phone Call</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="snippet-body">Body *</Label>
        <Textarea
          id="snippet-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          placeholder="Hi {{contact_name}}, just checking in…"
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          <Save className="mr-2 h-3.5 w-3.5" />
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          <X className="mr-2 h-3.5 w-3.5" />
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function MessagesLibraryPage() {
  const [search, setSearch] = useState('');
  const { data: snippets = [], isLoading, error } = useMessageSnippets({ search: search || undefined });
  const deleteSnippet = useDeleteMessageSnippet();
  const { showToast } = useToast();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this message snippet?')) return;
    try {
      await deleteSnippet.mutateAsync(id);
      showToast('Snippet deleted.', 'success');
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to delete snippet.'), 'error');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <ContentTabs />
      <PageHeader
        eyebrow="Content"
        title="Messages"
        description="Reusable message snippets you can drop into any sequence step or manual send — no approval required."
        metrics={[{ label: 'Total', value: snippets.length }]}
        actions={
          !creating && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New Snippet
            </Button>
          )
        }
      />

      {creating && (
        <Card>
          <CardContent className="pt-6">
            <SnippetForm onCancel={() => setCreating(false)} onSaved={() => setCreating(false)} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search snippets…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardHeader>

        <CardContent>
          {isLoading && <LoadingTable />}

          {!isLoading && error && <ErrorState message="Failed to load message snippets" />}

          {!isLoading && !error && snippets.length === 0 && !creating && (
            <EmptyState
              icon={<MessageSquare className="h-6 w-6" />}
              title="No message snippets yet"
              description="Create reusable snippets to speed up manual sends and sequence editing."
              action={
                <Button size="sm" onClick={() => setCreating(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  New Snippet
                </Button>
              }
            />
          )}

          {!isLoading && !error && snippets.length > 0 && (
            <div className="space-y-3">
              {snippets.map((snippet) =>
                editingId === snippet.id ? (
                  <SnippetForm
                    key={snippet.id}
                    initial={snippet}
                    onCancel={() => setEditingId(null)}
                    onSaved={() => setEditingId(null)}
                  />
                ) : (
                  <div
                    key={snippet.id}
                    className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 sm:flex-row sm:items-start"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-900">{snippet.title}</span>
                        {snippet.channel && (
                          <StatusBadge tone="gray">{channelLabels[snippet.channel]}</StatusBadge>
                        )}
                      </div>
                      <p className="mt-2 text-sm text-slate-600 line-clamp-2">{snippet.body}</p>
                      {snippet.variables.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {snippet.variables.map((v) => (
                            <code key={v} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
                              {`{{${v}}}`}
                            </code>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button variant="ghost" size="icon" title="Edit" onClick={() => setEditingId(snippet.id)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Delete"
                        onClick={() => handleDelete(snippet.id)}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </div>
                ),
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

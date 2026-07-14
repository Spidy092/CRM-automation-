import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTemplates, useApproveTemplate, useDeleteTemplate } from '@/api/templates';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge';
import { LoadingTable } from '@/components/ui/LoadingTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useToast } from '@/components/ui/Toast';
import type { MessageChannel, TemplateApprovalStatus } from '@/types';
import { Plus, Search, Check, X, Trash2, Edit, FileText, Paperclip } from 'lucide-react';

const approvalTones: Record<TemplateApprovalStatus, StatusTone> = {
  pending: 'amber',
  approved: 'green',
  rejected: 'red',
};

const channelLabels: Record<MessageChannel, string> = {
  whatsapp: '💬 WhatsApp',
  email: '✉️ Email',
  sms: '📱 SMS',
  phone_call: '📞 Call',
};

export function TemplatesPage() {
  const [search, setSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const { data: templates = [], isLoading, error } = useTemplates({
    search: search || undefined,
    channel: (channelFilter as MessageChannel) || undefined,
    approval_status: (statusFilter as TemplateApprovalStatus) || undefined,
  });
  const approveTemplate = useApproveTemplate();
  const deleteTemplate = useDeleteTemplate();
  const { showToast } = useToast();

  const handleApprove = async (id: string, approved: boolean) => {
    try {
      await approveTemplate.mutateAsync({ id, approved });
      showToast(approved ? 'Template approved.' : 'Template rejected.', 'success');
    } catch {
      showToast('Failed to update approval status.', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this template?')) return;
    try {
      await deleteTemplate.mutateAsync(id);
      showToast('Template deleted.', 'success');
    } catch {
      showToast('Failed to delete template.', 'error');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Outreach"
        title="Templates"
        description="Create and manage message templates for outreach sequences. Templates require approval before use."
        metrics={[
          { label: 'Total', value: templates.length },
          { label: 'Approved', value: templates.filter((t) => t.approval_status === 'approved').length, tone: 'success' },
          { label: 'Pending', value: templates.filter((t) => t.approval_status === 'pending').length, tone: 'warning' },
          { label: 'Rejected', value: templates.filter((t) => t.approval_status === 'rejected').length, tone: 'danger' },
        ]}
        actions={
          <Button asChild>
            <Link to="/templates/new">
              <Plus className="mr-2 h-4 w-4" />
              New Template
            </Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search templates…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">All Channels</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
              <option value="phone_call">Phone Call</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
        </CardHeader>

        <CardContent>
          {isLoading && <LoadingTable />}

          {!isLoading && error && (
            <ErrorState message="Failed to load templates" />
          )}

          {!isLoading && !error && templates.length === 0 && (
            <EmptyState
              icon={<FileText className="h-6 w-6" />}
              title="No templates yet"
              description="Create your first message template to use in outreach sequences."
              action={
                <Button asChild size="sm">
                  <Link to="/templates/new">
                    <Plus className="mr-2 h-4 w-4" />
                    New Template
                  </Link>
                </Button>
              }
            />
          )}

          {!isLoading && !error && templates.length > 0 && (
            <div className="space-y-3">
              {templates.map((template) => (
                <div
                  key={template.id}
                  className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 sm:flex-row sm:items-start"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-900">{template.name}</span>
                      <StatusBadge tone="gray">{channelLabels[template.channel]}</StatusBadge>
                      <StatusBadge tone={approvalTones[template.approval_status]}>
                        {template.approval_status}
                      </StatusBadge>
                      {(template.attachments?.length ?? 0) > 0 && (
                        <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                          <Paperclip className="h-3 w-3" />
                          {template.attachments?.length ?? 0}
                        </span>
                      )}
                    </div>
                    {template.subject && (
                      <p className="mt-1 text-xs text-slate-500">Subject: {template.subject}</p>
                    )}
                    <p className="mt-2 text-sm text-slate-600 line-clamp-2">{template.body}</p>
                    {(template.variables?.length ?? 0) > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {template.variables.map((v) => (
                          <code key={v} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
                            {`{{${v}}}`}
                          </code>
                        ))}
                      </div>
                    )}
                    {template.rejection_reason && (
                      <p className="mt-2 text-xs text-red-600">Rejected: {template.rejection_reason}</p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {template.approval_status === 'pending' && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Approve"
                          onClick={() => handleApprove(template.id, true)}
                          className="text-emerald-600 hover:text-emerald-700"
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Reject"
                          onClick={() => handleApprove(template.id, false)}
                          className="text-red-500 hover:text-red-600"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                    <Button variant="ghost" size="icon" asChild title="Edit">
                      <Link to={`/templates/${template.id}/edit`}>
                        <Edit className="h-4 w-4" />
                      </Link>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Delete"
                      onClick={() => handleDelete(template.id)}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

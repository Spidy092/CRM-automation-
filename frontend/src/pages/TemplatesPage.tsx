import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTemplates, useApproveTemplate, useDeleteTemplate } from '@/api/templates';
import { useAuthStore } from '@/store/authStore';
import { ROLE_PERMISSIONS } from '@/types/account';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge';
import { LoadingTable } from '@/components/ui/LoadingTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { TablePagination } from '@/components/ui/TablePagination';
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
  const user = useAuthStore((s) => s.user);
  const canWrite = user ? ROLE_PERMISSIONS[user.role]?.Templates?.write : false;

  const [search, setSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [cursors, setCursors] = useState<string[]>([]);

  const { data, isLoading, error } = useTemplates({
    search: search || undefined,
    channel: (channelFilter as MessageChannel) || undefined,
    approval_status: (statusFilter as TemplateApprovalStatus) || undefined,
    limit: pageSize,
    cursor: cursors[page] || undefined,
  });

  const templates = data?.items ?? [];
  const hasMore = data?.meta?.hasMore ?? false;
  const nextCursor = data?.meta?.nextCursor;

  const approveTemplate = useApproveTemplate();
  const deleteTemplate = useDeleteTemplate();
  const { showToast } = useToast();

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const handleApprove = async (id: string) => {
    try {
      await approveTemplate.mutateAsync({ id, approved: true });
      showToast('Template approved.', 'success');
    } catch {
      showToast('Failed to approve template.', 'error');
    }
  };

  const handleRejectConfirm = async () => {
    if (!rejectTarget) return;
    try {
      await approveTemplate.mutateAsync({
        id: rejectTarget,
        approved: false,
        rejection_reason: rejectReason.trim() || undefined,
      });
      showToast('Template rejected.', 'success');
    } catch {
      showToast('Failed to reject template.', 'error');
    }
    setRejectTarget(null);
    setRejectReason('');
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await deleteTemplate.mutateAsync(deleteTarget);
      showToast('Template deleted.', 'success');
    } catch {
      showToast('Failed to delete template.', 'error');
    }
    setDeleteTarget(null);
  };

  const handlePageChange = (newPage: number) => {
    if (newPage > page && nextCursor) {
      setCursors((prev) => {
        const next = [...prev];
        next[newPage] = nextCursor;
        return next;
      });
    }
    setPage(newPage);
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(0);
    setCursors([]);
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
          canWrite ? (
            <Button asChild>
              <Link to="/templates/new">
                <Plus className="mr-2 h-4 w-4" />
                New Template
              </Link>
            </Button>
          ) : undefined
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
                onChange={(e) => { setSearch(e.target.value); setPage(0); setCursors([]); }}
                className="pl-10"
              />
            </div>
            <select
              value={channelFilter}
              onChange={(e) => { setChannelFilter(e.target.value); setPage(0); setCursors([]); }}
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
              onChange={(e) => { setStatusFilter(e.target.value); setPage(0); setCursors([]); }}
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
                canWrite ? (
                  <Button asChild size="sm">
                    <Link to="/templates/new">
                      <Plus className="mr-2 h-4 w-4" />
                      New Template
                    </Link>
                  </Button>
                ) : undefined
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
                    {canWrite && template.approval_status === 'pending' && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Approve"
                          onClick={() => handleApprove(template.id)}
                          className="text-emerald-600 hover:text-emerald-700"
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Reject"
                          onClick={() => { setRejectTarget(template.id); setRejectReason(''); }}
                          className="text-red-500 hover:text-red-600"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                    {canWrite && (
                      <>
                        <Button variant="ghost" size="icon" asChild title="Edit">
                          <Link to={`/templates/${template.id}/edit`}>
                            <Edit className="h-4 w-4" />
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Delete"
                          onClick={() => setDeleteTarget(template.id)}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}

              <TablePagination
                page={page}
                pageSize={pageSize}
                rowCount={templates.length}
                hasMore={hasMore}
                isLoading={isLoading}
                onPageChange={handlePageChange}
                onPageSizeChange={handlePageSizeChange}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={!!deleteTarget}
        title="Delete template"
        description="Are you sure you want to delete this template? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="destructive"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />

      {rejectTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setRejectTarget(null)}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-slate-900">Reject template</h2>
            <p className="mt-2 text-sm text-slate-500">
              Optionally provide a reason so the author knows what to fix.
            </p>
            <div className="mt-4 space-y-1.5">
              <Label htmlFor="reject-reason">Rejection reason</Label>
              <Textarea
                id="reject-reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                placeholder="e.g. Tone is too informal for our brand…"
              />
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="outline" onClick={() => setRejectTarget(null)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleRejectConfirm}>
                Reject template
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

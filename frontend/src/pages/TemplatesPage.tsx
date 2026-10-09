import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  useTemplates,
  useApproveTemplate,
  useDeleteTemplate,
  useDuplicateTemplate,
  useArchiveTemplate,
  useUnarchiveTemplate,
  useRenameTemplate,
} from '@/api/templates';
import { useAuthStore } from '@/store/authStore';
import { ROLE_PERMISSIONS } from '@/types/account';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge';
import { LoadingTable } from '@/components/ui/LoadingTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { TablePagination } from '@/components/ui/TablePagination';
import { useToast } from '@/components/ui/Toast';
import { StarterGallery } from '@/components/templates/StarterGallery';
import { TemplatePreviewModal } from '@/components/templates/TemplatePreviewModal';
import { getApiErrorMessage } from '@/lib/apiError';
import type { MessageChannel, Template, TemplateApprovalStatus } from '@/types';
import {
  Plus, Search, Check, X, Trash2, Edit, FileText, Paperclip, Copy, Archive,
  ArchiveRestore, Eye, Pencil, Play,
} from 'lucide-react';

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

const modeLabels: Record<string, string> = {
  simple: 'Simple',
  visual: 'Visual design',
  html: 'Custom HTML',
};

type GalleryTab = 'built-in' | 'mine' | 'all';

export function TemplatesPage() {
  const user = useAuthStore((s) => s.user);
  const canWrite = user ? ROLE_PERMISSIONS[user.role]?.Templates?.write : false;
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [tab, setTab] = useState<GalleryTab>('all');
  const [search, setSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [showArchived, setShowArchived] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [cursors, setCursors] = useState<string[]>([]);

  const { data, isLoading, error } = useTemplates({
    search: search || undefined,
    channel: (channelFilter as MessageChannel) || undefined,
    approval_status: (statusFilter as TemplateApprovalStatus) || undefined,
    limit: pageSize,
    cursor: cursors[page] || undefined,
    include_archived: showArchived || undefined,
    mine: tab === 'mine' || undefined,
  });

  const templates = (data?.items ?? []).filter((t) => (showArchived ? true : !t.archived_at));
  const hasMore = data?.meta?.hasMore ?? false;
  const nextCursor = data?.meta?.nextCursor;

  const approveTemplate = useApproveTemplate();
  const deleteTemplate = useDeleteTemplate();
  const duplicateTemplate = useDuplicateTemplate();
  const archiveTemplate = useArchiveTemplate();
  const unarchiveTemplate = useUnarchiveTemplate();
  const renameTemplate = useRenameTemplate();

  const [deleteTarget, setDeleteTarget] = useState<Template | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Template | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [renameTarget, setRenameTarget] = useState<Template | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [previewTarget, setPreviewTarget] = useState<Template | null>(null);

  const resetPaging = () => { setPage(0); setCursors([]); };

  const handleApprove = async (t: Template) => {
    try {
      await approveTemplate.mutateAsync({ id: t.id, approved: true });
      showToast('Template approved.', 'success');
    } catch {
      showToast('Failed to approve template.', 'error');
    }
  };

  const handleRejectConfirm = async () => {
    if (!rejectTarget) return;
    try {
      await approveTemplate.mutateAsync({ id: rejectTarget.id, approved: false, rejection_reason: rejectReason.trim() || undefined });
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
      await deleteTemplate.mutateAsync(deleteTarget.id);
      showToast('Template deleted.', 'success');
    } catch {
      showToast('Failed to delete template.', 'error');
    }
    setDeleteTarget(null);
  };

  const handleDuplicate = async (t: Template) => {
    try {
      const copy = await duplicateTemplate.mutateAsync({ id: t.id });
      showToast(`Duplicated as “${copy?.name}”. Opening the copy for editing.`, 'success');
      if (copy) navigate(`/templates/${copy.id}/edit`);
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to duplicate template.'), 'error');
    }
  };

  /** “Use” creates a working copy and opens it — the original is never modified. */
  const handleUse = async (t: Template) => {
    if (!canWrite) return;
    await handleDuplicate(t);
  };

  const handleArchive = async (t: Template) => {
    try {
      if (t.archived_at) {
        await unarchiveTemplate.mutateAsync(t.id);
        showToast('Template restored from archive.', 'success');
      } else {
        await archiveTemplate.mutateAsync(t.id);
        showToast('Template archived. It stays readable but is hidden from pickers.', 'success');
      }
    } catch {
      showToast('Failed to update archive state.', 'error');
    }
  };

  const handleRenameConfirm = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    try {
      await renameTemplate.mutateAsync({ id: renameTarget.id, name: renameValue.trim() });
      showToast('Template renamed.', 'success');
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to rename template.'), 'error');
    }
    setRenameTarget(null);
    setRenameValue('');
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
    resetPaging();
  };

  const editPath = (t: Template) => `/templates/${t.id}/edit`;

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
            <div className="flex gap-2">
              <Button variant="outline" asChild>
                <Link to="/templates/new?channel=email&mode=visual">Start from blank (visual)</Link>
              </Button>
              <Button asChild>
                <Link to="/templates/new">
                  <Plus className="mr-2 h-4 w-4" />
                  New Template
                </Link>
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="flex gap-1 border-b border-slate-200" role="tablist" aria-label="Template gallery">
        {([['built-in', 'Built-in'], ['mine', 'My templates'], ['all', 'All templates']] as Array<[GalleryTab, string]>).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => { setTab(key); resetPaging(); }}
            className={`px-4 py-2 text-sm font-medium ${tab === key ? 'border-b-2 border-indigo-600 text-indigo-700' : 'text-slate-500 hover:text-slate-800'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'built-in' && <StarterGallery />}

      {tab !== 'built-in' && (
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input placeholder="Search templates…" value={search} onChange={(e) => { setSearch(e.target.value); resetPaging(); }} className="pl-10" aria-label="Search templates" />
              </div>
              <select value={channelFilter} onChange={(e) => { setChannelFilter(e.target.value); resetPaging(); }} className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm" aria-label="Filter by channel">
                <option value="">All Channels</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="email">Email</option>
                <option value="sms">SMS</option>
                <option value="phone_call">Phone Call</option>
              </select>
              <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); resetPaging(); }} className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm" aria-label="Filter by status">
                <option value="">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
              <label className="flex items-center gap-1.5 text-sm text-slate-600">
                <input type="checkbox" checked={showArchived} onChange={(e) => { setShowArchived(e.target.checked); resetPaging(); }} className="h-4 w-4" />
                Show archived
              </label>
            </div>
          </CardHeader>

          <CardContent>
            {isLoading && <LoadingTable />}
            {!isLoading && error && <ErrorState message="Failed to load templates" />}
            {!isLoading && !error && templates.length === 0 && (
              <EmptyState
                icon={<FileText className="h-6 w-6" />}
                title={tab === 'mine' ? 'No templates of yours yet' : 'No templates yet'}
                description={tab === 'mine' ? 'Templates you create will appear here.' : 'Create your first message template, or start from a built-in design.'}
                action={canWrite ? (<Button asChild size="sm"><Link to="/templates/new"><Plus className="mr-2 h-4 w-4" />New Template</Link></Button>) : undefined}
              />
            )}
            {!isLoading && !error && templates.length > 0 && (
              <div className="space-y-3">
                {templates.map((template) => (
                  <div key={template.id} className={`flex flex-col gap-3 rounded-lg border border-slate-200 p-4 sm:flex-row sm:items-start ${template.archived_at ? 'opacity-70' : ''}`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-900">{template.name}</span>
                        <StatusBadge tone="gray">{channelLabels[template.channel]}</StatusBadge>
                        {template.channel === 'email' && <StatusBadge tone="gray">{modeLabels[template.editor_mode] ?? template.editor_mode}</StatusBadge>}
                        <StatusBadge tone={approvalTones[template.approval_status]}>{template.approval_status}</StatusBadge>
                        {template.archived_at && <StatusBadge tone="gray">archived</StatusBadge>}
                        {(template.attachments?.length ?? 0) > 0 && (
                          <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                            <Paperclip className="h-3 w-3" />{template.attachments?.length ?? 0}
                          </span>
                        )}
                      </div>
                      {template.subject && <p className="mt-1 text-xs text-slate-500">Subject: {template.subject}</p>}
                      <p className="mt-2 line-clamp-2 text-sm text-slate-600">{template.text_body ?? template.body}</p>
                      {(template.variables?.length ?? 0) > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {template.variables.map((v) => (
                            <code key={v} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">{`{{${v}}}`}</code>
                          ))}
                        </div>
                      )}
                      {template.rejection_reason && <p className="mt-2 text-xs text-red-600">Rejected: {template.rejection_reason}</p>}
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-1">
                      <Button variant="ghost" size="icon" title="Preview" onClick={() => setPreviewTarget(template)} aria-label={`Preview ${template.name}`}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      {canWrite && (
                        <Button variant="ghost" size="icon" title="Use (create a working copy)" onClick={() => handleUse(template)} aria-label={`Use ${template.name}`}>
                          <Play className="h-4 w-4 text-indigo-600" />
                        </Button>
                      )}
                      {canWrite && template.approval_status === 'pending' && (
                        <>
                          <Button variant="ghost" size="icon" title="Approve" onClick={() => handleApprove(template)} className="text-emerald-600 hover:text-emerald-700" aria-label={`Approve ${template.name}`}>
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" title="Reject" onClick={() => { setRejectTarget(template); setRejectReason(''); }} className="text-red-500 hover:text-red-600" aria-label={`Reject ${template.name}`}>
                            <X className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                      {canWrite && (
                        <>
                          <Button variant="ghost" size="icon" title="Duplicate" onClick={() => handleDuplicate(template)} aria-label={`Duplicate ${template.name}`}>
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" title="Rename" onClick={() => { setRenameTarget(template); setRenameValue(template.name); }} aria-label={`Rename ${template.name}`}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" title={template.archived_at ? 'Unarchive' : 'Archive'} onClick={() => handleArchive(template)} aria-label={`${template.archived_at ? 'Unarchive' : 'Archive'} ${template.name}`}>
                            {template.archived_at ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                          </Button>
                          <Button variant="ghost" size="icon" asChild title="Edit">
                            <Link to={editPath(template)} aria-label={`Edit ${template.name}`}>
                              <Edit className="h-4 w-4" />
                            </Link>
                          </Button>
                          <Button variant="ghost" size="icon" title="Delete" onClick={() => setDeleteTarget(template)} aria-label={`Delete ${template.name}`}>
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
                <TablePagination page={page} pageSize={pageSize} rowCount={templates.length} hasMore={hasMore} isLoading={isLoading} onPageChange={handlePageChange} onPageSizeChange={handlePageSizeChange} />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {previewTarget && (
        <TemplatePreviewModal templateId={previewTarget.id} templateName={previewTarget.name} onClose={() => setPreviewTarget(null)} />
      )}

      <AlertDialog
        open={!!deleteTarget}
        title="Delete template"
        description={`Delete “${deleteTarget?.name}”? This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="destructive"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />

      {renameTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setRenameTarget(null)}>
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Rename template">
            <h2 className="text-lg font-semibold text-slate-900">Rename template</h2>
            <div className="mt-4 space-y-1.5">
              <Label htmlFor="rename-input">Name</Label>
              <Input id="rename-input" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} maxLength={255} />
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="outline" onClick={() => setRenameTarget(null)}>Cancel</Button>
              <Button onClick={handleRenameConfirm} disabled={!renameValue.trim()}>Rename</Button>
            </div>
          </div>
        </div>
      )}

      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setRejectTarget(null)}>
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Reject template">
            <h2 className="text-lg font-semibold text-slate-900">Reject template</h2>
            <p className="mt-2 text-sm text-slate-500">Optionally provide a reason so the author knows what to fix.</p>
            <div className="mt-4 space-y-1.5">
              <Label htmlFor="reject-reason">Rejection reason</Label>
              <textarea id="reject-reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3} placeholder="e.g. Tone is too informal for our brand…" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="outline" onClick={() => setRejectTarget(null)}>Cancel</Button>
              <Button variant="destructive" onClick={handleRejectConfirm}>Reject template</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

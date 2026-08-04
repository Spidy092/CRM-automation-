import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  useCampaigns,
  useAutomationPreview,
  useLaunchCampaign,
  usePauseCampaign,
  useResumeCampaign,
  useDeleteCampaign,
} from '@/api/campaigns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingTable } from '@/components/ui/LoadingTable';
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/Toast';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { getApiErrorMessage } from '@/lib/apiError';
import type { CampaignStatus } from '@/api/campaigns';
import { Plus, Play, Pause, Trash2, BarChart3, Edit, Sparkles, ChevronLeft, ChevronRight } from 'lucide-react';

const PAGE_SIZE = 9;

const statusTones: Record<CampaignStatus, StatusTone> = {
  draft: 'gray',
  active: 'green',
  paused: 'amber',
  completed: 'blue',
  archived: 'violet',
};

export function CampaignsPage() {
  const { data: campaigns, isLoading } = useCampaigns();
  const [previewCampaignId, setPreviewCampaignId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const previewCloseRef = useRef<HTMLButtonElement>(null);
  const { data: preview, isLoading: isPreviewLoading } = useAutomationPreview(
    previewCampaignId ?? '',
    !!previewCampaignId,
  );
  const launchCampaign = useLaunchCampaign();
  const pauseCampaign = usePauseCampaign();
  const resumeCampaign = useResumeCampaign();
  const deleteCampaign = useDeleteCampaign();
  const { showToast } = useToast();

  // Reset to page 0 when campaigns change
  useEffect(() => {
    setPage(0);
  }, [campaigns?.length]);

  // Focus trap and Escape key for launch preview modal
  useEffect(() => {
    if (!previewCampaignId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setPreviewCampaignId(null);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [previewCampaignId]);

  const handleLaunch = async (id: string) => {
    try {
      await launchCampaign.mutateAsync(id);
      showToast('Campaign launched.', 'success');
      setPreviewCampaignId(null);
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to launch campaign.'), 'error');
    }
  };

  const handlePause = async (id: string) => {
    try {
      await pauseCampaign.mutateAsync(id);
      showToast('Campaign paused.', 'success');
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to pause campaign.'), 'error');
    }
  };

  const handleResume = async (id: string) => {
    try {
      await resumeCampaign.mutateAsync(id);
      showToast('Campaign resumed.', 'success');
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to resume campaign.'), 'error');
    }
  };

  const confirmDelete = useCallback(async () => {
    if (!deleteTargetId) return;
    try {
      await deleteCampaign.mutateAsync(deleteTargetId);
      showToast('Campaign deleted.', 'success');
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to delete campaign.'), 'error');
    } finally {
      setDeleteTargetId(null);
    }
  }, [deleteTargetId, deleteCampaign, showToast]);

  const pagedCampaigns = campaigns ? campaigns.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) : [];
  const totalPages = campaigns ? Math.max(1, Math.ceil(campaigns.length / PAGE_SIZE)) : 1;
  const canPrev = page > 0;
  const canNext = page + 1 < totalPages;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Campaign operations"
        title="Campaigns"
        description="Create, launch, pause, and inspect campaigns that route qualified leads into outreach."
        metrics={campaigns ? [
          { label: 'Campaigns', value: campaigns.length },
          { label: 'Active', value: campaigns.filter((campaign) => campaign.status === 'active').length, tone: 'success' },
          { label: 'Drafts', value: campaigns.filter((campaign) => campaign.status === 'draft').length },
          { label: 'Paused', value: campaigns.filter((campaign) => campaign.status === 'paused').length, tone: 'warning' },
        ] : undefined}
        actions={
          <Button asChild>
            <Link to="/campaigns/new">
              <Plus className="mr-2 h-4 w-4" />
              Create Campaign
            </Link>
          </Button>
        }
      />

      {/* Launch Preview Modal */}
      {previewCampaignId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="launch-preview-title"
        >
          <div className="w-full max-w-2xl rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="launch-preview-title" className="text-lg font-semibold text-slate-900">Launch Preview</h2>
                <p className="text-sm text-slate-500">Eligible leads, skipped leads, and readiness checks.</p>
              </div>
              <Button
                ref={previewCloseRef}
                variant="outline"
                size="sm"
                onClick={() => setPreviewCampaignId(null)}
              >
                Close
              </Button>
            </div>

            {isPreviewLoading ? (
              <div className="mt-5">
                <LoadingTable rows={3} cols={3} />
              </div>
            ) : preview ? (
              <div className="mt-5 space-y-4">
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded-md border p-3">
                    <div className="text-slate-500">Eligible</div>
                    <div className="text-2xl font-semibold text-green-700">{preview.eligibleLeads.length}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-slate-500">Skipped</div>
                    <div className="text-2xl font-semibold text-amber-700">{preview.skippedLeads.length}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-slate-500">Jobs</div>
                    <div className="text-2xl font-semibold text-slate-900">{preview.expectedJobs}</div>
                  </div>
                </div>

                {[...preview.templateIssues, ...preview.connectorIssues].length > 0 && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    {[...preview.templateIssues, ...preview.connectorIssues].map((issue) => (
                      <div key={issue}>{issue}</div>
                    ))}
                  </div>
                )}

                {preview.skippedLeads.length > 0 && (
                  <div className="max-h-48 overflow-auto rounded-md border">
                    {preview.skippedLeads.slice(0, 8).map((lead) => (
                      <div key={lead.leadId} className="border-b p-3 text-sm last:border-b-0">
                        <div className="font-medium text-slate-900">{lead.businessName}</div>
                        <div className="text-slate-500">{lead.reasons.join(' ')}</div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setPreviewCampaignId(null)}>Cancel</Button>
                  <Button
                    onClick={() => handleLaunch(previewCampaignId)}
                    disabled={launchCampaign.isPending}
                  >
                    <Play className="mr-2 h-4 w-4" />
                    Launch {preview.eligibleLeads.length}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!deleteTargetId}
        title="Delete campaign"
        description="Are you sure you want to delete this campaign? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="destructive"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTargetId(null)}
      />

      {isLoading ? (
        <Card>
          <CardContent className="pt-5">
            <LoadingTable rows={4} cols={4} />
          </CardContent>
        </Card>
      ) : campaigns && campaigns.length > 0 ? (
        <>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {pagedCampaigns.map((campaign) => (
              <Card key={campaign.id} className="hover:shadow-md transition-shadow">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{campaign.name}</CardTitle>
                    <StatusBadge tone={statusTones[campaign.status]}>{campaign.status}</StatusBadge>
                  </div>
                  <CardDescription>
                    {campaign.target_industries.length > 0
                      ? `Industries: ${campaign.target_industries.join(', ')}`
                      : 'No industry targeting'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-sm text-slate-500">
                      <span>Tone: {campaign.tone}</span>
                      {campaign.launched_at && (
                        <span>
                          Launched: {new Date(campaign.launched_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>

                    <div className="flex justify-end space-x-2">
                      {campaign.status === 'draft' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPreviewCampaignId(campaign.id)}
                        >
                          <Play className="mr-1 h-3 w-3" />
                          Launch
                        </Button>
                      )}
                      {campaign.status === 'active' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handlePause(campaign.id)}
                        >
                          <Pause className="mr-1 h-3 w-3" />
                          Pause
                        </Button>
                      )}
                      {campaign.status === 'paused' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleResume(campaign.id)}
                        >
                          <Play className="mr-1 h-3 w-3" />
                          Resume
                        </Button>
                      )}
                      <Button variant="outline" size="sm" asChild>
                        <Link to={`/campaigns/${campaign.id}`}>
                          <BarChart3 className="mr-1 h-3 w-3" />
                          Stats
                        </Link>
                      </Button>
                      {(campaign.status === 'draft' || campaign.status === 'paused') && (
                        <Button variant="outline" size="sm" asChild>
                          <Link to={`/campaigns/${campaign.id}/edit`}>
                            <Edit className="mr-1 h-3 w-3" />
                            Edit
                          </Link>
                        </Button>
                      )}
                      {campaign.ai_personalization_enabled && (
                        <Button variant="outline" size="sm" asChild>
                          <Link to={`/campaigns/${campaign.id}/brief`}>
                            <Sparkles className="mr-1 h-3 w-3 text-purple-500" />
                            AI Brief
                          </Link>
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDeleteTargetId(campaign.id)}
                        disabled={campaign.status === 'active'}
                      >
                        <Trash2 className="h-3 w-3 text-red-500" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(page - 1)}
                disabled={!canPrev}
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-slate-500">
                Page {page + 1} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(page + 1)}
                disabled={!canNext}
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      ) : (
        <EmptyState
          icon={<BarChart3 className="h-6 w-6" />}
          title="No campaigns created yet"
          description="Create your first campaign to target leads, attach templates, and start outreach."
          action={
            <Button asChild size="sm">
              <Link to="/campaigns/new">
                <Plus className="mr-2 h-4 w-4" />
                Create Campaign
              </Link>
            </Button>
          }
        />
      )}
    </div>
  );
}

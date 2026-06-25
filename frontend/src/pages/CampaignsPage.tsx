import { useState } from 'react';
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
import type { CampaignStatus } from '@/api/campaigns';
import { Plus, Play, Pause, Trash2, BarChart3 } from 'lucide-react';

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
  const { data: preview, isLoading: isPreviewLoading } = useAutomationPreview(
    previewCampaignId ?? '',
    !!previewCampaignId,
  );
  const launchCampaign = useLaunchCampaign();
  const pauseCampaign = usePauseCampaign();
  const resumeCampaign = useResumeCampaign();
  const deleteCampaign = useDeleteCampaign();

  const handleLaunch = async (id: string) => {
    await launchCampaign.mutateAsync(id);
    setPreviewCampaignId(null);
  };

  const handlePause = async (id: string) => {
    await pauseCampaign.mutateAsync(id);
  };

  const handleResume = async (id: string) => {
    await resumeCampaign.mutateAsync(id);
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this campaign?')) {
      await deleteCampaign.mutateAsync(id);
    }
  };

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

      {previewCampaignId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Launch Preview</h2>
                <p className="text-sm text-gray-500">Eligible leads, skipped leads, and readiness checks.</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setPreviewCampaignId(null)}>
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
                    <div className="text-gray-500">Eligible</div>
                    <div className="text-2xl font-semibold text-green-700">{preview.eligibleLeads.length}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-gray-500">Skipped</div>
                    <div className="text-2xl font-semibold text-amber-700">{preview.skippedLeads.length}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-gray-500">Jobs</div>
                    <div className="text-2xl font-semibold text-gray-900">{preview.expectedJobs}</div>
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
                        <div className="font-medium text-gray-900">{lead.businessName}</div>
                        <div className="text-gray-500">{lead.reasons.join(' ')}</div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setPreviewCampaignId(null)}>Cancel</Button>
                  <Button
                    onClick={() => handleLaunch(previewCampaignId)}
                    disabled={launchCampaign.isPending || preview.eligibleLeads.length === 0}
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

      {isLoading ? (
        <Card>
          <CardContent className="pt-5">
            <LoadingTable rows={4} cols={4} />
          </CardContent>
        </Card>
      ) : campaigns && campaigns.length > 0 ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((campaign) => (
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
                  <div className="flex items-center justify-between text-sm text-gray-500">
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
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDelete(campaign.id)}
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

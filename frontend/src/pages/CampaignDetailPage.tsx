import { useParams, Link } from 'react-router-dom';
import { useCampaign, useCampaignStats } from '@/api/campaigns';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge';
import { LoadingTable } from '@/components/ui/LoadingTable';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Users, Send, CheckCircle, MailOpen, Reply, AlertCircle } from 'lucide-react';
import type { CampaignStatus } from '@/api/campaigns';

const statusTones: Record<CampaignStatus, StatusTone> = {
  draft: 'gray',
  active: 'green',
  paused: 'amber',
  completed: 'blue',
  archived: 'violet',
};

export function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: campaign, isLoading: isCampaignLoading, isError: isCampaignError } = useCampaign(id!);
  const { data: stats, isLoading: isStatsLoading } = useCampaignStats(id!);

  if (isCampaignLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Loading campaign..." />
        <Card><CardContent className="pt-6"><LoadingTable rows={4} cols={2} /></CardContent></Card>
      </div>
    );
  }

  if (isCampaignError || !campaign) {
    return (
      <div className="space-y-6">
        <PageHeader title="Campaign not found" />
        <Button asChild variant="outline">
          <Link to="/campaigns"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Campaigns</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button asChild variant="ghost" size="icon">
          <Link to="/campaigns">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <PageHeader
          eyebrow="Campaign Stats"
          title={campaign.name}
          description={`Created by ${campaign.created_by} • Tone: ${campaign.tone} • Targeted Industries: ${campaign.target_industries.join(', ') || 'All'}`}
        />
        <div className="ml-auto">
          <StatusBadge tone={statusTones[campaign.status]}>{campaign.status}</StatusBadge>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Basic Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-sm text-gray-500">Pipeline ID</div>
              <div className="font-medium text-gray-900">{campaign.pipeline_id || 'None'}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Sequence ID</div>
              <div className="font-medium text-gray-900">{campaign.sequence_id || 'None'}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">AI Personalization</div>
              <div className="font-medium text-gray-900">{campaign.ai_personalization_enabled ? 'Enabled' : 'Disabled'}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Launched At</div>
              <div className="font-medium text-gray-900">{campaign.launched_at ? new Date(campaign.launched_at).toLocaleString() : 'Not launched'}</div>
            </div>
          </CardContent>
        </Card>

        {/* Outreach Performance Stats */}
        <Card className="md:col-span-1 lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">Performance Metrics</CardTitle>
            <CardDescription>Live outreach statistics for this campaign</CardDescription>
          </CardHeader>
          <CardContent>
            {isStatsLoading ? (
              <LoadingTable rows={2} cols={3} />
            ) : stats ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <div className="rounded-xl border bg-slate-50 p-4">
                  <div className="flex items-center gap-2 text-slate-500">
                    <Users className="h-4 w-4" />
                    <span className="text-sm font-medium">Total Leads</span>
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-slate-900">{stats.total_leads}</div>
                </div>

                <div className="rounded-xl border bg-blue-50 p-4">
                  <div className="flex items-center gap-2 text-blue-600">
                    <Send className="h-4 w-4" />
                    <span className="text-sm font-medium">Sent</span>
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-blue-900">{stats.sent}</div>
                </div>

                <div className="rounded-xl border bg-indigo-50 p-4">
                  <div className="flex items-center gap-2 text-indigo-600">
                    <CheckCircle className="h-4 w-4" />
                    <span className="text-sm font-medium">Delivered</span>
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-indigo-900">{stats.delivered}</div>
                </div>

                <div className="rounded-xl border bg-purple-50 p-4">
                  <div className="flex items-center gap-2 text-purple-600">
                    <MailOpen className="h-4 w-4" />
                    <span className="text-sm font-medium">Opened</span>
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-purple-900">{stats.opened}</div>
                  <div className="text-xs text-purple-500 mt-1">
                    {stats.delivered > 0 ? Math.round((stats.opened / stats.delivered) * 100) : 0}% of delivered
                  </div>
                </div>

                <div className="rounded-xl border bg-green-50 p-4">
                  <div className="flex items-center gap-2 text-green-600">
                    <Reply className="h-4 w-4" />
                    <span className="text-sm font-medium">Replied</span>
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-green-900">{stats.replied}</div>
                  <div className="text-xs text-green-500 mt-1">
                    {stats.delivered > 0 ? Math.round((stats.replied / stats.delivered) * 100) : 0}% of delivered
                  </div>
                </div>

                <div className="rounded-xl border bg-red-50 p-4">
                  <div className="flex items-center gap-2 text-red-600">
                    <AlertCircle className="h-4 w-4" />
                    <span className="text-sm font-medium">Failed</span>
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-red-900">{stats.failed}</div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-gray-500">No stats available.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

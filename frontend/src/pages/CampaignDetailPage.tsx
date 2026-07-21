import { useParams, Link } from 'react-router-dom';
import {
  useCampaign,
  useCampaignStats,
  useCampaignStepStats,
  useLaunchCampaign,
  usePauseCampaign,
  useResumeCampaign,
  useCampaignLeads,
  useRetryLeadOutreachStep,
} from '@/api/campaigns';
import { useSequence } from '@/api/outreach';
import { usePipeline } from '@/api/pipelines';
import { useTemplates } from '@/api/templates';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge';
import { LoadingTable } from '@/components/ui/LoadingTable';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
import { CHANNEL_ICONS, CHANNEL_COLORS } from '@/components/SequenceStepEditor';
import {
  ArrowLeft,
  BarChart3,
  Clock,
  Users,
  Send,
  CheckCircle,
  MailOpen,
  Reply,
  AlertCircle,
  AlertTriangle,
  Play,
  Pause,
  Edit,
  Sparkles,
  GitBranch,
  Zap,
  RotateCw,
} from 'lucide-react';
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
  const { data: stepStats = [], isLoading: isStepStatsLoading } = useCampaignStepStats(id!);
  const { data: campaignLeads = [], isLoading: isLeadsLoading } = useCampaignLeads(id!);
  const { data: sequence } = useSequence(campaign?.sequence_id ?? '');
  const { data: pipeline } = usePipeline(campaign?.pipeline_id ?? '');
  const { data: templates = [] } = useTemplates();
  const launchCampaign = useLaunchCampaign();
  const pauseCampaign = usePauseCampaign();
  const resumeCampaign = useResumeCampaign();
  const retryStep = useRetryLeadOutreachStep();
  const { showToast } = useToast();

  const templateById = new Map(templates.map((t) => [t.id, t]));
  const triggerStageName = pipeline?.stages?.find(
    (stage) => stage.id === campaign?.trigger_stage_id,
  )?.name;

  const handleLaunch = async () => {
    try {
      await launchCampaign.mutateAsync(id!);
      showToast('Campaign launched.', 'success');
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to launch campaign.'), 'error');
    }
  };

  const handlePause = async () => {
    try {
      await pauseCampaign.mutateAsync(id!);
      showToast('Campaign paused.', 'success');
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to pause campaign.'), 'error');
    }
  };

  const handleResume = async () => {
    try {
      await resumeCampaign.mutateAsync(id!);
      showToast('Campaign resumed.', 'success');
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to resume campaign.'), 'error');
    }
  };

  const handleRetry = async (leadId: string) => {
    try {
      await retryStep.mutateAsync({ campaignId: id!, leadId });
      showToast('Retry queued — the message will be re-sent shortly.', 'success');
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to retry this send.'), 'error');
    }
  };

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
          eyebrow="Campaign"
          title={campaign.name}
          description={`Created by ${campaign.created_by} • Tone: ${campaign.tone} • Targeted Industries: ${campaign.target_industries.join(', ') || 'All'}`}
        />
        <div className="ml-auto flex items-center gap-2">
          <StatusBadge tone={statusTones[campaign.status]}>{campaign.status}</StatusBadge>
          {(campaign.status === 'draft' || campaign.status === 'paused') && (
            <Button asChild variant="outline" size="sm">
              <Link to={`/campaigns/${campaign.id}/edit`}>
                <Edit className="mr-1 h-3 w-3" />
                Edit
              </Link>
            </Button>
          )}
          {campaign.status === 'draft' && (
            <Button size="sm" onClick={handleLaunch} disabled={launchCampaign.isPending}>
              <Play className="mr-1 h-3 w-3" />
              {launchCampaign.isPending ? 'Launching…' : 'Launch'}
            </Button>
          )}
          {campaign.status === 'active' && (
            <Button variant="outline" size="sm" onClick={handlePause} disabled={pauseCampaign.isPending}>
              <Pause className="mr-1 h-3 w-3" />
              Pause
            </Button>
          )}
          {campaign.status === 'paused' && (
            <Button size="sm" onClick={handleResume} disabled={resumeCampaign.isPending}>
              <Play className="mr-1 h-3 w-3" />
              Resume
            </Button>
          )}
          {campaign.ai_personalization_enabled && (
            <Button asChild variant="outline" size="sm">
              <Link to={`/campaigns/${campaign.id}/brief`}>
                <Sparkles className="mr-1 h-3 w-3 text-purple-500" />
                AI Brief
              </Link>
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* How the campaign runs */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Automation Setup</CardTitle>
            <CardDescription>Pipeline trigger and outreach sequence.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex items-center gap-1.5 text-sm text-slate-500">
                <GitBranch className="h-3.5 w-3.5" />
                Pipeline trigger
              </div>
              {campaign.pipeline_id ? (
                <div className="mt-1 font-medium text-slate-900">
                  <Link to="/pipelines" className="text-indigo-600 hover:underline">
                    {pipeline?.name ?? 'Pipeline'}
                  </Link>
                  <span className="text-slate-500"> → {triggerStageName ?? 'any stage move'}</span>
                </div>
              ) : (
                <div className="mt-1 text-sm text-slate-500">
                  None — leads are only added manually.
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center gap-1.5 text-sm text-slate-500">
                <Zap className="h-3.5 w-3.5" />
                Outreach sequence
              </div>
              {campaign.sequence_id ? (
                sequence ? (
                  <div className="mt-1 space-y-2">
                    <Link to="/outreach/sequences" className="font-medium text-indigo-600 hover:underline">
                      {sequence.name}
                    </Link>
                    <div className="flex flex-wrap gap-1.5">
                      {sequence.steps.map((step) => {
                        const template = step.templateId ? templateById.get(step.templateId) : undefined;
                        const ready = template?.approval_status === 'approved';
                        return (
                          <span
                            key={step.stepNumber}
                            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${CHANNEL_COLORS[step.channel] ?? 'bg-slate-50 border-slate-200'}`}
                            title={template ? template.name : 'No template'}
                          >
                            {CHANNEL_ICONS[step.channel]}
                            <span>{template?.name ?? 'No template'}</span>
                            <span className="text-slate-500">
                              {step.delayHours === 0 ? '(now)' : `+${step.delayHours}h`}
                            </span>
                            {!ready && <AlertTriangle className="h-3 w-3 text-amber-600" />}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="mt-1 text-sm text-slate-500">Loading sequence…</div>
                )
              ) : (
                <div className="mt-1 flex items-center gap-1 text-sm text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  No sequence attached — this campaign cannot send messages.
                  {(campaign.status === 'draft' || campaign.status === 'paused') && (
                    <Link to={`/campaigns/${campaign.id}/edit`} className="font-medium underline">
                      Attach one
                    </Link>
                  )}
                </div>
              )}
            </div>

            <div>
              <div className="text-sm text-slate-500">AI Personalization</div>
              <div className="font-medium text-slate-900">
                {campaign.ai_personalization_enabled ? 'Enabled' : 'Disabled'}
              </div>
            </div>

            <div>
              <div className="flex items-center gap-1.5 text-sm text-slate-500">
                <Clock className="h-3.5 w-3.5" />
                Delivery controls
              </div>
              <div className="mt-1 text-sm font-medium text-slate-900">
                {campaign.send_window_enabled
                  ? `${String(campaign.send_window_start_hour).padStart(2, '0')}:00–${String(campaign.send_window_end_hour).padStart(2, '0')}:00 (${campaign.send_window_timezone})`
                  : 'Any time'}
                {campaign.daily_send_limit != null && (
                  <span className="text-slate-500"> · max {campaign.daily_send_limit}/day</span>
                )}
              </div>
            </div>

            <div>
              <div className="text-sm text-slate-500">Launched At</div>
              <div className="font-medium text-slate-900">
                {campaign.launched_at ? new Date(campaign.launched_at).toLocaleString() : 'Not launched'}
              </div>
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
                    <span className="text-sm font-medium">Msgs Sent</span>
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-blue-900">{stats.sent}</div>
                </div>

                <div className="rounded-xl border bg-indigo-50 p-4">
                  <div className="flex items-center gap-2 text-indigo-600">
                    <CheckCircle className="h-4 w-4" />
                    <span className="text-sm font-medium">Msgs Delivered</span>
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
                    <span className="text-sm font-medium">Msgs Failed</span>
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-red-900">{stats.failed}</div>
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<BarChart3 className="h-6 w-6" />}
                title="No stats available"
                description="Campaign statistics will appear once outreach begins."
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Sequence Step Funnel */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Sequence Funnel</CardTitle>
          <CardDescription>
            Where leads drop off, step by step. Rates are relative to messages sent at that step.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isStepStatsLoading ? (
            <LoadingTable rows={3} cols={6} />
          ) : stepStats.length > 0 ? (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Step</th>
                    <th className="px-4 py-3 font-medium">Channel</th>
                    <th className="px-4 py-3 font-medium">Sent</th>
                    <th className="px-4 py-3 font-medium">Delivered</th>
                    <th className="px-4 py-3 font-medium">Opened</th>
                    <th className="px-4 py-3 font-medium">Replied</th>
                    <th className="px-4 py-3 font-medium">Failed</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {stepStats.map((row) => {
                    const step = sequence?.steps.find((s) => s.stepNumber === row.step_number);
                    const pct = (n: number) =>
                      row.sent > 0 ? ` (${Math.round((n / row.sent) * 100)}%)` : '';
                    return (
                      <tr key={row.step_number} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3 font-medium text-slate-900">
                          Step {row.step_number}
                        </td>
                        <td className="px-4 py-3">
                          {step ? (
                            <span
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${CHANNEL_COLORS[step.channel] ?? 'bg-slate-50 border-slate-200'}`}
                            >
                              {CHANNEL_ICONS[step.channel]}
                              {step.channel}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-900">{row.sent}</td>
                        <td className="px-4 py-3 text-slate-600">
                          {row.delivered}
                          <span className="text-xs text-slate-400">{pct(row.delivered)}</span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {row.opened}
                          <span className="text-xs text-slate-400">{pct(row.opened)}</span>
                        </td>
                        <td className="px-4 py-3 text-green-700">
                          {row.replied}
                          <span className="text-xs text-slate-400">{pct(row.replied)}</span>
                        </td>
                        <td className={`px-4 py-3 ${row.failed > 0 ? 'text-red-600' : 'text-slate-600'}`}>
                          {row.failed}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={<BarChart3 className="h-6 w-6" />}
              title="No step data yet"
              description="The funnel appears once the sequence starts sending messages."
            />
          )}
        </CardContent>
      </Card>

      {/* Enrolled Leads Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Enrolled Leads & Progress</CardTitle>
          <CardDescription>View the current sequence step for each enrolled lead.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLeadsLoading ? (
            <LoadingTable rows={3} cols={4} />
          ) : campaignLeads.length > 0 ? (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Lead</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Latest Step</th>
                    <th className="px-4 py-3 font-medium">Step Status</th>
                    <th className="px-4 py-3 font-medium">Last Activity</th>
                    <th className="px-4 py-3 font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {campaignLeads.map((lead) => {
                    const failed = lead.step_status === 'failed';
                    const isRetryingThis =
                      retryStep.isPending && retryStep.variables?.leadId === lead.lead_id;
                    return (
                      <tr key={lead.lead_id} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3">
                          <Link to={`/leads/${lead.lead_id}`} className="font-medium text-indigo-600 hover:underline">
                            {lead.business_name || lead.contact_name || 'Unknown Lead'}
                          </Link>
                        </td>
                        <td className="px-4 py-3 capitalize text-slate-600">{lead.lead_status}</td>
                        <td className="px-4 py-3">
                          {lead.latest_step ? `Step ${lead.latest_step}` : <span className="text-slate-400">Not started</span>}
                        </td>
                        <td className="px-4 py-3">
                          {lead.step_status ? (
                            <div className="space-y-1">
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                                lead.step_status === 'sent' || lead.step_status === 'delivered' ? 'bg-green-100 text-green-700' :
                                lead.step_status === 'failed' ? 'bg-red-100 text-red-700' :
                                lead.step_status === 'replied' ? 'bg-purple-100 text-purple-700' :
                                'bg-slate-100 text-slate-700'
                              }`}>
                                {lead.step_status}
                              </span>
                              {failed && lead.step_error && (
                                <div className="flex items-start gap-1 text-xs text-red-600">
                                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                                  <span>{lead.step_error}</span>
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {lead.step_time ? new Date(lead.step_time).toLocaleString() : '—'}
                        </td>
                        <td className="px-4 py-3">
                          {failed && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => handleRetry(lead.lead_id)}
                              disabled={isRetryingThis}
                            >
                              <RotateCw className={`mr-1 h-3 w-3 ${isRetryingThis ? 'animate-spin' : ''}`} />
                              {isRetryingThis ? 'Retrying…' : 'Retry'}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={<Users className="h-6 w-6" />}
              title="No leads enrolled"
              description="No leads have been enrolled in this campaign yet."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

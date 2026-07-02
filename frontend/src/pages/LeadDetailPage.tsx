import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLead, useLeadActivity, usePauseLead, useDeleteLead, useEnrichLead } from '@/api/leads';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/Toast';
import type { LeadStatus } from '@/types';
import {
  ArrowLeft,
  Edit,
  Trash2,
  Pause,
  Play,
  AlertCircle,
  Globe,
  Star,
  MessageSquare,
  Tag,
  GitBranch,
  User,
  Activity,
  Sparkles,
} from 'lucide-react';

const statusTones: Record<LeadStatus, StatusTone> = {
  active: 'green',
  paused: 'amber',
  won: 'blue',
  lost: 'red',
  opted_out: 'gray',
};

const channelIcons: Record<string, string> = {
  whatsapp: '💬',
  email: '✉️',
  sms: '📱',
  phone_call: '📞',
};

function classifyActivity(action: string | null): string {
  if (!action) return 'Outreach';
  if (action === 'lead.created') return 'Lead created';
  if (action === 'lead.updated') return 'Lead updated';
  if (action === 'lead.stage_moved') return 'Stage changed';
  if (action === 'lead.paused') return 'Outreach paused';
  if (action === 'lead.resumed') return 'Outreach resumed';
  if (action === 'lead.deleted') return 'Lead deleted';
  return action.replace(/\./g, ' ');
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const { data: lead, isLoading: leadLoading, error: leadError } = useLead(id!);
  const { data: activity = [], isLoading: activityLoading } = useLeadActivity(id!, 50);
  const pauseLead = usePauseLead();
  const deleteLead = useDeleteLead();
  const enrichLead = useEnrichLead();

  const handlePause = async () => {
    if (!lead) return;
    const willPause = lead.status === 'active';
    try {
      await pauseLead.mutateAsync({ id: lead.id, paused: willPause });
      showToast(willPause ? 'Lead paused.' : 'Lead resumed.', 'success');
    } catch {
      showToast('Failed to update lead status.', 'error');
    }
  };

  const handleDelete = async () => {
    if (!lead) return;
    if (!window.confirm('Delete this lead? This cannot be undone.')) return;
    try {
      await deleteLead.mutateAsync(lead.id);
      showToast('Lead deleted.', 'success');
      navigate('/leads');
    } catch {
      showToast('Failed to delete lead.', 'error');
    }
  };

  if (leadLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-slate-700" />
      </div>
    );
  }

  if (leadError || !lead) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-6 py-10 text-center">
        <AlertCircle className="h-8 w-8 text-red-400" />
        <p className="font-semibold text-red-700">Lead not found</p>
        <Button variant="outline" size="sm" asChild>
          <Link to="/leads">Back to Leads</Link>
        </Button>
      </div>
    );
  }

  const scoreColor =
    lead.lead_score >= 70 ? 'text-emerald-700' : lead.lead_score >= 40 ? 'text-amber-700' : 'text-slate-700';

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Back + actions */}
      <PageHeader
        eyebrow="Lead detail"
        title={lead.business_name}
        description={`${lead.industry} · ${lead.location}${lead.country ? `, ${lead.country}` : ''}`}
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link to="/leads">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={handlePause}>
              {lead.status === 'active' ? (
                <><Pause className="mr-2 h-4 w-4" />Pause</>
              ) : (
                <><Play className="mr-2 h-4 w-4" />Resume</>
              )}
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to={`/leads/${lead.id}/ai`}>
                <Sparkles className="mr-2 h-4 w-4" />
                AI Profile
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to={`/leads/${lead.id}/edit`}>
                <Edit className="mr-2 h-4 w-4" />
                Edit
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={handleDelete} className="text-red-600 hover:text-red-700">
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          </>
        }
        metrics={[
          { label: 'Lead score', value: lead.lead_score, tone: lead.lead_score >= 70 ? 'success' : lead.lead_score >= 40 ? 'warning' : 'default' },
          { label: 'Status', value: lead.status.replace('_', ' ') },
          { label: 'Classification', value: lead.classification ?? '—' },
          { label: 'Source', value: lead.source_platform?.replace(/_/g, ' ') ?? '—' },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Contact info card */}
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-slate-900">Contact</h3>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row icon={<User className="h-4 w-4" />} label="Name" value={lead.contact_name} />
              <Row 
                icon={<span className="text-xs">✉</span>} 
                label="Email" 
                value={
                  <div className="flex items-center space-x-2">
                    <span>{lead.email}</span>
                    {lead.website && (
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-6 px-2 text-xs text-blue-600 hover:text-blue-700 bg-blue-50"
                        disabled={enrichLead.isPending}
                        onClick={() => {
                          enrichLead.mutate(lead.id, {
                            onSuccess: () => showToast('Lead data enriched!', 'success'),
                            onError: (err) => {
                              const axiosError = err as { response?: { data?: { error?: string } } };
                              showToast(axiosError.response?.data?.error || 'Failed to enrich data', 'error');
                            },
                          });
                        }}
                      >
                        {enrichLead.isPending ? 'Enriching...' : <><Sparkles className="h-3 w-3 mr-1" /> Enrich</>}
                      </Button>
                    )}
                  </div>
                } 
              />
              <Row icon={<span className="text-xs">📱</span>} label="Phone" value={lead.phone} />
              {lead.website && (
                <Row
                  icon={<Globe className="h-4 w-4" />}
                  label="Website"
                  value={
                    <a href={lead.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline-offset-2 hover:underline">
                      {lead.website}
                    </a>
                  }
                />
              )}
              {lead.google_rating !== null && (
                <Row
                  icon={<Star className="h-4 w-4 text-amber-400" />}
                  label="Rating"
                  value={`${lead.google_rating} (${lead.review_count ?? 0} reviews)`}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-slate-900">Pipeline</h3>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row icon={<GitBranch className="h-4 w-4" />} label="Stage" value={lead.pipeline_stage_id ?? 'Not assigned'} />
              <Row icon={<Activity className="h-4 w-4" />} label="Status">
                <StatusBadge tone={statusTones[lead.status]}>{lead.status.replace('_', ' ')}</StatusBadge>
              </Row>
              <Row
                icon={<span className={`text-sm font-bold ${scoreColor}`}>{lead.lead_score}</span>}
                label="Score"
                value={lead.classification ? <StatusBadge tone={lead.classification === 'hot' ? 'red' : lead.classification === 'warm' ? 'amber' : 'blue'}>{lead.classification}</StatusBadge> : '—'}
              />
            </CardContent>
          </Card>

          {/* Tags */}
          {(lead.tags?.length ?? 0) > 0 && (
            <Card>
              <CardHeader>
                <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Tag className="h-4 w-4" /> Tags
                </h3>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {lead.tags.map((tag) => (
                    <StatusBadge key={tag} tone="gray">{tag}</StatusBadge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Notes */}
          {lead.notes && (
            <Card>
              <CardHeader>
                <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" /> Notes
                </h3>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-600 whitespace-pre-wrap">{lead.notes}</p>
              </CardContent>
            </Card>
          )}

          {/* Custom fields */}
          {Object.keys(lead.custom_fields).length > 0 && (
            <Card>
              <CardHeader>
                <h3 className="text-sm font-semibold text-slate-900">Custom fields</h3>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {Object.entries(lead.custom_fields).map(([key, val]) => (
                  <Row key={key} label={key} value={String(val ?? '—')} />
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Activity timeline */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-slate-900">Activity timeline</h3>
            </CardHeader>
            <CardContent>
              {activityLoading && (
                <div className="flex h-32 items-center justify-center">
                  <div className="h-6 w-6 animate-spin rounded-full border-4 border-slate-300 border-t-slate-700" />
                </div>
              )}

              {!activityLoading && activity.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-10 text-center text-slate-500">
                  <Activity className="h-8 w-8 text-slate-300" />
                  <p className="text-sm">No activity yet</p>
                </div>
              )}

              {!activityLoading && activity.length > 0 && (
                <div className="relative">
                  <div className="absolute left-4 top-0 bottom-0 w-px bg-slate-200" />
                  <ul className="space-y-4 pl-10">
                    {activity.map((entry) => (
                      <li key={entry.id} className="relative">
                        <div className="absolute -left-6 flex h-4 w-4 items-center justify-center rounded-full bg-white ring-2 ring-slate-200">
                          {entry.kind === 'outreach' ? (
                            <span className="text-[10px]">{channelIcons[entry.channel ?? ''] ?? '📤'}</span>
                          ) : (
                            <div className="h-2 w-2 rounded-full bg-slate-400" />
                          )}
                        </div>
                        <div className="flex items-start justify-between gap-4 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900">
                              {entry.kind === 'outreach'
                                ? `${channelIcons[entry.channel ?? ''] ?? ''} ${entry.channel ?? 'outreach'} · ${entry.status ?? ''}`
                                : classifyActivity(entry.action)}
                            </p>
                            {entry.kind === 'outreach' && entry.status && (
                              <StatusBadge
                                tone={
                                  entry.status === 'delivered' || entry.status === 'opened' || entry.status === 'replied'
                                    ? 'green'
                                    : entry.status === 'failed' || entry.status === 'bounced'
                                    ? 'red'
                                    : 'gray'
                                }
                                className="mt-1"
                              >
                                {entry.status}
                              </StatusBadge>
                            )}
                          </div>
                          <time className="shrink-0 text-xs text-slate-400">{timeAgo(entry.created_at)}</time>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({
  icon,
  label,
  value,
  children,
}: {
  icon?: React.ReactNode;
  label: string;
  value?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      {icon && <span className="mt-0.5 shrink-0 text-slate-400">{icon}</span>}
      <div className="min-w-0 flex-1">
        <span className="text-xs text-slate-500">{label}</span>
        <div className="text-sm font-medium text-slate-900 mt-0.5">{children ?? value ?? '—'}</div>
      </div>
    </div>
  );
}

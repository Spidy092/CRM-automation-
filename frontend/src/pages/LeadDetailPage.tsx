import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLead, useLeadActivities, useCreateLeadActivity, usePauseLead, useDeleteLead, useEnrichLead } from '@/api/leads';
import { useLeadOutreachLogs } from '@/api/outreach';
import { PageHeader } from '@/components/ui/PageHeader';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge';
import { statusTones } from '@/lib/constants';
import { formatCurrency } from '@/lib/utils';
import { useToast } from '@/components/ui/Toast';
import { QuickResponseModal } from '@/components/ui/QuickResponseModal';
import { FollowUpPicker } from '@/components/ui/FollowUpPicker';
import type { ActivityType, Lead } from '@/types';
import {
  ArrowLeft,
  Edit,
  Trash2,
  Pause,
  Play,
  AlertCircle,
  User,
  Activity,
  Sparkles,
  Phone,
  Mail,
  FileText,
  MessageSquare,
  ArrowRightLeft,
  UserCheck,
  Send,
  ArrowRight,
  GitBranch,
  Tag,
  Globe,
  Star,
  CheckCircle2,
  ClipboardCheck,
  DollarSign,
  CalendarCheck,
  ChevronDown,
  ChevronRight,
  MailCheck,
  Clock,
  ChevronUp,
} from 'lucide-react';

const activityTypeIcons: Record<import('@/types').ActivityType, React.ReactNode> = {
  call: <Phone className="h-3.5 w-3.5" role="img" aria-label="Call" />,
  whatsapp: <MessageSquare className="h-3.5 w-3.5" role="img" aria-label="WhatsApp" />,
  email: <Mail className="h-3.5 w-3.5" role="img" aria-label="Email" />,
  note: <FileText className="h-3.5 w-3.5" role="img" aria-label="Note" />,
  status_change: <ArrowRightLeft className="h-3.5 w-3.5" role="img" aria-label="Status change" />,
  assignment_change: <UserCheck className="h-3.5 w-3.5" role="img" aria-label="Assignment change" />,
};

const activityTypeLabels: Record<import('@/types').ActivityType, string> = {
  call: 'Call',
  whatsapp: 'WhatsApp',
  email: 'Email',
  note: 'Note',
  status_change: 'Status change',
  assignment_change: 'Assignment change',
};


type LeadActionKind = 'link' | 'activity' | 'complete';
type LeadOutcome = 'reached' | 'no_answer' | 'interested' | 'not_interested' | 'wrong_contact';

interface LeadActionItem {
  id: string;
  title: string;
  description: string;
  tone: StatusTone;
  buttonLabel: string;
  kind: LeadActionKind;
  to?: string;
  activityType?: Exclude<ActivityType, 'status_change' | 'assignment_change'>;
  icon: React.ReactNode;
}

interface LeadOutcomeOption {
  id: LeadOutcome;
  label: string;
  nextStep: string;
  tone: StatusTone;
  icon: React.ReactNode;
}

const outcomeOptions: LeadOutcomeOption[] = [
  {
    id: 'reached',
    label: 'Reached',
    nextStep: 'Keep the lead active and continue qualification.',
    tone: 'green',
    icon: <Phone className="h-4 w-4" />,
  },
  {
    id: 'no_answer',
    label: 'No answer',
    nextStep: 'Log the attempt, then follow up later.',
    tone: 'amber',
    icon: <ClockIcon />,
  },
  {
    id: 'interested',
    label: 'Interested',
    nextStep: 'Review AI profile and move toward qualification.',
    tone: 'blue',
    icon: <Sparkles className="h-4 w-4" />,
  },
  {
    id: 'not_interested',
    label: 'Not interested',
    nextStep: 'Pause outreach if needed and keep the reason in history.',
    tone: 'red',
    icon: <Pause className="h-4 w-4" />,
  },
  {
    id: 'wrong_contact',
    label: 'Wrong contact',
    nextStep: 'Update contact fields before sending more outreach.',
    tone: 'gray',
    icon: <Edit className="h-4 w-4" />,
  },
];

function ClockIcon() {
  return <Activity className="h-4 w-4" />;
}

function getLeadActionPlan(lead: Lead, activityCount: number): LeadActionItem[] {
  const actions: LeadActionItem[] = [];
  const hasEmail = Boolean(lead.email);
  const hasPhone = Boolean(lead.phone);
  const isHot = lead.classification === 'hot' || lead.lead_score >= 80;

  if (lead.status === 'opted_out') {
    return [
      {
        id: 'opted-out',
        title: 'Contact is opted out',
        description: 'Keep this lead out of outreach. Use notes only for internal context.',
        tone: 'gray',
        buttonLabel: 'Add note below',
        kind: 'complete',
        icon: <AlertCircle className="h-4 w-4" />,
      },
    ];
  }

  if (!hasEmail && !hasPhone) {
    actions.push({
      id: 'missing-contact',
      title: 'Add contact details',
      description: 'This lead cannot enter email, SMS, WhatsApp, or call follow-up until email or phone is added.',
      tone: 'red',
      buttonLabel: 'Fix fields',
      kind: 'link',
      to: `/leads/${lead.id}/edit`,
      icon: <FileText className="h-4 w-4" />,
    });
  }

  if (!lead.pipeline_stage_id) {
    actions.push({
      id: 'pipeline-stage',
      title: 'Place in pipeline',
      description: 'Assign a stage so the next sales outcome is visible on the board.',
      tone: 'amber',
      buttonLabel: 'Open pipeline',
      kind: 'link',
      to: '/pipelines',
      icon: <GitBranch className="h-4 w-4" />,
    });
  }

  if (isHot && hasPhone) {
    actions.push({
      id: 'call-hot-lead',
      title: 'Call this hot lead',
      description: 'High-score leads should get a direct touch before automated nurture.',
      tone: 'green',
      buttonLabel: 'Log call',
      kind: 'activity',
      activityType: 'call',
      icon: <Phone className="h-4 w-4" />,
    });
  }

  if (!isHot && hasEmail) {
    actions.push({
      id: 'email-lead',
      title: 'Send a light follow-up',
      description: 'Use an approved template or campaign sequence instead of writing from scratch.',
      tone: 'blue',
      buttonLabel: 'Log email',
      kind: 'activity',
      activityType: 'email',
      icon: <Mail className="h-4 w-4" />,
    });
  }

  if (hasPhone && !actions.some((action) => action.activityType === 'call')) {
    actions.push({
      id: 'whatsapp-lead',
      title: 'Start WhatsApp follow-up',
      description: 'Use this when the lead is ready for a short conversational touch.',
      tone: 'cyan',
      buttonLabel: 'Log WhatsApp',
      kind: 'activity',
      activityType: 'whatsapp',
      icon: <MessageSquare className="h-4 w-4" />,
    });
  }

  if (activityCount === 0) {
    actions.push({
      id: 'first-note',
      title: 'Capture first context',
      description: 'Add a short note so the next rep understands why this lead matters.',
      tone: 'violet',
      buttonLabel: 'Add note below',
      kind: 'complete',
      icon: <ClipboardCheck className="h-4 w-4" />,
    });
  }

  if (actions.length === 0) {
    actions.push({
      id: 'ready',
      title: 'Lead is ready for normal follow-up',
      description: 'Contact details, pipeline state, and activity history are present.',
      tone: 'green',
      buttonLabel: 'Open AI profile',
      kind: 'link',
      to: `/leads/${lead.id}/ai`,
      icon: <CheckCircle2 className="h-4 w-4" />,
    });
  }

  return actions.slice(0, 3);
}

function classifyActivity(type: import('@/types').ActivityType, metadata: Record<string, unknown>): string {
  if (type === 'status_change') {
    const from = String(metadata?.from ?? '—');
    const to = String(metadata?.to ?? '—');
    return `Status changed from ${from} to ${to}`;
  }
  if (type === 'assignment_change') {
    const from = String(metadata?.from ?? '—');
    const to = String(metadata?.to ?? '—');
    return `Assignment changed from ${from} to ${to}`;
  }
  if (type === 'note') {
    if (metadata?.outcome_label) {
      return `Outcome · ${String(metadata.outcome_label)}`;
    }
    if (metadata?.note) {
      return String(metadata.note);
    }
    return 'Note';
  }
  if (type === 'call') {
    const direction = String(metadata?.direction ?? '');
    return direction ? `Call · ${direction}` : 'Call';
  }
  if (type === 'whatsapp') {
    const direction = String(metadata?.direction ?? '');
    return direction ? `WhatsApp · ${direction}` : 'WhatsApp';
  }
  if (type === 'email') {
    const direction = String(metadata?.direction ?? '');
    return direction ? `Email · ${direction}` : 'Email';
  }
  return activityTypeLabels[type];
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return 'just now';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}


function LeadOutcomeBar({
  onSelectOutcome,
  isSaving,
}: {
  onSelectOutcome: (outcome: LeadOutcomeOption) => void;
  isSaving: boolean;
}) {
  const [expanded, setExpanded] = React.useState(false);

  return (
    <Card className="overflow-hidden border-slate-200">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left transition hover:bg-slate-50"
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
          )}
          <h3 className="text-sm font-semibold text-slate-900">What happened?</h3>
          {!expanded && (
            <span className="hidden text-xs text-slate-400 sm:inline">Record the outcome so the next step is obvious</span>
          )}
        </div>
        <StatusBadge tone="violet">outcome</StatusBadge>
      </button>
      {expanded && (
        <CardContent className="grid gap-2 border-t p-4 sm:grid-cols-2 xl:grid-cols-5">
          {outcomeOptions.map((outcome) => (
            <button
              key={outcome.id}
              type="button"
              disabled={isSaving}
              onClick={() => onSelectOutcome(outcome)}
              className="flex min-h-28 flex-col rounded-lg border border-slate-200 bg-white p-3 text-left transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-slate-700">
                  {outcome.icon}
                </span>
                <StatusBadge tone={outcome.tone}>{outcome.label}</StatusBadge>
              </span>
              <span className="mt-3 text-xs leading-5 text-slate-500">{outcome.nextStep}</span>
            </button>
          ))}
        </CardContent>
      )}
    </Card>
  );
}

function LeadActionPlan({
  actions,
  onLogActivity,
  isLogging,
}: {
  actions: LeadActionItem[];
  onLogActivity: (type: Exclude<ActivityType, 'status_change' | 'assignment_change'>) => void;
  isLogging: boolean;
}) {
  const [expanded, setExpanded] = React.useState(false);

  return (
    <Card className="overflow-hidden border-slate-200">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 bg-slate-50/70 px-4 py-2.5 text-left transition hover:bg-slate-100"
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
          )}
          <h3 className="text-sm font-semibold text-slate-900">Recommended next actions</h3>
          {!expanded && (
            <span className="hidden text-xs text-slate-400 sm:inline">A short path from lead review to follow-up</span>
          )}
        </div>
        <StatusBadge tone="blue">guided flow</StatusBadge>
      </button>
      {expanded && (
      <CardContent className="grid gap-3 border-t p-4 md:grid-cols-3">
        {actions.map((action) => (
          <div key={action.id} className="flex min-h-40 flex-col rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                {action.icon}
              </div>
              <StatusBadge tone={action.tone}>{action.tone}</StatusBadge>
            </div>
            <div className="mt-3 flex-1">
              <p className="text-sm font-semibold text-slate-900">{action.title}</p>
              <p className="mt-1 text-sm text-slate-500">{action.description}</p>
            </div>
            {action.kind === 'link' && action.to ? (
              <Button variant="outline" size="sm" asChild className="mt-4 justify-between">
                <Link to={action.to}>
                  {action.buttonLabel}
                  <ArrowRight className="ml-2 h-3.5 w-3.5" />
                </Link>
              </Button>
            ) : action.kind === 'activity' && action.activityType ? (
              <Button
                variant="outline"
                size="sm"
                className="mt-4 justify-between"
                disabled={isLogging}
                onClick={() => onLogActivity(action.activityType!)}
              >
                {action.buttonLabel}
                <ArrowRight className="ml-2 h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button variant="outline" size="sm" className="mt-4 justify-between" disabled>
                {action.buttonLabel}
                <CheckCircle2 className="ml-2 h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ))}
      </CardContent>
      )}
    </Card>
  );
}

export function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const leadId = id ?? '';
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [activityLimit, setActivityLimit] = React.useState(25);
  const { data: lead, isLoading: leadLoading, error: leadError } = useLead(leadId);
  const { data: activitiesPage, isLoading: activityLoading } = useLeadActivities(leadId, { limit: activityLimit });
  const { data: outreachLogs = [], isLoading: logsLoading } = useLeadOutreachLogs(leadId);
  const createActivity = useCreateLeadActivity();
  const pauseLead = usePauseLead();
  const deleteLead = useDeleteLead();
  const enrichLead = useEnrichLead();

  const [noteText, setNoteText] = React.useState('');
  const [showQuickResponse, setShowQuickResponse] = React.useState(false);
  const [showDeleteModal, setShowDeleteModal] = React.useState(false);

  const activities = activitiesPage?.items ?? [];

  const handleQuickActivity = async (type: Exclude<ActivityType, 'status_change' | 'assignment_change'>) => {
    if (!id || createActivity.isPending) return;
    const label = activityTypeLabels[type];
    try {
      await createActivity.mutateAsync({
        leadId: id,
        input: {
          type,
          metadata: { source: 'quick_actions', note: `${label} logged` },
        },
      });
      showToast(`${label} logged successfully.`, 'success');
    } catch {
      showToast(`Failed to log ${label.toLowerCase()}.`, 'error');
    }
  };

  const handleAddNote = async () => {
    if (!id || !noteText.trim()) return;
    try {
      await createActivity.mutateAsync({
        leadId: id,
        input: {
          type: 'note',
          metadata: { note: noteText.trim(), source: 'detail_view' },
        },
      });
      showToast('Note added.', 'success');
      setNoteText('');
    } catch {
      showToast('Failed to add note.', 'error');
    }
  };

  const handleOutcome = async (outcome: { id: LeadOutcome; label: string; nextStep: string }) => {
    if (!id) return;
    try {
      await createActivity.mutateAsync({
        leadId: id,
        input: {
          type: 'note',
          metadata: {
            note: `${outcome.label}: ${outcome.nextStep}`,
            outcome: outcome.id,
            outcome_label: outcome.label,
            source: 'quick_outcome_bar',
          },
        },
      });
      showToast(`${outcome.label} saved.`, 'success');
    } catch {
      showToast('Failed to save outcome.', 'error');
    }
  };

  const handlePause = async () => {
    if (!lead) return;
    if (lead.status !== 'active' && lead.status !== 'paused') return;
    const willPause = lead.status === 'active';
    try {
      await pauseLead.mutateAsync({ id: lead.id, paused: willPause });
      showToast(willPause ? 'Lead paused.' : 'Lead resumed.', 'success');
    } catch {
      showToast('Failed to update lead status.', 'error');
    }
  };

  const confirmDelete = async () => {
    if (!lead) return;
    try {
      await deleteLead.mutateAsync(lead.id);
      showToast('Lead deleted.', 'success');
      setShowDeleteModal(false);
      navigate('/leads');
    } catch {
      showToast('Failed to delete lead.', 'error');
    }
  };

  if (leadLoading) {
    return <LoadingSpinner />;
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
  const actionPlan = getLeadActionPlan(lead, activities.length);

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
            {(lead.status === 'active' || lead.status === 'paused') && (
              <Button variant="outline" size="sm" onClick={handlePause} disabled={pauseLead.isPending}>
                {lead.status === 'active' ? (
                  <><Pause className="mr-2 h-4 w-4" />Pause</>
                ) : (
                  <><Play className="mr-2 h-4 w-4" />Resume</>
                )}
              </Button>
            )}
            {lead.status !== 'opted_out' && (
              <Button size="sm" onClick={() => setShowQuickResponse(true)}>
                <Send className="mr-2 h-4 w-4" />
                Send Quick Response
              </Button>
            )}
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
            <Button variant="outline" size="sm" onClick={() => setShowDeleteModal(true)} className="text-red-600 hover:text-red-700">
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

      <FollowUpPicker leadId={lead.id} value={lead.next_follow_up_at} />

      <LeadActionPlan
        actions={actionPlan}
        isLogging={createActivity.isPending}
        onLogActivity={handleQuickActivity}
      />

      <LeadOutcomeBar
        isSaving={createActivity.isPending}
        onSelectOutcome={handleOutcome}
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
              {typeof lead.deal_value === 'number' && (
                <Row
                  icon={<DollarSign className="h-4 w-4 text-green-600" />}
                  label="Deal Value"
                  value={formatCurrency(lead.deal_value)}
                />
              )}
              {lead.status === 'won' && lead.won_at && (
                <Row
                  icon={<CalendarCheck className="h-4 w-4 text-green-600" />}
                  label="Won On"
                  value={new Date(lead.won_at).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                />
              )}
              {lead.status === 'lost' && lead.lost_at && (
                <Row
                  icon={<CalendarCheck className="h-4 w-4 text-red-500" />}
                  label="Lost On"
                  value={new Date(lead.lost_at).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                />
              )}
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

        {/* Activity timeline and Message History */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-slate-900">Activity Timeline</h3>
            </CardHeader>
            <CardContent>
              <form onSubmit={(e) => { e.preventDefault(); void handleAddNote(); }} className="mb-6 flex flex-col gap-3">
                <Textarea
                  placeholder="Add a note..."
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  rows={3}
                  disabled={createActivity.isPending}
                />
                <div className="flex justify-end">
                  <Button type="submit" size="sm" disabled={!noteText.trim() || createActivity.isPending}>
                    <Send className="mr-2 h-4 w-4" />
                    Add note
                  </Button>
                </div>
              </form>

              {activityLoading && (
                <div className="flex h-32 items-center justify-center">
                  <div className="h-6 w-6 animate-spin rounded-full border-4 border-slate-300 border-t-slate-700" />
                </div>
              )}

              {!activityLoading && activities.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-10 text-center text-slate-500">
                  <Activity className="h-8 w-8 text-slate-300" />
                  <p className="text-sm">No activity yet</p>
                </div>
              )}

              {!activityLoading && activities.length > 0 && (
                <div className="relative">
                  <div className="absolute left-4 top-0 bottom-0 w-px bg-slate-200" />
                  <ul className="space-y-4 pl-10">
                    {activities.map((entry) => (
                      <li key={entry.id} className="relative">
                        <div className="absolute -left-6 flex h-6 w-6 items-center justify-center rounded-full bg-white ring-2 ring-slate-200">
                          {activityTypeIcons[entry.type]}
                        </div>
                        <div className="flex items-start justify-between gap-4 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900">
                              {activityTypeLabels[entry.type]}
                            </p>
                            <p className="text-sm text-slate-700">
                              {classifyActivity(entry.type, entry.metadata)}
                            </p>
                            {entry.user_name && (
                              <p className="mt-1 text-xs text-slate-500">by {entry.user_name}</p>
                            )}
                          </div>
                          <time className="shrink-0 text-xs text-slate-400">{timeAgo(entry.created_at)}</time>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {activitiesPage?.meta?.total && activitiesPage.meta.total > activities.length && (
                    <div className="mt-6 flex justify-center border-t border-slate-100 pt-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setActivityLimit((prev) => prev + 25)}
                      >
                        Load older activities ({activitiesPage.meta.total - activities.length} remaining)
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Message History */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <MailCheck className="h-4 w-4 text-indigo-500" />
                <h3 className="text-sm font-semibold text-slate-900">Message History</h3>
                {outreachLogs.length > 0 && (
                  <span className="ml-auto rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                    {outreachLogs.length} sent
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {logsLoading && (
                <div className="flex h-24 items-center justify-center">
                  <div className="h-5 w-5 animate-spin rounded-full border-4 border-slate-300 border-t-indigo-600" />
                </div>
              )}
              {!logsLoading && outreachLogs.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-8 text-center text-slate-500">
                  <MailCheck className="h-8 w-8 text-slate-300" />
                  <p className="text-sm">No messages sent yet</p>
                  <p className="text-xs text-slate-400">Emails sent via campaigns will appear here.</p>
                </div>
              )}
              {!logsLoading && outreachLogs.length > 0 && (
                <ul className="space-y-3">
                  {outreachLogs.map((log) => (
                    <MessageLogItem key={log.id} log={log} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      {showQuickResponse && (
        <QuickResponseModal lead={lead} onClose={() => setShowQuickResponse(false)} />
      )}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-fade-in">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">Delete Lead</h2>
            <p className="text-sm text-slate-600">
              Are you sure you want to delete <span className="font-semibold text-slate-800">{lead?.business_name}</span>? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
              <Button variant="outline" size="sm" onClick={() => setShowDeleteModal(false)} disabled={deleteLead.isPending}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={confirmDelete} disabled={deleteLead.isPending}>
                {deleteLead.isPending ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </div>
        </div>
      )}
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

// ── Message History sub-component ────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  sent:      'bg-blue-100 text-blue-700',
  delivered: 'bg-green-100 text-green-700',
  opened:    'bg-purple-100 text-purple-700',
  replied:   'bg-indigo-100 text-indigo-700',
  failed:    'bg-red-100 text-red-700',
  pending:   'bg-slate-100 text-slate-600',
};

const CHANNEL_LABELS: Record<string, string> = {
  email:       '📧 Email',
  whatsapp:    '💬 WhatsApp',
  sms:         '📱 SMS',
  phone_call:  '📞 Call',
};

function MessageLogItem({ log }: { log: import('@/api/outreach').OutreachLog }) {
  const [expanded, setExpanded] = React.useState(false);
  const preview = log.message_body ? log.message_body.slice(0, 150) : null;
  const hasMore  = log.message_body ? log.message_body.length > 150 : false;

  const statusStyle = STATUS_STYLES[log.status] ?? 'bg-slate-100 text-slate-600';
  const sentAt = log.sent_at ? new Date(log.sent_at).toLocaleString() : '—';

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-2">
        {log.step_number != null && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
            Step {log.step_number}
          </span>
        )}
        <span className="text-xs text-slate-500">
          {CHANNEL_LABELS[log.channel] ?? log.channel}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusStyle}`}>
          {log.status}
        </span>
        <span className="ml-auto flex items-center gap-1 text-xs text-slate-400">
          <Clock className="h-3 w-3" />
          {sentAt}
        </span>
      </div>

      {/* Body preview */}
      {preview && (
        <div className="mt-3">
          <p className="text-sm text-slate-700 whitespace-pre-line leading-relaxed">
            {expanded ? log.message_body : preview}
            {!expanded && hasMore && '…'}
          </p>
          {hasMore && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline"
            >
              {expanded
                ? <><ChevronUp className="h-3 w-3" /> Show less</>
                : <><ChevronDown className="h-3 w-3" /> Show more</>}
            </button>
          )}
        </div>
      )}

      {/* Error message if failed */}
      {log.error_message && (
        <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          ⚠ {log.error_message}
        </p>
      )}
    </li>
  );
}

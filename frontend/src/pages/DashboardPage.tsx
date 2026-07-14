import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from 'recharts';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/PageHeader';
import { ErrorState } from '@/components/ui/ErrorState';
import { useDashboardMetrics } from '@/api/reports';
import { useLeads } from '@/api/leads';
import { useCampaigns } from '@/api/campaigns';
import { usePipelines } from '@/api/pipelines';
import { useTemplates } from '@/api/templates';
import { useAuthStore } from '@/store/authStore';
import {
  Users,
  TrendingUp,
  Mail,
  BarChart3,
  Target,
  CheckCircle2,
  ClipboardList,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  ArrowRight,
  Bot,
  Clock3,
  FileText,
  KanbanSquare,
  MessageSquareText,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Campaign, DashboardMetrics, Lead, Template } from '@/types';
import type { UserRole } from '@/types';

/* ─── Types ─── */

interface ExtendedDashboardMetrics extends DashboardMetrics {
  leadSources?: Array<{ name: string; value: number }>;
  myPipelineStages?: Array<{ name: string; count: number }>;
}

interface StatConfig {
  title: string;
  value: number;
  description: string;
  icon: React.ReactNode;
  format?: 'number' | 'percent';
  accent: string;
  bg: string;
  trend?: number;
}

interface WorkQueueItem {
  id: string;
  title: string;
  description: string;
  eyebrow: string;
  actionLabel: string;
  to: string;
  priority: 'high' | 'medium' | 'low';
  icon: React.ReactNode;
}

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];

/* ─── Helpers ─── */

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatValue(value: number, format?: 'number' | 'percent'): string {
  if (format === 'percent') return `${value.toFixed(1)}%`;
  return value.toLocaleString();
}

function computeTrend(data: number[]): number {
  if (data.length < 2) return 0;
  const first = data[0] || 1;
  const last = data[data.length - 1] || 0;
  return first === 0 ? 0 : ((last - first) / first) * 100;
}

function getLeadName(lead: Lead): string {
  return lead.business_name || lead.contact_name || 'Unnamed lead';
}

function hasMissingContactInfo(lead: Lead): boolean {
  return !lead.email && !lead.phone;
}

function getWorkQueueItems({
  leads,
  campaigns,
  templates,
  hasPipelineStages,
  role,
}: {
  leads: Lead[];
  campaigns: Campaign[];
  templates: Template[];
  hasPipelineStages: boolean;
  role: UserRole;
}): WorkQueueItem[] {
  const items: WorkQueueItem[] = [];
  const canManageCampaigns = role === 'admin' || role === 'manager' || role === 'marketing';
  const canSell = role === 'admin' || role === 'manager' || role === 'sales';
  const canManageTemplates = role === 'admin' || role === 'manager' || role === 'marketing';

  const unassignedLead = leads.find((lead) => lead.status === 'active' && !lead.assigned_to);
  if (unassignedLead && (role === 'admin' || role === 'manager')) {
    items.push({
      id: `assign-${unassignedLead.id}`,
      title: `Assign ${getLeadName(unassignedLead)}`,
      description: 'New active lead has no owner. Assign it before outreach or follow-up stalls.',
      eyebrow: 'Lead routing',
      actionLabel: 'Open lead',
      to: `/leads/${unassignedLead.id}`,
      priority: 'high',
      icon: <Users className="h-4 w-4" />,
    });
  }

  const hotLead = leads.find(
    (lead) =>
      lead.status === 'active' &&
      (lead.classification === 'hot' || lead.lead_score >= 80),
  );
  if (hotLead && canSell) {
    items.push({
      id: `hot-${hotLead.id}`,
      title: `Work hot lead: ${getLeadName(hotLead)}`,
      description: 'High-intent lead should get a direct touch and pipeline update today.',
      eyebrow: 'Next best action',
      actionLabel: 'Review lead',
      to: `/leads/${hotLead.id}`,
      priority: 'high',
      icon: <Sparkles className="h-4 w-4" />,
    });
  }

  const missingContactLead = leads.find(
    (lead) => lead.status === 'active' && hasMissingContactInfo(lead),
  );
  if (missingContactLead && canSell) {
    items.push({
      id: `contact-${missingContactLead.id}`,
      title: `Complete ${getLeadName(missingContactLead)}`,
      description: 'This lead is missing both email and phone, so campaigns cannot reach them yet.',
      eyebrow: 'Data cleanup',
      actionLabel: 'Fix fields',
      to: `/leads/${missingContactLead.id}/edit`,
      priority: 'medium',
      icon: <FileText className="h-4 w-4" />,
    });
  }

  const draftCampaign = campaigns.find((campaign) => campaign.status === 'draft');
  if (draftCampaign && canManageCampaigns) {
    items.push({
      id: `campaign-${draftCampaign.id}`,
      title: `Finish campaign: ${draftCampaign.name}`,
      description: 'Draft campaign is ready for audience, template, and launch review.',
      eyebrow: 'Campaign setup',
      actionLabel: 'Open campaign',
      to: `/campaigns/${draftCampaign.id}`,
      priority: 'medium',
      icon: <MessageSquareText className="h-4 w-4" />,
    });
  }

  const pendingTemplate = templates.find(
    (template) => template.approval_status === 'pending',
  );
  if (pendingTemplate && canManageTemplates) {
    items.push({
      id: `template-${pendingTemplate.id}`,
      title: `Approve template: ${pendingTemplate.name}`,
      description: 'Pending templates block repeatable outreach until approved or rejected.',
      eyebrow: 'Template approval',
      actionLabel: 'Review template',
      to: '/templates',
      priority: 'medium',
      icon: <Bot className="h-4 w-4" />,
    });
  }

  if (!hasPipelineStages && (role === 'admin' || role === 'manager')) {
    items.push({
      id: 'pipeline-setup',
      title: 'Set up pipeline stages',
      description: 'A simple pipeline lets reps move leads by outcome instead of tracking work manually.',
      eyebrow: 'Pipeline setup',
      actionLabel: 'Manage pipeline',
      to: '/pipelines/manage',
      priority: 'low',
      icon: <KanbanSquare className="h-4 w-4" />,
    });
  }

  if (items.length === 0) {
    items.push({
      id: 'healthy-flow',
      title: 'Flow is clear',
      description: 'No urgent routing, approval, or setup gaps were found in the latest records.',
      eyebrow: 'System check',
      actionLabel: 'View AI inbox',
      to: '/ai-inbox',
      priority: 'low',
      icon: <CheckCircle2 className="h-4 w-4" />,
    });
  }

  const priorityOrder: Record<WorkQueueItem['priority'], number> = {
    high: 0,
    medium: 1,
    low: 2,
  };

  return items
    .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
    .slice(0, 5);
}

function getStatsForRole(
  role: UserRole,
  metrics: ExtendedDashboardMetrics,
): StatConfig[] {
  const leadActivity = metrics.recentActivity.map((d) => d.leads);
  const newLeadsThisPeriod = leadActivity.reduce((sum, d) => sum + d, 0);
  const leadTrend = computeTrend(leadActivity);

  const myWonLeads = Math.round((metrics.pipelineConversion / 100) * metrics.totalLeads);

  const accentMap: Record<string, { accent: string; bg: string }> = {
    leads: { accent: 'border-l-4 border-blue-500', bg: 'bg-blue-50/40' },
    conversion: { accent: 'border-l-4 border-emerald-500', bg: 'bg-emerald-50/40' },
    campaigns: { accent: 'border-l-4 border-violet-500', bg: 'bg-violet-50/40' },
    qualified: { accent: 'border-l-4 border-amber-500', bg: 'bg-amber-50/40' },
    outreach: { accent: 'border-l-4 border-cyan-500', bg: 'bg-cyan-50/40' },
    won: { accent: 'border-l-4 border-rose-500', bg: 'bg-rose-50/40' },
    tasks: { accent: 'border-l-4 border-slate-500', bg: 'bg-slate-50/40' },
  };

  switch (role) {
    case 'admin':
      return [
        {
          title: 'Total Leads',
          value: metrics.totalLeads,
          description:
            metrics.totalLeads === 0 ? 'No leads imported yet' : 'Total leads in CRM',
          icon: <Users className="h-5 w-5 text-blue-600" />,
          accent: accentMap.leads.accent,
          bg: accentMap.leads.bg,
          trend: leadTrend,
        },
        {
          title: 'New Leads This Period',
          value: newLeadsThisPeriod,
          description:
            newLeadsThisPeriod === 0
              ? 'No new leads this period'
              : 'New leads (last 7 days)',
          icon: <Activity className="h-5 w-5 text-cyan-600" />,
          accent: accentMap.outreach.accent,
          bg: accentMap.outreach.bg,
        },
        {
          title: 'Qualified Leads',
          value: metrics.qualifiedLeads,
          description:
            metrics.qualifiedLeads === 0 ? 'No qualified leads yet' : 'Hot & warm leads',
          icon: <Target className="h-5 w-5 text-amber-600" />,
          accent: accentMap.qualified.accent,
          bg: accentMap.qualified.bg,
        },
        {
          title: 'Conversion Rate',
          value: metrics.pipelineConversion,
          description:
            metrics.pipelineConversion === 0
              ? 'No conversions yet'
              : 'Pipeline conversion rate',
          icon: <TrendingUp className="h-5 w-5 text-emerald-600" />,
          format: 'percent',
          accent: accentMap.conversion.accent,
          bg: accentMap.conversion.bg,
        },
      ];

    case 'manager':
      return [
        {
          title: 'Total Leads',
          value: metrics.totalLeads,
          description:
            metrics.totalLeads === 0 ? 'No leads imported yet' : 'Total leads in CRM',
          icon: <Users className="h-5 w-5 text-blue-600" />,
          accent: accentMap.leads.accent,
          bg: accentMap.leads.bg,
          trend: leadTrend,
        },
        {
          title: 'Qualified Leads',
          value: metrics.qualifiedLeads,
          description:
            metrics.qualifiedLeads === 0 ? 'No qualified leads yet' : 'Hot & warm leads',
          icon: <Target className="h-5 w-5 text-amber-600" />,
          accent: accentMap.qualified.accent,
          bg: accentMap.qualified.bg,
        },
        {
          title: 'Active Campaigns',
          value: metrics.totalCampaigns,
          description:
            metrics.totalCampaigns === 0 ? 'No campaigns created' : 'Running campaigns',
          icon: <Mail className="h-5 w-5 text-violet-600" />,
          accent: accentMap.campaigns.accent,
          bg: accentMap.campaigns.bg,
        },
        {
          title: 'Conversion Rate',
          value: metrics.pipelineConversion,
          description:
            metrics.pipelineConversion === 0
              ? 'No conversions yet'
              : 'Pipeline conversion rate',
          icon: <TrendingUp className="h-5 w-5 text-emerald-600" />,
          format: 'percent',
          accent: accentMap.conversion.accent,
          bg: accentMap.conversion.bg,
        },
      ];

    case 'sales':
      return [
        {
          title: 'My Assigned Leads',
          value: metrics.totalLeads,
          description:
            metrics.totalLeads === 0 ? 'No leads assigned yet' : 'Leads assigned to you',
          icon: <Users className="h-5 w-5 text-blue-600" />,
          accent: accentMap.leads.accent,
          bg: accentMap.leads.bg,
          trend: leadTrend,
        },
        {
          title: 'My Won Leads',
          value: myWonLeads,
          description: myWonLeads === 0 ? 'No won leads yet' : 'Leads you have won',
          icon: <CheckCircle2 className="h-5 w-5 text-rose-600" />,
          accent: accentMap.won.accent,
          bg: accentMap.won.bg,
        },
        {
          title: 'My Pending Tasks',
          value: 0,
          description: 'No pending tasks',
          icon: <ClipboardList className="h-5 w-5 text-slate-600" />,
          accent: accentMap.tasks.accent,
          bg: accentMap.tasks.bg,
        },
        {
          title: 'Conversion Rate',
          value: metrics.pipelineConversion,
          description:
            metrics.pipelineConversion === 0
              ? 'No conversions yet'
              : 'Your conversion rate',
          icon: <TrendingUp className="h-5 w-5 text-emerald-600" />,
          format: 'percent',
          accent: accentMap.conversion.accent,
          bg: accentMap.conversion.bg,
        },
      ];

    case 'marketing':
      return [
        {
          title: 'Total Leads',
          value: metrics.totalLeads,
          description:
            metrics.totalLeads === 0 ? 'No leads imported yet' : 'Total leads in CRM',
          icon: <Users className="h-5 w-5 text-blue-600" />,
          accent: accentMap.leads.accent,
          bg: accentMap.leads.bg,
          trend: leadTrend,
        },
        {
          title: 'New Leads This Period',
          value: newLeadsThisPeriod,
          description:
            newLeadsThisPeriod === 0
              ? 'No new leads this period'
              : 'New leads (last 7 days)',
          icon: <Activity className="h-5 w-5 text-cyan-600" />,
          accent: accentMap.outreach.accent,
          bg: accentMap.outreach.bg,
        },
        {
          title: 'Active Campaigns',
          value: metrics.totalCampaigns,
          description:
            metrics.totalCampaigns === 0 ? 'No campaigns created' : 'Running campaigns',
          icon: <Mail className="h-5 w-5 text-violet-600" />,
          accent: accentMap.campaigns.accent,
          bg: accentMap.campaigns.bg,
        },
        {
          title: 'Qualified Leads',
          value: metrics.qualifiedLeads,
          description:
            metrics.qualifiedLeads === 0 ? 'No qualified leads yet' : 'Hot & warm leads',
          icon: <Target className="h-5 w-5 text-amber-600" />,
          accent: accentMap.qualified.accent,
          bg: accentMap.qualified.bg,
        },
      ];

    case 'viewer':
    default:
      return [
        {
          title: 'Total Leads',
          value: metrics.totalLeads,
          description:
            metrics.totalLeads === 0 ? 'No leads imported yet' : 'Total leads in CRM',
          icon: <Users className="h-5 w-5 text-blue-600" />,
          accent: accentMap.leads.accent,
          bg: accentMap.leads.bg,
          trend: leadTrend,
        },
        {
          title: 'New Leads This Period',
          value: newLeadsThisPeriod,
          description:
            newLeadsThisPeriod === 0
              ? 'No new leads this period'
              : 'New leads (last 7 days)',
          icon: <Activity className="h-5 w-5 text-cyan-600" />,
          accent: accentMap.outreach.accent,
          bg: accentMap.outreach.bg,
        },
        {
          title: 'Qualified Leads',
          value: metrics.qualifiedLeads,
          description:
            metrics.qualifiedLeads === 0 ? 'No qualified leads yet' : 'Hot & warm leads',
          icon: <Target className="h-5 w-5 text-amber-600" />,
          accent: accentMap.qualified.accent,
          bg: accentMap.qualified.bg,
        },
        {
          title: 'Conversion Rate',
          value: metrics.pipelineConversion,
          description:
            metrics.pipelineConversion === 0
              ? 'No conversions yet'
              : 'Pipeline conversion rate',
          icon: <TrendingUp className="h-5 w-5 text-emerald-600" />,
          format: 'percent',
          accent: accentMap.conversion.accent,
          bg: accentMap.conversion.bg,
        },
      ];
  }
}

/* ─── Sub-components ─── */

function TrendBadge({ value }: { value?: number }) {
  if (value === undefined) return null;
  const isUp = value >= 0;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold',
        isUp ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700',
      )}
    >
      {isUp ? (
        <ArrowUpRight className="h-3 w-3" />
      ) : (
        <ArrowDownRight className="h-3 w-3" />
      )}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

function EmptyStateCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex h-72 flex-col items-center justify-center gap-3 text-slate-400">
      <div className="rounded-full bg-slate-100 p-4">
        <BarChart3 className="h-8 w-8 text-slate-300" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-slate-500">{title}</p>
        <p className="text-xs text-slate-400">{description}</p>
      </div>
    </div>
  );
}

function WorkQueueSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        {[0, 1, 2].map((item) => (
          <div key={item} className="flex gap-3">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-full" />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function WorkQueue({ items }: { items: WorkQueueItem[] }) {
  return (
    <Card className="overflow-hidden border-slate-200">
      <CardHeader className="border-b bg-white pb-4 pt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Clock3 className="h-4 w-4 text-slate-600" />
              Today's Work Queue
            </CardTitle>
            <CardDescription>
              Leads, pipeline, campaigns, and templates in one review flow
            </CardDescription>
          </div>
          <Button size="sm" asChild>
            <Link to="/ai-inbox">
              Open AI inbox
              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-slate-100">
          {items.map((item) => (
            <div
              key={item.id}
              className="grid gap-4 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center"
            >
              <div className="flex min-w-0 gap-3">
                <div
                  className={cn(
                    'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                    item.priority === 'high' && 'bg-rose-50 text-rose-600',
                    item.priority === 'medium' && 'bg-amber-50 text-amber-600',
                    item.priority === 'low' && 'bg-emerald-50 text-emerald-600',
                  )}
                >
                  {item.icon}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-semibold',
                        item.priority === 'high' && 'bg-rose-100 text-rose-700',
                        item.priority === 'medium' && 'bg-amber-100 text-amber-700',
                        item.priority === 'low' && 'bg-emerald-100 text-emerald-700',
                      )}
                    >
                      {item.eyebrow}
                    </span>
                    <span className="text-xs capitalize text-slate-500">
                      {item.priority} priority
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-semibold text-slate-900">
                    {item.title}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {item.description}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                asChild
                className="justify-self-start sm:justify-self-end"
              >
                <Link to={item.to}>
                  {item.actionLabel}
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── Page ─── */

export function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const role = user?.role ?? 'viewer';

  const { data, isLoading, error, refetch } = useDashboardMetrics();
  const leadsQuery = useLeads({ limit: 20 });
  const campaignsQuery = useCampaigns();
  const templatesQuery = useTemplates({ limit: 20 });
  const pipelinesQuery = usePipelines();
  const metrics = data as ExtendedDashboardMetrics | undefined;

  const stats = useMemo(
    () => (metrics ? getStatsForRole(role, metrics) : []),
    [role, metrics],
  );

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const workQueueItems = useMemo(
    () =>
      getWorkQueueItems({
        leads: leadsQuery.data?.items ?? [],
        campaigns: campaignsQuery.data ?? [],
        templates: templatesQuery.data ?? [],
        hasPipelineStages:
          pipelinesQuery.data?.some((pipeline) => pipeline.stages.length > 0) ?? false,
        role,
      }),
    [
      campaignsQuery.data,
      leadsQuery.data?.items,
      pipelinesQuery.data,
      role,
      templatesQuery.data,
    ],
  );

  const isWorkQueueLoading =
    leadsQuery.isLoading ||
    campaignsQuery.isLoading ||
    templatesQuery.isLoading ||
    pipelinesQuery.isLoading;

  return (
    <div className="space-y-8">
      <PageHeader
        title={role === 'sales' ? 'My Dashboard' : 'Dashboard'}
        description={today}
        eyebrow={role ? role.charAt(0).toUpperCase() + role.slice(1) : undefined}
        actions={
          (role === 'admin' || role === 'manager') ? (
            <Button variant="outline" size="sm" asChild>
              <Link to="/reports">View Reports</Link>
            </Button>
          ) : undefined
        }
      />

      {/* ─── Error banner ─── */}
      {error && (
        <ErrorState
          title="Failed to load dashboard data"
          message="Some metrics may be outdated or unavailable."
          onRetry={() => refetch()}
        />
      )}

      {/* ─── Hero stats ─── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Primary hero stat */}
        {isLoading ? (
          <Card className="lg:col-span-2 overflow-hidden">
            <CardContent className="p-7">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-4 h-14 w-48" />
              <Skeleton className="mt-2 h-3 w-40" />
              <Skeleton className="mt-6 h-20 w-full" />
            </CardContent>
          </Card>
        ) : stats[0] ? (
          <Card
            className={cn(
              'lg:col-span-2 overflow-hidden',
              stats[0].accent,
              stats[0].bg,
            )}
          >
            <CardContent className="p-7">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-600">
                    {stats[0].title}
                  </p>
                  <div className="mt-2 flex flex-wrap items-baseline gap-3">
                    <span className="text-5xl font-bold tracking-tight text-slate-900">
                      {formatValue(stats[0].value, stats[0].format)}
                    </span>
                    <TrendBadge value={stats[0].trend} />
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    {stats[0].description}
                  </p>
                </div>
                <div className="shrink-0 rounded-xl bg-white/70 p-3 shadow-sm backdrop-blur-sm">
                  {stats[0].icon}
                </div>
              </div>
              {/* Mini sparkline */}
              {metrics && metrics.recentActivity.length > 1 && (
                <div className="mt-6 h-20">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={metrics.recentActivity}>
                      <defs>
                        <linearGradient
                          id="miniLeads"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="#6366f1"
                            stopOpacity={0.2}
                          />
                          <stop
                            offset="95%"
                            stopColor="#6366f1"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <Area
                        type="monotone"
                        dataKey="leads"
                        stroke="#6366f1"
                        fill="url(#miniLeads)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        ) : null}

        {/* Stacked secondary stats */}
        <div className="flex flex-col gap-5">
          {isLoading
            ? [0, 1].map((i) => (
                <Card key={i} className="flex-1">
                  <CardContent className="p-5">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="mt-3 h-10 w-24" />
                    <Skeleton className="mt-2 h-3 w-32" />
                  </CardContent>
                </Card>
              ))
            : stats.slice(1, 3).map((stat) => (
                <Card
                  key={stat.title}
                  className={cn('flex-1', stat.accent, stat.bg)}
                >
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-slate-600">
                        {stat.title}
                      </p>
                      <div className="rounded-lg bg-white/70 p-2 shadow-sm">
                        {stat.icon}
                      </div>
                    </div>
                    <p className="mt-3 text-3xl font-bold tracking-tight text-slate-900">
                      {formatValue(stat.value, stat.format)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {stat.description}
                    </p>
                  </CardContent>
                </Card>
              ))}
        </div>
      </div>

      {/* ─── Compact stats row ─── */}
      {!isLoading && stats.length > 3 && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {stats.slice(3).map((stat) => (
            <Card key={stat.title} className={cn(stat.accent, stat.bg)}>
              <CardContent className="flex items-center gap-4 p-5">
                <div className="shrink-0 rounded-xl bg-white/70 p-2.5 shadow-sm">
                  {stat.icon}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-500">
                    {stat.title}
                  </p>
                  <p className="text-xl font-bold text-slate-900">
                    {formatValue(stat.value, stat.format)}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {stat.description}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {isWorkQueueLoading ? <WorkQueueSkeleton /> : <WorkQueue items={workQueueItems} />}

      {/* ─── Activity chart ─── */}
      <Card className="overflow-hidden">
        <CardHeader className="border-b bg-slate-50/50 pb-4 pt-6">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold">
                Recent Activity
              </CardTitle>
              <CardDescription>
                Leads and outreach over the last 7 days
              </CardDescription>
            </div>
            {metrics && metrics.recentActivity.length > 0 && (
              <div className="hidden items-center gap-4 sm:flex">
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-indigo-500" />
                  <span className="text-xs text-slate-500">Leads</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  <span className="text-xs text-slate-500">Outreach</span>
                </div>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-5">
          {isLoading ? (
            <Skeleton className="h-72 w-full" />
          ) : metrics && metrics.recentActivity.length > 0 ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={metrics.recentActivity}
                  margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
                >
                  <defs>
                    <linearGradient
                      id="mainLeads"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="5%"
                        stopColor="#6366f1"
                        stopOpacity={0.25}
                      />
                      <stop
                        offset="95%"
                        stopColor="#6366f1"
                        stopOpacity={0}
                      />
                    </linearGradient>
                    <linearGradient
                      id="mainOutreach"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="5%"
                        stopColor="#10b981"
                        stopOpacity={0.25}
                      />
                      <stop
                        offset="95%"
                        stopColor="#10b981"
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#f1f5f9"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(value: string) => formatDate(value)}
                    stroke="#94a3b8"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="#94a3b8"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: '12px',
                      border: '1px solid #e2e8f0',
                      boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
                      fontSize: '13px',
                    }}
                    labelFormatter={(label: string) => formatDate(label)}
                  />
                  <Area
                    type="monotone"
                    dataKey="leads"
                    name="Leads"
                    stroke="#6366f1"
                    fillOpacity={1}
                    fill="url(#mainLeads)"
                    strokeWidth={2.5}
                  />
                  <Area
                    type="monotone"
                    dataKey="outreach"
                    name="Outreach"
                    stroke="#10b981"
                    fillOpacity={1}
                    fill="url(#mainOutreach)"
                    strokeWidth={2.5}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyStateCard
              title="No recent activity"
              description="Check back after leads or outreach are processed"
            />
          )}
        </CardContent>
      </Card>

      {/* ─── Bottom row ─── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Role-specific chart */}
        <Card className="overflow-hidden lg:col-span-2">
          <CardHeader className="border-b bg-slate-50/50 pb-4 pt-6">
            <div>
              <CardTitle className="text-base font-semibold">
                {role === 'sales'
                  ? 'My Pipeline Stages'
                  : 'Lead Sources'}
              </CardTitle>
              <CardDescription>
                {role === 'sales'
                  ? 'Your current pipeline distribution'
                  : 'Where your leads are coming from'}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="p-5">
            {isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : role === 'sales' &&
              metrics?.myPipelineStages &&
              metrics.myPipelineStages.length > 0 ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={metrics.myPipelineStages}
                    barCategoryGap="20%"
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#f1f5f9"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="name"
                      stroke="#94a3b8"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      stroke="#94a3b8"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: '12px',
                        border: '1px solid #e2e8f0',
                        boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
                        fontSize: '13px',
                      }}
                    />
                    <Bar
                      dataKey="count"
                      fill="#6366f1"
                      radius={[6, 6, 0, 0]}
                      barSize={40}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (role === 'admin' || role === 'manager') &&
              metrics?.leadSources &&
              metrics.leadSources.length > 0 ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={metrics.leadSources}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={4}
                      cornerRadius={4}
                    >
                      {metrics.leadSources.map((entry, index) => (
                        <Cell
                          key={`cell-${entry.name}`}
                          fill={COLORS[index % COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        borderRadius: '12px',
                        border: '1px solid #e2e8f0',
                        boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
                        fontSize: '13px',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyStateCard
                title={
                  role === 'sales'
                    ? 'No pipeline data'
                    : 'No lead source data'
                }
                description="Data will appear once leads start flowing in"
              />
            )}
          </CardContent>
        </Card>

        {/* Dark snapshot card */}
        <Card className="overflow-hidden bg-slate-900 text-white">
          <CardHeader className="border-b border-white/10 pb-4 pt-6">
            <CardTitle className="text-base font-semibold text-white">
              Quick Snapshot
            </CardTitle>
            <CardDescription className="text-slate-400">
              At-a-glance summary
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 p-6">
            {isLoading ? (
              <>
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton className="h-3 w-24 bg-white/10" />
                    <Skeleton className="h-6 w-16 bg-white/10" />
                  </div>
                ))}
              </>
            ) : metrics ? (
              <>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                    Total Leads
                  </p>
                  <p className="mt-1 text-2xl font-bold text-white">
                    {metrics.totalLeads.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                    Conversion Rate
                  </p>
                  <p className="mt-1 text-2xl font-bold text-white">
                    {metrics.pipelineConversion.toFixed(1)}%
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                    Active Outreach
                  </p>
                  <p className="mt-1 text-2xl font-bold text-white">
                    {metrics.activeOutreach.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                    Campaigns
                  </p>
                  <p className="mt-1 text-2xl font-bold text-white">
                    {metrics.totalCampaigns.toLocaleString()}
                  </p>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

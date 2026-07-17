import { useState, useMemo } from 'react';
import {
  useDashboardMetrics,
  useLeadGenerationReport,
  useOutreachReport,
  usePipelineReport,
  useSalesRepReport,
  useCampaignAnalytics,
  useIntegrationAnalytics,
  useExportReport,
} from '@/api/reports';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
import {
  BarChartGeneric,
  MultiLineChart,
  HorizontalBarChart,
  DonutChartWithLegend,
  FunnelProgressBar,
  IntegrationStatusPie,
} from '@/components/reports/AnalyticsCharts';
import {
  BarChart3, Download, RefreshCw, Users, TrendingUp, Mail,
  Target, Activity, Link2, Calendar, ArrowUpRight, ArrowDownRight,
} from 'lucide-react';
import type { ReportListFilters } from '@/types';

type Tab = 'leadgen' | 'outreach' | 'pipeline' | 'reps' | 'campaigns' | 'integrations';

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'leadgen',      label: 'Lead Generation', icon: <Users className="h-3.5 w-3.5" /> },
  { key: 'outreach',     label: 'Outreach',         icon: <Mail className="h-3.5 w-3.5" /> },
  { key: 'pipeline',     label: 'Pipeline',         icon: <TrendingUp className="h-3.5 w-3.5" /> },
  { key: 'reps',         label: 'Sales Reps',       icon: <Target className="h-3.5 w-3.5" /> },
  { key: 'campaigns',    label: 'Campaigns',        icon: <Activity className="h-3.5 w-3.5" /> },
  { key: 'integrations', label: 'Integrations',     icon: <Link2 className="h-3.5 w-3.5" /> },
];

const EXPORT_TYPE: Record<Tab, string> = {
  leadgen: 'leads', outreach: 'outreach', pipeline: 'pipeline',
  reps: 'reps', campaigns: 'campaigns', integrations: 'integrations',
};

// ── Quick-date presets ─────────────────────────────────────────────────────

function quickRange(days: number): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - days);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

// ── KPI Card ───────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string | number;
  sub?: string;
  trend?: number;
  accent: string;
}

function KpiCard({ label, value, sub, trend, accent }: KpiCardProps) {
  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm ${accent}`}>
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="text-2xl font-bold text-slate-900">{value}</span>
        {trend !== undefined && (
          <span className={`flex items-center text-xs font-semibold ${trend >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            {trend >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {Math.abs(trend).toFixed(1)}%
          </span>
        )}
      </div>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

// ── Section wrapper ────────────────────────────────────────────────────────

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-slate-800">{title}</CardTitle>
        {description && <CardDescription className="text-xs">{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// ── Status badge ───────────────────────────────────────────────────────────

function Badge({ children, color = 'slate' }: { children: React.ReactNode; color?: string }) {
  const map: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-600',
    green: 'bg-emerald-100 text-emerald-700',
    red: 'bg-red-100 text-red-700',
    amber: 'bg-amber-100 text-amber-700',
    blue: 'bg-blue-100 text-blue-700',
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${map[color] ?? map.slate}`}>
      {children}
    </span>
  );
}

// ── Table ──────────────────────────────────────────────────────────────────

function Table({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200">
            {headers.map((h) => (
              <th key={h} className="pb-2 pr-4 text-xs font-semibold uppercase tracking-wider text-slate-500">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-slate-100 hover:bg-slate-50/50">
              {row.map((cell, j) => (
                <td key={j} className="py-2.5 pr-4 text-slate-700">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export function ReportsPage() {
  const [tab, setTab] = useState<Tab>('leadgen');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });

  const filters: ReportListFilters = useMemo(() => ({
    limit: 100,
    offset: 0,
    ...(dateRange.start ? { startDate: dateRange.start } : {}),
    ...(dateRange.end   ? { endDate:   dateRange.end   } : {}),
  }), [dateRange]);

  const { data: dashboard } = useDashboardMetrics();
  const { data: leadGen }   = useLeadGenerationReport(filters);
  const { data: outreach }  = useOutreachReport(filters);
  const { data: pipeline }  = usePipelineReport(filters);
  const { data: reps }      = useSalesRepReport(filters);
  const { data: campaigns, isLoading: campLoading } = useCampaignAnalytics(filters);
  const { data: integrations, isLoading: intLoading } = useIntegrationAnalytics();

  const exportMutation = useExportReport();
  const { showToast } = useToast();

  const handleExport = () => {
    exportMutation.mutate(
      { reportType: EXPORT_TYPE[tab], format: 'csv', filters: dateRange.start ? dateRange : undefined },
      {
        onSuccess: () => showToast('Export queued — check exports directory.', 'success'),
        onError: (err) => showToast(getApiErrorMessage(err, 'Export failed.'), 'error'),
      },
    );
  };

  // ── KPI computations ───────────────────────────────────────────────────

  const leadItems  = (leadGen?.items  ?? []) as Array<{ date: string; source: string; count: number; qualifiedCount?: number; conversionRate?: number }>;
  const outItems   = (outreach?.items ?? []) as Array<{ date: string; channel: string; sent: number; delivered: number; opened: number; replied: number; failed: number; bounced?: number; responseRate?: number }>;
  const pipeItems  = (pipeline?.items ?? []) as Array<{ stageName: string; leadCount: number; conversionRate: number; avgDays: number; avgDaysInStage?: number; dropOffRate?: number }>;
  const repItems   = (reps?.items     ?? []) as Array<{ repId: string; repName: string; leadsAssigned: number; leadsConverted: number; conversionRate: number; avgResponseTime: number; dealsClosed?: number; revenueEstimate?: number }>;
  const campItems  = (campaigns?.data ?? []) as Array<{ date: string; campaignId: string; campaignName: string; leadsTargeted: number; leadsConverted: number; conversionRate: number; channel: string }>;
  const intItems   = (integrations?.data ?? []) as Array<{ integrationId: string; name: string; displayName?: string; channel: string; status: string; enabled: boolean; lastTestedAt?: string; successRate: number }>;

  const totalSent    = outItems.reduce((s, r) => s + r.sent, 0);
  const totalReplied = outItems.reduce((s, r) => s + r.replied, 0);
  const avgReply     = totalSent > 0 ? ((totalReplied / totalSent) * 100).toFixed(1) : '—';
  const healthyInt   = intItems.filter((i) => i.status === 'healthy').length;

  // ── Lead source donut ──────────────────────────────────────────────────

  const leadSourceMap: Record<string, number> = {};
  leadItems.forEach((r) => {
    const src = r.source ?? 'Unknown';
    leadSourceMap[src] = (leadSourceMap[src] ?? 0) + Number(r.count);
  });
  const leadSourceData = Object.entries(leadSourceMap).map(([name, value]) => ({ name, value }));

  // ── Outreach multi-line data ───────────────────────────────────────────

  const outDateMap: Record<string, { date: string; sent: number; delivered: number; replied: number; failed: number }> = {};
  outItems.forEach((r) => {
    if (!outDateMap[r.date]) outDateMap[r.date] = { date: r.date, sent: 0, delivered: 0, replied: 0, failed: 0 };
    outDateMap[r.date].sent      += r.sent;
    outDateMap[r.date].delivered += r.delivered;
    outDateMap[r.date].replied   += r.replied;
    outDateMap[r.date].failed    += r.failed;
  });
  const outChartData = Object.values(outDateMap).sort((a, b) => a.date.localeCompare(b.date));

  // ── Campaign bar data ──────────────────────────────────────────────────

  const campMap: Record<string, { campaignName: string; leadsTargeted: number; leadsConverted: number }> = {};
  campItems.forEach((r) => {
    if (!campMap[r.campaignId]) campMap[r.campaignId] = { campaignName: r.campaignName, leadsTargeted: 0, leadsConverted: 0 };
    campMap[r.campaignId].leadsTargeted += r.leadsTargeted;
    campMap[r.campaignId].leadsConverted += r.leadsConverted;
  });
  const campChartData = Object.values(campMap).slice(0, 12);

  const intStatusColor = (s: string) => ({ healthy: 'green', degraded: 'amber', failing: 'red', disabled: 'slate' }[s] ?? 'slate');

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        eyebrow="Analytics"
        title="Reports"
        description="A-to-Z analytics: leads, outreach, pipeline, reps, campaigns, and integrations."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleExport} disabled={exportMutation.isPending}>
              {exportMutation.isPending ? <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
              Export CSV
            </Button>
          </div>
        }
      />

      {/* KPI bar */}
      {dashboard && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <KpiCard label="Total Leads"     value={dashboard.totalLeads.toLocaleString()}       accent="border-l-4 border-blue-500"   />
          <KpiCard label="Qualified"       value={dashboard.qualifiedLeads.toLocaleString()}    accent="border-l-4 border-amber-500"  />
          <KpiCard label="Active Outreach" value={dashboard.activeOutreach.toLocaleString()}    accent="border-l-4 border-cyan-500"   />
          <KpiCard label="Pipeline Conv."  value={`${(dashboard.pipelineConversion ?? 0).toFixed(1)}%`} accent="border-l-4 border-emerald-500" />
          <KpiCard label="Campaigns"       value={dashboard.activeCampaigns ?? dashboard.totalCampaigns ?? 0} accent="border-l-4 border-violet-500" />
          <KpiCard label="Reply Rate"      value={`${avgReply}%`}                              accent="border-l-4 border-pink-500"   sub={`${healthyInt} integrations healthy`} />
        </div>
      )}

      {/* Date filter */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Start</label>
            <input type="date" value={dateRange.start} onChange={(e) => setDateRange((p) => ({ ...p, start: e.target.value }))}
              className="h-9 rounded-md border border-slate-300 px-3 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">End</label>
            <input type="date" value={dateRange.end} onChange={(e) => setDateRange((p) => ({ ...p, end: e.target.value }))}
              className="h-9 rounded-md border border-slate-300 px-3 text-sm" />
          </div>
          <div className="flex gap-1.5">
            {[7, 30, 90].map((d) => (
              <Button key={d} size="sm" variant="outline" className="h-9 text-xs px-3"
                onClick={() => setDateRange(quickRange(d))}>
                Last {d}d
              </Button>
            ))}
            <Button size="sm" variant="ghost" className="h-9 text-xs px-3 flex items-center gap-1"
              onClick={() => setDateRange({ start: '', end: '' })}>
              <Calendar className="h-3 w-3" /> All time
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all
              ${tab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* ── Lead Generation ── */}
      {tab === 'leadgen' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Section title="Daily Lead Volume" description="Leads created per day">
              {leadItems.length ? (
                <BarChartGeneric
                  data={leadItems.map((r) => ({ date: String(r.date).slice(5), count: Number(r.count) }))}
                  xKey="date" yKey="count" color="#6366f1" />
              ) : <EmptyState icon={<BarChart3 className="h-5 w-5" />} title="No data" description="Select a date range." />}
            </Section>
            <Section title="Leads by Source" description="Distribution across channels">
              {leadSourceData.length
                ? <DonutChartWithLegend data={leadSourceData} />
                : <EmptyState icon={<BarChart3 className="h-5 w-5" />} title="No source data" description="Sources appear after leads are imported." />}
            </Section>
          </div>
          {leadItems.length > 0 && (
            <Section title="Lead Generation Detail">
              <Table
                headers={['Date', 'Source', 'Count', 'Qualified', 'Conv. Rate']}
                rows={leadItems.map((r) => [
                  r.date,
                  r.source ?? '—',
                  r.count,
                  r.qualifiedCount ?? '—',
                  r.conversionRate != null ? `${Number(r.conversionRate).toFixed(1)}%` : '—',
                ])}
              />
            </Section>
          )}
        </div>
      )}

      {/* ── Outreach ── */}
      {tab === 'outreach' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard label="Total Sent"      value={totalSent.toLocaleString()}    accent="border-l-4 border-cyan-500" />
            <KpiCard label="Delivered"       value={outItems.reduce((s,r)=>s+r.delivered,0).toLocaleString()} accent="border-l-4 border-emerald-500" />
            <KpiCard label="Replied"         value={totalReplied.toLocaleString()} accent="border-l-4 border-violet-500" />
            <KpiCard label="Reply Rate"      value={`${avgReply}%`}               accent="border-l-4 border-pink-500" />
          </div>
          <Section title="Outreach Activity Over Time" description="Sent · Delivered · Replied · Failed per day">
            {outChartData.length
              ? <MultiLineChart data={outChartData} xKey="date"
                  series={[
                    { key: 'sent',      label: 'Sent',      color: '#06b6d4' },
                    { key: 'delivered', label: 'Delivered', color: '#10b981' },
                    { key: 'replied',   label: 'Replied',   color: '#8b5cf6' },
                    { key: 'failed',    label: 'Failed',    color: '#ef4444' },
                  ]} />
              : <EmptyState icon={<BarChart3 className="h-5 w-5" />} title="No outreach data" description="Outreach logs appear after sequences run." />}
          </Section>
          {outItems.length > 0 && (
            <Section title="Outreach Detail by Channel">
              <Table
                headers={['Date', 'Channel', 'Sent', 'Delivered', 'Opened', 'Replied', 'Failed', 'Reply %']}
                rows={outItems.map((r) => [
                  r.date,
                  <Badge key="ch" color="blue">{r.channel}</Badge>,
                  r.sent, r.delivered, r.opened, r.replied, r.failed,
                  r.responseRate != null ? `${Number(r.responseRate).toFixed(1)}%` : '—',
                ])}
              />
            </Section>
          )}
        </div>
      )}

      {/* ── Pipeline ── */}
      {tab === 'pipeline' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Section title="Funnel View" description="Leads per stage with conversion & drop-off">
              {pipeItems.length
                ? <FunnelProgressBar stages={pipeItems} />
                : <EmptyState icon={<BarChart3 className="h-5 w-5" />} title="No pipeline data" description="Move leads through stages to see the funnel." />}
            </Section>
            <Section title="Leads by Stage">
              {pipeItems.length
                ? <HorizontalBarChart data={pipeItems} yKey="stageName" xKey="leadCount" color="#10b981" />
                : <EmptyState icon={<BarChart3 className="h-5 w-5" />} title="No stage data" description="Stages appear after leads are assigned." />}
            </Section>
          </div>
          {pipeItems.length > 0 && (
            <Section title="Pipeline Conversion Detail">
              <Table
                headers={['Stage', 'Leads', 'Conv. Rate', 'Drop-off', 'Avg Days in Stage', 'Avg Days to Win']}
                rows={pipeItems.map((r) => [
                  <span key="s" className="font-medium text-slate-800">{r.stageName}</span>,
                  r.leadCount,
                  `${r.conversionRate.toFixed(1)}%`,
                  r.dropOffRate != null ? `${r.dropOffRate.toFixed(1)}%` : '—',
                  r.avgDaysInStage != null ? `${r.avgDaysInStage.toFixed(1)}d` : '—',
                  `${r.avgDays.toFixed(1)}d`,
                ])}
              />
            </Section>
          )}
        </div>
      )}

      {/* ── Sales Reps ── */}
      {tab === 'reps' && (
        <div className="space-y-4">
          <Section title="Rep Leaderboard" description="Sorted by leads converted">
            {repItems.length ? (
              <HorizontalBarChart data={repItems} yKey="repName" xKey="leadsConverted" color="#f59e0b" />
            ) : <EmptyState icon={<BarChart3 className="h-5 w-5" />} title="No rep data" description="Assignment and conversion activity will populate this." />}
          </Section>
          {repItems.length > 0 && (
            <Section title="Rep Performance Detail">
              <Table
                headers={['#', 'Rep', 'Assigned', 'Converted', 'Conv. Rate', 'Deals Closed', 'Rev. Est.', 'Avg Response']}
                rows={repItems.map((r, i) => [
                  <span key="i" className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold
                    ${i === 0 ? 'bg-amber-100 text-amber-700' : i === 1 ? 'bg-slate-100 text-slate-600' : i === 2 ? 'bg-orange-100 text-orange-600' : 'text-slate-400'}`}>{i + 1}</span>,
                  <span key="n" className="font-medium text-slate-800">{r.repName}</span>,
                  r.leadsAssigned,
                  r.leadsConverted,
                  `${r.conversionRate.toFixed(1)}%`,
                  r.dealsClosed ?? '—',
                  r.revenueEstimate ? `₹${Number(r.revenueEstimate).toLocaleString()}` : '—',
                  `${r.avgResponseTime.toFixed(1)}h`,
                ])}
              />
            </Section>
          )}
        </div>
      )}

      {/* ── Campaigns ── */}
      {tab === 'campaigns' && (
        <div className="space-y-4">
          {campLoading ? (
            <div className="h-48 animate-pulse rounded-xl bg-slate-100" />
          ) : (
            <>
              <Section title="Leads Targeted per Campaign">
                {campChartData.length
                  ? <BarChartGeneric data={campChartData} xKey="campaignName" yKey="leadsTargeted" color="#8b5cf6" />
                  : <EmptyState icon={<BarChart3 className="h-5 w-5" />} title="No campaign data" description="Launch campaigns to populate analytics." />}
              </Section>
              {campItems.length > 0 && (
                <Section title="Campaign Detail">
                  <Table
                    headers={['Date', 'Campaign', 'Channel', 'Targeted', 'Converted', 'Conv. Rate']}
                    rows={campItems.map((r) => [
                      r.date,
                      <span key="n" className="font-medium text-slate-800">{r.campaignName}</span>,
                      <Badge key="ch" color="blue">{r.channel}</Badge>,
                      r.leadsTargeted,
                      r.leadsConverted,
                      `${(Number(r.conversionRate) * (Number(r.conversionRate) > 1 ? 1 : 100)).toFixed(1)}%`,
                    ])}
                  />
                </Section>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Integrations ── */}
      {tab === 'integrations' && (
        <div className="space-y-4">
          {intLoading ? (
            <div className="h-48 animate-pulse rounded-xl bg-slate-100" />
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Section title="Status Overview" description="Healthy · Degraded · Failing · Disabled">
                  {intItems.length
                    ? <IntegrationStatusPie integrations={intItems} />
                    : <EmptyState icon={<Link2 className="h-5 w-5" />} title="No integrations" description="Configure connectors to see health analytics." />}
                </Section>
                <Section title="Success Rate by Provider">
                  {intItems.length
                    ? <HorizontalBarChart
                        data={intItems.map((i) => ({ name: i.displayName ?? i.name, successRate: i.successRate }))}
                        yKey="name" xKey="successRate" color="#06b6d4" />
                    : <EmptyState icon={<BarChart3 className="h-5 w-5" />} title="No data" description="Run outreach through integrations to see success rates." />}
                </Section>
              </div>
              {intItems.length > 0 && (
                <Section title="Integration Health Detail">
                  <Table
                    headers={['Provider', 'Status', 'Enabled', 'Success Rate', 'Last Tested']}
                    rows={intItems.map((r) => [
                      <span key="n" className="font-medium text-slate-800">{r.displayName ?? r.name}</span>,
                      <Badge key="s" color={intStatusColor(r.status)}>{r.status}</Badge>,
                      r.enabled ? <Badge key="e" color="green">Yes</Badge> : <Badge key="e" color="slate">No</Badge>,
                      `${r.successRate.toFixed(1)}%`,
                      r.lastTestedAt ? new Date(r.lastTestedAt).toLocaleString() : '—',
                    ])}
                  />
                </Section>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

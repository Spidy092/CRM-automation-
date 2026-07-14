import { useState } from 'react';
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
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
import { BarChart3, Download, FileText, RefreshCw } from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';
import { BarChartGeneric, IntegrationStatusPie, LineChartGeneric } from '@/components/reports/AnalyticsCharts';
import { CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ReportListFilters } from '@/types';

type ReportTab = 'leadgen' | 'outreach' | 'pipeline' | 'reps' | 'campaigns' | 'integrations';

const tabs: { key: ReportTab; label: string }[] = [
  { key: 'leadgen', label: 'Lead Generation' },
  { key: 'outreach', label: 'Outreach' },
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'reps', label: 'Sales Reps' },
  { key: 'campaigns', label: 'Campaigns' },
  { key: 'integrations', label: 'Integrations' },
];

export function ReportsPage() {
  const [activeTab, setActiveTab] = useState<ReportTab>('leadgen');
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({ start: '', end: '' });

  const filters: ReportListFilters = {
    limit: 50,
    offset: 0,
    ...(dateRange.start ? { startDate: dateRange.start } : {}),
    ...(dateRange.end ? { endDate: dateRange.end } : {}),
  };

  const { data: dashboard } = useDashboardMetrics();
  const { data: leadGen } = useLeadGenerationReport(filters);
  const { data: outreach } = useOutreachReport(filters);
  const { data: pipeline } = usePipelineReport(filters);
  const { data: reps } = useSalesRepReport(filters);
  const {
    data: campaigns,
    isLoading: campaignsLoading,
    isError: campaignsError,
  } = useCampaignAnalytics(filters);
  const {
    data: integrations,
    isLoading: integrationsLoading,
    isError: integrationsError,
  } = useIntegrationAnalytics();

  const exportMutation = useExportReport();
  const { showToast } = useToast();

  const handleExport = (reportType: string) => {
    exportMutation.mutate(
      {
        reportType,
        format: 'csv',
        filters: dateRange.start ? { startDate: dateRange.start, endDate: dateRange.end } : undefined,
      },
      {
        onSuccess: () => showToast('Export queued — check the exports directory.', 'success'),
        onError: (err) => showToast(getApiErrorMessage(err, 'Export failed.'), 'error'),
      },
    );
  };

  const getExportType = (tab: ReportTab): string => {
    switch (tab) {
      case 'leadgen':
        return 'leads';
      case 'reps':
        return 'reps';
      case 'campaigns':
        return 'campaigns';
      case 'integrations':
        return 'integrations';
      default:
        return tab;
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Analytics"
        title="Reports"
        description="Analyze lead generation, outreach performance, pipeline conversion, sales rep activity, campaigns, and integration health."
        actions={
          <Button onClick={() => handleExport(getExportType(activeTab))} disabled={exportMutation.isPending}>
            {exportMutation.isPending ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Export CSV
          </Button>
        }
      />

      {/* KPI Cards */}
      {dashboard && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total Leads</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{dashboard.totalLeads}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Qualified</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{dashboard.qualifiedLeads}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Active Outreach</p>
            <p className="mt-1 text-2xl font-bold text-indigo-600">{dashboard.activeOutreach}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Pipeline Conv.</p>
            <p className="mt-1 text-2xl font-bold text-amber-600">{(dashboard.pipelineConversion ?? 0).toFixed(1)}%</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Active Campaigns</p>
            <p className="mt-1 text-2xl font-bold text-violet-600">{dashboard.activeCampaigns ?? 0}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Healthy Integrations</p>
            <p className="mt-1 text-2xl font-bold text-teal-600">{dashboard.healthyIntegrations ?? 0}</p>
          </div>
        </div>
      )}

      {/* Date Filter */}
      <Card>
        <CardContent className="flex flex-col gap-4 pt-5 sm:flex-row sm:items-end">
        <div>
          <label className="block text-xs font-medium text-slate-500">Start</label>
          <input
            type="date"
            value={dateRange.start}
            onChange={(e) => setDateRange((prev) => ({ ...prev, start: e.target.value }))}
            className="mt-1 h-10 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500">End</label>
          <input
            type="date"
            value={dateRange.end}
            onChange={(e) => setDateRange((prev) => ({ ...prev, end: e.target.value }))}
            className="mt-1 h-10 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <Button
          variant="outline"
          onClick={() => setDateRange({ start: '', end: '' })}
          className="sm:ml-auto"
        >
          Clear
        </Button>
        </CardContent>
      </Card>

      {/* Tab Bar */}
      <div className="grid gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm sm:grid-cols-6">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <Card><CardContent className="pt-5">
        {activeTab === 'leadgen' && (
          <div className="p-6">
            <h3 className="mb-4 text-base font-semibold text-slate-900">Lead Generation</h3>
            <Card className="mb-6">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-slate-700">Leads by Date</CardTitle>
                <CardDescription className="text-xs">Daily lead volume for the selected range</CardDescription>
              </CardHeader>
              <CardContent>
                {leadGen?.items?.length ? (
                  <BarChartGeneric
                    data={leadGen.items.map((r) => ({ date: r.date, count: Number(r.count) }))}
                    xKey="date"
                    yKey="count"
                    color="#6366f1"
                  />
                ) : (
                  <EmptyState icon={<BarChart3 className="h-6 w-6" />} title="No chart data" description="Select a date range with lead activity." />
                )}
              </CardContent>
            </Card>
            {leadGen?.items?.length ? (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 uppercase tracking-wider">
                    <th className="pb-3 pr-4">Date</th>
                    <th className="pb-3 pr-4">Source</th>
                    <th className="pb-3">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {(leadGen.items as Array<{ date: string; source: string; count: number }>).map((row, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="py-3 pr-4 text-slate-700">{row.date}</td>
                      <td className="py-3 pr-4 text-slate-700">{row.source}</td>
                      <td className="py-3 font-medium">{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState icon={<FileText className="h-6 w-6" />} title="No lead generation data" description="Adjust the date range or wait for lead source activity." />
            )}
          </div>
        )}

        {activeTab === 'outreach' && (
          <div className="p-6">
            <h3 className="mb-4 text-base font-semibold text-slate-900">Outreach Performance</h3>
            <Card className="mb-6">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-slate-700">Messages Sent</CardTitle>
                <CardDescription className="text-xs">Daily outreach volume</CardDescription>
              </CardHeader>
              <CardContent>
                {outreach?.items?.length ? (
                  <LineChartGeneric
                    data={outreach.items.map((r) => ({ date: r.date, sent: Number(r.sent) }))}
                    xKey="date"
                    yKey="sent"
                    color="#0ea5e9"
                  />
                ) : (
                  <EmptyState icon={<BarChart3 className="h-6 w-6" />} title="No chart data" description="Select a date range with outreach activity." />
                )}
              </CardContent>
            </Card>
            {outreach?.items?.length ? (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 uppercase tracking-wider">
                    <th className="pb-3 pr-4">Date</th>
                    <th className="pb-3 pr-4">Channel</th>
                    <th className="pb-3 pr-4">Sent</th>
                    <th className="pb-3 pr-4">Delivered</th>
                    <th className="pb-3 pr-4">Opened</th>
                    <th className="pb-3 pr-4">Replied</th>
                    <th className="pb-3">Failed</th>
                  </tr>
                </thead>
                <tbody>
                  {(outreach.items as Array<{ date: string; channel: string; sent: number; delivered: number; opened: number; replied: number; failed: number }>).map((row, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="py-3 pr-4 text-slate-700">{row.date}</td>
                      <td className="py-3 pr-4">
                        <StatusBadge>{row.channel}</StatusBadge>
                      </td>
                      <td className="py-3 pr-4">{row.sent}</td>
                      <td className="py-3 pr-4">{row.delivered}</td>
                      <td className="py-3 pr-4">{row.opened}</td>
                      <td className="py-3 pr-4">{row.replied}</td>
                      <td className="py-3">{row.failed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState icon={<BarChart3 className="h-6 w-6" />} title="No outreach data" description="Outreach reports appear after sequence jobs send messages or create tasks." />
            )}
          </div>
        )}

        {activeTab === 'pipeline' && (
          <div className="p-6">
            <h3 className="mb-4 text-base font-semibold text-slate-900">Pipeline Conversion</h3>
            <Card className="mb-6">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-slate-700">Leads per Stage</CardTitle>
                <CardDescription className="text-xs">Current distribution across pipeline stages</CardDescription>
              </CardHeader>
              <CardContent>
                {pipeline?.items?.length ? (
                  <BarChartGeneric
                    data={pipeline.items.map((r) => ({ stageName: r.stageName, leadCount: Number(r.leadCount) }))}
                    xKey="stageName"
                    yKey="leadCount"
                    color="#10b981"
                  />
                ) : (
                  <EmptyState icon={<BarChart3 className="h-6 w-6" />} title="No chart data" description="Move leads through pipeline stages to populate this chart." />
                )}
              </CardContent>
            </Card>
            {pipeline?.items?.length ? (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 uppercase tracking-wider">
                    <th className="pb-3 pr-4">Stage</th>
                    <th className="pb-3 pr-4">Leads</th>
                    <th className="pb-3 pr-4">Conv. Rate</th>
                    <th className="pb-3">Avg Days</th>
                  </tr>
                </thead>
                <tbody>
                  {(pipeline.items as Array<{ stageName: string; leadCount: number; conversionRate: number; avgDays: number }>).map((row, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="py-3 pr-4 text-slate-700 font-medium">{row.stageName}</td>
                      <td className="py-3 pr-4">{row.leadCount}</td>
                      <td className="py-3 pr-4">{(row.conversionRate ?? 0).toFixed(1)}%</td>
                      <td className="py-3">{(row.avgDays ?? 0).toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState icon={<BarChart3 className="h-6 w-6" />} title="No pipeline data" description="Move leads through pipeline stages to populate conversion reporting." />
            )}
          </div>
        )}

        {activeTab === 'reps' && (
          <div className="p-6">
            <h3 className="mb-4 text-base font-semibold text-slate-900">Sales Rep Performance</h3>
            <Card className="mb-6">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-slate-700">Assigned Leads</CardTitle>
                <CardDescription className="text-xs">Leads assigned to each rep</CardDescription>
              </CardHeader>
              <CardContent>
                {reps?.items?.length ? (
                  <BarChartGeneric
                    data={reps.items.map((r) => ({ repName: r.repName, leadsAssigned: Number(r.leadsAssigned) }))}
                    xKey="repName"
                    yKey="leadsAssigned"
                    color="#f59e0b"
                  />
                ) : (
                  <EmptyState icon={<BarChart3 className="h-6 w-6" />} title="No chart data" description="Assignments will populate this chart." />
                )}
              </CardContent>
            </Card>
            {reps?.items?.length ? (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 uppercase tracking-wider">
                    <th className="pb-3 pr-4">Rep</th>
                    <th className="pb-3 pr-4">Assigned</th>
                    <th className="pb-3 pr-4">Converted</th>
                    <th className="pb-3 pr-4">Conv. Rate</th>
                    <th className="pb-3">Avg Response</th>
                  </tr>
                </thead>
                <tbody>
                  {(reps.items as Array<{ repName: string; leadsAssigned: number; leadsConverted: number; conversionRate: number; avgResponseTime: number }>).map((row, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="py-3 pr-4 text-slate-700 font-medium">{row.repName}</td>
                      <td className="py-3 pr-4">{row.leadsAssigned}</td>
                      <td className="py-3 pr-4">{row.leadsConverted}</td>
                      <td className="py-3 pr-4">{(row.conversionRate ?? 0).toFixed(1)}%</td>
                      <td className="py-3">{(row.avgResponseTime ?? 0).toFixed(1)}h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState icon={<FileText className="h-6 w-6" />} title="No sales rep data" description="Assignment and conversion activity will populate this report." />
            )}
          </div>
        )}

        {activeTab === 'campaigns' && (
          <div className="p-6">
            <h3 className="mb-4 text-base font-semibold text-slate-900">Campaign Analytics</h3>
            {campaignsLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : campaignsError ? (
              <ErrorState message="Failed to load campaign analytics." />
            ) : (
              <Card className="mb-6">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-slate-700">Leads Targeted</CardTitle>
                  <CardDescription className="text-xs">Per-campaign outreach reach</CardDescription>
                </CardHeader>
                <CardContent>
                  {campaigns?.data?.length ? (
                    <BarChartGeneric
                      data={campaigns.data.map((r) => ({
                        campaignName: r.campaignName,
                        leadsTargeted: Number(r.leadsTargeted),
                      }))}
                      xKey="campaignName"
                      yKey="leadsTargeted"
                      color="#8b5cf6"
                    />
                  ) : (
                    <EmptyState icon={<BarChart3 className="h-6 w-6" />} title="No campaign data" description="Launch campaigns to populate analytics." />
                  )}
                </CardContent>
              </Card>
            )}
            {!campaignsLoading && !campaignsError && campaigns?.data?.length ? (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 uppercase tracking-wider">
                    <th className="pb-3 pr-4">Date</th>
                    <th className="pb-3 pr-4">Campaign</th>
                    <th className="pb-3 pr-4">Channel</th>
                    <th className="pb-3 pr-4">Targeted</th>
                    <th className="pb-3 pr-4">Converted</th>
                    <th className="pb-3">Conv. Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.data.map((row, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="py-3 pr-4 text-slate-700">{row.date}</td>
                      <td className="py-3 pr-4 font-medium">{row.campaignName}</td>
                      <td className="py-3 pr-4"><StatusBadge>{row.channel}</StatusBadge></td>
                      <td className="py-3 pr-4">{row.leadsTargeted}</td>
                      <td className="py-3 pr-4">{row.leadsConverted}</td>
                      <td className="py-3">{((row.conversionRate ?? 0) * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : !campaignsLoading && !campaignsError ? (
              <EmptyState icon={<FileText className="h-6 w-6" />} title="No campaign data" description="Launch campaigns to populate this report." />
            ) : null}
          </div>
        )}

        {activeTab === 'integrations' && (
          <div className="p-6">
            <h3 className="mb-4 text-base font-semibold text-slate-900">Integration Health</h3>
            {integrationsLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : integrationsError ? (
              <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">Failed to load integration health.</div>
            ) : (
              <Card className="mb-6">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-slate-700">Status Overview</CardTitle>
                  <CardDescription className="text-xs">Healthy vs degraded vs failing integrations</CardDescription>
                </CardHeader>
                <CardContent>
                  {integrations?.data?.length ? (
                    <IntegrationStatusPie integrations={integrations.data} />
                  ) : (
                    <EmptyState icon={<BarChart3 className="h-6 w-6" />} title="No integration data" description="Configure integrations to populate health analytics." />
                  )}
                </CardContent>
              </Card>
            )}
            {!integrationsLoading && !integrationsError && integrations?.data?.length ? (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 uppercase tracking-wider">
                    <th className="pb-3 pr-4">Integration</th>
                    <th className="pb-3 pr-4">Channel</th>
                    <th className="pb-3 pr-4">Status</th>
                    <th className="pb-3 pr-4">Enabled</th>
                    <th className="pb-3 pr-4">Success Rate</th>
                    <th className="pb-3">Last Tested</th>
                  </tr>
                </thead>
                <tbody>
                  {integrations.data.map((row, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="py-3 pr-4 font-medium">{row.displayName ?? row.name}</td>
                      <td className="py-3 pr-4"><StatusBadge>{row.channel}</StatusBadge></td>
                      <td className="py-3 pr-4"><StatusBadge>{row.status}</StatusBadge></td>
                      <td className="py-3 pr-4">{row.enabled ? 'Yes' : 'No'}</td>
                      <td className="py-3 pr-4">{(row.successRate ?? 0).toFixed(1)}%</td>
                      <td className="py-3">{row.lastTestedAt ? new Date(row.lastTestedAt).toLocaleString() : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : !integrationsLoading && !integrationsError ? (
              <EmptyState icon={<FileText className="h-6 w-6" />} title="No integration data" description="Configure integrations to populate this report." />
            ) : null}
          </div>
        )}
      </CardContent></Card>

      {exportMutation.isPending && (
        <div className="rounded-lg bg-blue-50 p-4 text-sm text-blue-700">
          Export job queued — check the exports directory for the file.
        </div>
      )}
      {exportMutation.isError && (
        <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
          Export failed: {(exportMutation.error as Error).message}
        </div>
      )}
    </div>
  );
}

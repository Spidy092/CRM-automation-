import { useState } from 'react';
import {
  useDashboardMetrics,
  useLeadGenerationReport,
  useOutreachReport,
  usePipelineReport,
  useSalesRepReport,
  useExportReport,
} from '@/api/reports';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { BarChart3, Download, FileText, RefreshCw } from 'lucide-react';
import type { ReportListFilters } from '@/types';

type ReportTab = 'leadgen' | 'outreach' | 'pipeline' | 'reps';
// Type removed as it was unused

const tabs: { key: ReportTab; label: string }[] = [
  { key: 'leadgen', label: 'Lead Generation' },
  { key: 'outreach', label: 'Outreach' },
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'reps', label: 'Sales Reps' },
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

  const exportMutation = useExportReport();

  const handleExport = (reportType: string) => {
    exportMutation.mutate({
      reportType,
      format: 'csv',
      filters: dateRange.start ? { startDate: dateRange.start, endDate: dateRange.end } : undefined,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Analytics"
        title="Reports"
        description="Analyze lead generation, outreach performance, pipeline conversion, and sales rep activity."
        actions={
          <Button onClick={() => handleExport(activeTab === 'leadgen' ? 'leads' : activeTab)} disabled={exportMutation.isPending}>
            {exportMutation.isPending ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Export CSV
          </Button>
        }
      />

      {/* KPI Cards */}
      {dashboard && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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
            <p className="mt-1 text-2xl font-bold text-amber-600">{dashboard.pipelineConversion.toFixed(1)}%</p>
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
      <div className="grid gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm sm:grid-cols-4">
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
                      <td className="py-3 pr-4">{row.conversionRate.toFixed(1)}%</td>
                      <td className="py-3">{row.avgDays.toFixed(1)}</td>
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
                      <td className="py-3 pr-4">{row.conversionRate.toFixed(1)}%</td>
                      <td className="py-3">{row.avgResponseTime.toFixed(1)}h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState icon={<FileText className="h-6 w-6" />} title="No sales rep data" description="Assignment and conversion activity will populate this report." />
            )}
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

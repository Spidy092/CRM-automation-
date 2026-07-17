import { useMemo, useState } from 'react';
import { useTeamMetrics } from '@/api/teamMetrics';
import { usePipelines } from '@/api/pipelines';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { Users, UserCheck, Clock, Activity, BarChart3, Search, RefreshCw } from 'lucide-react';
import type { MemberMetrics } from '@/types';

function toUtcStartOfDay(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0)).toISOString();
}

function toUtcEndOfDay(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999)).toISOString();
}

function calculateSummary(metrics: MemberMetrics[]) {
  const totalLeads = metrics.reduce((sum, m) => sum + m.assigned_count, 0);
  const contactedLeads = metrics.reduce((sum, m) => sum + m.contacted_count, 0);
  const totalActivities = metrics.reduce((sum, m) => sum + m.total_activities, 0);

  const totalResponseTime = metrics.reduce(
    (sum, m) => sum + (m.avg_response_time ?? 0) * m.contacted_count,
    0,
  );
  const avgResponseTime = contactedLeads > 0 ? totalResponseTime / contactedLeads : 0;

  return {
    totalLeads,
    contactedLeads,
    avgResponseTime,
    totalActivities,
  };
}

export function TeamDashboardPage() {
  const [inputFrom, setInputFrom] = useState('');
  const [inputTo, setInputTo] = useState('');
  const [inputStage, setInputStage] = useState('');

  const [from, setFrom] = useState<string | undefined>(undefined);
  const [to, setTo] = useState<string | undefined>(undefined);
  const [stage, setStage] = useState<string | undefined>(undefined);

  const { data: pipelines } = usePipelines();
  const { data: metrics, isLoading, isError, refetch, isFetching } = useTeamMetrics(from, to, stage);

  const allStages = useMemo(() => {
    if (!pipelines) return [];
    return pipelines.flatMap((p) =>
      p.stages.map((s) => ({ id: s.id, name: s.name, pipelineName: p.name })),
    );
  }, [pipelines]);

  const summary = useMemo(() => {
    if (!metrics || metrics.length === 0) return null;
    return calculateSummary(metrics);
  }, [metrics]);

  const handleApply = () => {
    setFrom(inputFrom ? toUtcStartOfDay(inputFrom) : undefined);
    setTo(inputTo ? toUtcEndOfDay(inputTo) : undefined);
    setStage(inputStage || undefined);
  };

  const handleClear = () => {
    setInputFrom('');
    setInputTo('');
    setInputStage('');
    setFrom(undefined);
    setTo(undefined);
    setStage(undefined);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Intelligence"
        title="Team Dashboard"
        description="Track per-member outreach activity, response times, and pipeline contribution."
      />

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-col gap-4 pt-5 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="team-from" className="block text-xs font-medium text-slate-500">
              From
            </label>
            <Input
              id="team-from"
              type="date"
              value={inputFrom}
              onChange={(e) => setInputFrom(e.target.value)}
              className="mt-1"
            />
          </div>
          <div className="flex-1">
            <label htmlFor="team-to" className="block text-xs font-medium text-slate-500">
              To
            </label>
            <Input
              id="team-to"
              type="date"
              value={inputTo}
              onChange={(e) => setInputTo(e.target.value)}
              className="mt-1"
            />
          </div>
          <div className="flex-1">
            <label htmlFor="team-stage" className="block text-xs font-medium text-slate-500">
              Stage
            </label>
            <select
              id="team-stage"
              value={inputStage}
              onChange={(e) => setInputStage(e.target.value)}
              className="mt-1 flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
            >
              <option value="">All Stages</option>
              {allStages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.pipelineName} / {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleApply}>Apply</Button>
            <Button variant="outline" onClick={handleClear}>
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-slate-500">Total Leads</CardTitle>
              <Users className="h-4 w-4 text-slate-400" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-slate-900">{summary.totalLeads}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-slate-500">Contacted Leads</CardTitle>
              <UserCheck className="h-4 w-4 text-slate-400" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-emerald-600">{summary.contactedLeads}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-slate-500">Avg Response Time</CardTitle>
              <Clock className="h-4 w-4 text-slate-400" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-indigo-600">
                {summary.avgResponseTime > 0 ? `${Math.round(summary.avgResponseTime)}s` : '—'}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-slate-500">Total Activities</CardTitle>
              <Activity className="h-4 w-4 text-slate-400" />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-amber-600">{summary.totalActivities}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Per-member performance</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : isError ? (
            <EmptyState
              icon={<Search className="h-6 w-6" />}
              title="Failed to load team metrics"
              description="There was an error fetching the team dashboard. Try adjusting the filters or retry later."
              action={
                <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
                  <RefreshCw className="h-3.5 w-3.5" />
                  Retry
                </Button>
              }
            />
          ) : metrics && metrics.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Total Leads</TableHead>
                    <TableHead>Contacted</TableHead>
                    <TableHead>Contacted %</TableHead>
                    <TableHead>Avg Response Time</TableHead>
                    <TableHead>Total Activities</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metrics.map((member) => (
                    <TableRow key={member.user_id}>
                      <TableCell className="font-medium text-slate-900">{member.name}</TableCell>
                      <TableCell>{member.assigned_count}</TableCell>
                      <TableCell>{member.contacted_count}</TableCell>
                      <TableCell>
                        {member.contacted_pct != null ? `${member.contacted_pct.toFixed(1)}%` : '—'}
                      </TableCell>
                      <TableCell>
                        {member.avg_response_time != null && member.avg_response_time > 0
                          ? `${Math.round(member.avg_response_time)}s`
                          : '—'}
                      </TableCell>
                      <TableCell>{member.total_activities}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <EmptyState
              icon={<BarChart3 className="h-6 w-6" />}
              title="No team data"
              description="Try selecting a different date range or stage filter."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

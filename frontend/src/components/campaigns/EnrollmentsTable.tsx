import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useCampaignEnrollments,
  usePauseEnrollment,
  useResumeEnrollment,
  useRetryLeadOutreachStep,
  type EnrollmentProgressItem,
} from '@/api/campaigns';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingTable } from '@/components/ui/LoadingTable';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
import { Users, Search, Pause, Play, RotateCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { isOverdue, waitingReasonLabel } from './operationsLabels';

interface Props {
  campaignId: string;
}

/** Server-paginated enrollment progress with search and per-lead controls. */
export function EnrollmentsTable({ campaignId }: Props) {
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState<string | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  // Cursor stack for server-side keyset pages; reset whenever filters change.
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const cursor = cursors[cursors.length - 1] ?? undefined;
  const { showToast } = useToast();
  const pauseEnrollment = usePauseEnrollment();
  const resumeEnrollment = useResumeEnrollment();
  const retryStep = useRetryLeadOutreachStep();

  const {
    data,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useCampaignEnrollments(campaignId, {
    ...(appliedSearch ? { search: appliedSearch } : {}),
    ...(statusFilter ? { enrollmentStatus: statusFilter } : {}),
    ...(cursor ? { cursor } : {}),
  });
  const items = data?.items ?? [];

  const applySearch = () => {
    setAppliedSearch(search.trim() || undefined);
    setCursors([null]);
  };

  const handlePause = async (item: EnrollmentProgressItem) => {
    try {
      await pauseEnrollment.mutateAsync({
        campaignId,
        leadId: item.leadId,
        expectedGeneration: item.schedulingGeneration,
      });
      showToast('Lead paused. The campaign resume will not resume this lead.', 'success');
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to pause this lead.'), 'error');
    }
  };

  const handleResume = async (item: EnrollmentProgressItem) => {
    try {
      await resumeEnrollment.mutateAsync({
        campaignId,
        leadId: item.leadId,
        expectedGeneration: item.schedulingGeneration,
      });
      showToast('Lead resumed.', 'success');
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to resume this lead.'), 'error');
    }
  };

  const handleRetry = async (leadId: string) => {
    try {
      await retryStep.mutateAsync({ campaignId, leadId });
      showToast('Retry queued — the message will be re-sent shortly.', 'success');
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to retry this send.'), 'error');
    }
  };

  return (
    <Card aria-labelledby="enrollments-title">
      <CardHeader>
        <CardTitle id="enrollments-title" className="text-lg">
          Enrolled Leads & Progress
        </CardTitle>
        <CardDescription>
          Per-lead next action and waiting reason, served by the backend.
        </CardDescription>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <label htmlFor="enrollment-search" className="sr-only">
            Search enrolled leads
          </label>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
            <input
              id="enrollment-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applySearch();
              }}
              placeholder="Search by name or email…"
              className="w-full rounded-md border border-slate-200 py-2 pl-9 pr-3 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={applySearch}>
              Search
            </Button>
            <label htmlFor="enrollment-status" className="sr-only">
              Filter by enrollment status
            </label>
            <select
              id="enrollment-status"
              value={statusFilter ?? ''}
              onChange={(e) => {
                setStatusFilter(e.target.value || undefined);
                setCursors([null]);
              }}
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm"
            >
              <option value="">All states</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="completed">Completed</option>
              <option value="stopped">Stopped</option>
            </select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <LoadingTable rows={3} cols={5} />
        ) : isError ? (
          <ErrorState
            title="Could not load enrollments"
            message="Lead progress is unavailable right now."
            onRetry={() => refetch()}
          />
        ) : items.length > 0 ? (
          <>
            {isFetching && (
              <div className="mb-2 text-xs text-slate-400" aria-live="off">
                Updating…
              </div>
            )}
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">Lead</th>
                    <th scope="col" className="px-4 py-3 font-medium">Progress</th>
                    <th scope="col" className="px-4 py-3 font-medium">Next action</th>
                    <th scope="col" className="px-4 py-3 font-medium">Waiting reason</th>
                    <th scope="col" className="px-4 py-3 font-medium">Last activity</th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((item) => (
                    <tr key={item.leadId} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3">
                        <Link
                          to={`/leads/${item.leadId}`}
                          className="font-medium text-indigo-600 hover:underline"
                        >
                          {item.businessName || item.contactName || 'Unknown Lead'}
                        </Link>
                        <div className="text-xs capitalize text-slate-500">
                          {item.leadStatus} · {item.enrollmentStatus}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {item.totalSteps != null
                          ? `${item.completedSteps}/${item.totalSteps} steps`
                          : `${item.completedSteps} done`}
                      </td>
                      <td className="px-4 py-3">
                        {item.nextAction ? (
                          <div>
                            <div className="font-medium text-slate-900">
                              Step {item.nextAction.stepNumber} · {item.nextAction.channel}
                              {item.nextAction.kind === 'projected' && (
                                <span className="ml-1 text-xs font-normal text-slate-400">(projected)</span>
                              )}
                            </div>
                            <div
                              className={`text-xs ${item.nextAction.dueAt && isOverdue(item.nextAction.dueAt) ? 'font-medium text-amber-700' : 'text-slate-500'}`}
                            >
                              {item.nextAction.dueLabel ??
                                (item.timingUnknown
                                  ? 'Timing unknown — resume with a schedule'
                                  : 'Not scheduled')}
                              {item.nextAction.dueAt && isOverdue(item.nextAction.dueAt) && ' · overdue'}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {item.terminalReason ? (
                          <span className="text-xs">{item.terminalReason}</span>
                        ) : (
                          <span title={item.waitingDetail ?? undefined} className="text-xs">
                            {waitingReasonLabel(item.waitingReason)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {item.lastActivity
                          ? `${new Date(item.lastActivity.at).toLocaleString()} · ${item.lastActivity.status}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          {item.actions.pause && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => handlePause(item)}
                              aria-label={`Pause lead ${item.businessName ?? item.leadId}`}
                            >
                              <Pause className="mr-1 h-3 w-3" />
                              Pause
                            </Button>
                          )}
                          {item.actions.resume && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => handleResume(item)}
                              aria-label={`Resume lead ${item.businessName ?? item.leadId}`}
                            >
                              <Play className="mr-1 h-3 w-3" />
                              Resume
                            </Button>
                          )}
                          {item.actions.retry && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => handleRetry(item.leadId)}
                            >
                              <RotateCw className="mr-1 h-3 w-3" />
                              Retry
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(data?.hasMore || cursors.length > 1) && (
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  {isFetching ? 'Loading…' : `Page ${cursors.length}`}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={() => setCursors((prev) => prev.slice(0, -1))}
                    disabled={cursors.length <= 1}
                    aria-label="Previous enrollments page"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={() => {
                      if (data?.nextCursor) setCursors((prev) => [...prev, data.nextCursor]);
                    }}
                    disabled={!data?.hasMore || !data?.nextCursor}
                    aria-label="Next enrollments page"
                  >
                    <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : (
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title="No leads enrolled"
            description={
              appliedSearch || statusFilter
                ? 'No enrollments match the current search or filter.'
                : 'No leads have been enrolled in this campaign yet.'
            }
          />
        )}
      </CardContent>
    </Card>
  );
}

import { useCampaignOperations } from '@/api/campaigns';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingTable } from '@/components/ui/LoadingTable';
import { Clock, CalendarClock, Users, Send, AlertTriangle, Inbox } from 'lucide-react';
import { freshnessLabel, waitingReasonLabel } from './operationsLabels';

interface Props {
  campaignId: string;
}

/**
 * Operations overview: what happens next, when (with timezone), for how
 * many recipients, how many potential messages remain, capacity, and why
 * anything is waiting. All times come from backend scheduling calculations.
 */
export function OperationsOverview({ campaignId }: Props) {
  const {
    data: operations,
    isLoading,
    isError,
    refetch,
    isFetching,
    dataUpdatedAt,
    isStale,
  } = useCampaignOperations(campaignId);

  return (
    <Card aria-labelledby="operations-overview-title">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle id="operations-overview-title" className="text-lg">
              Next Activity
            </CardTitle>
            <CardDescription>
              Estimated sends from backend scheduling — never inferred in the browser.
            </CardDescription>
          </div>
          {dataUpdatedAt > 0 && (
            <span className="shrink-0 text-xs text-slate-400" aria-live="off">
              Updated {freshnessLabel(dataUpdatedAt)}
              {isFetching ? ' · updating…' : ''}
              {isStale && !isFetching ? ' · may be stale' : ''}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <LoadingTable rows={2} cols={3} />
        ) : isError || !operations ? (
          <ErrorState
            title="Could not load scheduling"
            message="Operational data is unavailable. Campaign sending is unaffected."
            onRetry={() => refetch()}
          />
        ) : (
          <div className="space-y-4">
            {operations.nextActivity ? (
              <div
                className="rounded-xl border border-indigo-200 bg-indigo-50 p-4"
                aria-live="polite"
              >
                <div className="flex items-center gap-2 text-indigo-700">
                  <CalendarClock className="h-4 w-4" aria-hidden="true" />
                  <span className="text-sm font-medium">
                    Next: Step {operations.nextActivity.stepNumber} · {operations.nextActivity.channel}
                  </span>
                </div>
                <div className="mt-1 text-lg font-semibold text-indigo-900">
                  Estimated {operations.nextActivity.dueLabel}
                </div>
                <div className="mt-1 text-sm text-indigo-700">
                  {operations.nextActivity.businessName ?? 'Recipient'}
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<Inbox className="h-6 w-6" />}
                title="No scheduled sends"
                description={
                  operations.status === 'paused'
                    ? 'The campaign is paused. Resume it to recompute scheduled sends.'
                    : operations.durable
                      ? 'Nothing is currently scheduled. New enrollments will appear here.'
                      : 'Scheduling details appear after the durable scheduling upgrade. Counts below still reflect recorded sends.'
                }
              />
            )}

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="rounded-xl border bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-slate-500">
                  <Clock className="h-4 w-4" aria-hidden="true" />
                  <span className="text-sm font-medium">Scheduled</span>
                </div>
                <div className="mt-2 text-2xl font-semibold text-slate-900">
                  {operations.scheduledCount}
                </div>
                <div className="mt-1 text-xs text-slate-500">next-step sends</div>
              </div>
              <div className="rounded-xl border bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-slate-500">
                  <Users className="h-4 w-4" aria-hidden="true" />
                  <span className="text-sm font-medium">Potential left</span>
                </div>
                <div className="mt-2 text-2xl font-semibold text-slate-900">
                  {operations.potentialRemaining}
                </div>
                <div className="mt-1 text-xs text-slate-500">future sends if no stops</div>
              </div>
              <div className="rounded-xl border bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-slate-500">
                  <Send className="h-4 w-4" aria-hidden="true" />
                  <span className="text-sm font-medium">Sent today</span>
                </div>
                <div className="mt-2 text-2xl font-semibold text-slate-900">
                  {operations.dailyLimit != null
                    ? `${operations.sentToday} / ${operations.dailyLimit}`
                    : operations.sentToday}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {operations.capacityRemaining != null
                    ? `${operations.capacityRemaining} capacity left`
                    : 'no daily limit'}
                </div>
              </div>
              <div className="rounded-xl border bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-slate-500">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                  <span className="text-sm font-medium">Needs review</span>
                </div>
                <div className="mt-2 text-2xl font-semibold text-slate-900">
                  {operations.failedUnresolved + operations.uncertain}
                </div>
                <div className="mt-1 text-xs text-slate-500">failed + uncertain</div>
              </div>
            </div>

            {operations.waitingReasons.length > 0 && (
              <div aria-label="Waiting reasons">
                <div className="text-sm font-medium text-slate-700">Why work is waiting</div>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {operations.waitingReasons.map(({ reason, count }) => (
                    <li
                      key={reason}
                      className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800"
                    >
                      {waitingReasonLabel(reason)} · {count}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {operations.attention.length > 0 && (
              <div aria-label="Attention items" className="rounded-md border border-red-200 bg-red-50 p-3">
                {operations.attention.map((item) => (
                  <div key={item.kind} className="flex items-center gap-2 text-sm text-red-800">
                    <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>
                      {item.label} ({item.count})
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

import { useCampaign, useCampaignSchedule } from '@/api/campaigns';
import { useSequence } from '@/api/outreach';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingTable } from '@/components/ui/LoadingTable';
import { CHANNEL_ICONS, CHANNEL_COLORS } from '@/components/SequenceStepEditor';
import { ListOrdered, History } from 'lucide-react';
import { isOverdue } from './operationsLabels';

interface Props {
  campaignId: string;
}

/**
 * Committed upcoming work versus projected future steps, plus the readable
 * sequence timeline. Committed rows are persisted intents; projected rows
 * are estimates clearly marked as such.
 */
export function SchedulePanel({ campaignId }: Props) {
  const { data: schedule, isLoading, isError, refetch } = useCampaignSchedule(campaignId);
  const { data: campaign } = useCampaign(campaignId);
  const { data: sequence } = useSequence(campaign?.sequence_id ?? '');
  const committed = schedule?.committed ?? [];
  const projected = schedule?.projected ?? [];
  const orderedSteps = [...(sequence?.steps ?? [])].sort((a, b) => a.stepNumber - b.stepNumber);

  return (
    <Card aria-labelledby="schedule-title">
      <CardHeader>
        <CardTitle id="schedule-title" className="text-lg">
          Schedule
        </CardTitle>
        <CardDescription>
          Committed sends are persisted promises; projected steps are estimates.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <LoadingTable rows={3} cols={4} />
        ) : isError || !schedule ? (
          <ErrorState
            title="Could not load the schedule"
            message="Upcoming sends are unavailable right now."
            onRetry={() => refetch()}
          />
        ) : committed.length === 0 && projected.length === 0 && orderedSteps.length === 0 ? (
          <EmptyState
            icon={<ListOrdered className="h-6 w-6" />}
            title="Nothing scheduled"
            description="Committed sends and projections will appear here once enrollments have next steps."
          />
        ) : (
          <div className="space-y-5">
            {orderedSteps.length > 0 && (
              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">
                  Sequence timeline ({orderedSteps.length} steps)
                </div>
                <ol className="space-y-1.5">
                  {orderedSteps.map((step) => (
                    <li
                      key={step.stepNumber}
                      className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-1.5 text-xs text-slate-600"
                    >
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${CHANNEL_COLORS[step.channel] ?? 'bg-slate-50 border-slate-200'}`}
                      >
                        {CHANNEL_ICONS[step.channel]}
                        Step {step.stepNumber} · {step.channel}
                      </span>
                      <span>
                        {step.stepNumber === 1
                          ? 'sends immediately inside the allowed window'
                          : `waits ${step.delayHours}h after the previous send`}
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="mt-1 text-xs text-slate-500">
                  Enrollments pin the sequence version they started with; later edits apply to new
                  enrollments.
                </p>
              </div>
            )}
            {committed.length > 0 && (
              <div>
                <div className="mb-2 text-sm font-medium text-slate-700">
                  Committed ({committed.length})
                </div>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th scope="col" className="px-4 py-2 font-medium">Lead</th>
                        <th scope="col" className="px-4 py-2 font-medium">Step</th>
                        <th scope="col" className="px-4 py-2 font-medium">Estimated time</th>
                        <th scope="col" className="px-4 py-2 font-medium">State</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {committed.map((item, index) => (
                        <tr key={`${item.leadId}-${item.stepNumber}-${index}`} className="hover:bg-slate-50/50">
                          <td className="px-4 py-2 text-slate-900">
                            {item.businessName ?? 'Recipient'}
                          </td>
                          <td className="px-4 py-2">
                            <span
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${CHANNEL_COLORS[item.channel] ?? 'bg-slate-50 border-slate-200'}`}
                            >
                              {CHANNEL_ICONS[item.channel]}
                              Step {item.stepNumber} · {item.channel}
                            </span>
                          </td>
                          <td className={`px-4 py-2 text-xs ${item.dueAt && isOverdue(item.dueAt) ? 'font-medium text-amber-700' : 'text-slate-500'}`}>
                            {item.dueLabel ?? 'Unscheduled'}
                            {item.dueAt && isOverdue(item.dueAt) && ' · overdue'}
                          </td>
                          <td className="px-4 py-2 text-xs capitalize text-slate-600">{item.state}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {projected.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-700">
                  <History className="h-3.5 w-3.5" aria-hidden="true" />
                  Projected future steps ({projected.length})
                </div>
                <p className="mb-2 text-xs text-slate-500">
                  Estimates only — replies and opt-outs reduce the eventual total.
                </p>
                <ul className="space-y-1.5">
                  {projected.slice(0, 10).map((item, index) => (
                    <li
                      key={`${item.leadId}-${item.stepNumber}-${index}`}
                      className="flex flex-wrap items-center gap-2 rounded-md border border-dashed px-3 py-1.5 text-xs text-slate-600"
                    >
                      <span className="font-medium text-slate-800">
                        Step {item.stepNumber} · {item.channel}
                      </span>
                      <span>{item.estimatedDueLabel}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

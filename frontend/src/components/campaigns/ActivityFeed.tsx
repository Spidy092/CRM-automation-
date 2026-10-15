import { useCampaignActivity } from '@/api/campaigns';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { LoadingTable } from '@/components/ui/LoadingTable';
import { Activity } from 'lucide-react';

interface Props {
  campaignId: string;
}

const KIND_STYLES: Record<string, string> = {
  send: 'bg-green-100 text-green-700',
  failure: 'bg-red-100 text-red-700',
  reply: 'bg-purple-100 text-purple-700',
  operator: 'bg-slate-100 text-slate-700',
};

/** Chronological scheduling, sending, reply, failure, and operator history. */
export function ActivityFeed({ campaignId }: Props) {
  const { data, isLoading, isError, refetch } = useCampaignActivity(campaignId);
  const items = data?.items ?? [];

  return (
    <Card aria-labelledby="activity-title">
      <CardHeader>
        <CardTitle id="activity-title" className="text-lg">
          Activity
        </CardTitle>
        <CardDescription>Sends, replies, failures, and operator actions.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <LoadingTable rows={4} cols={2} />
        ) : isError ? (
          <ErrorState
            title="Could not load activity"
            message="Operational history is unavailable right now."
            onRetry={() => refetch()}
          />
        ) : items.length > 0 ? (
          <ol className="space-y-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${KIND_STYLES[item.kind] ?? KIND_STYLES.operator}`}
                >
                  {item.kind}
                </span>
                <span className="text-slate-600">
                  {item.stepNumber != null && `Step ${item.stepNumber} · `}
                  {item.channel ?? item.status ?? ''}
                </span>
                <span className="ml-auto text-xs text-slate-400">
                  {new Date(item.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState
            icon={<Activity className="h-6 w-6" />}
            title="No activity yet"
            description="Launches, sends, pauses, and retries will appear here."
          />
        )}
      </CardContent>
    </Card>
  );
}

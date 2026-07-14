import { useLeadTimeline, useLeadOutreachLogs } from '@/api/outreach';
import type { TimelineEntry, OutreachLog } from '@/api/outreach';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  Mail,
  MessageSquare,
  Phone,
  Zap,
  CheckCircle,
  XCircle,
  Clock,
  Send,
  Eye,
  Reply,
  AlertCircle,
} from 'lucide-react';

// ── Channel icon ────────────────────────────────────────────────────────────

function ChannelIcon({ channel }: { channel?: string }) {
  switch (channel) {
    case 'whatsapp':
      return <MessageSquare className="h-4 w-4 text-emerald-600" />;
    case 'email':
      return <Mail className="h-4 w-4 text-blue-600" />;
    case 'sms':
      return <Zap className="h-4 w-4 text-amber-600" />;
    case 'phone_call':
      return <Phone className="h-4 w-4 text-purple-600" />;
    default:
      return <Clock className="h-4 w-4 text-slate-400" />;
  }
}

// ── Status icon ─────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status?: string }) {
  switch (status) {
    case 'sent':
      return <Send className="h-3.5 w-3.5 text-blue-500" />;
    case 'delivered':
      return <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />;
    case 'opened':
      return <Eye className="h-3.5 w-3.5 text-indigo-500" />;
    case 'replied':
      return <Reply className="h-3.5 w-3.5 text-emerald-600" />;
    case 'failed':
    case 'bounced':
      return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    case 'queued':
      return <Clock className="h-3.5 w-3.5 text-slate-400" />;
    default:
      return <AlertCircle className="h-3.5 w-3.5 text-slate-400" />;
  }
}

// ── Status badge ────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  sent: 'bg-blue-50 text-blue-700',
  delivered: 'bg-emerald-50 text-emerald-700',
  opened: 'bg-indigo-50 text-indigo-700',
  replied: 'bg-emerald-50 text-emerald-700',
  failed: 'bg-red-50 text-red-700',
  bounced: 'bg-red-50 text-red-700',
  queued: 'bg-slate-100 text-slate-500',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status] ?? 'bg-slate-100 text-slate-600'}`}
    >
      <StatusIcon status={status} />
      {status}
    </span>
  );
}

// ── Timeline entry ──────────────────────────────────────────────────────────

function TimelineItem({ entry }: { entry: TimelineEntry }) {
  const ts = new Date(entry.occurred_at);

  return (
    <div className="relative flex gap-3">
      {/* Connector line */}
      <div className="absolute left-3.5 top-8 bottom-0 w-px bg-slate-200" aria-hidden />

      {/* Icon bubble */}
      <div className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white shadow ring-1 ring-slate-200 mt-0.5">
        <ChannelIcon channel={entry.channel} />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 pb-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-800">
            {entry.title ?? `${entry.channel ?? 'Event'} — step ${(entry.meta?.step_number as number | undefined) ?? ''}`}
          </span>
          {entry.status && <StatusBadge status={entry.status} />}
        </div>
        {entry.description && (
          <p className="mt-0.5 text-xs text-slate-500 line-clamp-2">{entry.description}</p>
        )}
        <time className="mt-0.5 block text-xs text-slate-400">
          {ts.toLocaleDateString()} {ts.toLocaleTimeString()}
        </time>
      </div>
    </div>
  );
}

// ── Outreach log row ────────────────────────────────────────────────────────

function LogRow({ log }: { log: OutreachLog }) {
  return (
    <tr className="border-b border-slate-100 last:border-0">
      <td className="py-2 pr-3">
        <div className="flex items-center gap-1.5">
          <ChannelIcon channel={log.channel} />
          <span className="text-xs capitalize text-slate-700">{log.channel}</span>
        </div>
      </td>
      <td className="py-2 pr-3">
        <StatusBadge status={log.status} />
      </td>
      <td className="py-2 pr-3 text-xs text-slate-500">
        {log.step_number !== null ? `Step ${log.step_number}` : '—'}
      </td>
      <td className="py-2 text-xs text-slate-400">
        {log.sent_at ? new Date(log.sent_at).toLocaleString() : '—'}
      </td>
    </tr>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

interface LeadTimelineProps {
  leadId: string;
}

export function LeadTimeline({ leadId }: LeadTimelineProps) {
  const { data: timeline, isLoading: timelineLoading } = useLeadTimeline(leadId);
  const { data: logs, isLoading: logsLoading } = useLeadOutreachLogs(leadId);

  return (
    <div className="space-y-6">
      {/* Activity timeline */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-700 uppercase tracking-wide">
          Activity Timeline
        </h3>

        {timelineLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="h-7 w-7 rounded-full shrink-0" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : !timeline || timeline.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 py-8 text-center">
            <Clock className="mx-auto h-8 w-8 text-slate-300 mb-2" />
            <p className="text-sm text-slate-400">No activity yet.</p>
          </div>
        ) : (
          <div className="relative">
            {timeline.map((entry) => (
              <TimelineItem key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </div>

      {/* Outreach logs table */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-700 uppercase tracking-wide">
          Outreach Logs
        </h3>

        {logsLoading ? (
          <Skeleton className="h-24 w-full rounded-lg" />
        ) : !logs || logs.length === 0 ? (
          <p className="text-sm text-slate-400">No outreach messages sent yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-100">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="px-0 py-2 pr-3 text-xs font-medium text-slate-500 pl-3">Channel</th>
                  <th className="py-2 pr-3 text-xs font-medium text-slate-500">Status</th>
                  <th className="py-2 pr-3 text-xs font-medium text-slate-500">Step</th>
                  <th className="py-2 text-xs font-medium text-slate-500">Sent At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 pl-3">
                {logs.map((log) => (
                  <LogRow key={log.id} log={log} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

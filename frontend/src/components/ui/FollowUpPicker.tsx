import { useEffect, useRef, useState } from 'react';
import { useUpdateLead } from '@/api/leads';
import { useToast } from '@/components/ui/Toast';
import { Calendar, ChevronDown, X } from 'lucide-react';

interface Props {
  leadId: string;
  value: string | null;
}

function startOfLocalDay(daysFromNow: number, hour: number = 9): Date {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  d.setDate(d.getDate() + daysFromNow);
  return d;
}

function addMonths(months: number, hour: number = 9): Date {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  d.setMonth(d.getMonth() + months);
  return d;
}

function formatLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const datePart = isToday
    ? 'Today'
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const timePart = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${datePart}, ${timePart}`;
}

const shortcuts: Array<{ label: string; getDate: (hour: number) => Date }> = [
  { label: 'Set to today', getDate: (h) => startOfLocalDay(0, h) },
  { label: 'Set to tomorrow', getDate: (h) => startOfLocalDay(1, h) },
  { label: 'Set to 1 week from now', getDate: (h) => startOfLocalDay(7, h) },
  { label: 'Set to 1 month from now', getDate: (h) => addMonths(1, h) },
];

export function FollowUpPicker({ leadId, value }: Props) {
  const [open, setOpen] = useState(false);
  const [selectedHour, setSelectedHour] = useState<number>(9);
  const containerRef = useRef<HTMLDivElement>(null);
  const updateLead = useUpdateLead();
  const { showToast } = useToast();

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const setFollowUp = async (date: Date | null) => {
    try {
      await updateLead.mutateAsync({
        id: leadId,
        input: { next_follow_up_at: date ? date.toISOString() : null },
      });
      setOpen(false);
      showToast(
        date ? 'Follow-up scheduled successfully.' : 'Follow-up date cleared.',
        'success',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update follow-up date.';
      showToast(message, 'error');
    }
  };

  const nowIsoMin = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
      >
        <Calendar className="h-4 w-4 text-slate-400" />
        {value ? (
          <span className="font-medium text-slate-800">{formatLabel(value)}</span>
        ) : (
          <span className="text-slate-400">No Follow Up Scheduled</span>
        )}
        <ChevronDown className="h-4 w-4 text-slate-400" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 w-64 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-1.5 mb-1">
            <span className="text-[11px] font-medium text-slate-500">Shortcut Time</span>
            <div className="flex gap-1">
              {[
                { label: '9 AM', hour: 9 },
                { label: '2 PM', hour: 14 },
                { label: '5 PM', hour: 17 },
              ].map((slot) => (
                <button
                  key={slot.hour}
                  type="button"
                  onClick={() => setSelectedHour(slot.hour)}
                  className={`rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
                    selectedHour === slot.hour
                      ? 'bg-blue-100 text-blue-700 font-semibold'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {slot.label}
                </button>
              ))}
            </div>
          </div>
          {shortcuts.map((s) => (
            <button
              key={s.label}
              type="button"
              disabled={updateLead.isPending}
              onClick={() => setFollowUp(s.getDate(selectedHour))}
              className="block w-full rounded px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {s.label}
            </button>
          ))}
          <label className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
            <span className="mb-1 block text-xs text-slate-400">Custom date</span>
            <input
              type="datetime-local"
              min={nowIsoMin}
              disabled={updateLead.isPending}
              className="w-full rounded border border-slate-200 px-2 py-1 text-sm"
              onChange={(e) => {
                if (!e.target.value) return;
                setFollowUp(new Date(e.target.value));
              }}
            />
          </label>
          {value && (
            <button
              type="button"
              disabled={updateLead.isPending}
              onClick={() => setFollowUp(null)}
              className="flex w-full items-center gap-1.5 rounded px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" />
              Clear follow-up
            </button>
          )}
        </div>
      )}
    </div>
  );
}

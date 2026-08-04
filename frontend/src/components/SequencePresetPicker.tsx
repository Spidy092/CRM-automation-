import { useSequencePreset } from '@/hooks/useSequencePreset';
import { SEQUENCE_PRESETS, type SequencePreset } from '@/lib/sequencePresets';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
import type { Sequence } from '@/api/outreach';
import { Clock, Sparkles } from 'lucide-react';

/**
 * One-click starters for the sequence editor. Everything a preset creates is ordinary,
 * fully editable data — the cards exist purely so nobody has to face a blank page.
 */
export function SequencePresetPicker({
  onApplied,
  className,
}: {
  onApplied: (sequence: Sequence) => void;
  className?: string;
}) {
  const { applyPreset, isApplying } = useSequencePreset();
  const { showToast } = useToast();

  const handlePick = async (preset: SequencePreset) => {
    if (isApplying) return;
    try {
      const sequence = await applyPreset(preset);
      showToast(`"${preset.name}" created — edit any step before you launch.`, 'success');
      onApplied(sequence);
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to create the sequence.'), 'error');
    }
  };

  return (
    <div className={className}>
      <div className="mb-2 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-indigo-600" />
        <h3 className="text-sm font-semibold text-slate-900">Start from a proven sequence</h3>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {SEQUENCE_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => handlePick(preset)}
            disabled={isApplying}
            className="flex h-full flex-col rounded-lg border border-slate-200 bg-white p-3 text-left transition-colors hover:border-indigo-400 hover:bg-indigo-50/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="text-sm font-medium text-slate-900">{preset.name}</span>
            <span className="mt-1 flex-1 text-xs leading-5 text-slate-500">
              {preset.description}
            </span>
            <span className="mt-2 flex items-center gap-1 text-xs font-medium text-indigo-700">
              <Clock className="h-3 w-3" />
              {preset.steps.length} steps
            </span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-500">
        {isApplying
          ? 'Creating messages and sequence…'
          : 'Creates the messages and the sequence — every step stays editable.'}
      </p>
    </div>
  );
}

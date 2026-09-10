import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Sequence, SequenceStep } from '@/api/outreach';
import type { Template } from '@/types';
import { CHANNEL_COLORS, CHANNEL_ICONS, CHANNEL_LABELS } from '@/components/SequenceStepEditor';
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Eye,
  AlertTriangle,
  CheckCircle2,
  Clock,
} from 'lucide-react';

interface SequenceMessagePreviewProps {
  sequence: Sequence;
  templateById: Map<string, Template>;
  title?: string;
  initiallyOpen?: boolean;
  className?: string;
}

function formatDelay(delayHours: number): string {
  if (delayHours === 0) return 'Immediate (on enrollment)';
  if (delayHours % 24 === 0) {
    const days = delayHours / 24;
    return `+${delayHours}h (${days} day${days > 1 ? 's' : ''} after previous step)`;
  }
  return `+${delayHours}h after previous step`;
}

function renderTextWithVariables(text: string) {
  const parts = text.split(/(\{\{[a-zA-Z0-9_]+\}\})/g);
  return parts.map((part, i) => {
    if (part.startsWith('{{') && part.endsWith('}}')) {
      return (
        <span
          key={i}
          className="mx-0.5 inline-block rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 font-mono text-xs font-medium text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300"
        >
          {part}
        </span>
      );
    }
    return part;
  });
}

export function SequenceMessagePreview({
  sequence,
  templateById,
  title = 'Message Content Preview',
  initiallyOpen = true,
  className = '',
}: SequenceMessagePreviewProps) {
  const [isOpen, setIsOpen] = useState(initiallyOpen);
  const steps = sequence.steps ?? [];

  if (steps.length === 0) {
    return null;
  }

  return (
    <div className={`overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}>
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/40">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h4>
          <span className="rounded-full bg-slate-200/70 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-300">
            {steps.length} {steps.length === 1 ? 'touch' : 'touches'}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
        >
          {isOpen ? (
            <>
              Hide message content <ChevronUp className="h-3.5 w-3.5" />
            </>
          ) : (
            <>
              View message content <ChevronDown className="h-3.5 w-3.5" />
            </>
          )}
        </button>
      </div>

      {isOpen && (
        <div className="divide-y divide-slate-100 p-4 space-y-4 divide-y-0 dark:divide-slate-800">
          {steps.map((step) => {
            const template = step.templateId ? templateById.get(step.templateId) : null;
            return (
              <StepPreviewCard
                key={step.stepNumber}
                step={step}
                template={template}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function StepPreviewCard({
  step,
  template,
}: {
  step: SequenceStep;
  template?: Template | null;
}) {
  const channelClass =
    CHANNEL_COLORS[step.channel] ?? 'bg-slate-50 border-slate-200 text-slate-800';

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 transition-colors hover:border-slate-300 dark:border-slate-800 dark:bg-slate-800/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-800 dark:bg-slate-700 dark:text-slate-200">
            Step {step.stepNumber}
          </span>
          <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${channelClass}`}>
            {CHANNEL_ICONS[step.channel]}
            <span>{CHANNEL_LABELS[step.channel]}</span>
          </span>
          <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
            <Clock className="h-3 w-3" />
            {formatDelay(step.delayHours)}
          </span>
        </div>

        {template && (
          <div className="flex items-center gap-2">
            {template.approval_status === 'approved' ? (
              <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                <CheckCircle2 className="h-3 w-3" /> Approved
              </span>
            ) : (
              <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                <AlertTriangle className="h-3 w-3" /> {template.approval_status}
              </span>
            )}
            <Link
              to={`/templates/${template.id}/edit`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline dark:text-indigo-400"
              title="Edit this template in a new tab"
            >
              Edit <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        )}
      </div>

      {!template ? (
        <div className="mt-3 flex items-center gap-1.5 rounded border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>No template attached or template was not found.</span>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Template:{' '}
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              {template.name}
            </span>
          </div>

          {template.subject && (
            <div className="rounded border border-slate-200/80 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Subject:{' '}
              </span>
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {renderTextWithVariables(template.subject)}
              </span>
            </div>
          )}

          <div className="rounded border border-slate-200/80 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Message Body:
            </div>
            <div className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-700 dark:text-slate-300">
              {renderTextWithVariables(template.body)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

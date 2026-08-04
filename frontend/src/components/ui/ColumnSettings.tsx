import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowDown, ArrowUp, RotateCcw, Settings2, X } from 'lucide-react';
import type { TableDensity } from '@/lib/tablePrefs';

export interface ColumnOption {
  key: string;
  label: string;
  /** Columns that cannot be hidden (e.g. the row's primary identifier). */
  locked?: boolean;
  /** Optional grouping label shown as a divider, e.g. "Custom fields". */
  group?: string;
}

/** A named starting point, e.g. "Essentials only". */
export interface ColumnPreset {
  label: string;
  keys: string[];
}

interface ColumnSettingsProps {
  options: ColumnOption[];
  /** Visible column keys, in display order. */
  visible: string[];
  onToggle: (key: string) => void;
  /** Omit to hide the reorder arrows (forms keep a fixed layout). */
  onMove?: (key: string, direction: -1 | 1) => void;
  /** Omit to hide the row-density control (only meaningful for tables). */
  density?: TableDensity;
  onDensityChange?: (density: TableDensity) => void;
  onReset: () => void;
  /** One-click starting points shown above the list. */
  presets?: ColumnPreset[];
  onPresetSelect?: (keys: string[]) => void;
  /** Button text and dialog heading noun — "Columns" for tables, "Fields" for forms. */
  label?: string;
  /** Extra line of guidance under the heading. */
  hint?: string;
}

/**
 * Dropdown that lets a user choose which columns (or form fields) are shown,
 * in what order, and how tight the rows are. Purely presentational —
 * persistence lives in `useTablePrefs`.
 */
export function ColumnSettings({
  options,
  visible,
  onToggle,
  onMove,
  density,
  onDensityChange,
  onReset,
  presets,
  onPresetSelect,
  label = 'Columns',
  hint,
}: ColumnSettingsProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const byKey = new Map(options.map((o) => [o.key, o]));
  const orderedVisible = visible.filter((k) => byKey.has(k));
  const hidden = options.filter((o) => !visible.includes(o.key));

  return (
    <div className="relative" ref={containerRef}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={`Choose ${label.toLowerCase()}`}
      >
        <Settings2 className="mr-1.5 h-3.5 w-3.5" />
        {label}
        <span className="ml-1.5 rounded bg-slate-100 px-1.5 text-[10px] font-semibold text-slate-600">
          {orderedVisible.length}
        </span>
      </Button>

      {open && (
        <div
          role="dialog"
          aria-label={`${label} settings`}
          className="absolute right-0 z-40 mt-2 w-72 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 shadow-xl"
        >
          <div className="flex items-center justify-between pb-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Visible {label.toLowerCase()}
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded p-1 text-slate-400 hover:bg-slate-100"
              aria-label="Close column settings"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {hint && <p className="pb-2 text-[11px] leading-4 text-slate-500 dark:text-slate-400">{hint}</p>}

          {presets && presets.length > 0 && onPresetSelect && (
            <div className="flex flex-wrap gap-1 pb-2">
              {presets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => onPresetSelect(preset.keys)}
                  className="rounded-full border border-slate-200 dark:border-slate-700 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}

          <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
            {orderedVisible.map((key, index) => {
              const option = byKey.get(key)!;
              return (
                <li key={key} className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked
                    disabled={option.locked}
                    onChange={() => onToggle(key)}
                    className="h-3.5 w-3.5 rounded border-slate-300 disabled:opacity-40"
                    aria-label={`Hide ${option.label}`}
                  />
                  <span className="flex-1 truncate text-xs text-slate-700" title={option.label}>
                    {option.label}
                    {option.group && (
                      <span className="ml-1 text-[10px] text-slate-400">{option.group}</span>
                    )}
                  </span>
                  {onMove && (
                    <>
                      <button
                        type="button"
                        onClick={() => onMove(key, -1)}
                        disabled={index === 0}
                        className="rounded p-0.5 text-slate-400 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"
                        aria-label={`Move ${option.label} up`}
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onMove(key, 1)}
                        disabled={index === orderedVisible.length - 1}
                        className="rounded p-0.5 text-slate-400 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"
                        aria-label={`Move ${option.label} down`}
                      >
                        <ArrowDown className="h-3 w-3" />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>

          {hidden.length > 0 && (
            <>
              <p className="border-t border-slate-100 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Hidden
              </p>
              <ul className="max-h-40 space-y-1 overflow-y-auto pr-1">
                {hidden.map((option) => (
                  <li
                    key={option.key}
                    className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={false}
                      onChange={() => onToggle(option.key)}
                      className="h-3.5 w-3.5 rounded border-slate-300"
                      aria-label={`Show ${option.label}`}
                    />
                    <span className="flex-1 truncate text-xs text-slate-600" title={option.label}>
                      {option.label}
                      {option.group && (
                        <span className="ml-1 text-[10px] text-slate-400">{option.group}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="mt-3 flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-2">
            {density && onDensityChange ? (
              <div className="flex items-center gap-1">
                <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                  Rows
                </span>
                {(['comfortable', 'compact'] as TableDensity[]).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => onDensityChange(d)}
                    className={`rounded px-2 py-1 text-[11px] font-medium capitalize transition-colors ${
                      density === d
                        ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={onReset}
              className="flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

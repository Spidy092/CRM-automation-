import { useEffect, useRef, useState } from 'react';
import { useTemplates } from '@/api/templates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/Toast';
import { Search, X } from 'lucide-react';

interface TemplateChooserProps {
  open: boolean;
  onClose: () => void;
  /** Called with the chosen template id. Caller navigates; no write happens here. */
  onChoose: (templateId: string) => void;
  onCreateNew: () => void;
  itemDescription: string;
}

/**
 * Searchable existing-template chooser used by “Use in template”.
 * Choosing never persists a change or sends a message — it only carries
 * the selected library item into the editor as a pending selection.
 */
export function TemplateChooser({ open, onClose, onChoose, onCreateNew, itemDescription }: TemplateChooserProps): React.JSX.Element | null {
  const [search, setSearch] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const { showToast } = useToast();
  const { data, isLoading, error } = useTemplates({ search: search || undefined, limit: 20 });

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    setSearch('');
    const t = window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open ]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) returnFocusRef.current?.focus?.();
  }, [open]);

  if (!open) return null;

  const items = data?.items ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Choose a template"
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900">Use in template</h2>
            <p className="truncate text-xs text-slate-500">{itemDescription} — no change is saved until you confirm in the editor.</p>
          </div>
          <Button ref={closeRef} variant="ghost" size="icon" onClick={onClose} aria-label="Close template chooser">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="space-y-3 overflow-y-auto p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <Input
              aria-label="Search templates"
              placeholder="Search templates…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px] w-full"
            onClick={() => {
              showToast('A new template will open with your selection pending.', 'success');
              onCreateNew();
            }}
          >
            + Create new template with this item
          </Button>
          {isLoading && <p role="status" className="text-sm text-slate-500">Loading templates…</p>}
          {error && <p role="alert" className="text-sm text-red-600">Could not load templates. Try again.</p>}
          {!isLoading && !error && items.length === 0 && (
            <p className="text-sm text-slate-500">No templates match. Create a new template to continue.</p>
          )}
          <ul className="space-y-2" aria-label="Templates">
            {items.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onChoose(t.id)}
                  className="flex w-full items-center gap-3 rounded-md border border-slate-200 p-2 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900" title={t.name}>{t.name}</span>
                    <span className="block text-xs text-slate-500">
                      {t.channel} · {t.approval_status}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex justify-end border-t border-slate-200 p-3">
          <Button type="button" variant="outline" className="min-h-[44px]" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

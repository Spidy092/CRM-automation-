import { useEffect, useMemo, useState } from 'react';
import { Loader2, CheckSquare, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
import { useImportSelectedCandidates } from '@/api/scraper';
import type { ScraperLog, StagedResearchCandidate, ResearchContactState } from '@/types';

function isCandidate(value: unknown): value is StagedResearchCandidate {
  if (!value || typeof value !== 'object') return false;
  const c = value as Record<string, unknown>;
  const provider = c.provider as Record<string, unknown> | undefined;
  const business = c.business as Record<string, unknown> | undefined;
  return (
    typeof provider?.id === 'string' &&
    typeof business?.name === 'string' &&
    Array.isArray(c.contacts)
  );
}

function stateTone(state: ResearchContactState): 'green' | 'amber' | 'red' | 'gray' | 'blue' {
  switch (state) {
    case 'observed':
      return 'green';
    case 'dns_supported':
      return 'blue';
    case 'unknown':
      return 'amber';
    case 'malformed':
    case 'disposable':
      return 'red';
    case 'synthetic':
    default:
      return 'gray';
  }
}

function stateLabel(state: ResearchContactState): string {
  switch (state) {
    case 'observed':
      return 'observed';
    case 'dns_supported':
      return 'DNS-supported (not mailbox proof)';
    case 'unknown':
      return 'unknown';
    case 'malformed':
      return 'malformed';
    case 'disposable':
      return 'disposable';
    case 'synthetic':
    default:
      return 'research-only';
  }
}

/**
 * Review-first panel for a single run log. Renders staged research candidates
 * from the run's `raw_response.candidates` — real contact states, evidence
 * links, observed opportunities vs AI guesses, fit/contact scores, selected
 * service, and rejection reasons. Synthetic contacts are always labelled
 * research-only and can never be selected as destinations.
 *
 * Import creates leads only (idempotent server-side). Research candidates
 * are never turned into campaigns or messages from here.
 */
export function ReviewCandidates({
  log,
  canWrite,
}: {
  log: ScraperLog;
  canWrite: boolean;
}) {
  const { showToast } = useToast();
  const importMutation = useImportSelectedCandidates();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const pageSize = 50;

  useEffect(() => {
    setPage(0);
    setSelected(new Set());
  }, [log.id]);

  const candidates = useMemo<StagedResearchCandidate[]>(() => {
    const raw = log.raw_response as Record<string, unknown> | null;
    const list = raw?.candidates;
    if (!Array.isArray(list)) return [];
    return list.filter(isCandidate);
  }, [log.raw_response]);

  const pageCount = Math.max(1, Math.ceil(candidates.length / pageSize));
  const visibleCandidates = candidates.slice(page * pageSize, (page + 1) * pageSize);

  const raw = (log.raw_response ?? {}) as Record<string, unknown>;
  const importMode = typeof raw.import_mode === 'string' ? raw.import_mode : null;

  if (candidates.length === 0) return null;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 100) next.add(id);
      else {
        showToast('You can import up to 100 candidates at a time.', 'error');
        return prev;
      }
      return next;
    });
  };

  const selectable = (c: StagedResearchCandidate): boolean => {
    return c.eligibility === 'eligible' && c.contacts.some(
      (contact) => contact.state === 'observed' || contact.state === 'dns_supported',
    );
  };

  const handleImport = () => {
    const selection = [...selected];
    if (selection.length === 0) {
      showToast('Select at least one candidate to import.', 'error');
      return;
    }
    importMutation.mutate(
      { logId: log.id, selection },
      {
        onSuccess: (res) => {
          setSelected(new Set());
          showToast(
            `Import complete: ${res.recordsImported} new, ${res.recordsDuplicate} duplicate, ${res.recordsFailed} failed.`,
            'success',
          );
        },
        onError: (error) => showToast(getApiErrorMessage(error, 'Import failed.'), 'error'),
      },
    );
  };

  return (
    <div className="mt-2 border-t border-slate-200 pl-5 pt-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-600">
          Review candidates ({candidates.length}
          {importMode === 'review' ? ' staged for review' : ''})
        </p>
        {canWrite && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleImport}
            disabled={selected.size === 0 || importMutation.isPending}
          >
            {importMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
            ) : null}
            Import selected ({selected.size})
          </Button>
        )}
      </div>
      {pageCount > 1 && (
        <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
          <span>
            Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, candidates.length)} of {candidates.length}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <Button size="sm" variant="outline" disabled={page + 1 >= pageCount} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
      <ul className="mt-2 space-y-2">
        {visibleCandidates.map((candidate) => {
          const id = candidate.provider.id;
          const canSelect = selectable(candidate) && canWrite;
          const isSelected = selected.has(id);
          return (
            <li key={id} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  aria-label={isSelected ? `Deselect ${candidate.business.name}` : `Select ${candidate.business.name}`}
                  disabled={!canSelect}
                  onClick={() => toggle(id)}
                  className="mt-0.5 text-slate-500 disabled:opacity-30"
                >
                  {isSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                </button>
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-900">{candidate.business.name}</span>
                    <StatusBadge
                      tone={
                        candidate.eligibility === 'eligible'
                          ? 'green'
                          : candidate.eligibility === 'research_only'
                            ? 'amber'
                            : 'red'
                      }
                    >
                      {candidate.eligibility === 'research_only'
                        ? 'research only'
                        : candidate.eligibility}
                    </StatusBadge>
                    {candidate.suggestedService !== 'none' && (
                      <StatusBadge tone="blue">{candidate.suggestedService.replace('_', ' ')}</StatusBadge>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {candidate.contacts.length === 0 && (
                      <span className="text-xs text-slate-400">No contacts observed</span>
                    )}
                    {candidate.contacts.map((contact, i) => (
                      <StatusBadge key={`${contact.channel}-${i}`} tone={stateTone(contact.state)}>
                        {contact.channel}: {contact.state === 'synthetic' ? 'research-only' : contact.value} ·{' '}
                        {stateLabel(contact.state)}
                      </StatusBadge>
                    ))}
                  </div>
                  {(candidate.business.website || candidate.business.sourceUrls.length > 0) && (
                    <div className="mt-1 flex flex-wrap gap-2 text-xs">
                      {candidate.business.website && (
                        <a
                          href={candidate.business.website}
                          target="_blank"
                          rel="noreferrer"
                          className="text-indigo-600 hover:text-indigo-700"
                        >
                          Website
                        </a>
                      )}
                      {candidate.business.sourceUrls
                        .filter((u) => u !== candidate.business.website)
                        .slice(0, 3)
                        .map((u) => (
                          <a key={u} href={u} target="_blank" rel="noreferrer" className="text-indigo-600 hover:text-indigo-700">
                            Evidence link
                          </a>
                        ))}
                    </div>
                  )}
                  {candidate.observedOpportunities.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                      {candidate.observedOpportunities.slice(0, 3).map((o, i) => (
                        <li key={i}>
                          <span className="font-medium">Observed: </span>
                          {o.fact}
                        </li>
                      ))}
                    </ul>
                  )}
                  {candidate.modelSuggestions.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
                      {candidate.modelSuggestions.slice(0, 2).map((s, i) => (
                        <li key={i}>
                          <span className="font-medium">AI guess (unverified): </span>
                          {s.suggestion}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-1 text-xs text-slate-400">
                    Fit {candidate.targetFit} · Contact {candidate.contactQuality}
                    {candidate.business.location ? ` · ${candidate.business.location}` : ''}
                    {candidate.rejectionReasons.length > 0 &&
                      ` · ${candidate.rejectionReasons.join(', ')}`}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthStore } from '@/store/authStore';

/** Sort direction for a customizable table column. */
export type SortDir = 'asc' | 'desc';

/** Row height presets — purely visual, persisted with the rest of the prefs. */
export type TableDensity = 'comfortable' | 'compact';

export interface TablePrefs {
  /** Visible column keys, in display order. */
  columns: string[];
  pageSize: number;
  density: TableDensity;
  sortBy: string | null;
  sortDir: SortDir;
}

export interface TablePrefsDefaults {
  columns: string[];
  pageSize?: number;
  density?: TableDensity;
  sortBy?: string | null;
  sortDir?: SortDir;
}

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 200] as const;

function storageKey(tableKey: string, userId: string | undefined): string {
  return `crm.table.${tableKey}.${userId ?? 'anon'}`;
}

function readStored(key: string): Partial<TablePrefs> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as Partial<TablePrefs>;
  } catch {
    // Corrupt or unavailable storage must never break the table.
    return null;
  }
}

/**
 * Per-user, per-table view preferences (visible columns + order, page size,
 * density, sort) persisted in localStorage. Column keys that no longer exist
 * — e.g. a deleted custom field — are dropped on read, and newly added
 * required columns are never force-injected, so a user's choice sticks.
 */
export function useTablePrefs(
  tableKey: string,
  defaults: TablePrefsDefaults,
  /** All column keys currently selectable; stored keys outside this list are pruned. */
  availableKeys: string[],
) {
  const userId = useAuthStore((s) => s.user?.id);
  const key = storageKey(tableKey, userId);

  const fallback = useMemo<TablePrefs>(
    () => ({
      columns: defaults.columns,
      pageSize: defaults.pageSize ?? 25,
      density: defaults.density ?? 'comfortable',
      sortBy: defaults.sortBy ?? null,
      sortDir: defaults.sortDir ?? 'desc',
    }),
    // `defaults` is a literal at the call site; the individual values are stable.
    [defaults.columns, defaults.pageSize, defaults.density, defaults.sortBy, defaults.sortDir],
  );

  const [prefs, setPrefs] = useState<TablePrefs>(() => ({ ...fallback, ...readStored(key) }));

  /** True once this user has actually changed something in this session. */
  const isCustomized = useRef(readStored(key) !== null);

  const update = useCallback((updater: (p: TablePrefs) => TablePrefs) => {
    isCustomized.current = true;
    setPrefs(updater);
  }, []);

  // Adopt new defaults while the user has no stored preferences — defaults can
  // grow after async data arrives (a custom field adds a column), and those
  // should appear rather than being frozen out by the first render. Once the
  // user has customized, only a storage-key change (login / user switch)
  // re-reads, so their choices are never discarded mid-session.
  useEffect(() => {
    if (isCustomized.current) return;
    setPrefs(fallback);
  }, [fallback]);

  useEffect(() => {
    const stored = readStored(key);
    isCustomized.current = stored !== null;
    setPrefs({ ...fallback, ...stored });
    // Re-reading is keyed on the storage key alone; `fallback` is handled above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!isCustomized.current) return;
    try {
      localStorage.setItem(key, JSON.stringify(prefs));
    } catch {
      // Ignore quota / private-mode failures — prefs simply won't persist.
    }
  }, [key, prefs]);

  // Prune stale keys (deleted custom fields) without rewriting stored prefs.
  const visibleColumns = useMemo(
    () => prefs.columns.filter((c) => availableKeys.includes(c)),
    [prefs.columns, availableKeys],
  );

  const setColumns = useCallback(
    (columns: string[]) => update((p) => ({ ...p, columns })),
    [update],
  );

  const toggleColumn = useCallback(
    (columnKey: string) => {
      update((p) => {
        if (p.columns.includes(columnKey)) {
          return { ...p, columns: p.columns.filter((c) => c !== columnKey) };
        }
        // Insert at the position it occupies in the master column list so newly
        // re-enabled columns land back where the user expects them.
        const next = [...p.columns, columnKey];
        next.sort((a, b) => availableKeys.indexOf(a) - availableKeys.indexOf(b));
        return { ...p, columns: next };
      });
    },
    [availableKeys, update],
  );

  const moveColumn = useCallback((columnKey: string, direction: -1 | 1) => {
    update((p) => {
      const idx = p.columns.indexOf(columnKey);
      const target = idx + direction;
      if (idx === -1 || target < 0 || target >= p.columns.length) return p;
      const next = [...p.columns];
      [next[idx], next[target]] = [next[target], next[idx]];
      return { ...p, columns: next };
    });
  }, [update]);

  const setPageSize = useCallback(
    (pageSize: number) => update((p) => ({ ...p, pageSize })),
    [update],
  );

  const setDensity = useCallback(
    (density: TableDensity) => update((p) => ({ ...p, density })),
    [update],
  );

  /** Click a header: first click sorts ascending, clicking the same column flips. */
  const toggleSort = useCallback((columnKey: string) => {
    update((p) =>
      p.sortBy === columnKey
        ? { ...p, sortDir: p.sortDir === 'asc' ? 'desc' : 'asc' }
        : { ...p, sortBy: columnKey, sortDir: 'asc' },
    );
  }, [update]);

  const setSort = useCallback(
    (sortBy: string | null, sortDir: SortDir = 'desc') => update((p) => ({ ...p, sortBy, sortDir })),
    [update],
  );

  const reset = useCallback(() => update(() => fallback), [fallback, update]);

  return {
    prefs,
    visibleColumns,
    setColumns,
    toggleColumn,
    moveColumn,
    setPageSize,
    setDensity,
    toggleSort,
    setSort,
    reset,
  };
}

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTablePrefs } from '../tablePrefs';

const AVAILABLE = ['a', 'b', 'c', 'cf:custom'];
const DEFAULTS = { columns: ['a', 'b'], pageSize: 25, sortBy: 'created_at', sortDir: 'desc' as const };

function setup() {
  return renderHook(() => useTablePrefs('leads-test', DEFAULTS, AVAILABLE));
}

describe('useTablePrefs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts from the supplied defaults', () => {
    const { result } = setup();
    expect(result.current.visibleColumns).toEqual(['a', 'b']);
    expect(result.current.prefs.pageSize).toBe(25);
    expect(result.current.prefs.density).toBe('comfortable');
  });

  it('shows and hides columns, keeping master-list order', () => {
    const { result } = setup();

    act(() => result.current.toggleColumn('c'));
    expect(result.current.visibleColumns).toEqual(['a', 'b', 'c']);

    act(() => result.current.toggleColumn('b'));
    expect(result.current.visibleColumns).toEqual(['a', 'c']);
  });

  it('reorders visible columns', () => {
    const { result } = setup();
    act(() => result.current.moveColumn('b', -1));
    expect(result.current.visibleColumns).toEqual(['b', 'a']);

    // Moving past the edge is a no-op.
    act(() => result.current.moveColumn('b', -1));
    expect(result.current.visibleColumns).toEqual(['b', 'a']);
  });

  it('toggles sort direction on the same column and resets on a new one', () => {
    const { result } = setup();

    act(() => result.current.toggleSort('business_name'));
    expect(result.current.prefs).toMatchObject({ sortBy: 'business_name', sortDir: 'asc' });

    act(() => result.current.toggleSort('business_name'));
    expect(result.current.prefs.sortDir).toBe('desc');

    act(() => result.current.toggleSort('lead_score'));
    expect(result.current.prefs).toMatchObject({ sortBy: 'lead_score', sortDir: 'asc' });
  });

  it('persists prefs and restores them on remount', () => {
    const { result, unmount } = setup();
    act(() => {
      result.current.setPageSize(100);
      result.current.setDensity('compact');
      result.current.toggleColumn('c');
    });
    unmount();

    const { result: restored } = setup();
    expect(restored.current.prefs.pageSize).toBe(100);
    expect(restored.current.prefs.density).toBe('compact');
    expect(restored.current.visibleColumns).toEqual(['a', 'b', 'c']);
  });

  it('drops stored columns that no longer exist', () => {
    localStorage.setItem(
      'crm.table.leads-test.anon',
      JSON.stringify({ ...DEFAULTS, columns: ['a', 'cf:deleted', 'c'] }),
    );
    const { result } = setup();
    expect(result.current.visibleColumns).toEqual(['a', 'c']);
  });

  it('ignores corrupt stored prefs', () => {
    localStorage.setItem('crm.table.leads-test.anon', '{not json');
    const { result } = setup();
    expect(result.current.visibleColumns).toEqual(['a', 'b']);
  });

  it('adopts defaults that grow later, while the user has not customized', () => {
    // Simulates custom fields arriving after first render: the new column must
    // become visible rather than being frozen out by the initial defaults.
    const { result, rerender } = renderHook(
      ({ defaults, available }) => useTablePrefs('leads-test', defaults, available),
      { initialProps: { defaults: { columns: ['a'] }, available: ['a'] } },
    );
    expect(result.current.visibleColumns).toEqual(['a']);

    rerender({ defaults: { columns: ['a', 'cf:custom'] }, available: ['a', 'cf:custom'] });
    expect(result.current.visibleColumns).toEqual(['a', 'cf:custom']);
  });

  it('does not let later defaults overwrite an explicit user choice', () => {
    const { result, rerender } = renderHook(
      ({ defaults, available }) => useTablePrefs('leads-test', defaults, available),
      { initialProps: { defaults: { columns: ['a', 'b'] }, available: AVAILABLE } },
    );
    act(() => result.current.toggleColumn('b'));
    expect(result.current.visibleColumns).toEqual(['a']);

    rerender({ defaults: { columns: ['a', 'b', 'c'] }, available: AVAILABLE });
    expect(result.current.visibleColumns).toEqual(['a']);
  });

  it('writes nothing to storage until the user changes something', () => {
    const { result } = setup();
    expect(localStorage.getItem('crm.table.leads-test.anon')).toBeNull();

    act(() => result.current.setPageSize(50));
    expect(localStorage.getItem('crm.table.leads-test.anon')).not.toBeNull();
  });

  it('reset returns to the defaults', () => {
    const { result } = setup();
    act(() => {
      result.current.setPageSize(200);
      result.current.toggleColumn('c');
    });
    act(() => result.current.reset());
    expect(result.current.prefs.pageSize).toBe(25);
    expect(result.current.visibleColumns).toEqual(['a', 'b']);
  });
});

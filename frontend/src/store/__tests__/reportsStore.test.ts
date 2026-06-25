import { describe, it, expect, beforeEach } from 'vitest';
import { useReportsStore } from '../reportsStore';

describe('reportsStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useReportsStore.setState({
      activeReport: 'leads',
      startDate: null,
      endDate: null,
      chartType: 'bar',
      isExporting: false,
      exportJobId: null,
      limit: 25,
      offset: 0,
    });
  });

  it('should initialize with default state', () => {
    const state = useReportsStore.getState();
    expect(state.activeReport).toBe('leads');
    expect(state.startDate).toBeNull();
    expect(state.endDate).toBeNull();
    expect(state.chartType).toBe('bar');
    expect(state.isExporting).toBe(false);
    expect(state.exportJobId).toBeNull();
    expect(state.limit).toBe(25);
    expect(state.offset).toBe(0);
  });

  it('should handle setActiveReport and reset offset', () => {
    useReportsStore.setState({ offset: 10 });
    
    useReportsStore.getState().setActiveReport('outreach');
    
    const state = useReportsStore.getState();
    expect(state.activeReport).toBe('outreach');
    expect(state.offset).toBe(0); // Offset should be reset
  });

  it('should handle setDateRange and reset offset', () => {
    useReportsStore.setState({ offset: 25 });
    
    useReportsStore.getState().setDateRange('2026-01-01', '2026-01-31');
    
    const state = useReportsStore.getState();
    expect(state.startDate).toBe('2026-01-01');
    expect(state.endDate).toBe('2026-01-31');
    expect(state.offset).toBe(0); // Offset should be reset
  });

  it('should handle setDateRange with nulls', () => {
    useReportsStore.getState().setDateRange(null, null);
    
    const state = useReportsStore.getState();
    expect(state.startDate).toBeNull();
    expect(state.endDate).toBeNull();
  });

  it('should handle setChartType', () => {
    useReportsStore.getState().setChartType('pie');
    expect(useReportsStore.getState().chartType).toBe('pie');
    
    useReportsStore.getState().setChartType('line');
    expect(useReportsStore.getState().chartType).toBe('line');
  });

  it('should handle setExporting', () => {
    useReportsStore.getState().setExporting(true, 'job-123');
    
    let state = useReportsStore.getState();
    expect(state.isExporting).toBe(true);
    expect(state.exportJobId).toBe('job-123');

    useReportsStore.getState().setExporting(false);
    
    state = useReportsStore.getState();
    expect(state.isExporting).toBe(false);
    expect(state.exportJobId).toBeNull();
  });

  it('should handle setPagination', () => {
    useReportsStore.getState().setPagination(50, 100);
    
    const state = useReportsStore.getState();
    expect(state.limit).toBe(50);
    expect(state.offset).toBe(100);
  });
});

import { create } from 'zustand';

export type ReportType = 'leads' | 'outreach' | 'pipeline' | 'reps';
export type ChartType = 'bar' | 'line' | 'table' | 'pie';

interface ReportsState {
  // Active report view
  activeReport: ReportType;
  setActiveReport: (report: ReportType) => void;

  // Date range filters (shared across reports)
  startDate: string | null;
  endDate: string | null;
  setDateRange: (start: string | null, end: string | null) => void;

  // Chart display preference
  chartType: ChartType;
  setChartType: (type: ChartType) => void;

  // Export UI state
  isExporting: boolean;
  exportJobId: string | null;
  setExporting: (isExporting: boolean, jobId?: string | null) => void;

  // Table pagination (shared for list views)
  limit: number;
  offset: number;
  setPagination: (limit: number, offset: number) => void;
}

export const useReportsStore = create<ReportsState>((set) => ({
  activeReport: 'leads',
  setActiveReport: (activeReport) => set({ activeReport, offset: 0 }),

  startDate: null,
  endDate: null,
  setDateRange: (startDate, endDate) => set({ startDate, endDate, offset: 0 }),

  chartType: 'bar',
  setChartType: (chartType) => set({ chartType }),

  isExporting: false,
  exportJobId: null,
  setExporting: (isExporting, exportJobId = null) => set({ isExporting, exportJobId }),

  limit: 25,
  offset: 0,
  setPagination: (limit, offset) => set({ limit, offset }),
}));

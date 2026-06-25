export interface ReportActor {
  id: string;
  role: string;
  ipAddress?: string | null;
}

export interface ReportListFilters {
  limit: number;
  offset: number;
  startDate?: string;
  endDate?: string;
}

export interface PaginatedResult<T> {
  items: T[];
  meta: {
    limit: number;
    offset: number;
    total?: number;
  };
}

export interface DashboardMetrics {
  totalLeads: number;
  qualifiedLeads: number;
  totalCampaigns: number;
  activeOutreach: number;
  pipelineConversion: number;
  recentActivity: DashboardActivityPoint[];
}

export interface DashboardActivityPoint {
  date: string;
  leads: number;
  outreach: number;
}

export interface LeadGenerationRow {
  date: string;
  count: number;
  source: string;
}

export interface OutreachPerformanceRow {
  date: string;
  channel: string;
  sent: number;
  delivered: number;
  opened: number;
  replied: number;
  failed: number;
}

export interface PipelineConversionRow {
  stageName: string;
  leadCount: number;
  conversionRate: number;
  avgDays: number;
}

export interface SalesRepPerformanceRow {
  repId: string;
  repName: string;
  leadsAssigned: number;
  leadsConverted: number;
  conversionRate: number;
  avgResponseTime: number;
}

export interface ExportJobInput {
  reportType: string;
  format: 'csv' | 'xlsx' | 'pdf';
  filters?: Record<string, unknown>;
}

export interface ExportJobResult {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
}

export interface ReportStub {
  id: string;
  name: string;
  description: string;
  type: string;
  createdAt: string;
}

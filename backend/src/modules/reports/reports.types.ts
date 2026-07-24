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
  /** Total deal_value across leads with status = 'won'. */
  wonRevenue: number;
  /** Count of leads with status = 'won'. */
  wonDeals: number;
  recentActivity: DashboardActivityPoint[];
  leadSources?: Array<{ name: string; value: number }>;
  myPipelineStages?: Array<{ name: string; count: number }>;
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
  qualifiedCount?: number;
  conversionRate?: number;
}

export interface OutreachPerformanceRow {
  date: string;
  channel: string;
  sent: number;
  delivered: number;
  opened: number;
  replied: number;
  failed: number;
  bounced?: number;
  responseRate?: number;
}

export interface PipelineConversionRow {
  stageName: string;
  leadCount: number;
  conversionRate: number;
  avgDays: number;
  avgDaysInStage?: number;
  dropOffRate?: number;
}

export interface SalesRepPerformanceRow {
  repId: string;
  repName: string;
  leadsAssigned: number;
  leadsConverted: number;
  conversionRate: number;
  avgResponseTime: number;
  dealsClosed?: number;
  revenueEstimate?: number;
}

export interface CampaignAnalyticsRow {
  date: string;
  campaignId: string;
  campaignName: string;
  leadsTargeted: number;
  leadsConverted: number;
  conversionRate: number;
  channel: string;
}

export interface IntegrationHealthRow {
  integrationId: string;
  name: string;
  displayName: string;
  channel: string;
  status: 'healthy' | 'degraded' | 'failing' | 'disabled';
  enabled: boolean;
  lastTestedAt: string;
  successRate: number;
}

export interface CachedReport<T> {
  key: AnalyticsCacheKey;
  generatedAt: string;
  ttlSeconds: number;
  data: T;
}

export type AnalyticsCacheKey =
  | `campaigns:${string}:${string}:${string}`
  | `integrations:${string}`
  | `lead-generation:${string}:${string}`
  | `outreach:${string}:${string}`
  | `pipeline:${string}:${string}`
  | `sales-reps:${string}:${string}`;

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

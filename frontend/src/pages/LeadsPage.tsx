import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useLeadsTable, useDeleteLead, usePauseLead, useBulkPauseLeads, useBulkClassifyLeads } from '@/api/leads';
import { useCampaigns, useAddLeadsToCampaign } from '@/api/campaigns';
import { usePipelines, useBulkMoveLead } from '@/api/pipelines';
import { useCustomFields } from '@/api/customFields';
import { useUsers } from '@/api/users';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { LoadingTable } from '@/components/ui/LoadingTable';
import { ColumnSettings, type ColumnOption } from '@/components/ui/ColumnSettings';
import { TablePagination } from '@/components/ui/TablePagination';
import { useTablePrefs } from '@/lib/tablePrefs';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
import { statusTones } from '@/lib/constants';
import { formatCurrency } from '@/lib/utils';
import type { Lead, LeadStatus } from '@/types';
import {
  Plus,
  Search,
  Upload,
  Edit,
  Trash2,
  Pause,
  Play,
  Lock,
  InboxIcon,
  ExternalLink,
  X,
  Flame,
  PhoneCall,
  MessageSquareMore,
  Tag,
  Sparkles,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  ChevronsUpDown,
} from 'lucide-react';

/** Returns an ISO-8601 UTC string for N days ago (start of that day). */
function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

/** Renders a JSONB custom-field value according to its declared field type. */
function formatCustomFieldValue(value: unknown, fieldType: string): ReactNode {
  if (value === null || value === undefined || value === '') {
    return <span className="text-slate-400">—</span>;
  }
  if (fieldType === 'checkbox') return value ? '✓' : '—';
  if (fieldType === 'date') return formatDate(String(value));
  return String(value);
}

interface LeadColumn {
  key: string;
  label: string;
  /** Backend `sort_by` value; omitted for columns the API cannot sort on. */
  sortKey?: string;
  /** Locked columns can never be hidden. */
  locked?: boolean;
  /** Shown as a hint in the column picker. */
  group?: string;
  align?: 'left' | 'right';
  render: (lead: Lead) => ReactNode;
}

/** Columns shown to a user who has never touched the column picker. */
const DEFAULT_LEAD_COLUMNS = [
  'business_name',
  'contact_name',
  'pipeline',
  'email',
  'phone',
  'status',
  'score',
  'tags',
];

const VALID_TABS = ['all', 'uncontacted', 'contacted', 'hot', 'replied', 'new'] as const;
type TabType = (typeof VALID_TABS)[number];

export function LeadsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const rawTab = searchParams.get('tab');
  const activeTab: TabType = (VALID_TABS as readonly string[]).includes(rawTab ?? '')
    ? (rawTab as TabType)
    : 'all';
  const statusFilter = searchParams.get('status') || '';
  const classificationFilter = searchParams.get('classification') || '';
  const dateRange = (searchParams.get('dateRange') as '' | 'today' | '7d' | '30d') || '';
  const pipelineFilter = searchParams.get('pipeline') || '';
  const search = searchParams.get('q') || '';

  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkClassification, setBulkClassification] = useState<'hot' | 'warm' | 'cold' | ''>('');

  const updateParam = (key: string, value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
      return next;
    }, { replace: true });
  };

  const setSearch = (val: string) => updateParam('q', val);
  const setStatusFilter = (val: string) => updateParam('status', val);
  const setClassificationFilter = (val: string) => updateParam('classification', val);
  const setDateRange = (val: '' | 'today' | '7d' | '30d') => updateParam('dateRange', val);
  const setPipelineFilter = (val: string) => updateParam('pipeline', val);
  const setActiveTab = (val: string) => updateParam('tab', val === 'all' ? '' : val);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(handler);
  }, [search]);

  const createdAfter =
    dateRange === 'today' ? daysAgoIso(0)
    : dateRange === '7d'  ? daysAgoIso(7)
    : dateRange === '30d' ? daysAgoIso(30)
    : undefined;

  const apiFilters = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      status: statusFilter || undefined,
      classification: (activeTab === 'hot' ? 'hot' : classificationFilter) || undefined,
      tags:
        activeTab === 'contacted'
          ? 'contacted'
          : activeTab === 'replied'
          ? 'replied'
          : undefined,
      exclude_tags: activeTab === 'uncontacted' ? 'contacted' : undefined,
      created_after: createdAfter,
      unclassified: activeTab === 'new' ? true : undefined,
      pipeline_id: pipelineFilter || undefined,
    }),
    [
      debouncedSearch,
      statusFilter,
      activeTab,
      classificationFilter,
      createdAfter,
      pipelineFilter,
    ],
  );

  const [leadToDelete, setLeadToDelete] = useState<{ id: string; name: string } | null>(null);

  const { data: pipelines } = usePipelines();
  const { data: users } = useUsers();
  const { data: customFields } = useCustomFields();

  const pipelineIndex = useMemo(() => {
    const map = new Map<string, { pipelineName: string; stageName: string }>();
    pipelines?.forEach((p) => {
      p.stages?.forEach((s) => map.set(s.id, { pipelineName: p.name, stageName: s.name }));
    });
    return map;
  }, [pipelines]);

  const userIndex = useMemo(() => {
    const map = new Map<string, string>();
    users?.forEach((u) => map.set(u.id, u.name));
    return map;
  }, [users]);

  /** Master column list — built-ins plus one column per active custom field. */
  const columns = useMemo<LeadColumn[]>(() => {
    const base: LeadColumn[] = [
      {
        key: 'business_name',
        label: 'Business',
        sortKey: 'business_name',
        locked: true,
        render: (lead) => (
          <>
            <Link
              to={`/leads/${lead.id}`}
              className="font-medium text-slate-900 dark:text-slate-100 underline-offset-2 hover:underline"
            >
              {lead.business_name}
            </Link>
            <div className="text-xs text-slate-400">{lead.industry}</div>
          </>
        ),
      },
      {
        key: 'contact_name',
        label: 'Contact',
        sortKey: 'contact_name',
        render: (lead) => <span className="text-slate-700 dark:text-slate-300">{lead.contact_name}</span>,
      },
      {
        key: 'pipeline',
        label: 'Pipeline / Stage',
        render: (lead) => {
          const info = lead.pipeline_stage_id ? pipelineIndex.get(lead.pipeline_stage_id) : undefined;
          if (!info) return <span className="text-xs text-slate-400">—</span>;
          return (
            <div className="flex flex-col">
              <span className="max-w-[140px] truncate text-xs font-medium text-slate-700 dark:text-slate-300" title={info.pipelineName}>
                {info.pipelineName}
              </span>
              <span className="max-w-[140px] truncate text-[10px] text-slate-500 dark:text-slate-400" title={info.stageName}>
                {info.stageName}
              </span>
            </div>
          );
        },
      },
      {
        key: 'email',
        label: 'Email',
        sortKey: 'email',
        render: (lead) => <span className="text-slate-700 dark:text-slate-300">{lead.email}</span>,
      },
      {
        key: 'phone',
        label: 'Phone',
        render: (lead) => <span className="text-slate-700 dark:text-slate-300">{lead.phone}</span>,
      },
      {
        key: 'status',
        label: 'Status',
        sortKey: 'status',
        render: (lead) => (
          <StatusBadge tone={statusTones[lead.status]}>{lead.status.replace('_', ' ')}</StatusBadge>
        ),
      },
      {
        key: 'score',
        label: 'Score',
        sortKey: 'lead_score',
        render: (lead) => (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
              lead.classification === 'hot' ? 'bg-red-100 text-red-700'
              : lead.classification === 'warm' ? 'bg-amber-100 text-amber-700'
              : lead.classification === 'cold' ? 'bg-blue-100 text-blue-600'
              : 'bg-slate-100 text-slate-500'
            }`}
          >
            {lead.classification === 'hot' ? '🔥' : lead.classification === 'warm' ? '🌡️' : lead.classification === 'cold' ? '❄️' : '⚪'}
            {lead.lead_score ?? '—'}
          </span>
        ),
      },
      {
        key: 'tags',
        label: 'Tags',
        render: (lead) => (
          <div className="flex flex-wrap gap-1" title={lead.tags?.join(', ')}>
            {lead.tags?.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-300"
              >
                {tag}
              </span>
            ))}
            {(lead.tags?.length ?? 0) > 3 && (
              <span className="cursor-help text-[10px] text-slate-400" title={lead.tags?.slice(3).join(', ')}>
                +{(lead.tags?.length ?? 0) - 3}
              </span>
            )}
          </div>
        ),
      },
      {
        key: 'industry',
        label: 'Industry',
        sortKey: 'industry',
        render: (lead) => <span className="text-slate-700 dark:text-slate-300">{lead.industry || '—'}</span>,
      },
      {
        key: 'location',
        label: 'Location',
        sortKey: 'location',
        render: (lead) => (
          <span className="text-slate-700 dark:text-slate-300">
            {[lead.location, lead.country].filter(Boolean).join(', ') || '—'}
          </span>
        ),
      },
      {
        key: 'source_platform',
        label: 'Source',
        render: (lead) => (
          <span className="text-xs text-slate-600 dark:text-slate-400">{lead.source_platform || '—'}</span>
        ),
      },
      {
        key: 'assigned_to',
        label: 'Owner',
        render: (lead) => (
          <span className="text-slate-700 dark:text-slate-300">
            {lead.assigned_to ? userIndex.get(lead.assigned_to) ?? 'Assigned' : 'Unassigned'}
          </span>
        ),
      },
      {
        key: 'deal_value',
        label: 'Deal value',
        sortKey: 'deal_value',
        align: 'right',
        render: (lead) => (
          <span className="text-slate-700 dark:text-slate-300">
            {lead.deal_value === null || lead.deal_value === undefined
              ? '—'
              : formatCurrency(Number(lead.deal_value))}
          </span>
        ),
      },
      {
        key: 'website',
        label: 'Website',
        render: (lead) =>
          lead.website ? (
            <a
              href={lead.website}
              target="_blank"
              rel="noreferrer"
              className="block max-w-[160px] truncate text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              {lead.website.replace(/^https?:\/\//, '')}
            </a>
          ) : (
            <span className="text-slate-400">—</span>
          ),
      },
      {
        key: 'next_follow_up_at',
        label: 'Next follow-up',
        sortKey: 'next_follow_up_at',
        render: (lead) => (
          <span className="text-xs text-slate-600 dark:text-slate-400">{formatDate(lead.next_follow_up_at)}</span>
        ),
      },
      {
        key: 'created_at',
        label: 'Created',
        sortKey: 'created_at',
        render: (lead) => (
          <span className="text-xs text-slate-600 dark:text-slate-400">{formatDate(lead.created_at)}</span>
        ),
      },
      {
        key: 'updated_at',
        label: 'Updated',
        sortKey: 'updated_at',
        render: (lead) => (
          <span className="text-xs text-slate-600 dark:text-slate-400">{formatDate(lead.updated_at)}</span>
        ),
      },
    ];

    const custom: LeadColumn[] = (customFields ?? [])
      .filter((field) => field.is_active)
      .map((field) => ({
        key: `cf:${field.field_key}`,
        label: field.label,
        group: '(custom)',
        render: (lead: Lead) => (
          <span className="text-slate-700 dark:text-slate-300">
            {formatCustomFieldValue(lead.custom_fields?.[field.field_key], field.field_type)}
          </span>
        ),
      }));

    return [...base, ...custom];
  }, [pipelineIndex, userIndex, customFields]);

  const availableKeys = useMemo(() => columns.map((c) => c.key), [columns]);
  const columnOptions = useMemo<ColumnOption[]>(
    () => columns.map((c) => ({ key: c.key, label: c.label, locked: c.locked, group: c.group })),
    [columns],
  );

  const {
    prefs,
    visibleColumns,
    toggleColumn,
    moveColumn,
    setPageSize,
    setDensity,
    toggleSort,
    reset: resetPrefs,
  } = useTablePrefs(
    'leads',
    { columns: DEFAULT_LEAD_COLUMNS, pageSize: 25, sortBy: 'created_at', sortDir: 'desc' },
    availableKeys,
  );

  const activeColumns = useMemo(
    () =>
      visibleColumns
        .map((key) => columns.find((c) => c.key === key))
        .filter((c): c is LeadColumn => Boolean(c)),
    [visibleColumns, columns],
  );

  const [page, setPage] = useState(0);
  const filterSignature = JSON.stringify(apiFilters);

  // Any change to the result set or its ordering invalidates the current page number.
  useEffect(() => {
    setPage(0);
    setSelected(new Set());
  }, [filterSignature, prefs.pageSize, prefs.sortBy, prefs.sortDir]);

  const { data, isLoading, isFetching, error, refetch } = useLeadsTable({
    ...apiFilters,
    limit: prefs.pageSize,
    offset: page * prefs.pageSize,
    sort_by: prefs.sortBy ?? undefined,
    sort_dir: prefs.sortDir,
  });

  const deleteLead = useDeleteLead();
  const pauseLead = usePauseLead();
  const bulkPause = useBulkPauseLeads();
  const bulkClassify = useBulkClassifyLeads();
  const { data: campaigns } = useCampaigns();
  const addLeadsToCampaign = useAddLeadsToCampaign();
  const [selectedCampaign, setSelectedCampaign] = useState('');
  const bulkMoveLead = useBulkMoveLead();
  const [selectedPipelineStage, setSelectedPipelineStage] = useState('');
  const { showToast } = useToast();

  const leads = data?.items ?? [];
  const totalServerLeads = data?.meta?.total ?? leads.length;
  const allSelected = leads.length > 0 && leads.every((l) => selected.has(l.id));

  /** Selection is page-scoped: toggling only adds or clears the rows on screen. */
  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      leads.forEach((l) => (allSelected ? next.delete(l.id) : next.add(l.id)));
      return next;
    });
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const confirmDeleteLead = async () => {
    if (!leadToDelete) return;
    try {
      await deleteLead.mutateAsync(leadToDelete.id);
      showToast('Lead deleted successfully.', 'success');
      setSelected((prev) => { const n = new Set(prev); n.delete(leadToDelete.id); return n; });
      setLeadToDelete(null);
    } catch {
      showToast('Failed to delete lead. Please try again.', 'error');
    }
  };

  const handlePause = async (id: string, currentStatus: LeadStatus) => {
    if (currentStatus !== 'active' && currentStatus !== 'paused') return;
    const willPause = currentStatus === 'active';
    try {
      await pauseLead.mutateAsync({ id, paused: willPause });
      showToast(willPause ? 'Lead paused.' : 'Lead resumed.', 'success');
    } catch {
      showToast('Failed to update lead status.', 'error');
    }
  };

  const handleBulkPause = async (paused: boolean) => {
    const ids = Array.from(selected);
    try {
      const res = await bulkPause.mutateAsync({ ids, paused });
      if (paused) {
        const jobsCount = res?.cancelledJobs ?? 0;
        const jobsMsg = jobsCount > 0 ? ` (${jobsCount} outreach job${jobsCount === 1 ? '' : 's'} cancelled)` : '';
        showToast(`${ids.length} leads paused${jobsMsg}.`, 'success');
      } else {
        showToast(`${ids.length} leads resumed.`, 'success');
      }
      setSelected(new Set());
    } catch {
      showToast('Bulk action failed.', 'error');
    }
  };

  const handleAddToCampaign = async () => {
    if (!selectedCampaign) return;
    const ids = Array.from(selected);
    try {
      await addLeadsToCampaign.mutateAsync({ campaignId: selectedCampaign, leadIds: ids });
      showToast(`${ids.length} leads added to campaign.`, 'success');
      setSelected(new Set());
      setSelectedCampaign('');
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to add leads to campaign.'), 'error');
    }
  };

  const handleMoveToPipeline = async () => {
    if (!selectedPipelineStage) return;
    const ids = Array.from(selected);
    const selectedLeads = leads.filter((l) => selected.has(l.id));

    const targetPipelineId = pipelines?.find((p) => p.stages?.some((s) => s.id === selectedPipelineStage))?.id;
    if (targetPipelineId) {
      const hasConflictingPipeline = selectedLeads.some((l) => {
        if (!l.pipeline_stage_id) return false;
        const currentPipelineId = pipelines?.find((p) => p.stages?.some((s) => s.id === l.pipeline_stage_id))?.id;
        return currentPipelineId && currentPipelineId !== targetPipelineId;
      });
      if (hasConflictingPipeline) {
        showToast('Selected leads contain leads from a different pipeline. Please select leads from the same pipeline or unassigned leads.', 'error');
        return;
      }
    }

    try {
      await bulkMoveLead.mutateAsync({ stageId: selectedPipelineStage, leadIds: ids });
      showToast(`${ids.length} leads moved to pipeline stage.`, 'success');
      setSelected(new Set());
      setSelectedPipelineStage('');
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to move leads to pipeline.'), 'error');
    }
  };

  const handleBulkClassify = async () => {
    if (!bulkClassification) return;
    const ids = Array.from(selected);
    try {
      const result = await bulkClassify.mutateAsync({ ids, classification: bulkClassification });
      showToast(`${result?.updated ?? ids.length} leads classified as ${bulkClassification}.`, 'success');
      setSelected(new Set());
      setBulkClassification('');
    } catch {
      showToast('Bulk classify failed.', 'error');
    }
  };

  const cellPadding = prefs.density === 'compact' ? 'py-1.5' : 'py-3';

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Lead workspace"
        title="Leads"
        description="Find, qualify, pause, and update prospects before they move into campaigns or pipeline stages."
        metrics={[
          { label: 'Total leads', value: totalServerLeads },
          { label: 'On this page', value: leads.length },
          { label: 'Active on page', value: leads.filter((lead) => lead.status === 'active').length, tone: 'success' },
          { label: 'Paused on page', value: leads.filter((lead) => lead.status === 'paused').length, tone: 'warning' },
        ]}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/leads/import">
                <Upload className="mr-2 h-4 w-4" />
                Import
              </Link>
            </Button>
            <Button asChild>
              <Link to="/leads/new">
                <Plus className="mr-2 h-4 w-4" />
                Add Lead
              </Link>
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader>
          {/* ── Quick-view tabs ── */}
          <div className="flex gap-1 pb-3 border-b border-slate-100 dark:border-slate-800 mb-3 overflow-x-auto">
            {([
              { key: 'all',         label: 'All Leads',       icon: <InboxIcon className="h-3.5 w-3.5" /> },
              { key: 'new',         label: 'New ✨',           icon: <Sparkles className="h-3.5 w-3.5" /> },
              { key: 'uncontacted', label: 'Uncontacted',     icon: <PhoneCall className="h-3.5 w-3.5" /> },
              { key: 'contacted',   label: 'Contacted',       icon: <MessageSquareMore className="h-3.5 w-3.5" /> },
              { key: 'hot',         label: 'Hot 🔥',          icon: <Flame className="h-3.5 w-3.5" /> },
              { key: 'replied',     label: 'Replied',         icon: <Tag className="h-3.5 w-3.5" /> },
            ] as { key: typeof activeTab; label: string; icon: React.ReactNode }[]).map((tab) => (
              <button
                key={tab.key}
                onClick={() => { setActiveTab(tab.key); setSelected(new Set()); }}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                  activeTab === tab.key
                    ? 'bg-slate-950 dark:bg-slate-100 text-white dark:text-slate-950 shadow-sm'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                id="leads-search"
                placeholder="Search leads…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <select
              id="leads-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
              <option value="opted_out">Opted Out</option>
            </select>
            <select
              id="leads-classification-filter"
              value={classificationFilter}
              onChange={(e) => setClassificationFilter(e.target.value)}
              disabled={activeTab === 'hot' || activeTab === 'new'}
              className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground disabled:opacity-50"
            >
              <option value="">All Scores</option>
              <option value="hot">🔥 Hot</option>
              <option value="warm">🌡️ Warm</option>
              <option value="cold">❄️ Cold</option>
            </select>
            <select
              id="leads-pipeline-filter"
              value={pipelineFilter}
              onChange={(e) => setPipelineFilter(e.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground max-w-[150px] truncate"
            >
              <option value="">All Pipelines</option>
              {pipelines?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {/* Date-range quick filter */}
            <select
              id="leads-date-filter"
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value as typeof dateRange)}
              className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              title="Filter by date added"
            >
              <option value="">All Time</option>
              <option value="today">📅 Today</option>
              <option value="7d">📅 Last 7 days</option>
              <option value="30d">📅 Last 30 days</option>
            </select>

            <ColumnSettings
              options={columnOptions}
              visible={visibleColumns}
              onToggle={toggleColumn}
              onMove={moveColumn}
              density={prefs.density}
              onDensityChange={setDensity}
              onReset={resetPrefs}
            />
          </div>

          {/* Bulk action toolbar */}
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-blue-200 dark:border-blue-800/60 bg-blue-50 dark:bg-blue-950/40 px-4 py-2 mt-3">
              <span className="text-sm font-medium text-blue-700 dark:text-blue-300">{selected.size} selected</span>

              {/* Pause / Resume */}
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => handleBulkPause(true)} disabled={bulkPause.isPending}>
                  {bulkPause.isPending ? <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Pause className="mr-1.5 h-3.5 w-3.5" />} Pause all
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleBulkPause(false)} disabled={bulkPause.isPending}>
                  {bulkPause.isPending ? <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />} Resume all
                </Button>
              </div>

              {/* ── Bulk Classify ── */}
              <div className="flex items-center gap-2 border-l border-blue-200 pl-3">
                <Sparkles className="h-3.5 w-3.5 text-blue-500" />
                <select
                  id="bulk-classify-select"
                  className="h-8 rounded-md border border-input bg-background px-3 py-1 text-xs"
                  value={bulkClassification}
                  onChange={(e) => setBulkClassification(e.target.value as typeof bulkClassification)}
                >
                  <option value="">Set score…</option>
                  <option value="hot">🔥 Hot</option>
                  <option value="warm">🌡️ Warm</option>
                  <option value="cold">❄️ Cold</option>
                </select>
                <Button
                  variant="default"
                  size="sm"
                  className="h-8"
                  disabled={!bulkClassification || bulkClassify.isPending}
                  onClick={handleBulkClassify}
                >
                  {bulkClassify.isPending && <RefreshCw className="mr-1.5 h-3 w-3 animate-spin" />}
                  Apply
                </Button>
              </div>

              {/* Add to campaign */}
              <div className="flex items-center gap-2 border-l border-blue-200 pl-3">
                <select
                  className="h-8 rounded-md border border-input bg-background px-3 py-1 text-xs"
                  value={selectedCampaign}
                  onChange={(e) => setSelectedCampaign(e.target.value)}
                >
                  <option value="">Select campaign...</option>
                  {campaigns?.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <Button variant="default" size="sm" className="h-8" disabled={!selectedCampaign || addLeadsToCampaign.isPending} onClick={handleAddToCampaign}>
                  {addLeadsToCampaign.isPending && <RefreshCw className="mr-1.5 h-3 w-3 animate-spin" />}
                  Add
                </Button>
              </div>

              {/* Move to pipeline */}
              <div className="flex items-center gap-2 border-l border-blue-200 pl-3">
                <select
                  className="h-8 rounded-md border border-input bg-background px-3 py-1 text-xs max-w-xs truncate"
                  value={selectedPipelineStage}
                  onChange={(e) => setSelectedPipelineStage(e.target.value)}
                >
                  <option value="">Select pipeline stage...</option>
                  {pipelines?.map((p) => (
                    <optgroup key={p.id} label={p.name}>
                      {p.stages?.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <Button variant="default" size="sm" className="h-8" disabled={!selectedPipelineStage || bulkMoveLead.isPending} onClick={handleMoveToPipeline}>
                  {bulkMoveLead.isPending && <RefreshCw className="mr-1.5 h-3 w-3 animate-spin" />}
                  Move
                </Button>
              </div>

              <Button variant="ghost" size="icon" className="ml-auto h-7 w-7" onClick={() => setSelected(new Set())}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
        </CardHeader>

        <CardContent>
          {/* ── Loading state ── */}
          {isLoading && <LoadingTable />}

          {/* ── Error state ── */}
          {!isLoading && error && (
            <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
          )}

          {/* ── Empty state ── */}
          {!isLoading && !error && leads.length === 0 && (
            <EmptyState
              icon={<InboxIcon className="h-6 w-6" />}
              title="No leads found"
              description="Import a CSV or add a lead manually to start qualification and outreach."
              action={
                <Button asChild size="sm">
                  <Link to="/leads/new">
                    <Plus className="mr-2 h-4 w-4" />
                    Add Lead
                  </Link>
                </Button>
              }
            />
          )}

          {/* ── Data table — columns, order, density and sort come from user prefs ── */}
          {!isLoading && !error && leads.length > 0 && (
            <>
              <div className={`overflow-x-auto transition-opacity ${isFetching ? 'opacity-60' : ''}`}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b dark:border-slate-800">
                      <th className="pb-3 pr-3 text-left">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={toggleAll}
                          className="h-4 w-4 rounded border-slate-300"
                          aria-label="Select all"
                        />
                      </th>
                      {activeColumns.map((column) => {
                        const sortKey = column.sortKey;
                        const isSorted = sortKey !== undefined && prefs.sortBy === sortKey;
                        return (
                          <th
                            key={column.key}
                            className={`pb-3 pr-2 font-medium text-slate-500 dark:text-slate-400 ${
                              column.align === 'right' ? 'text-right' : 'text-left'
                            }`}
                          >
                            {sortKey ? (
                              <button
                                type="button"
                                onClick={() => toggleSort(sortKey)}
                                className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                                aria-label={`Sort by ${column.label}`}
                                title={`Sort by ${column.label}`}
                              >
                                {column.label}
                                {isSorted ? (
                                  prefs.sortDir === 'asc' ? (
                                    <ArrowUp className="h-3 w-3 text-slate-700 dark:text-slate-200" />
                                  ) : (
                                    <ArrowDown className="h-3 w-3 text-slate-700 dark:text-slate-200" />
                                  )
                                ) : (
                                  <ChevronsUpDown className="h-3 w-3 text-slate-300 dark:text-slate-600" />
                                )}
                              </button>
                            ) : (
                              column.label
                            )}
                          </th>
                        );
                      })}
                      <th className="pb-3 text-right font-medium text-slate-500 dark:text-slate-400">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((lead: Lead) => (
                      <tr
                        key={lead.id}
                        tabIndex={0}
                        role="row"
                        className={`border-b dark:border-slate-800 transition-colors hover:bg-slate-50 focus:bg-slate-100 focus:outline-none dark:hover:bg-slate-800/60 dark:focus:bg-slate-800 ${selected.has(lead.id) ? 'bg-blue-50/60 dark:bg-blue-950/30' : ''}`}
                        onKeyDown={(e) => {
                          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault();
                            navigate(`/leads/${lead.id}`);
                          }
                        }}
                      >
                        <td className={`${cellPadding} pr-3`}>
                          <input
                            type="checkbox"
                            checked={selected.has(lead.id)}
                            onChange={() => toggleOne(lead.id)}
                            className="h-4 w-4 rounded border-slate-300"
                            aria-label={`Select ${lead.business_name}`}
                          />
                        </td>
                        {activeColumns.map((column) => (
                          <td
                            key={column.key}
                            className={`${cellPadding} pr-2 ${column.align === 'right' ? 'text-right' : ''}`}
                          >
                            {column.render(lead)}
                          </td>
                        ))}
                        <td className={`${cellPadding} text-right`}>
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" asChild title="View detail">
                              <Link to={`/leads/${lead.id}`}>
                                <ExternalLink className="h-4 w-4" />
                              </Link>
                            </Button>
                            <Button variant="ghost" size="icon" asChild title="Edit">
                              <Link to={`/leads/${lead.id}/edit`}>
                                <Edit className="h-4 w-4" />
                              </Link>
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              title={
                                lead.status === 'active'
                                  ? 'Pause'
                                  : lead.status === 'paused'
                                  ? 'Resume'
                                  : 'Status locked (closed lead)'
                              }
                              onClick={() => handlePause(lead.id, lead.status)}
                              disabled={pauseLead.isPending || (lead.status !== 'active' && lead.status !== 'paused')}
                            >
                              {lead.status === 'active' ? (
                                <Pause className="h-4 w-4" />
                              ) : lead.status === 'paused' ? (
                                <Play className="h-4 w-4" />
                              ) : (
                                <Lock className="h-4 w-4 text-slate-300" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Delete"
                              onClick={() => setLeadToDelete({ id: lead.id, name: lead.business_name })}
                            >
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="pt-4">
                <TablePagination
                  page={page}
                  pageSize={prefs.pageSize}
                  rowCount={leads.length}
                  total={data?.meta?.total}
                  hasMore={data?.meta?.hasMore ?? false}
                  isLoading={isFetching}
                  onPageChange={setPage}
                  onPageSizeChange={setPageSize}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {leadToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-fade-in">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">Delete Lead</h2>
            <p className="text-sm text-slate-600">
              Are you sure you want to delete <span className="font-semibold text-slate-800">{leadToDelete.name}</span>? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
              <Button variant="outline" size="sm" onClick={() => setLeadToDelete(null)} disabled={deleteLead.isPending}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={confirmDeleteLead} disabled={deleteLead.isPending}>
                {deleteLead.isPending ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

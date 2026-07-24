import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useInfiniteLeads, useDeleteLead, usePauseLead, useBulkPauseLeads, useBulkClassifyLeads } from '@/api/leads';
import { useCampaigns, useAddLeadsToCampaign } from '@/api/campaigns';
import { usePipelines, useBulkMoveLead } from '@/api/pipelines';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { LoadingTable } from '@/components/ui/LoadingTable';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
import { statusTones } from '@/lib/constants';
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
} from 'lucide-react';

/** Returns an ISO-8601 UTC string for N days ago (start of that day). */
function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function LeadsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = (searchParams.get('tab') as 'all' | 'uncontacted' | 'contacted' | 'hot' | 'replied' | 'new') || 'all';
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

  const apiFilters = {
    search: debouncedSearch || undefined,
    status: statusFilter || undefined,
    classification: (activeTab === 'hot' ? 'hot' : classificationFilter) || undefined,
    tags: activeTab === 'contacted' ? 'contacted'
         : activeTab === 'replied' ? 'replied'
         : undefined,
    exclude_tags: activeTab === 'uncontacted' ? 'contacted' : undefined,
    created_after: createdAfter,
    unclassified: activeTab === 'new' ? true : undefined,
    pipeline_id: pipelineFilter || undefined,
  };

  const [leadToDelete, setLeadToDelete] = useState<{ id: string; name: string } | null>(null);

  const { data, isLoading, error, hasNextPage, fetchNextPage, isFetchingNextPage, isFetching, refetch } =
    useInfiniteLeads(apiFilters);
  const deleteLead = useDeleteLead();
  const pauseLead = usePauseLead();
  const bulkPause = useBulkPauseLeads();
  const bulkClassify = useBulkClassifyLeads();
  const { data: campaigns } = useCampaigns();
  const addLeadsToCampaign = useAddLeadsToCampaign();
  const [selectedCampaign, setSelectedCampaign] = useState('');
  const { data: pipelines } = usePipelines();
  const bulkMoveLead = useBulkMoveLead();
  const [selectedPipelineStage, setSelectedPipelineStage] = useState('');
  const { showToast } = useToast();

  const leads = data?.pages.flatMap((p) => p.items) ?? [];
  const totalServerLeads = data?.pages[0]?.meta?.total ?? leads.length;
  const filteredLeads = leads;
  const allSelected = filteredLeads.length > 0 && filteredLeads.every((l) => selected.has(l.id));

  function getPipelineInfo(stageId: string | null) {
    if (!stageId || !pipelines) return null;
    for (const p of pipelines) {
      const stage = p.stages?.find((s) => s.id === stageId);
      if (stage) return { pipelineName: p.name, stageName: stage.name };
    }
    return null;
  }

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredLeads.map((l) => l.id)));
    }
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

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Lead workspace"
        title="Leads"
        description="Find, qualify, pause, and update prospects before they move into campaigns or pipeline stages."
        metrics={[
          { label: 'Total leads', value: totalServerLeads },
          { label: 'Loaded on page', value: leads.length },
          { label: 'Loaded active', value: leads.filter((lead) => lead.status === 'active').length, tone: 'success' },
          { label: 'Loaded paused', value: leads.filter((lead) => lead.status === 'paused').length, tone: 'warning' },
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
          <div className="flex gap-1 pb-3 border-b border-slate-100 mb-3 overflow-x-auto">
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
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
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
              className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
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
              className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
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
              className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm max-w-[150px] truncate"
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
              className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
              title="Filter by date added"
            >
              <option value="">All Time</option>
              <option value="today">📅 Today</option>
              <option value="7d">📅 Last 7 days</option>
              <option value="30d">📅 Last 30 days</option>
            </select>
          </div>

          {/* Bulk action toolbar */}
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 mt-3">
              <span className="text-sm font-medium text-blue-700">{selected.size} selected</span>

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
          {(isLoading || (isFetching && filteredLeads.length === 0)) && <LoadingTable />}

          {/* ── Error state ── */}
          {!isLoading && !isFetching && error && (
            <ErrorState message={error.message} onRetry={() => refetch()} />
          )}

          {/* ── Empty state ── */}
          {!isLoading && !isFetching && !error && filteredLeads.length === 0 && (
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

          {/* ── Data table ── */}
          {!isLoading && !error && filteredLeads.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="pb-3 pr-3 text-left">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        className="h-4 w-4 rounded border-slate-300"
                        aria-label="Select all"
                      />
                    </th>
                    <th className="pb-3 text-left font-medium text-slate-500">Business</th>
                    <th className="pb-3 text-left font-medium text-slate-500">Contact</th>
                    <th className="pb-3 text-left font-medium text-slate-500">Pipeline / Stage</th>
                    <th className="pb-3 text-left font-medium text-slate-500">Email</th>
                    <th className="pb-3 text-left font-medium text-slate-500">Phone</th>
                    <th className="pb-3 text-left font-medium text-slate-500">Status</th>
                    <th className="pb-3 text-left font-medium text-slate-500">Score</th>
                    <th className="pb-3 text-left font-medium text-slate-500">Tags</th>
                    <th className="pb-3 text-right font-medium text-slate-500">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLeads.map((lead: Lead) => (
                    <tr
                      key={lead.id}
                      tabIndex={0}
                      role="row"
                      className={`border-b transition-colors hover:bg-slate-50 focus:bg-slate-100 focus:outline-none ${selected.has(lead.id) ? 'bg-blue-50/60' : ''}`}
                      onKeyDown={(e) => {
                        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          navigate(`/leads/${lead.id}`);
                        }
                      }}
                    >
                      <td className="py-3 pr-3">
                        <input
                          type="checkbox"
                          checked={selected.has(lead.id)}
                          onChange={() => toggleOne(lead.id)}
                          className="h-4 w-4 rounded border-slate-300"
                          aria-label={`Select ${lead.business_name}`}
                        />
                      </td>
                      <td className="py-3">
                        <Link
                          to={`/leads/${lead.id}`}
                          className="font-medium text-slate-900 underline-offset-2 hover:text-slate-700 hover:underline"
                        >
                          {lead.business_name}
                        </Link>
                        <div className="text-xs text-slate-400">{lead.industry}</div>
                      </td>
                      <td className="py-3 text-slate-700">{lead.contact_name}</td>
                      <td className="py-3 pr-2">
                        {(() => {
                          const info = getPipelineInfo(lead.pipeline_stage_id);
                          if (!info) return <span className="text-slate-400 text-xs">—</span>;
                          return (
                            <div className="flex flex-col">
                              <span className="text-xs font-medium text-slate-700 truncate max-w-[140px]" title={info.pipelineName}>
                                {info.pipelineName}
                              </span>
                              <span className="text-[10px] text-slate-500 truncate max-w-[140px]" title={info.stageName}>
                                {info.stageName}
                              </span>
                            </div>
                          );
                        })()}
                      </td>
                      <td className="py-3 text-slate-700">{lead.email}</td>
                      <td className="py-3 text-slate-700">{lead.phone}</td>
                      <td className="py-3">
                        <StatusBadge tone={statusTones[lead.status]}>
                          {lead.status.replace('_', ' ')}
                        </StatusBadge>
                      </td>
                      <td className="py-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                          lead.classification === 'hot' ? 'bg-red-100 text-red-700'
                          : lead.classification === 'warm' ? 'bg-amber-100 text-amber-700'
                          : lead.classification === 'cold' ? 'bg-blue-100 text-blue-600'
                          : 'bg-slate-100 text-slate-500'
                        }`}>
                          {lead.classification === 'hot' ? '🔥' : lead.classification === 'warm' ? '🌡️' : lead.classification === 'cold' ? '❄️' : '⚪'}
                          {lead.lead_score ?? '—'}
                        </span>
                      </td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-1" title={lead.tags?.join(', ')}>
                          {lead.tags?.slice(0, 3).map((tag) => (
                            <span key={tag} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                              {tag}
                            </span>
                          ))}
                          {(lead.tags?.length ?? 0) > 3 && (
                            <span className="text-[10px] text-slate-400 cursor-help" title={lead.tags?.slice(3).join(', ')}>
                              +{(lead.tags?.length ?? 0) - 3}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 text-right">
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

              {hasNextPage && (
                <div className="flex justify-center pt-4">
                  <Button
                    variant="outline"
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                  >
                    {isFetchingNextPage ? 'Loading…' : 'Load more leads'}
                  </Button>
                </div>
              )}
            </div>
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

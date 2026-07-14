import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteLeads, useDeleteLead, usePauseLead, useBulkPauseLeads } from '@/api/leads';
import { useCampaigns, useAddLeadsToCampaign } from '@/api/campaigns';
import { usePipelines, useBulkMoveLead } from '@/api/pipelines';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge';
import { LoadingTable } from '@/components/ui/LoadingTable';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
import type { Lead, LeadStatus } from '@/types';
import {
  Plus,
  Search,
  Upload,
  Edit,
  Trash2,
  Pause,
  Play,
  InboxIcon,
  ExternalLink,
  X,
  Flame,
  PhoneCall,
  MessageSquareMore,
  Tag,
} from 'lucide-react';

const statusTones: Record<LeadStatus, StatusTone> = {
  active: 'green',
  paused: 'amber',
  won: 'blue',
  lost: 'red',
  opted_out: 'gray',
};

export function LeadsPage() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [classificationFilter, setClassificationFilter] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'all' | 'uncontacted' | 'contacted' | 'hot' | 'replied'>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(handler);
  }, [search]);

  const apiFilters = {
    search: debouncedSearch || undefined,
    status: statusFilter || undefined,
    classification: (activeTab === 'hot' ? 'hot' : classificationFilter) || undefined,
    tags: activeTab === 'contacted' ? 'contacted'
         : activeTab === 'replied' ? 'replied'
         : undefined,
  };

  const { data, isLoading, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useInfiniteLeads(apiFilters);
  const deleteLead = useDeleteLead();
  const pauseLead = usePauseLead();
  const bulkPause = useBulkPauseLeads();
  const { data: campaigns } = useCampaigns();
  const addLeadsToCampaign = useAddLeadsToCampaign();
  const [selectedCampaign, setSelectedCampaign] = useState('');
  const { data: pipelines } = usePipelines();
  const bulkMoveLead = useBulkMoveLead();
  const [selectedPipelineStage, setSelectedPipelineStage] = useState('');
  const { showToast } = useToast();

  const leads = data?.pages.flatMap((p) => p.items) ?? [];
  // For 'uncontacted' tab, filter client-side: leads with no 'contacted' tag
  const filteredLeads = activeTab === 'uncontacted'
    ? leads.filter((l) => !l.tags?.includes('contacted'))
    : leads;
  const allSelected = filteredLeads.length > 0 && filteredLeads.every((l) => selected.has(l.id));

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

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this lead?')) {
      try {
        await deleteLead.mutateAsync(id);
        showToast('Lead deleted successfully.', 'success');
        setSelected((prev) => { const n = new Set(prev); n.delete(id); return n; });
      } catch {
        showToast('Failed to delete lead. Please try again.', 'error');
      }
    }
  };

  const handlePause = async (id: string, currentStatus: LeadStatus) => {
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
      await bulkPause.mutateAsync({ ids, paused });
      showToast(paused ? `${ids.length} leads paused.` : `${ids.length} leads resumed.`, 'success');
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
    try {
      await bulkMoveLead.mutateAsync({ stageId: selectedPipelineStage, leadIds: ids });
      showToast(`${ids.length} leads moved to pipeline stage.`, 'success');
      setSelected(new Set());
      setSelectedPipelineStage('');
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to move leads to pipeline.'), 'error');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Lead workspace"
        title="Leads"
        description="Find, qualify, pause, and update prospects before they move into campaigns or pipeline stages."
        metrics={[
          { label: 'Visible leads', value: leads.length },
          { label: 'Active', value: leads.filter((lead) => lead.status === 'active').length, tone: 'success' },
          { label: 'Paused', value: leads.filter((lead) => lead.status === 'paused').length, tone: 'warning' },
          { label: 'Won', value: leads.filter((lead) => lead.status === 'won').length, tone: 'success' },
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
              { key: 'all',         label: 'All Leads',    icon: <InboxIcon className="h-3.5 w-3.5" /> },
              { key: 'uncontacted', label: 'Uncontacted',  icon: <PhoneCall className="h-3.5 w-3.5" /> },
              { key: 'contacted',   label: 'Contacted',    icon: <MessageSquareMore className="h-3.5 w-3.5" /> },
              { key: 'hot',         label: 'Hot 🔥',       icon: <Flame className="h-3.5 w-3.5" /> },
              { key: 'replied',     label: 'Replied',      icon: <Tag className="h-3.5 w-3.5" /> },
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
              disabled={activeTab === 'hot'}
              className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
            >
              <option value="">All Scores</option>
              <option value="hot">🔥 Hot</option>
              <option value="warm">🌡️ Warm</option>
              <option value="cold">❄️ Cold</option>
            </select>
          </div>

          {/* Bulk action toolbar */}
          {selected.size > 0 && (
            <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 mt-3">
              <span className="text-sm font-medium text-blue-700">{selected.size} selected</span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleBulkPause(true)}
                  disabled={bulkPause.isPending}
                >
                  <Pause className="mr-1.5 h-3.5 w-3.5" />
                  Pause all
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleBulkPause(false)}
                  disabled={bulkPause.isPending}
                >
                  <Play className="mr-1.5 h-3.5 w-3.5" />
                  Resume all
                </Button>
              </div>
              <div className="flex items-center gap-2 ml-4 border-l border-blue-200 pl-4">
                <select
                  className="h-8 rounded-md border border-input bg-background px-3 py-1 text-xs"
                  value={selectedCampaign}
                  onChange={(e) => setSelectedCampaign(e.target.value)}
                >
                  <option value="">Select campaign...</option>
                  {campaigns?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <Button
                  variant="default"
                  size="sm"
                  className="h-8"
                  disabled={!selectedCampaign || addLeadsToCampaign.isPending}
                  onClick={handleAddToCampaign}
                >
                  Add
                </Button>
              </div>
              <div className="flex items-center gap-2 ml-4 border-l border-blue-200 pl-4">
                <select
                  className="h-8 rounded-md border border-input bg-background px-3 py-1 text-xs max-w-xs truncate"
                  value={selectedPipelineStage}
                  onChange={(e) => setSelectedPipelineStage(e.target.value)}
                >
                  <option value="">Select pipeline stage...</option>
                  {pipelines?.map((p) => (
                    <optgroup key={p.id} label={p.name}>
                      {p.stages?.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <Button
                  variant="default"
                  size="sm"
                  className="h-8"
                  disabled={!selectedPipelineStage || bulkMoveLead.isPending}
                  onClick={handleMoveToPipeline}
                >
                  Move
                </Button>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto h-7 w-7"
                onClick={() => setSelected(new Set())}
              >
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
            <ErrorState message={error.message} onRetry={() => window.location.reload()} />
          )}

          {/* ── Empty state ── */}
          {!isLoading && !error && filteredLeads.length === 0 && (
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
                      className={`border-b transition-colors hover:bg-slate-50 ${selected.has(lead.id) ? 'bg-blue-50/60' : ''}`}
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
                          {lead.classification === 'hot' ? '🔥' : lead.classification === 'warm' ? '🌡️' : lead.classification === 'cold' ? '❄️' : ''}
                          {lead.lead_score}
                        </span>
                      </td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-1">
                          {lead.tags?.slice(0, 3).map((tag) => (
                            <span key={tag} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                              {tag}
                            </span>
                          ))}
                          {(lead.tags?.length ?? 0) > 3 && (
                            <span className="text-[10px] text-slate-400">+{(lead.tags?.length ?? 0) - 3}</span>
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
                            title={lead.status === 'active' ? 'Pause' : 'Resume'}
                            onClick={() => handlePause(lead.id, lead.status)}
                          >
                            {lead.status === 'active' ? (
                              <Pause className="h-4 w-4" />
                            ) : (
                              <Play className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Delete"
                            onClick={() => handleDelete(lead.id)}
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
    </div>
  );
}

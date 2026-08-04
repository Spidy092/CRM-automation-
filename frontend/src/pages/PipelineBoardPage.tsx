import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { usePipelines, usePipeline, useMoveLead } from '@/api/pipelines';
import { useInfiniteLeads } from '@/api/leads';
import { useCampaigns, type Campaign } from '@/api/campaigns';
import { useAuthStore } from '@/store/authStore';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
import { PageHeader } from '@/components/ui/PageHeader';
import { Settings, Phone, Mail, Building2, Zap, ChevronDown } from 'lucide-react';
import type { Lead } from '@/types';

/**
 * Campaigns that auto-enroll leads dropped into this stage — precise
 * (trigger_stage_id === stage.id) matches plus pipeline-wide catch-alls
 * (pipeline_id set, trigger_stage_id null). Mirrors the two-level lookup
 * `handleStageMoved` does server-side in events.worker.ts.
 */
function campaignsForStage(campaigns: Campaign[], pipelineId: string, stageId: string): Campaign[] {
  return campaigns.filter(
    (c) =>
      c.status === 'active' &&
      c.pipeline_id === pipelineId &&
      (c.trigger_stage_id === stageId || c.trigger_stage_id === null),
  );
}

function StageCampaignBadge({ campaigns }: { campaigns: Campaign[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (campaigns.length === 0) return null;

  if (campaigns.length === 1) {
    const first = campaigns[0];
    return (
      <Link
        to={`/campaigns/${first.id}`}
        title={first.name}
        className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300"
      >
        <Zap className="h-3 w-3 shrink-0" />
        <span className="max-w-[130px] truncate">{first.name}</span>
      </Link>
    );
  }

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300"
      >
        <Zap className="h-3 w-3 shrink-0 text-indigo-500" />
        <span>{campaigns.length} Active Campaigns</span>
        <ChevronDown className="h-3 w-3 shrink-0 ml-0.5 opacity-70" />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-md border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-800 dark:bg-slate-900">
          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Targeting Campaigns ({campaigns.length})
          </div>
          <div className="max-h-48 overflow-y-auto space-y-0.5">
            {campaigns.map((c) => (
              <Link
                key={c.id}
                to={`/campaigns/${c.id}`}
                onClick={() => setIsOpen(false)}
                className="flex items-center justify-between rounded px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <span className="truncate font-medium">{c.name}</span>
                <Zap className="h-3 w-3 shrink-0 text-indigo-500" />
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function PipelineBoardPage() {
  const { user } = useAuthStore();
  const canManagePipelines = user?.role === 'admin' || user?.role === 'manager';

  const { data: pipelines, isLoading: isLoadingPipelines } = usePipelines();
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null);
  const [draggingLeadId, setDraggingLeadId] = useState<string | null>(null);

  const moveLead = useMoveLead();
  const { showToast } = useToast();

  useEffect(() => {
    if (pipelines && pipelines.length > 0 && !selectedPipelineId) {
      const defaultPipeline = pipelines.find((p) => p.is_default) || pipelines[0];
      setSelectedPipelineId(defaultPipeline.id);
    }
  }, [pipelines, selectedPipelineId]);

  const {
    data: infiniteLeadsData,
    isLoading: isLoadingLeads,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useInfiniteLeads(selectedPipelineId ? { pipeline_id: selectedPipelineId, limit: 100 } : {});

  const { data: selectedPipeline } = usePipeline(selectedPipelineId || '');
  const { data: campaigns = [] } = useCampaigns(
    selectedPipelineId ? { pipeline_id: selectedPipelineId } : undefined
  );

  const stages = selectedPipeline?.stages || [];
  const leads = infiniteLeadsData?.pages.flatMap((page) => page.items) ?? [];

  const handleDragStart = (e: React.DragEvent, leadId: string) => {
    e.dataTransfer.setData('leadId', leadId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingLeadId(leadId);
  };

  const handleDragEnd = () => {
    setDraggingLeadId(null);
    setDragOverStageId(null);
  };

  const handleDragOver = (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverStageId !== stageId) {
      setDragOverStageId(stageId);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOverStageId(null);
  };

  const handleDrop = async (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    setDragOverStageId(null);
    setDraggingLeadId(null);
    const leadId = e.dataTransfer.getData('leadId');
    if (!leadId) return;

    try {
      await moveLead.mutateAsync({ leadId, stageId });
      showToast('Lead moved successfully.', 'success');
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to move lead.'), 'error');
    }
  };

  if (isLoadingPipelines) {
    return <div className="flex h-64 items-center justify-center">Loading pipelines...</div>;
  }

  if (!pipelines || pipelines.length === 0) {
    return (
      <div className="flex h-96 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 p-8 text-center">
        <h2 className="mb-2 text-xl font-semibold text-slate-900">No Pipelines Found</h2>
        <p className="mb-6 text-slate-500">You need to create a pipeline before you can view the board.</p>
        {canManagePipelines && (
          <Button asChild>
            <Link to="/pipelines/manage">Create Pipeline</Link>
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col space-y-4">
      <div className="flex-shrink-0">
        <PageHeader
          title="Pipeline Board"
          eyebrow="CRM"
          actions={
            <div className="flex items-center gap-3">
              {hasNextPage && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="text-xs"
                >
                  {isFetchingNextPage ? 'Loading...' : `Load More Leads (${leads.length} loaded)`}
                </Button>
              )}
              <select
                value={selectedPipelineId || ''}
                onChange={(e) => setSelectedPipelineId(e.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                {pipelines.map((pipeline) => (
                  <option key={pipeline.id} value={pipeline.id}>
                    {pipeline.name} {pipeline.is_default ? '(Default)' : ''}
                  </option>
                ))}
              </select>
              {canManagePipelines && (
                <Button asChild variant="outline">
                  <Link to="/pipelines/manage">
                    <Settings className="mr-2 h-4 w-4" />
                    Manage Pipelines
                  </Link>
                </Button>
              )}
            </div>
          }
        />
      </div>

      <div className="flex-1 overflow-x-auto pb-4">
        <div className="flex h-full space-x-4">
          {stages.map((stage) => {
            const stageLeads = leads.filter((l) => l.pipeline_stage_id === stage.id);
            const stageTotal = stageLeads.reduce((sum, lead) => sum + (Number(lead.deal_value) || 0), 0);
            const stageCampaigns = selectedPipelineId
              ? campaignsForStage(campaigns, selectedPipelineId, stage.id)
              : [];
            const isTarget = dragOverStageId === stage.id;

            return (
              <div
                key={stage.id}
                className={`flex w-80 flex-shrink-0 flex-col rounded-xl bg-slate-50 dark:bg-slate-900/80 border transition-all ${
                  isTarget
                    ? 'border-indigo-500 ring-2 ring-indigo-500/50 bg-indigo-50/40 dark:bg-indigo-950/40'
                    : 'border-slate-200 dark:border-slate-800 shadow-sm'
                }`}
                onDragOver={(e) => handleDragOver(e, stage.id)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, stage.id)}
              >
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-4 py-3">
                  <h3 className="font-semibold text-slate-700 dark:text-slate-200">{stage.name}</h3>
                  <div className="flex items-center space-x-2">
                    <span className="flex h-6 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/60 px-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      ${stageTotal.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </span>
                    <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-800 px-2 text-xs font-medium text-slate-600 dark:text-slate-300">
                      {stageLeads.length}
                    </span>
                  </div>
                </div>
                {stageCampaigns.length > 0 && (
                  <div className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-2">
                    <StageCampaignBadge campaigns={stageCampaigns} />
                  </div>
                )}

                <div className="flex-1 overflow-y-auto p-3 space-y-3">
                  {isLoadingLeads ? (
                    <div className="text-center text-sm text-slate-400 py-4">Loading leads...</div>
                  ) : stageLeads.length === 0 ? (
                    <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-transparent text-center text-sm text-slate-400 dark:text-slate-500 px-4 leading-snug">
                      Drop leads here, or bulk-move them from the Leads list.
                    </div>
                  ) : (
                    stageLeads.map((lead: Lead) => {
                      const isDragging = draggingLeadId === lead.id;
                      return (
                        <Card
                          key={lead.id}
                          draggable
                          onDragStart={(e) => handleDragStart(e, lead.id)}
                          onDragEnd={handleDragEnd}
                          className={`cursor-move hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-md transition-all active:cursor-grabbing bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm ${
                            isDragging ? 'opacity-40 border-dashed border-indigo-400' : ''
                          }`}
                        >
                          <CardContent className="p-3">
                            <div className="mb-2 flex items-start justify-between">
                              <div>
                                <Link to={`/leads/${lead.id}`} className="font-medium text-slate-900 dark:text-slate-100 hover:text-primary hover:underline">
                                  {lead.contact_name}
                                </Link>
                                {lead.business_name && (
                                  <div className="flex items-center mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                    <Building2 className="mr-1 h-3 w-3" />
                                    <span className="truncate max-w-[140px]">{lead.business_name}</span>
                                  </div>
                                )}
                              </div>
                              <div className="flex space-x-1 items-center">
                                {lead.deal_value && (
                                  <span className="rounded bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">
                                    ${Number(lead.deal_value).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                  </span>
                                )}
                                {lead.status === 'paused' && (
                                  <span className="rounded bg-amber-100 dark:bg-amber-950/60 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-300">
                                    PAUSED
                                  </span>
                                )}
                              </div>
                            </div>
                            
                            <div className="mt-3 flex flex-col space-y-1 text-xs text-slate-500 dark:text-slate-400">
                              {lead.email && (
                                <div className="flex items-center">
                                  <Mail className="mr-1.5 h-3 w-3" />
                                  <span className="truncate">{lead.email}</span>
                                </div>
                              )}
                              {lead.phone && (
                                <div className="flex items-center">
                                  <Phone className="mr-1.5 h-3 w-3" />
                                  <span>{lead.phone}</span>
                                </div>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

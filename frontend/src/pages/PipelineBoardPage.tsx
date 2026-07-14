import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { usePipelines, usePipeline, useMoveLead } from '@/api/pipelines';
import { useLeads } from '@/api/leads';
import { useCampaigns, type Campaign } from '@/api/campaigns';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
import { PageHeader } from '@/components/ui/PageHeader';
import { Settings, Phone, Mail, Building2, Zap } from 'lucide-react';
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
  if (campaigns.length === 0) return null;
  const [first, ...rest] = campaigns;
  return (
    <Link
      to={`/campaigns/${first.id}`}
      title={campaigns.map((c) => c.name).join(', ')}
      className="flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100"
    >
      <Zap className="h-3 w-3 shrink-0" />
      <span className="max-w-[110px] truncate">{first.name}</span>
      {rest.length > 0 && <span>+{rest.length}</span>}
    </Link>
  );
}

export function PipelineBoardPage() {
  const { data: pipelines, isLoading: isLoadingPipelines } = usePipelines();
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  
  const moveLead = useMoveLead();
  const { showToast } = useToast();

  useEffect(() => {
    if (pipelines && pipelines.length > 0 && !selectedPipelineId) {
      const defaultPipeline = pipelines.find(p => p.is_default) || pipelines[0];
      setSelectedPipelineId(defaultPipeline.id);
    }
  }, [pipelines, selectedPipelineId]);

  const { data: leadsData, isLoading: isLoadingLeads } = useLeads(
    selectedPipelineId ? { pipeline_id: selectedPipelineId, limit: 500 } : {}
  );

  const { data: selectedPipeline } = usePipeline(selectedPipelineId || '');
  const { data: campaigns = [] } = useCampaigns();

  const stages = selectedPipeline?.stages || [];
  const leads = leadsData?.items || [];

  const handleDragStart = (e: React.DragEvent, leadId: string) => {
    e.dataTransfer.setData('leadId', leadId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
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
        <Button asChild>
          <Link to="/pipelines/manage">Create Pipeline</Link>
        </Button>
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
              <Button asChild variant="outline">
                <Link to="/pipelines/manage">
                  <Settings className="mr-2 h-4 w-4" />
                  Manage Pipelines
                </Link>
              </Button>
            </div>
          }
        />
      </div>

      <div className="flex-1 overflow-x-auto pb-4">
        <div className="flex h-full space-x-4">
          {stages.map((stage) => {
            const stageLeads = leads.filter(l => l.pipeline_stage_id === stage.id);
            const stageTotal = stageLeads.reduce((sum, lead) => sum + (Number(lead.deal_value) || 0), 0);
            const stageCampaigns = selectedPipelineId
              ? campaignsForStage(campaigns, selectedPipelineId, stage.id)
              : [];

            return (
              <div
                key={stage.id}
                className="flex w-80 flex-shrink-0 flex-col rounded-xl bg-slate-50 border border-slate-200 shadow-sm"
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, stage.id)}
              >
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                  <h3 className="font-semibold text-slate-700">{stage.name}</h3>
                  <div className="flex items-center space-x-2">
                    <span className="flex h-6 items-center justify-center rounded-full bg-green-100 px-2 text-xs font-semibold text-green-700">
                      ${stageTotal.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </span>
                    <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-200 px-2 text-xs font-medium text-slate-600">
                      {stageLeads.length}
                    </span>
                  </div>
                </div>
                {stageCampaigns.length > 0 && (
                  <div className="border-b border-slate-200 bg-white px-4 py-2">
                    <StageCampaignBadge campaigns={stageCampaigns} />
                  </div>
                )}

                <div className="flex-1 overflow-y-auto p-3 space-y-3">
                  {isLoadingLeads ? (
                    <div className="text-center text-sm text-slate-400 py-4">Loading leads...</div>
                  ) : stageLeads.length === 0 ? (
                    <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-transparent text-center text-sm text-slate-400 px-4 leading-snug">
                      Drop leads here, or bulk-move them from the Leads list.
                    </div>
                  ) : (
                    stageLeads.map((lead: Lead) => (
                      <Card
                        key={lead.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, lead.id)}
                        className="cursor-move hover:border-slate-300 hover:shadow-md transition-all active:cursor-grabbing bg-white border-slate-200 shadow-sm"
                      >
                        <CardContent className="p-3">
                          <div className="mb-2 flex items-start justify-between">
                            <div>
                              <Link to={`/leads/${lead.id}`} className="font-medium text-slate-900 hover:text-primary hover:underline">
                                {lead.contact_name}
                              </Link>
                              {lead.business_name && (
                                <div className="flex items-center mt-0.5 text-xs text-slate-500">
                                  <Building2 className="mr-1 h-3 w-3" />
                                  <span className="truncate max-w-[140px]">{lead.business_name}</span>
                                </div>
                              )}
                            </div>
                            <div className="flex space-x-1 items-center">
                              {lead.deal_value && (
                                <span className="rounded bg-green-50 px-1.5 py-0.5 text-[10px] font-bold text-green-700 border border-green-200">
                                  ${Number(lead.deal_value).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                </span>
                              )}
                              {lead.status === 'paused' && (
                                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                                  PAUSED
                                </span>
                              )}
                            </div>
                          </div>
                          
                          <div className="mt-3 flex flex-col space-y-1 text-xs text-slate-500">
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
                    ))
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

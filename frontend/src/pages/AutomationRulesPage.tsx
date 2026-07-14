import { Link } from 'react-router-dom';
import { useCampaigns } from '@/api/campaigns';
import { useSequences } from '@/api/outreach';
import { usePipelines } from '@/api/pipelines';
import type { Campaign, CampaignStatus } from '@/api/campaigns';
import type { Sequence } from '@/api/outreach';
import type { Pipeline, PipelineStage } from '@/api/pipelines';

import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge';
import { LoadingTable } from '@/components/ui/LoadingTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Mail, MessageSquare, Phone, Zap, Target, Play, GitBranch, ArrowRight } from 'lucide-react';

// ── Channel icons ────────────────────────────────────────────────────────────

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  whatsapp: <MessageSquare className="h-4 w-4 text-green-600" />,
  email: <Mail className="h-4 w-4 text-blue-600" />,
  sms: <Zap className="h-4 w-4 text-amber-600" />,
  phone_call: <Phone className="h-4 w-4 text-purple-600" />,
};

// ── Status tones ─────────────────────────────────────────────────────────────

const STATUS_TONES: Record<CampaignStatus, StatusTone> = {
  draft: 'gray',
  active: 'green',
  paused: 'amber',
  completed: 'blue',
  archived: 'violet',
};

// ── Step preview pill ─────────────────────────────────────────────────────────

function StepPill({
  stepNumber,
  channel,
  delayHours,
}: {
  stepNumber: number;
  channel: string;
  delayHours: number;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700">
      {CHANNEL_ICONS[channel] ?? null}
      <span className="font-medium">Step {stepNumber}</span>
      <span className="text-slate-400">
        {delayHours === 0 ? '(now)' : `+${delayHours}h`}
      </span>
    </span>
  );
}

// ── Trigger section ───────────────────────────────────────────────────────────

function TriggerSection({
  campaign,
  pipelineMap,
}: {
  campaign: Campaign;
  pipelineMap: Record<string, { pipeline: Pipeline; stages: PipelineStage[] }>;
}) {
  const pipelineEntry = campaign.pipeline_id ? pipelineMap[campaign.pipeline_id] : undefined;
  const triggerStage = campaign.trigger_stage_id
    ? pipelineEntry?.stages.find((s) => s.id === campaign.trigger_stage_id)
    : undefined;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <Target className="h-3.5 w-3.5" />
        Trigger
      </div>

      {campaign.target_industries.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-slate-500">Industries</p>
          <div className="flex flex-wrap gap-1">
            {campaign.target_industries.map((ind) => (
              <span
                key={ind}
                className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-700"
              >
                {ind}
              </span>
            ))}
          </div>
        </div>
      )}

      {campaign.target_countries.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-slate-500">Countries</p>
          <div className="flex flex-wrap gap-1">
            {campaign.target_countries.map((country) => (
              <span
                key={country}
                className="inline-flex items-center rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-700"
              >
                {country}
              </span>
            ))}
          </div>
        </div>
      )}

      {pipelineEntry ? (
        <div className="rounded-md border border-indigo-100 bg-indigo-50 px-3 py-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <GitBranch className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
            <span className="text-xs font-medium text-indigo-800">{pipelineEntry.pipeline.name}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-indigo-600">
            <ArrowRight className="h-3 w-3 shrink-0 text-indigo-400" />
            {triggerStage ? (
              <span>
                Triggers on:{' '}
                <span className="font-semibold">{triggerStage.name}</span>
                {triggerStage.is_terminal_won && (
                  <span className="ml-1 text-green-600">(Won)</span>
                )}
                {triggerStage.is_terminal_lost && (
                  <span className="ml-1 text-red-500">(Lost)</span>
                )}
              </span>
            ) : (
              <span className="italic text-indigo-400">Any stage move (catch-all)</span>
            )}
          </div>
        </div>
      ) : campaign.pipeline_id ? (
        // pipeline_id is set but not yet loaded in the map — show a loading skeleton
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-400 animate-pulse">
          Loading pipeline…
        </div>
      ) : null}

      <div>
        <p className="text-xs text-slate-500">Tone</p>
        <p className="text-sm font-medium capitalize text-slate-900">{campaign.tone}</p>
      </div>
    </div>
  );
}

// ── Action section ────────────────────────────────────────────────────────────

function ActionSection({ sequence }: { sequence: Sequence | null }) {
  if (!sequence) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <Play className="h-3.5 w-3.5" />
          Action
        </div>
        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-3 text-center">
          <p className="text-xs text-slate-500">No sequence connected</p>
          <p className="mt-1 text-xs text-slate-400">
            Edit the campaign to attach an outreach sequence.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <Play className="h-3.5 w-3.5" />
        Action
      </div>

      <div>
        <p className="text-xs text-slate-500">Sequence</p>
        <p className="text-sm font-medium text-slate-900">{sequence.name}</p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {sequence.steps.map((step) => (
          <StepPill
            key={step.stepNumber}
            stepNumber={step.stepNumber}
            channel={step.channel}
            delayHours={step.delayHours}
          />
        ))}
      </div>
    </div>
  );
}

// ── Rule card ─────────────────────────────────────────────────────────────────

function RuleCard({
  campaign,
  sequence,
  pipelineMap,
}: {
  campaign: Campaign;
  sequence: Sequence | null;
  pipelineMap: Record<string, { pipeline: Pipeline; stages: PipelineStage[] }>;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-start justify-between border-b border-slate-100 bg-slate-50 px-5 py-4">
        <h3 className="text-base font-semibold text-slate-950">{campaign.name}</h3>
        <StatusBadge tone={STATUS_TONES[campaign.status]}>{campaign.status}</StatusBadge>
      </div>

      <div className="grid grid-cols-1 divide-y divide-slate-100 md:grid-cols-2 md:divide-y-0 md:divide-x">
        {/* Trigger */}
        <div className="bg-white px-5 py-4">
          <TriggerSection campaign={campaign} pipelineMap={pipelineMap} />
        </div>

        {/* Action */}
        <div className="bg-slate-50 px-5 py-4">
          <ActionSection sequence={sequence} />
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-slate-100 bg-white px-5 py-3">
        <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
          <Link to="/outreach/sequences">View Sequence</Link>
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
          <Link to={`/campaigns/${campaign.id}/edit`}>Edit Rule</Link>
        </Button>
      </div>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function AutomationRulesPage() {
  const { data: campaigns = [], isLoading: campaignsLoading, isError: campaignsError } = useCampaigns();
  const { data: sequenceData, isLoading: sequencesLoading } = useSequences();
  const { data: pipelines = [], isLoading: pipelinesLoading } = usePipelines();

  const isLoading = campaignsLoading || sequencesLoading || pipelinesLoading;

  const sequences = (sequenceData as { items?: Sequence[] } | undefined)?.items ?? [];

  const sequenceMap = sequences.reduce<Record<string, Sequence>>((acc, seq) => {
    acc[seq.id] = seq;
    return acc;
  }, {});

  // Build a map: pipelineId → { pipeline, stages }
  // usePipelines() returns Pipeline[] (no stages); to get stages we need usePipeline(id).
  // Instead of N individual queries, we derive stage info from campaigns that have a
  // trigger_stage_id by extracting what we can from the pipelines list, and use a
  // secondary fetch pattern via PipelineStagesLoader per unique pipeline.
  const pipelineMap = pipelines.reduce<Record<string, { pipeline: Pipeline; stages: PipelineStage[] }>>(
    (acc, p) => {
      // stages come from the detail endpoint; for the list view we start with empty
      // and let PipelineStagesEnricher fill them in via usePipeline per card.
      acc[p.id] = { pipeline: p, stages: [] };
      return acc;
    },
    {},
  );

  // Metrics
  const activeCampaigns = campaigns.filter((c) => c.status === 'active').length;
  const totalRules = campaigns.length;
  const sequencesInUse = new Set(campaigns.map((c) => c.sequence_id).filter(Boolean)).size;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Automation"
        title="Automation Rules"
        description="Manage campaign trigger conditions and their connected outreach sequences."
        metrics={[
          { label: 'Active Rules', value: activeCampaigns },
          { label: 'Total Rules', value: totalRules },
          { label: 'Sequences in Use', value: sequencesInUse },
        ]}
        actions={
          <Button asChild>
            <Link to="/campaigns/new">Create Rule</Link>
          </Button>
        }
      />

      {isLoading && <LoadingTable rows={4} cols={3} />}

      {campaignsError && (
        <ErrorState message="Failed to load automation rules. Unable to fetch campaigns." />
      )}

      {!isLoading && !campaignsError && campaigns.length === 0 && (
        <EmptyState
          icon={<Zap className="h-6 w-6" />}
          title="No automation rules"
          description="Create a campaign to define trigger conditions and connect an outreach sequence."
          action={
            <Button asChild>
              <Link to="/campaigns/new">Create first rule</Link>
            </Button>
          }
        />
      )}

      {!isLoading && !campaignsError && campaigns.length > 0 && (
        <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-2">
          {campaigns.map((campaign) => (
            <PipelineEnrichedCard
              key={campaign.id}
              campaign={campaign}
              sequence={campaign.sequence_id ? sequenceMap[campaign.sequence_id] ?? null : null}
              basePipelineMap={pipelineMap}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Per-card pipeline enricher ────────────────────────────────────────────────
// Fetches the full pipeline (with stages) only for campaigns that have a pipeline_id.
// This avoids N+1 for cards without pipeline links while keeping each card self-contained.

import { usePipeline } from '@/api/pipelines';

function PipelineEnrichedCard({
  campaign,
  sequence,
  basePipelineMap,
}: {
  campaign: Campaign;
  sequence: Sequence | null;
  basePipelineMap: Record<string, { pipeline: Pipeline; stages: PipelineStage[] }>;
}) {
  const { data: pipelineDetail } = usePipeline(campaign.pipeline_id ?? '');

  const enrichedMap = { ...basePipelineMap };
  if (campaign.pipeline_id && pipelineDetail) {
    enrichedMap[campaign.pipeline_id] = {
      pipeline: pipelineDetail,
      stages: pipelineDetail.stages ?? [],
    };
  }

  return (
    <RuleCard
      campaign={campaign}
      sequence={sequence}
      pipelineMap={enrichedMap}
    />
  );
}
import { Link } from 'react-router-dom';
import { useCampaigns } from '@/api/campaigns';
import { useSequences } from '@/api/outreach';
import type { Campaign, CampaignStatus } from '@/api/campaigns';
import type { Sequence } from '@/api/outreach';

import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge';
import { LoadingTable } from '@/components/ui/LoadingTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { Mail, MessageSquare, Phone, Zap, Target, Play, AlertCircle } from 'lucide-react';

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

function TriggerSection({ campaign }: { campaign: Campaign }) {
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

      {campaign.pipeline_id && (
        <div>
          <p className="text-xs text-slate-500">Pipeline</p>
          <p className="text-sm font-medium text-slate-900">{campaign.pipeline_id}</p>
        </div>
      )}

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
}: {
  campaign: Campaign;
  sequence: Sequence | null;
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
          <TriggerSection campaign={campaign} />
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

  const isLoading = campaignsLoading || sequencesLoading;

  const sequences = (sequenceData as { items?: Sequence[] } | undefined)?.items ?? [];

  const sequenceMap = sequences.reduce<Record<string, Sequence>>((acc, seq) => {
    acc[seq.id] = seq;
    return acc;
  }, {});

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
        <Card className="border-red-200 bg-red-50">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertCircle className="h-5 w-5 shrink-0 text-red-600" />
            <div>
              <p className="text-sm font-medium text-red-800">Failed to load automation rules.</p>
              <p className="text-xs text-red-600">Unable to fetch campaigns. Please try again.</p>
            </div>
          </CardContent>
        </Card>
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
            <RuleCard
              key={campaign.id}
              campaign={campaign}
              sequence={campaign.sequence_id ? sequenceMap[campaign.sequence_id] ?? null : null}
            />
          ))}
        </div>
      )}
    </div>
  );
}
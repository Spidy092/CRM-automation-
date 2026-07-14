import { Link, useParams } from 'react-router-dom';
import {
  useLeadAiProfile,
  useLeadDecisions,
  type NextBestAction,
  type BuyingIntent,
  type EnrichmentStatus,
} from '@/api/aiIntelligence';
import { PageHeader } from '@/components/ui/PageHeader';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ArrowLeft, Brain, Sparkles, Target, MessageSquare } from 'lucide-react';

const intentTones: Record<BuyingIntent, StatusTone> = {
  high: 'green',
  medium: 'amber',
  low: 'gray',
  unknown: 'gray',
};

const enrichmentTones: Record<EnrichmentStatus, StatusTone> = {
  done: 'green',
  running: 'blue',
  pending: 'gray',
  failed: 'red',
};

const actionLabels: Record<NextBestAction, string> = {
  send_whatsapp: 'Send WhatsApp',
  send_email: 'Send email',
  send_sms: 'Send SMS',
  wait_and_followup: 'Wait & follow up',
  call: 'Call',
  move_to_nurture: 'Move to nurture',
  escalate_to_rep: 'Escalate to rep',
  request_human_approval: 'Request approval',
  disqualify: 'Disqualify',
  request_review: 'Request review',
};

export function LeadAIProfilePage() {
  const { id } = useParams<{ id: string }>();
  const leadId = id!;
  const { data: profile, isLoading, error } = useLeadAiProfile(leadId);
  const { data: decisions = [] } = useLeadDecisions(leadId);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="AI intelligence"
        title="Lead AI Profile"
        description="What the AI knows about this lead — research, memory, and the next best action."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to={`/leads/${leadId}`}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to lead
            </Link>
          </Button>
        }
      />

      {isLoading && <LoadingSpinner />}

      {error && !isLoading && (
        <ErrorState message="Could not load the AI profile" />
      )}

      {!isLoading && !error && !profile && (
        <EmptyState
          icon={<Brain className="h-6 w-6" />}
          title="No AI profile yet"
          description="This lead has not been researched by the AI yet. A profile is generated automatically after the lead is scraped or imported."
        />
      )}

      {!isLoading && !error && profile && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Enrichment" badge={<StatusBadge tone={enrichmentTones[profile.enrichment_status]}>{profile.enrichment_status}</StatusBadge>} />
            <Stat label="Buying intent" badge={<StatusBadge tone={intentTones[profile.buying_intent]}>{profile.buying_intent}</StatusBadge>} />
            <Stat label="Website quality" value={profile.website_quality_score ?? '—'} />
            <Stat label="Reachability" value={profile.reachability_score ?? '—'} />
          </div>

          {/* Next best action */}
          <Card>
            <CardHeader>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Sparkles className="h-4 w-4 text-violet-500" /> Next best action
              </h3>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone="violet">
                  {profile.next_best_action ? actionLabels[profile.next_best_action] : '—'}
                </StatusBadge>
                {profile.next_best_action_confidence !== null && (
                  <StatusBadge tone="gray">Confidence {profile.next_best_action_confidence}</StatusBadge>
                )}
              </div>
              {profile.next_best_action_reason && (
                <p className="text-sm text-slate-600">{profile.next_best_action_reason}</p>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Target className="h-4 w-4" /> Pain points & offer
                </h3>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Field label="Offer angle" value={profile.offer_angle} />
                <Field label="Budget range" value={profile.inferred_budget_range} />
                <Field label="Preferred channel" value={profile.preferred_channel} />
                <TagList label="Pain points" items={profile.pain_points} tone="amber" />
                <TagList label="Do not say" items={profile.do_not_say} tone="red" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <MessageSquare className="h-4 w-4" /> Memory
                </h3>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Field label="Conversation summary" value={profile.conversation_summary} />
                <Field label="AI notes" value={profile.ai_notes} />
                {profile.buying_signals.length > 0 && (
                  <div>
                    <p className="text-xs text-slate-500">Buying signals</p>
                    <ul className="mt-1 space-y-1">
                      {profile.buying_signals.map((s, i) => (
                        <li key={i} className="text-sm text-slate-700">• {s.signal}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {profile.objection_log.length > 0 && (
                  <div>
                    <p className="text-xs text-slate-500">Objections</p>
                    <ul className="mt-1 space-y-1">
                      {profile.objection_log.map((o, i) => (
                        <li key={i} className="text-sm text-slate-700">
                          <span className="font-medium">{o.type}:</span> {o.text}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Decision log */}
          <Card>
            <CardHeader>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Brain className="h-4 w-4" /> AI decision log
              </h3>
            </CardHeader>
            <CardContent>
              {decisions.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">No AI decisions logged for this lead.</p>
              ) : (
                <ul className="space-y-3">
                  {decisions.map((d) => (
                    <li key={d.id} className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge tone="blue">{d.decision_type.replace('_', ' ')}</StatusBadge>
                        <span className="text-sm font-medium text-slate-900">{d.decision}</span>
                        {d.confidence !== null && (
                          <StatusBadge tone="gray">Confidence {d.confidence}</StatusBadge>
                        )}
                      </div>
                      {d.chain_of_thought && (
                        <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{d.chain_of_thought}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, badge }: { label: string; value?: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-1 text-xl font-semibold text-slate-900">{badge ?? value}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-slate-900">{value ?? '—'}</p>
    </div>
  );
}

function TagList({ label, items, tone }: { label: string; items: string[]; tone: StatusTone }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {items.map((item, i) => (
          <StatusBadge key={i} tone={tone}>{item}</StatusBadge>
        ))}
      </div>
    </div>
  );
}

export default LeadAIProfilePage;

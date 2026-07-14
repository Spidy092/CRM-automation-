import { Link, useParams } from 'react-router-dom';
import {
  useCampaignBrief,
  useApproveBrief,
  useRejectBrief,
  type BriefStatus,
} from '@/api/aiCampaignBrain';
import { PageHeader } from '@/components/ui/PageHeader';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useToast } from '@/components/ui/Toast';
import {
  ArrowLeft,
  FileText,
  AlertTriangle,
  Check,
  X,
  ShieldQuestion,
} from 'lucide-react';

const statusTones: Record<BriefStatus, StatusTone> = {
  draft: 'amber',
  approved: 'green',
  rejected: 'red',
};

export function CampaignBriefPage() {
  const { id } = useParams<{ id: string }>();
  const campaignId = id!;
  const { showToast } = useToast();
  const { data: brief, isLoading, error } = useCampaignBrief(campaignId);
  const approve = useApproveBrief(campaignId);
  const reject = useRejectBrief(campaignId);

  const handleApprove = async () => {
    try {
      await approve.mutateAsync();
      showToast('Brief approved.', 'success');
    } catch {
      showToast('Failed to approve brief.', 'error');
    }
  };

  const handleReject = async () => {
    try {
      await reject.mutateAsync();
      showToast('Brief rejected.', 'success');
    } catch {
      showToast('Failed to reject brief.', 'error');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="AI campaign brain"
        title="Campaign Brief"
        description="AI pre-launch strategy — review the segment fit, angle, and risks before launching."
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link to="/campaigns">
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Link>
            </Button>
            {brief && brief.status === 'draft' && (
              <>
                <Button size="sm" onClick={handleApprove} disabled={approve.isPending}>
                  <Check className="mr-1 h-4 w-4" /> Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleReject}
                  disabled={reject.isPending}
                  className="text-red-600 hover:text-red-700"
                >
                  <X className="mr-1 h-4 w-4" /> Reject
                </Button>
              </>
            )}
          </>
        }
      />

      {isLoading && <LoadingSpinner />}

      {error && !isLoading && (
        <ErrorState message="Could not load the campaign brief" />
      )}

      {!isLoading && !error && !brief && (
        <EmptyState
          icon={<FileText className="h-6 w-6" />}
          title="No brief generated yet"
          description="The AI generates a strategy brief before launch. Trigger generation from the campaign, then review it here."
        />
      )}

      {!isLoading && !error && brief && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Status" badge={<StatusBadge tone={statusTones[brief.status]}>{brief.status}</StatusBadge>} />
            <Stat label="Leads evaluated" value={brief.total_leads_evaluated} />
            <Stat label="Eligible" value={brief.eligible_leads} />
            <Stat label="High fit" value={brief.high_fit_leads} />
          </div>

          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-slate-900">Segment summary</h3>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-slate-700">{brief.segment_summary}</p>
              <div>
                <p className="text-xs text-slate-500">Recommended offer angle</p>
                <p className="mt-0.5 font-medium text-slate-900">{brief.recommended_offer_angle}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone="violet">Autonomy: {brief.recommended_autonomy_level}</StatusBadge>
                <StatusBadge tone="gray">Confidence {brief.confidence_score}</StatusBadge>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <ShieldQuestion className="h-4 w-4 text-amber-500" /> Expected objections
                </h3>
              </CardHeader>
              <CardContent>
                {brief.expected_objections.length === 0 ? (
                  <p className="text-sm text-slate-500">None identified.</p>
                ) : (
                  <ul className="space-y-1 text-sm text-slate-700">
                    {brief.expected_objections.map((o, i) => (
                      <li key={i}>• {o}</li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <AlertTriangle className="h-4 w-4 text-red-500" /> Risk warnings
                </h3>
              </CardHeader>
              <CardContent>
                {brief.risk_warnings.length === 0 ? (
                  <p className="text-sm text-slate-500">No risks flagged.</p>
                ) : (
                  <ul className="space-y-1 text-sm text-slate-700">
                    {brief.risk_warnings.map((r, i) => (
                      <li key={i}>• {r}</li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          {brief.recommended_sequence.length > 0 && (
            <Card>
              <CardHeader>
                <h3 className="text-sm font-semibold text-slate-900">Recommended sequence</h3>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                        <th className="py-2 pr-4">Step</th>
                        <th className="py-2 pr-4">Channel</th>
                        <th className="py-2 pr-4">Delay</th>
                        <th className="py-2">Goal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {brief.recommended_sequence.map((step) => (
                        <tr key={step.step_number} className="border-b border-slate-100 last:border-0">
                          <td className="py-2 pr-4 font-medium text-slate-900">{step.step_number}</td>
                          <td className="py-2 pr-4">
                            <StatusBadge tone="blue">{step.channel}</StatusBadge>
                          </td>
                          <td className="py-2 pr-4 text-slate-600">{step.delay_hours}h</td>
                          <td className="py-2 text-slate-700">{step.goal}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {brief.template_suggestions.length > 0 && (
            <Card>
              <CardHeader>
                <h3 className="text-sm font-semibold text-slate-900">Template suggestions</h3>
              </CardHeader>
              <CardContent className="space-y-3">
                {brief.template_suggestions.map((t, i) => (
                  <div key={i} className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <StatusBadge tone="cyan">{t.channel}</StatusBadge>
                      {t.subject && <span className="text-sm font-medium text-slate-900">{t.subject}</span>}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{t.body_preview}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
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

export default CampaignBriefPage;

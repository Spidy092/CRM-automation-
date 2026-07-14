import { useState, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  useCreateCampaign,
  useUpdateCampaign,
  useCampaign,
  useAutomationPreview,
  useLaunchCampaign,
} from '@/api/campaigns';
import { usePipelines, usePipeline } from '@/api/pipelines';
import { useSequences, useCreateSequence } from '@/api/outreach';
import type { Sequence, SequenceStep } from '@/api/outreach';
import { useTemplates } from '@/api/templates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  SequenceForm,
  CHANNEL_ICONS,
  CHANNEL_LABELS,
  CHANNEL_COLORS,
} from '@/components/SequenceStepEditor';
import {
  GitBranch,
  Info,
  Check,
  ChevronLeft,
  ChevronRight,
  Plus,
  Play,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Users,
} from 'lucide-react';

// ── Wizard steps ─────────────────────────────────────────────────────────────

const WIZARD_STEPS = [
  { title: 'Basics', description: 'Name, tone, and targeting' },
  { title: 'Pipeline', description: 'When leads auto-enroll' },
  { title: 'Sequence', description: 'What messages go out' },
  { title: 'Review & Launch', description: 'Readiness check' },
] as const;

function StepIndicator({
  current,
  onSelect,
  maxReached,
}: {
  current: number;
  onSelect: (step: number) => void;
  maxReached: number;
}) {
  return (
    <ol className="flex flex-wrap items-center gap-2">
      {WIZARD_STEPS.map((step, i) => {
        const state = i < current ? 'done' : i === current ? 'active' : 'todo';
        const reachable = i <= maxReached;
        return (
          <li key={step.title} className="flex items-center gap-2">
            <button
              type="button"
              disabled={!reachable}
              onClick={() => onSelect(i)}
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                state === 'active'
                  ? 'border-indigo-600 bg-indigo-50 text-indigo-700 font-medium'
                  : state === 'done'
                    ? 'border-green-300 bg-green-50 text-green-700'
                    : 'border-slate-200 bg-white text-slate-400'
              } ${reachable ? 'cursor-pointer' : 'cursor-not-allowed'}`}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-xs font-bold shadow-sm">
                {state === 'done' ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              {step.title}
            </button>
            {i < WIZARD_STEPS.length - 1 && <ChevronRight className="h-4 w-4 text-slate-300" />}
          </li>
        );
      })}
    </ol>
  );
}

// ── Sequence picker (step 3) ─────────────────────────────────────────────────

function SequenceCard({
  sequence,
  selected,
  onSelect,
  templateNameById,
  approvedTemplateIds,
}: {
  sequence: Sequence;
  selected: boolean;
  onSelect: () => void;
  templateNameById: Map<string, string>;
  approvedTemplateIds: Set<string>;
}) {
  const unreadySteps = sequence.steps.filter(
    (step) => !step.templateId || !approvedTemplateIds.has(step.templateId),
  );
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-lg border p-4 text-left transition-colors ${
        selected ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500' : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="font-medium text-slate-900">{sequence.name}</span>
        {selected && <CheckCircle2 className="h-4 w-4 text-indigo-600" />}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {sequence.steps.map((step) => (
          <span
            key={step.stepNumber}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${CHANNEL_COLORS[step.channel] ?? 'bg-slate-50 border-slate-200'}`}
          >
            {CHANNEL_ICONS[step.channel]}
            <span>
              {step.templateId
                ? templateNameById.get(step.templateId) ?? 'Unknown template'
                : 'No template'}
            </span>
            <span className="text-slate-500">
              {step.delayHours === 0 ? '(immediate)' : `+${step.delayHours}h`}
            </span>
          </span>
        ))}
      </div>
      {unreadySteps.length > 0 && (
        <p className="mt-2 flex items-center gap-1 text-xs text-amber-700">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {unreadySteps.length} step{unreadySteps.length !== 1 ? 's' : ''} missing an approved
          template — launch will be blocked until fixed.
        </p>
      )}
    </button>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function CampaignFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEditMode = Boolean(id);

  const navigate = useNavigate();
  const createCampaign = useCreateCampaign();
  const updateCampaign = useUpdateCampaign();
  const launchCampaign = useLaunchCampaign();
  const createSequence = useCreateSequence();
  const { data: pipelines } = usePipelines();

  const { data: sequenceData } = useSequences();
  const sequences = ((sequenceData as { items?: Sequence[] } | undefined)?.items ?? []).map(
    (seq) => ({ ...seq, steps: Array.isArray(seq.steps) ? seq.steps : [] }),
  );

  const { data: allTemplates = [] } = useTemplates();
  const templateNameById = new Map(allTemplates.map((t) => [t.id, t.name]));
  const approvedTemplateIds = new Set(
    allTemplates.filter((t) => t.approval_status === 'approved').map((t) => t.id),
  );

  const { data: existingCampaign, isLoading: isCampaignLoading } = useCampaign(id ?? '');

  const { showToast } = useToast();

  const [step, setStep] = useState(0);
  const [maxReached, setMaxReached] = useState(0);

  const [name, setName] = useState('');
  const [tone, setTone] = useState<'formal' | 'professional' | 'conversational'>('professional');
  const [targetIndustries, setTargetIndustries] = useState('');
  const [targetCountries, setTargetCountries] = useState('');
  const [pipelineId, setPipelineId] = useState('');
  const [triggerStageId, setTriggerStageId] = useState<string>('');
  const [sequenceId, setSequenceId] = useState('');
  const [aiPersonalizationEnabled, setAiPersonalizationEnabled] = useState(false);
  const [showNewSequence, setShowNewSequence] = useState(false);

  // Set once the campaign row exists (immediately in edit mode) — enables the readiness check.
  const [savedCampaignId, setSavedCampaignId] = useState<string | null>(id ?? null);

  const { data: preview, isLoading: isPreviewLoading } = useAutomationPreview(
    savedCampaignId ?? '',
    step === 3 && !!savedCampaignId,
  );

  // Fetch stages for the selected pipeline
  const { data: selectedPipeline } = usePipeline(pipelineId);
  const stages = selectedPipeline?.stages ?? [];

  useEffect(() => {
    if (isEditMode && existingCampaign) {
      setName(existingCampaign.name);
      setTone(existingCampaign.tone);
      setTargetIndustries(existingCampaign.target_industries.join(', '));
      setTargetCountries(existingCampaign.target_countries.join(', '));
      setPipelineId(existingCampaign.pipeline_id || '');
      setTriggerStageId(existingCampaign.trigger_stage_id || '');
      setSequenceId(existingCampaign.sequence_id || '');
      setAiPersonalizationEnabled(existingCampaign.ai_personalization_enabled);
      setMaxReached(WIZARD_STEPS.length - 1);
    }
  }, [isEditMode, existingCampaign]);

  const goTo = (next: number) => {
    setStep(next);
    setMaxReached((prev) => Math.max(prev, next));
  };

  // When pipeline changes, clear trigger stage if it no longer belongs to the new pipeline
  const handlePipelineChange = (newPipelineId: string) => {
    setPipelineId(newPipelineId);
    setTriggerStageId(''); // reset stage on pipeline change
  };

  const buildPayload = () => ({
    name,
    tone,
    target_industries: targetIndustries
      ? targetIndustries.split(',').map((s) => s.trim()).filter(Boolean)
      : [],
    target_countries: targetCountries
      ? targetCountries.split(',').map((s) => s.trim()).filter(Boolean)
      : [],
    pipeline_id: pipelineId || undefined,
    trigger_stage_id: triggerStageId || null,
    sequence_id: sequenceId || undefined,
    ai_personalization_enabled: aiPersonalizationEnabled,
  });

  const isSaving = createCampaign.isPending || updateCampaign.isPending;

  const handleSave = async (): Promise<string | null> => {
    try {
      if (savedCampaignId) {
        await updateCampaign.mutateAsync({ id: savedCampaignId, input: buildPayload() });
        showToast('Campaign saved.', 'success');
        return savedCampaignId;
      }
      const created = await createCampaign.mutateAsync(buildPayload());
      setSavedCampaignId(created.id);
      showToast('Campaign saved as draft.', 'success');
      return created.id;
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to save campaign.'), 'error');
      return null;
    }
  };

  const handleLaunch = async () => {
    const campaignId = await handleSave();
    if (!campaignId) return;
    try {
      await launchCampaign.mutateAsync(campaignId);
      showToast('Campaign launched.', 'success');
      navigate(`/campaigns/${campaignId}`);
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to launch campaign.'), 'error');
    }
  };

  const handleFinishDraft = async () => {
    const campaignId = await handleSave();
    if (campaignId) navigate(`/campaigns/${campaignId}`);
  };

  const handleCreateSequence = async (seqName: string, steps: SequenceStep[]) => {
    try {
      const created = await createSequence.mutateAsync({ name: seqName, steps });
      setSequenceId(created.id);
      setShowNewSequence(false);
      showToast('Sequence created and attached to this campaign.', 'success');
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to create sequence.'), 'error');
    }
  };

  if (isEditMode && isCampaignLoading) {
    return <div className="p-8 text-center">Loading campaign details...</div>;
  }

  const selectedSequence = sequences.find((seq) => seq.id === sequenceId);
  const selectedStageName = stages.find((stage) => stage.id === triggerStageId)?.name;
  const issues = preview ? [...preview.templateIssues, ...preview.connectorIssues] : [];

  const inputClass =
    'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEditMode ? 'Edit Campaign' : 'Create Campaign'}
        eyebrow="Campaigns"
      />
      <StepIndicator current={step} onSelect={goTo} maxReached={maxReached} />

      {/* ── Step 1: Basics ─────────────────────────────────────────────────── */}
      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Campaign Basics</CardTitle>
            <CardDescription>Name the campaign and describe who it targets.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name">Campaign Name *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Q1 Restaurant Outreach"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="tone">Message Tone</Label>
              <select
                id="tone"
                value={tone}
                onChange={(e) => setTone(e.target.value as 'formal' | 'professional' | 'conversational')}
                className={inputClass}
              >
                <option value="formal">Formal</option>
                <option value="professional">Professional</option>
                <option value="conversational">Conversational</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="target_industries">Target Industries (comma-separated)</Label>
              <Input
                id="target_industries"
                value={targetIndustries}
                onChange={(e) => setTargetIndustries(e.target.value)}
                placeholder="e.g., restaurants, retail, healthcare"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="target_countries">Target Countries (comma-separated)</Label>
              <Input
                id="target_countries"
                value={targetCountries}
                onChange={(e) => setTargetCountries(e.target.value)}
                placeholder="e.g., US, UK, Canada"
              />
            </div>

            <div className="flex flex-row items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="ai_personalization_enabled" className="text-base">AI Personalization</Label>
                <div className="text-sm text-muted-foreground">
                  Use OpenAI to personalize outreach messages for each lead based on their details.
                </div>
              </div>
              <Switch
                id="ai_personalization_enabled"
                checked={aiPersonalizationEnabled}
                onCheckedChange={setAiPersonalizationEnabled}
                className="data-[state=checked]:bg-indigo-600"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Step 2: Pipeline trigger ───────────────────────────────────────── */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitBranch className="h-5 w-5 text-slate-500" />
              Pipeline Auto-Enrollment
            </CardTitle>
            <CardDescription>
              Optional — connect this campaign to a pipeline so leads enroll automatically when
              they move stages. Skip this if you will add leads manually from the Leads page.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pipeline">Pipeline</Label>
              <select
                id="pipeline"
                value={pipelineId}
                onChange={(e) => handlePipelineChange(e.target.value)}
                className={inputClass}
              >
                <option value="">No pipeline trigger — add leads manually</option>
                {pipelines?.map((pipeline) => (
                  <option key={pipeline.id} value={pipeline.id}>
                    {pipeline.name}
                  </option>
                ))}
              </select>
            </div>

            {pipelineId && (
              <div className="space-y-2">
                <Label htmlFor="trigger_stage">
                  Trigger Stage
                  <span className="ml-1 text-xs font-normal text-slate-500">(optional)</span>
                </Label>
                <select
                  id="trigger_stage"
                  value={triggerStageId}
                  onChange={(e) => setTriggerStageId(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Any stage move (catch-all)</option>
                  {stages
                    .slice()
                    .sort((a, b) => a.position - b.position)
                    .map((stage) => (
                      <option key={stage.id} value={stage.id}>
                        {stage.name}
                        {stage.is_terminal_won ? ' ✓ Won' : stage.is_terminal_lost ? ' ✗ Lost' : ''}
                      </option>
                    ))}
                </select>
                <p className="flex items-center gap-1 text-xs text-slate-500">
                  <Info className="h-3 w-3 shrink-0" />
                  {triggerStageId
                    ? 'Leads will be auto-enrolled only when they reach this exact stage.'
                    : 'Leads will be auto-enrolled on any stage move within this pipeline.'}
                </p>
              </div>
            )}

            {!pipelineId && (
              <p className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                <Info className="h-3.5 w-3.5 shrink-0" />
                Without a pipeline trigger, this campaign only reaches leads you add to it
                explicitly (from the Leads page or the campaign detail page).
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Step 3: Sequence ───────────────────────────────────────────────── */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Outreach Sequence</CardTitle>
            <CardDescription>
              The sequence defines which messages go out, on which channels, and how far apart.
              Each step uses an approved template.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {sequences.length > 0 && (
              <div className="space-y-2">
                {sequences.map((seq) => (
                  <SequenceCard
                    key={seq.id}
                    sequence={seq}
                    selected={sequenceId === seq.id}
                    onSelect={() => setSequenceId(seq.id === sequenceId ? '' : seq.id)}
                    templateNameById={templateNameById}
                    approvedTemplateIds={approvedTemplateIds}
                  />
                ))}
              </div>
            )}

            {!showNewSequence ? (
              <Button type="button" variant="outline" onClick={() => setShowNewSequence(true)}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                Build a new sequence
              </Button>
            ) : (
              <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-4">
                <h3 className="mb-3 text-sm font-semibold text-slate-900">New Sequence</h3>
                <SequenceForm
                  onSave={handleCreateSequence}
                  onCancel={() => setShowNewSequence(false)}
                  isPending={createSequence.isPending}
                />
              </div>
            )}

            {!sequenceId && (
              <p className="flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Without a sequence the campaign can be saved as a draft, but it cannot launch — no
                messages would go out.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Step 4: Review & Launch ────────────────────────────────────────── */}
      {step === 3 && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Review</CardTitle>
              <CardDescription>Everything the campaign will do, in one place.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-slate-500">Name</dt>
                  <dd className="font-medium text-slate-900">{name || '—'}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Tone</dt>
                  <dd className="font-medium text-slate-900 capitalize">{tone}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Targeting</dt>
                  <dd className="font-medium text-slate-900">
                    {[targetIndustries, targetCountries].filter(Boolean).join(' · ') || 'All leads'}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Pipeline trigger</dt>
                  <dd className="font-medium text-slate-900">
                    {pipelineId
                      ? `${selectedPipeline?.name ?? 'Pipeline'} → ${selectedStageName ?? 'any stage move'}`
                      : 'None (manual lead adds only)'}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-slate-500">Sequence</dt>
                  <dd className="mt-1">
                    {selectedSequence ? (
                      <div className="flex flex-wrap gap-2">
                        {selectedSequence.steps.map((s) => (
                          <span
                            key={s.stepNumber}
                            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${CHANNEL_COLORS[s.channel] ?? 'bg-slate-50 border-slate-200'}`}
                          >
                            {CHANNEL_ICONS[s.channel]}
                            <span className="font-medium">{CHANNEL_LABELS[s.channel]}</span>
                            <span className="text-slate-500">
                              {s.delayHours === 0 ? '(immediate)' : `+${s.delayHours}h`}
                            </span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="font-medium text-amber-700">
                        No sequence selected — launch is blocked.
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">AI Personalization</dt>
                  <dd className="font-medium text-slate-900">
                    {aiPersonalizationEnabled ? 'Enabled' : 'Disabled'}
                  </dd>
                </div>
              </dl>

              {aiPersonalizationEnabled && (
                <p className="mt-4 flex items-center gap-1 rounded-md border border-purple-200 bg-purple-50 p-3 text-xs text-purple-800">
                  <Sparkles className="h-3.5 w-3.5 shrink-0" />
                  AI personalization requires an approved AI campaign brief before launch.
                  {savedCampaignId && (
                    <Link to={`/campaigns/${savedCampaignId}/brief`} className="font-medium underline">
                      Open the AI Brief page
                    </Link>
                  )}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Readiness Check</CardTitle>
              <CardDescription>
                {savedCampaignId
                  ? 'Live checks against templates, connectors, and enrolled leads.'
                  : 'Save the campaign to run the readiness check.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!savedCampaignId ? (
                <Button onClick={handleSave} disabled={isSaving || !name.trim()}>
                  {isSaving ? 'Saving…' : 'Save draft & check readiness'}
                </Button>
              ) : isPreviewLoading ? (
                <div className="text-sm text-slate-500">Running readiness checks…</div>
              ) : preview ? (
                <>
                  {issues.length === 0 ? (
                    <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      All templates approved and connectors ready.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {preview.templateIssues.map((issue) => (
                        <div
                          key={issue}
                          className="flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
                        >
                          <span className="flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4 shrink-0" />
                            {issue}
                          </span>
                          <Button type="button" variant="outline" size="sm" onClick={() => goTo(2)}>
                            Fix sequence
                          </Button>
                        </div>
                      ))}
                      {preview.connectorIssues.map((issue) => (
                        <div
                          key={issue}
                          className="flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
                        >
                          <span className="flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4 shrink-0" />
                            {issue}
                          </span>
                          <Button asChild variant="outline" size="sm">
                            <Link to="/settings/integrations">Open Integrations</Link>
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div className="rounded-md border p-3">
                      <div className="text-slate-500">Eligible leads</div>
                      <div className="text-2xl font-semibold text-green-700">{preview.eligibleLeads.length}</div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-slate-500">Skipped</div>
                      <div className="text-2xl font-semibold text-amber-700">{preview.skippedLeads.length}</div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div className="text-slate-500">Messages queued at launch</div>
                      <div className="text-2xl font-semibold text-slate-900">{preview.expectedJobs}</div>
                    </div>
                  </div>

                  {preview.eligibleLeads.length === 0 && preview.skippedLeads.length === 0 && (
                    <p className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                      <Users className="h-3.5 w-3.5 shrink-0" />
                      No leads in this campaign yet. Add them from the{' '}
                      <Link to="/leads" className="font-medium underline">
                        Leads page
                      </Link>
                      {pipelineId ? ', or let the pipeline trigger enroll them automatically.' : '.'}
                    </p>
                  )}
                </>
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Navigation ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => navigate('/campaigns')}>
            Cancel
          </Button>
          {step > 0 && (
            <Button type="button" variant="outline" onClick={() => goTo(step - 1)}>
              <ChevronLeft className="mr-1 h-4 w-4" />
              Back
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          {step < 3 ? (
            <Button type="button" onClick={() => goTo(step + 1)} disabled={step === 0 && !name.trim()}>
              Next
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={handleFinishDraft} disabled={isSaving || !name.trim()}>
                {isSaving ? 'Saving…' : 'Save as draft'}
              </Button>
              <Button
                type="button"
                onClick={handleLaunch}
                disabled={
                  isSaving ||
                  launchCampaign.isPending ||
                  !name.trim() ||
                  !sequenceId ||
                  (!!preview && issues.length > 0)
                }
              >
                <Play className="mr-1 h-4 w-4" />
                {launchCampaign.isPending ? 'Launching…' : 'Save & Launch'}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

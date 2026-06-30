import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useCreateCampaign, useUpdateCampaign, useCampaign } from '@/api/campaigns';
import { usePipelines } from '@/api/pipelines';
import { useSequences } from '@/api/outreach';
import type { Sequence } from '@/api/outreach';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';

export function CampaignFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEditMode = Boolean(id);
  
  const navigate = useNavigate();
  const createCampaign = useCreateCampaign();
  const updateCampaign = useUpdateCampaign();
  const { data: pipelines } = usePipelines();
  
  const { data: sequenceData } = useSequences();
  const sequences = (sequenceData as { items?: Sequence[] } | undefined)?.items ?? [];

  const { data: existingCampaign, isLoading: isCampaignLoading } = useCampaign(id ?? '');

  const { showToast } = useToast();

  const [name, setName] = useState('');
  const [tone, setTone] = useState<'formal' | 'professional' | 'conversational'>('professional');
  const [targetIndustries, setTargetIndustries] = useState('');
  const [targetCountries, setTargetCountries] = useState('');
  const [pipelineId, setPipelineId] = useState('');
  const [sequenceId, setSequenceId] = useState('');
  const [aiPersonalizationEnabled, setAiPersonalizationEnabled] = useState(false);

  useEffect(() => {
    if (isEditMode && existingCampaign) {
      setName(existingCampaign.name);
      setTone(existingCampaign.tone);
      setTargetIndustries(existingCampaign.target_industries.join(', '));
      setTargetCountries(existingCampaign.target_countries.join(', '));
      setPipelineId(existingCampaign.pipeline_id || '');
      setSequenceId(existingCampaign.sequence_id || '');
      setAiPersonalizationEnabled(existingCampaign.ai_personalization_enabled);
    }
  }, [isEditMode, existingCampaign]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const payload = {
      name,
      tone,
      target_industries: targetIndustries
        ? targetIndustries.split(',').map((s) => s.trim()).filter(Boolean)
        : [],
      target_countries: targetCountries
        ? targetCountries.split(',').map((s) => s.trim()).filter(Boolean)
        : [],
      pipeline_id: pipelineId || undefined,
      sequence_id: sequenceId || undefined,
      ai_personalization_enabled: aiPersonalizationEnabled,
    };

    try {
      if (isEditMode && id) {
        await updateCampaign.mutateAsync({ id, input: payload });
        showToast('Campaign updated.', 'success');
      } else {
        await createCampaign.mutateAsync(payload);
        showToast('Campaign created.', 'success');
      }
      navigate('/campaigns');
    } catch (error) {
      showToast(getApiErrorMessage(error, `Failed to ${isEditMode ? 'update' : 'create'} campaign.`), 'error');
    }
  };

  if (isEditMode && isCampaignLoading) {
    return <div className="p-8 text-center">Loading campaign details...</div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-900">{isEditMode ? 'Edit Campaign' : 'Create Campaign'}</h1>

      <Card>
        <CardHeader>
          <CardTitle>Campaign Details</CardTitle>
          <CardDescription>
            Configure your outreach campaign settings
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
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
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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

            <div className="space-y-2">
              <Label htmlFor="pipeline">Pipeline (Optional)</Label>
              <select
                id="pipeline"
                value={pipelineId}
                onChange={(e) => setPipelineId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="">Select a pipeline</option>
                {pipelines?.map((pipeline) => (
                  <option key={pipeline.id} value={pipeline.id}>
                    {pipeline.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sequence">Outreach Sequence (Optional)</Label>
              <select
                id="sequence"
                value={sequenceId}
                onChange={(e) => setSequenceId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="">Select a sequence</option>
                {sequences?.map((seq) => (
                  <option key={seq.id} value={seq.id}>
                    {seq.name}
                  </option>
                ))}
              </select>
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

            <div className="flex justify-end space-x-4">
              <Button type="button" variant="outline" onClick={() => navigate('/campaigns')}>
                Cancel
              </Button>
              <Button type="submit" disabled={isEditMode ? updateCampaign.isPending : createCampaign.isPending}>
                {isEditMode
                  ? (updateCampaign.isPending ? 'Updating...' : 'Update Campaign')
                  : (createCampaign.isPending ? 'Creating...' : 'Create Campaign')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

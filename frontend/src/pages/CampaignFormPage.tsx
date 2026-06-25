import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCreateCampaign } from '@/api/campaigns';
import { usePipelines } from '@/api/pipelines';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function CampaignFormPage() {
  const navigate = useNavigate();
  const createCampaign = useCreateCampaign();
  const { data: pipelines } = usePipelines();

  const [name, setName] = useState('');
  const [tone, setTone] = useState<'formal' | 'professional' | 'conversational'>('professional');
  const [targetIndustries, setTargetIndustries] = useState('');
  const [targetCountries, setTargetCountries] = useState('');
  const [pipelineId, setPipelineId] = useState('');
  const [aiPersonalizationEnabled, setAiPersonalizationEnabled] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      await createCampaign.mutateAsync({
        name,
        tone,
        target_industries: targetIndustries
          ? targetIndustries.split(',').map((s) => s.trim()).filter(Boolean)
          : [],
        target_countries: targetCountries
          ? targetCountries.split(',').map((s) => s.trim()).filter(Boolean)
          : [],
        pipeline_id: pipelineId || undefined,
        ai_personalization_enabled: aiPersonalizationEnabled,
      });
      navigate('/campaigns');
    } catch (error) {
      console.error('Failed to create campaign:', error);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-900">Create Campaign</h1>

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
              <Button type="submit" disabled={createCampaign.isPending}>
                {createCampaign.isPending ? 'Creating...' : 'Create Campaign'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

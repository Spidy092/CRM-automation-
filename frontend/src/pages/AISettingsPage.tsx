import React, { useState, useEffect } from 'react';
import { useAiSettings, useUpdateAiSettings } from '../api/aiSettings';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { Textarea } from '../components/ui/textarea';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../components/ui/card';
import { AlertCircle, CheckCircle2, Save } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';

// Provider presets for OpenAI-compatible chat-completions APIs.
// The backend is provider-agnostic: it forwards base_url + api_key + model
// straight to the OpenAI SDK, so any compatible endpoint works.
type ProviderId = 'xiaomi' | 'openai' | 'custom';

const PROVIDER_PRESETS: Record<
  ProviderId,
  { label: string; base_url: string; model: string; keyHint: string; docsUrl?: string }
> = {
  xiaomi: {
    label: 'Xiaomi MiMo',
    base_url: 'https://api.xiaomimimo.com/v1',
    model: 'mimo-v2.5-pro',
    keyHint: 'sk-... or tp-...',
    docsUrl: 'https://mimo.mi.com/docs/en-US/quick-start/summary/first-api-call',
  },
  openai: {
    label: 'OpenAI',
    base_url: '', // empty → OpenAI SDK uses its default https://api.openai.com/v1
    model: 'gpt-4o',
    keyHint: 'sk-...',
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  custom: {
    label: 'Custom (OpenAI-compatible)',
    base_url: '',
    model: '',
    keyHint: 'Your provider API key',
  },
};

// Infer which provider a stored base_url corresponds to (null = not yet configured).
function detectProvider(baseUrl: string | null): ProviderId | null {
  if (!baseUrl) return null;
  if (baseUrl.includes('xiaomimimo')) return 'xiaomi';
  if (baseUrl.includes('openai.com')) return 'openai';
  return 'custom';
}

export default function AISettingsPage() {
  const { data: settings, isLoading, error } = useAiSettings();
  const updateMutation = useUpdateAiSettings();
  const { showToast } = useToast();

  // Default new installs to Xiaomi MiMo.
  const [provider, setProvider] = useState<ProviderId>('xiaomi');

  const [formData, setFormData] = useState({
    enabled: false,
    base_url: PROVIDER_PRESETS.xiaomi.base_url,
    api_key: '',
    model: PROVIDER_PRESETS.xiaomi.model,
    max_tokens: 500,
    temperature: 0.7,
    system_prompt_override: '',
    cache_ttl_seconds: 604800,
  });

  useEffect(() => {
    if (settings) {
      const detected = detectProvider(settings.base_url);
      // Configured-but-no-base_url means OpenAI default endpoint; otherwise a
      // brand-new install with nothing saved yet keeps the MiMo default.
      const resolvedProvider: ProviderId =
        detected ?? (settings.has_api_key ? 'openai' : 'xiaomi');
      const usePreset = !detected && !settings.has_api_key;

      setProvider(resolvedProvider);
      setFormData({
        enabled: settings.enabled,
        base_url: usePreset ? PROVIDER_PRESETS.xiaomi.base_url : settings.base_url || '',
        api_key: '', // Never populate API key from server
        model: usePreset ? PROVIDER_PRESETS.xiaomi.model : settings.model || 'gpt-4o',
        max_tokens: settings.max_tokens || 500,
        temperature: settings.temperature || 0.7,
        system_prompt_override: settings.system_prompt_override || '',
        cache_ttl_seconds: settings.cache_ttl_seconds || 604800,
      });
    }
  }, [settings]);

  // Selecting a preset auto-fills base_url + model. "Custom" leaves them as-is.
  const handleProviderChange = (next: ProviderId) => {
    setProvider(next);
    if (next === 'custom') return;
    setFormData((prev) => ({
      ...prev,
      base_url: PROVIDER_PRESETS[next].base_url,
      model: PROVIDER_PRESETS[next].model,
    }));
  };

  // Manual edits to the endpoint keep the provider dropdown honest.
  const handleBaseUrlChange = (value: string) => {
    setFormData((prev) => ({ ...prev, base_url: value }));
    setProvider(detectProvider(value) ?? 'custom');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate(
      {
        ...formData,
        base_url: formData.base_url || null,
        api_key: formData.api_key || undefined,
        system_prompt_override: formData.system_prompt_override || null,
      },
      {
        onSuccess: () => showToast('AI settings saved.', 'success'),
        onError: (err) => showToast(getApiErrorMessage(err, 'Failed to update settings.'), 'error'),
      },
    );
  };

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Loading AI settings...</div>;
  if (error) return <div className="p-8 text-center text-destructive">Failed to load AI settings.</div>;

  return (
    <div className="container mx-auto p-6 max-w-4xl space-y-8 animate-in fade-in zoom-in-95 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">AI Personalization Settings</h1>
        <p className="text-muted-foreground mt-2">
          Configure the AI provider used for generating personalized outreach messages. Works with
          any OpenAI-compatible API (Xiaomi MiMo, OpenAI, or a custom endpoint).
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="border-primary/10 shadow-md">
          <CardHeader className="bg-primary/5 pb-4 border-b">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Enable AI Engine</CardTitle>
                <CardDescription>
                  Globally enable or disable AI outreach personalization.
                </CardDescription>
              </div>
              <Switch
                checked={formData.enabled}
                onCheckedChange={(checked) => setFormData({ ...formData, enabled: checked })}
                className="data-[state=checked]:bg-primary"
              />
            </div>
          </CardHeader>
          <CardContent className="pt-6 space-y-6">

            <div className="space-y-2">
              <Label htmlFor="provider">AI Provider</Label>
              <select
                id="provider"
                value={provider}
                onChange={(e) => handleProviderChange(e.target.value as ProviderId)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {(Object.keys(PROVIDER_PRESETS) as ProviderId[]).map((id) => (
                  <option key={id} value={id}>
                    {PROVIDER_PRESETS[id].label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Picking a provider fills in its base URL and model. Choose “Custom” to enter your own,
                then paste the API key below.
                {PROVIDER_PRESETS[provider].docsUrl && (
                  <>
                    {' '}
                    <a
                      href={PROVIDER_PRESETS[provider].docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline"
                    >
                      Where do I get a key?
                    </a>
                  </>
                )}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="api_key">API Key {settings?.has_api_key && <span className="text-green-500 text-xs ml-2">(Stored)</span>}</Label>
                <Input
                  id="api_key"
                  type="password"
                  placeholder={settings?.has_api_key ? '••••••••••••••••' : PROVIDER_PRESETS[provider].keyHint}
                  value={formData.api_key}
                  onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                  className="transition-all focus:ring-primary"
                />
                <p className="text-xs text-muted-foreground">Leave blank to keep current key.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="base_url">API Base URL {provider === 'openai' && '(Optional)'}</Label>
                <Input
                  id="base_url"
                  placeholder="https://api.xiaomimimo.com/v1"
                  value={formData.base_url}
                  onChange={(e) => handleBaseUrlChange(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="model">Model</Label>
                <Input
                  id="model"
                  placeholder="mimo-v2.5-pro"
                  value={formData.model}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="max_tokens">Max Tokens</Label>
                <Input
                  id="max_tokens"
                  type="number"
                  min={1}
                  max={500}
                  value={formData.max_tokens}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      max_tokens: Math.min(parseInt(e.target.value) || 500, 500),
                    })
                  }
                />
                <p className="text-xs text-muted-foreground">Max 500 (cost-control cap).</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="temperature">Temperature (0.0 to 2.0)</Label>
                <Input
                  id="temperature"
                  type="number"
                  step="0.1"
                  min={0}
                  max={2}
                  value={formData.temperature}
                  onChange={(e) => setFormData({ ...formData, temperature: parseFloat(e.target.value) || 0.7 })}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="cache_ttl">Cache TTL (Seconds)</Label>
                <Input
                  id="cache_ttl"
                  type="number"
                  min={60}
                  value={formData.cache_ttl_seconds}
                  onChange={(e) => setFormData({ ...formData, cache_ttl_seconds: parseInt(e.target.value) || 604800 })}
                />
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <Label htmlFor="system_prompt_override">System Prompt Override (Optional)</Label>
              <Textarea
                id="system_prompt_override"
                placeholder="You are a helpful CRM outreach assistant..."
                className="min-h-[120px] font-mono text-sm"
                value={formData.system_prompt_override}
                onChange={(e) => setFormData({ ...formData, system_prompt_override: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to use the default CRM prompt. The prompt directs the AI on how to process the lead and template.
              </p>
            </div>

            {updateMutation.isSuccess && (
              <Alert className="bg-green-500/10 text-green-700 border-green-500/20">
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>Success</AlertTitle>
                <AlertDescription>AI Settings updated successfully.</AlertDescription>
              </Alert>
            )}

            {updateMutation.isError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{updateMutation.error?.message || 'Failed to update settings.'}</AlertDescription>
              </Alert>
            )}
          </CardContent>
          <CardFooter className="bg-muted/50 px-6 py-4 flex justify-end">
            <Button type="submit" disabled={updateMutation.isPending} className="gap-2">
              <Save className="h-4 w-4" />
              {updateMutation.isPending ? 'Saving...' : 'Save Settings'}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}

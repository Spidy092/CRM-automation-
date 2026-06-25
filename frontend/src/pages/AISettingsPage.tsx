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

export default function AISettingsPage() {
  const { data: settings, isLoading, error } = useAiSettings();
  const updateMutation = useUpdateAiSettings();

  const [formData, setFormData] = useState({
    enabled: false,
    base_url: '',
    api_key: '',
    model: 'gpt-4o',
    max_tokens: 500,
    temperature: 0.7,
    system_prompt_override: '',
    cache_ttl_seconds: 604800,
  });

  useEffect(() => {
    if (settings) {
      setFormData({
        enabled: settings.enabled,
        base_url: settings.base_url || '',
        api_key: '', // Never populate API key from server
        model: settings.model || 'gpt-4o',
        max_tokens: settings.max_tokens || 500,
        temperature: settings.temperature || 0.7,
        system_prompt_override: settings.system_prompt_override || '',
        cache_ttl_seconds: settings.cache_ttl_seconds || 604800,
      });
    }
  }, [settings]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate({
      ...formData,
      base_url: formData.base_url || null,
      api_key: formData.api_key || undefined,
      system_prompt_override: formData.system_prompt_override || null,
    });
  };

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Loading AI settings...</div>;
  if (error) return <div className="p-8 text-center text-destructive">Failed to load AI settings.</div>;

  return (
    <div className="container mx-auto p-6 max-w-4xl space-y-8 animate-in fade-in zoom-in-95 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">AI Personalization Settings</h1>
        <p className="text-muted-foreground mt-2">
          Configure the OpenAI integration used for generating personalized outreach messages.
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
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="api_key">OpenAI API Key {settings?.has_api_key && <span className="text-green-500 text-xs ml-2">(Stored)</span>}</Label>
                <Input
                  id="api_key"
                  type="password"
                  placeholder={settings?.has_api_key ? '••••••••••••••••' : 'sk-...'}
                  value={formData.api_key}
                  onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                  className="transition-all focus:ring-primary"
                />
                <p className="text-xs text-muted-foreground">Leave blank to keep current key.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="base_url">API Base URL (Optional)</Label>
                <Input
                  id="base_url"
                  placeholder="https://api.openai.com/v1"
                  value={formData.base_url}
                  onChange={(e) => setFormData({ ...formData, base_url: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="model">Model</Label>
                <Input
                  id="model"
                  placeholder="gpt-4o"
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
                  max={2000}
                  value={formData.max_tokens}
                  onChange={(e) => setFormData({ ...formData, max_tokens: parseInt(e.target.value) || 500 })}
                />
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

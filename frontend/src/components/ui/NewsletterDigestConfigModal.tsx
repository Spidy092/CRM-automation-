import React, { useState, useEffect } from 'react';
import { Button } from './button';
import { Input } from './input';
import { Textarea } from './textarea';
import { Sparkles, Save } from 'lucide-react';
import { useDigestConfig, useUpdateDigestConfig, type NewsletterDigestConfig } from '@/api/newsletter';
import { useToast } from '@/components/ui/Toast';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

interface Props {
  onClose: () => void;
}

export function NewsletterDigestConfigModal({ onClose }: Props) {
  const { data: config, isLoading } = useDigestConfig();
  const updateMutation = useUpdateDigestConfig();
  const { showToast } = useToast();

  const [formData, setFormData] = useState<NewsletterDigestConfig>({
    topic: 'Weekly Sales Tips & Growth Hacks',
    tone: 'professional',
    customPrompt: 'Provide actionable sales techniques and productivity advice.',
    targetAudience: 'Sales reps and business professionals',
  });

  useEffect(() => {
    if (config) {
      setFormData(config);
    }
  }, [config]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.topic.trim()) {
      showToast('Please provide a digest topic.', 'error');
      return;
    }
    try {
      await updateMutation.mutateAsync(formData);
      showToast('AI Digest settings updated successfully!');
      onClose();
    } catch (err) {
      showToast('Failed to save AI Digest settings.', 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-center gap-2 mb-4">
          <div className="p-2 rounded-lg bg-primary/10 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">AI Digest Settings</h2>
            <p className="text-xs text-slate-500">Customize the topic, tone, and guidelines for Friday AI newsletters.</p>
          </div>
        </div>

        {isLoading ? (
          <div className="py-8 flex justify-center">
            <LoadingSpinner />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Digest Topic / Title</label>
              <Input
                value={formData.topic}
                onChange={(e) => setFormData({ ...formData, topic: e.target.value })}
                placeholder="e.g. Weekly Sales Strategy & Prospecting Hacks"
                required
              />
              <p className="mt-1 text-[11px] text-slate-500">Main subject header sent to subscribers every Friday.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Tone of Voice</label>
                <select
                  value={formData.tone}
                  onChange={(e) =>
                    setFormData({ ...formData, tone: e.target.value as NewsletterDigestConfig['tone'] })
                  }
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="professional">Professional & Direct</option>
                  <option value="casual">Casual & Friendly</option>
                  <option value="motivational">Motivational & High Energy</option>
                  <option value="technical">Technical & In-Depth</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Target Audience</label>
                <Input
                  value={formData.targetAudience}
                  onChange={(e) => setFormData({ ...formData, targetAudience: e.target.value })}
                  placeholder="e.g. B2B Account Executives"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Custom Content Prompt & Instructions</label>
              <Textarea
                value={formData.customPrompt}
                onChange={(e) => setFormData({ ...formData, customPrompt: e.target.value })}
                placeholder="e.g. Include 3 actionable tips for closing deals faster and 1 weekly objection handling template."
                rows={4}
              />
              <p className="mt-1 text-[11px] text-slate-500">Guide the AI on specific sub-topics, bullet formatting, or key takeaways to highlight.</p>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button type="button" variant="outline" onClick={onClose} disabled={updateMutation.isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateMutation.isPending} className="gap-2">
                <Save className="h-4 w-4" />
                {updateMutation.isPending ? 'Saving...' : 'Save Settings'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

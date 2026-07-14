import { useState } from 'react';
import { 
  useScoringConfig, 
  useUpdateScoringConfig, 
  useScoringRules, 
  useCreateScoringRule, 
  useDeleteScoringRule 
} from '@/api/scoring';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/PageHeader';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Trash2, Plus, Save } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';

export function ScoringPage() {
  const { data: config, isLoading: isConfigLoading } = useScoringConfig();
  const { data: rules, isLoading: isRulesLoading } = useScoringRules();
  const updateConfig = useUpdateScoringConfig();
  const createRule = useCreateScoringRule();
  const deleteRule = useDeleteScoringRule();
  const { showToast } = useToast();

  const [hotScore, setHotScore] = useState<number | ''>('');
  const [warmScore, setWarmScore] = useState<number | ''>('');
  const [threshold, setThreshold] = useState<number | ''>('');

  const [newRuleFactor, setNewRuleFactor] = useState('');
  const [newRuleScore, setNewRuleScore] = useState('');

  // Sync config when loaded
  if (config && hotScore === '' && warmScore === '' && threshold === '') {
    setHotScore(config.hot_min_score);
    setWarmScore(config.warm_min_score);
    setThreshold(config.assignment_threshold);
  }

  const handleSaveConfig = async () => {
    try {
      await updateConfig.mutateAsync({
        hot_min_score: Number(hotScore),
        warm_min_score: Number(warmScore),
        assignment_threshold: Number(threshold),
      });
      showToast('Scoring configuration updated.', 'success');
    } catch {
      showToast('Failed to update config.', 'error');
    }
  };

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createRule.mutateAsync({
        factor: newRuleFactor,
        weight: 1.0,
        condition: { type: 'equals', value: 'example' }, // Default placeholder condition for MVP
        score_value: Number(newRuleScore),
        is_active: true,
      });
      setNewRuleFactor('');
      setNewRuleScore('');
      showToast('Scoring rule created.', 'success');
    } catch {
      showToast('Failed to create rule.', 'error');
    }
  };

  const handleDeleteRule = async (id: string) => {
    if (window.confirm('Delete this scoring rule?')) {
      try {
        await deleteRule.mutateAsync(id);
        showToast('Rule deleted.', 'success');
      } catch {
        showToast('Failed to delete rule.', 'error');
      }
    }
  };

  if (isConfigLoading || isRulesLoading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Lead Scoring" eyebrow="Automation" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Global Configuration */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle>Score Thresholds</CardTitle>
            <CardDescription>
              Define the minimum scores for lead classifications.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="hot-score">Hot Lead Minimum Score</Label>
              <Input
                id="hot-score"
                type="number"
                value={hotScore}
                onChange={(e) => setHotScore(Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="warm-score">Warm Lead Minimum Score</Label>
              <Input
                id="warm-score"
                type="number"
                value={warmScore}
                onChange={(e) => setWarmScore(Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="threshold">Auto-Assignment Threshold</Label>
              <Input
                id="threshold"
                type="number"
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
              />
            </div>
            <Button
              onClick={handleSaveConfig}
              disabled={updateConfig.isPending}
              className="mt-4 w-full"
            >
              <Save className="mr-2 h-4 w-4" />
              {updateConfig.isPending ? 'Saving...' : 'Save Configuration'}
            </Button>
          </CardContent>
        </Card>

        {/* Scoring Rules */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle>Scoring Rules</CardTitle>
            <CardDescription>
              Factors that increment or decrement a lead's score.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <form onSubmit={handleCreateRule} className="flex gap-2">
              <Input
                placeholder="Factor Name (e.g. email_opened)"
                value={newRuleFactor}
                onChange={(e) => setNewRuleFactor(e.target.value)}
                required
              />
              <Input
                type="number"
                placeholder="Score Value (e.g. 10)"
                value={newRuleScore}
                onChange={(e) => setNewRuleScore(e.target.value)}
                required
                className="w-24"
              />
              <Button type="submit" disabled={createRule.isPending}>
                <Plus className="h-4 w-4" />
              </Button>
            </form>

            <div className="space-y-2">
              {rules && rules.length > 0 ? (
                rules.map((rule) => (
                  <div
                    key={rule.id}
                    className="flex items-center justify-between rounded-lg border bg-white/50 p-3"
                  >
                    <div>
                      <p className="font-medium text-slate-800">{rule.factor}</p>
                      <p className="text-xs text-slate-500">
                        Adds {rule.score_value} points
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteRule(rule.id)}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                ))
              ) : (
                <EmptyState
                  icon={<Plus className="h-6 w-6" />}
                  title="No scoring rules yet"
                  description="Create your first scoring rule to start evaluating leads."
                />
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

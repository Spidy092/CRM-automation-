import { useState } from 'react';
import { 
  useAssignmentConfig, 
  useUpdateAssignmentConfig, 
  useEligibleUsers
} from '@/api/assignments';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Save, UserCheck } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';

export function AssignmentsPage() {
  const { data: config, isLoading: isConfigLoading } = useAssignmentConfig();
  const { data: users, isLoading: isUsersLoading } = useEligibleUsers();
  const updateConfig = useUpdateAssignmentConfig();
  const { showToast } = useToast();

  const [isEnabled, setIsEnabled] = useState<boolean | null>(null);
  const [thresholdScore, setThresholdScore] = useState<number | ''>('');
  
  if (config && isEnabled === null) {
    setIsEnabled(config.is_enabled);
    setThresholdScore(config.threshold_score);
  }

  const handleSaveConfig = async () => {
    try {
      await updateConfig.mutateAsync({
        is_enabled: isEnabled ?? false,
        threshold_score: Number(thresholdScore),
      });
      showToast('Assignment configuration updated.', 'success');
    } catch {
      showToast('Failed to update config.', 'error');
    }
  };

  if (isConfigLoading || isUsersLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-slate-900">Lead Assignments</h1>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Round Robin Config */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle>Round Robin Rules</CardTitle>
            <CardDescription>
              Configure automatic lead routing to sales representatives.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center space-x-2 pt-2">
              <input
                type="checkbox"
                id="is_enabled"
                checked={isEnabled ?? false}
                onChange={(e) => setIsEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              <Label htmlFor="is_enabled">Enable Automatic Assignments</Label>
            </div>
            <div className="space-y-2">
              <Label htmlFor="threshold">Assignment Trigger Score</Label>
              <Input
                id="threshold"
                type="number"
                value={thresholdScore}
                onChange={(e) => setThresholdScore(Number(e.target.value))}
                disabled={!isEnabled}
              />
              <p className="text-xs text-slate-500">
                Leads must reach this score to be automatically routed.
              </p>
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

        {/* Eligible Users */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle>Eligible Representatives</CardTitle>
            <CardDescription>
              Users currently included in the round-robin pool.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {users && users.length > 0 ? (
                users.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center gap-3 rounded-lg border bg-white/50 p-3"
                  >
                    <UserCheck className="h-5 w-5 text-indigo-500" />
                    <div>
                      <p className="font-medium text-slate-800">
                        {user.first_name} {user.last_name}
                      </p>
                      <p className="text-xs text-slate-500">{user.email}</p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500 text-center py-4">
                  No eligible users found for assignment.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

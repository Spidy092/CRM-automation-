import { Link } from 'react-router-dom';
import {
  useCampaigns,
  useLaunchCampaign,
  usePauseCampaign,
  useResumeCampaign,
  useDeleteCampaign,
} from '@/api/campaigns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { CampaignStatus } from '@/api/campaigns';
import { Plus, Play, Pause, Trash2, BarChart3 } from 'lucide-react';

const statusColors: Record<CampaignStatus, string> = {
  draft: 'bg-gray-100 text-gray-800',
  active: 'bg-green-100 text-green-800',
  paused: 'bg-yellow-100 text-yellow-800',
  completed: 'bg-blue-100 text-blue-800',
  archived: 'bg-purple-100 text-purple-800',
};

export function CampaignsPage() {
  const { data: campaigns, isLoading } = useCampaigns();
  const launchCampaign = useLaunchCampaign();
  const pauseCampaign = usePauseCampaign();
  const resumeCampaign = useResumeCampaign();
  const deleteCampaign = useDeleteCampaign();

  const handleLaunch = async (id: string) => {
    await launchCampaign.mutateAsync(id);
  };

  const handlePause = async (id: string) => {
    await pauseCampaign.mutateAsync(id);
  };

  const handleResume = async (id: string) => {
    await resumeCampaign.mutateAsync(id);
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this campaign?')) {
      await deleteCampaign.mutateAsync(id);
    }
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900">Campaigns</h1>
        <Button asChild>
          <Link to="/campaigns/new">
            <Plus className="mr-2 h-4 w-4" />
            Create Campaign
          </Link>
        </Button>
      </div>

      {campaigns && campaigns.length > 0 ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((campaign) => (
            <Card key={campaign.id} className="hover:shadow-md transition-shadow">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">{campaign.name}</CardTitle>
                  <span
                    className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${statusColors[campaign.status]}`}
                  >
                    {campaign.status}
                  </span>
                </div>
                <CardDescription>
                  {campaign.target_industries.length > 0
                    ? `Industries: ${campaign.target_industries.join(', ')}`
                    : 'No industry targeting'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm text-gray-500">
                    <span>Tone: {campaign.tone}</span>
                    {campaign.launched_at && (
                      <span>
                        Launched: {new Date(campaign.launched_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>

                  <div className="flex justify-end space-x-2">
                    {campaign.status === 'draft' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleLaunch(campaign.id)}
                      >
                        <Play className="mr-1 h-3 w-3" />
                        Launch
                      </Button>
                    )}
                    {campaign.status === 'active' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePause(campaign.id)}
                      >
                        <Pause className="mr-1 h-3 w-3" />
                        Pause
                      </Button>
                    )}
                    {campaign.status === 'paused' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleResume(campaign.id)}
                      >
                        <Play className="mr-1 h-3 w-3" />
                        Resume
                      </Button>
                    )}
                    <Button variant="outline" size="sm" asChild>
                      <Link to={`/campaigns/${campaign.id}`}>
                        <BarChart3 className="mr-1 h-3 w-3" />
                        Stats
                      </Link>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDelete(campaign.id)}
                      disabled={campaign.status === 'active'}
                    >
                      <Trash2 className="h-3 w-3 text-red-500" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Marketing Campaigns</CardTitle>
            <CardDescription>
              Manage your outreach campaigns and track their performance
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex h-40 flex-col items-center justify-center text-sm text-gray-500">
              <BarChart3 className="mb-2 h-8 w-8" />
              <p>No campaigns created yet</p>
              <p className="mt-1 text-xs">Create your first campaign to start reaching out to leads</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

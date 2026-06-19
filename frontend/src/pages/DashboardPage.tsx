import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/Skeleton';
import { useLeads } from '@/api/leads';
import { Users, TrendingUp, Mail, BarChart3, AlertCircle } from 'lucide-react';

export function DashboardPage() {
  const { data, isLoading, error } = useLeads({ limit: 1 });

  // Derive real total count from meta (API returns total via meta if available, fallback to items length)
  const totalLeads: number =
    (data?.meta as { total?: number } | undefined)?.total ?? data?.items.length ?? 0;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total Leads — real data */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Leads</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <>
                <Skeleton className="mb-1 h-8 w-16" />
                <Skeleton className="h-3 w-28" />
              </>
            ) : error ? (
              <div className="flex items-center gap-1.5 text-sm text-red-500">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Failed to load</span>
              </div>
            ) : (
              <>
                <div className="text-2xl font-bold">{totalLeads.toLocaleString()}</div>
                <p className="text-xs text-muted-foreground">
                  {totalLeads === 0 ? 'No leads imported yet' : 'Total leads in CRM'}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Conversion Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0%</div>
            <p className="text-xs text-muted-foreground">No conversions yet</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Campaigns</CardTitle>
            <Mail className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
            <p className="text-xs text-muted-foreground">No campaigns created</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Revenue</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">$0</div>
            <p className="text-xs text-muted-foreground">No revenue tracked</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Latest actions in your CRM</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex h-40 items-center justify-center text-sm text-gray-500">
              No recent activity
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lead Sources</CardTitle>
            <CardDescription>Where your leads are coming from</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex h-40 items-center justify-center text-sm text-gray-500">
              No lead data available
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

import { useParams, useNavigate } from 'react-router-dom';
import { useForm, useFormAnalytics } from '@/api/forms';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LoadingTable } from '@/components/ui/LoadingTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
import { ArrowLeft, BarChart3, ExternalLink } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

const PIE_COLORS = ['#6366f1', '#06b6d4', '#f59e0b', '#10b981', '#ef4444'];

export function FormAnalyticsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const { data: formData, isLoading: loadingForm } = useForm(id ?? '');
  const { data: analytics, isLoading: loadingAnalytics, error } = useFormAnalytics(id ?? '');

  if (loadingForm || loadingAnalytics) return <LoadingTable rows={5} cols={4} />;
  if (error) {
    showToast(getApiErrorMessage(error, 'Failed to load analytics'), 'error');
  }

  const form = formData?.data;
  const a = analytics?.data;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Capture"
        title={form ? `${form.name} Analytics` : 'Form Analytics'}
        description="Submission metrics and referrer breakdown"
        actions={
          <Button variant="outline" onClick={() => navigate('/forms')}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Button>
        }
      />

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-slate-500">Total Submissions</p>
            <p className="mt-1 text-3xl font-bold text-slate-900">{a?.totalSubmissions ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-slate-500">Unique Leads</p>
            <p className="mt-1 text-3xl font-bold text-slate-900">{a?.uniqueLeads ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-slate-500">Conversion Rate</p>
            <p className="mt-1 text-3xl font-bold text-indigo-600">{(a?.conversionRate ?? 0).toFixed(1)}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-slate-500">Fields in Form</p>
            <p className="mt-1 text-3xl font-bold text-slate-900">{form?.fields.length ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Empty state */}
      {a && a.totalSubmissions === 0 ? (
        <EmptyState
          icon={<BarChart3 className="h-6 w-6" />}
          title="No submissions yet"
          description="Share your form link or embed snippet to start capturing submissions and analytics."
          action={
            form ? (
              <Button
                variant="outline"
                onClick={() => window.open(`/forms/${form.slug}`, '_blank')}
              >
                <ExternalLink className="mr-2 h-4 w-4" /> Preview Form
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Submissions over time */}
          {a?.submissionsByDay && a.submissionsByDay.length > 0 && (
            <Card>
              <CardContent className="p-5">
                <CardTitle className="mb-4 text-base">Submissions Over Time</CardTitle>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={a.submissionsByDay}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Top referrers */}
          {a?.topReferrers && a.topReferrers.length > 0 && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardContent className="p-5">
                  <CardTitle className="mb-4 text-base">Top Referrers</CardTitle>
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie
                        data={a.topReferrers.slice(0, 5)}
                        dataKey="count"
                        nameKey="referrer"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        label={({ referrer, count }) => `${referrer || 'Direct'}: ${count}`}
                      >
                        {a.topReferrers.slice(0, 5).map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-5">
                  <CardTitle className="mb-4 text-base">Referrer Breakdown</CardTitle>
                  <div className="space-y-3">
                    {a.topReferrers.map((r, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <span className="text-sm text-slate-700 truncate max-w-[200px]">
                          {r.referrer || 'Direct / Unknown'}
                        </span>
                        <span className="text-sm font-medium text-slate-900">{r.count}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLeads, useDeleteLead, usePauseLead } from '@/api/leads';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { LoadingTable } from '@/components/ui/LoadingTable';
import { useToast } from '@/components/ui/Toast';
import type { Lead, LeadStatus } from '@/types';
import {
  Plus,
  Search,
  Upload,
  Edit,
  Trash2,
  Pause,
  Play,
  AlertCircle,
  InboxIcon,
} from 'lucide-react';

const statusColors: Record<LeadStatus, string> = {
  active: 'bg-emerald-100 text-emerald-800',
  paused: 'bg-amber-100 text-amber-800',
  won: 'bg-blue-100 text-blue-800',
  lost: 'bg-red-100 text-red-800',
  opted_out: 'bg-gray-100 text-gray-600',
};

export function LeadsPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const { data, isLoading, error } = useLeads({
    search: search || undefined,
    status: statusFilter || undefined,
  });
  const deleteLead = useDeleteLead();
  const pauseLead = usePauseLead();
  const { showToast } = useToast();

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this lead?')) {
      try {
        await deleteLead.mutateAsync(id);
        showToast('Lead deleted successfully.', 'success');
      } catch {
        showToast('Failed to delete lead. Please try again.', 'error');
      }
    }
  };

  const handlePause = async (id: string, currentStatus: LeadStatus) => {
    const willPause = currentStatus === 'active';
    try {
      await pauseLead.mutateAsync({ id, paused: willPause });
      showToast(willPause ? 'Lead paused.' : 'Lead resumed.', 'success');
    } catch {
      showToast('Failed to update lead status.', 'error');
    }
  };

  const leads = data?.items ?? [];

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900">Leads</h1>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link to="/leads/import">
              <Upload className="mr-2 h-4 w-4" />
              Import
            </Link>
          </Button>
          <Button asChild>
            <Link to="/leads/new">
              <Plus className="mr-2 h-4 w-4" />
              Add Lead
            </Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                id="leads-search"
                placeholder="Search leads…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <select
              id="leads-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
              <option value="opted_out">Opted Out</option>
            </select>
          </div>
        </CardHeader>

        <CardContent>
          {/* ── Loading state ── */}
          {isLoading && <LoadingTable />}

          {/* ── Error state ── */}
          {!isLoading && error && (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-6 py-10 text-center">
              <AlertCircle className="h-8 w-8 text-red-400" />
              <div>
                <p className="font-semibold text-red-700">Failed to load leads</p>
                <p className="mt-1 text-sm text-red-500">{error.message}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                Try again
              </Button>
            </div>
          )}

          {/* ── Empty state ── */}
          {!isLoading && !error && leads.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <InboxIcon className="h-10 w-10 text-gray-300" />
              <p className="font-medium text-gray-500">No leads found</p>
              <p className="text-sm text-gray-400">Import a CSV or add your first lead manually.</p>
              <Button asChild size="sm" className="mt-2">
                <Link to="/leads/new">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Lead
                </Link>
              </Button>
            </div>
          )}

          {/* ── Data table ── */}
          {!isLoading && !error && leads.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="pb-3 text-left font-medium text-gray-500">Business</th>
                    <th className="pb-3 text-left font-medium text-gray-500">Contact</th>
                    <th className="pb-3 text-left font-medium text-gray-500">Email</th>
                    <th className="pb-3 text-left font-medium text-gray-500">Phone</th>
                    <th className="pb-3 text-left font-medium text-gray-500">Status</th>
                    <th className="pb-3 text-left font-medium text-gray-500">Score</th>
                    <th className="pb-3 text-right font-medium text-gray-500">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead: Lead) => (
                    <tr key={lead.id} className="border-b transition-colors hover:bg-slate-50">
                      <td className="py-3">
                        <div className="font-medium text-gray-900">{lead.business_name}</div>
                        <div className="text-xs text-gray-400">{lead.industry}</div>
                      </td>
                      <td className="py-3 text-gray-700">{lead.contact_name}</td>
                      <td className="py-3 text-gray-700">{lead.email}</td>
                      <td className="py-3 text-gray-700">{lead.phone}</td>
                      <td className="py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${statusColors[lead.status]}`}
                        >
                          {lead.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="py-3 font-medium text-gray-700">{lead.lead_score}</td>
                      <td className="py-3 text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" asChild title="Edit">
                            <Link to={`/leads/${lead.id}/edit`}>
                              <Edit className="h-4 w-4" />
                            </Link>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title={lead.status === 'active' ? 'Pause' : 'Resume'}
                            onClick={() => handlePause(lead.id, lead.status)}
                          >
                            {lead.status === 'active' ? (
                              <Pause className="h-4 w-4" />
                            ) : (
                              <Play className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Delete"
                            onClick={() => handleDelete(lead.id)}
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

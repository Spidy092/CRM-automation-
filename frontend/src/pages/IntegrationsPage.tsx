import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useIntegrations,
  useUpdateIntegration,
  useTestIntegration,
  bulkTestIntegrations,
} from '@/api/integrations';
import type { Integration, BulkTestResult } from '@/api/integrations';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingTable } from '@/components/ui/LoadingTable';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useToast } from '@/components/ui/Toast';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { IntegrationSetupWizard } from '@/components/IntegrationSetupWizard';
import {
  CATEGORY_ORDER,
  INTEGRATION_DESCRIPTIONS,
  groupByCategory,
  getCategory,
  timeAgo,
} from '@/lib/integrations.config';
import {
  CheckCircle,
  XCircle,
  AlertCircle,
  RefreshCw,
  Search,
  X,
  Loader2,
  Link2,
} from 'lucide-react';

// ── Status badge ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string | null }) {
  if (!status) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
        <AlertCircle className="h-3 w-3" /> Not tested
      </span>
    );
  }
  if (status === 'ok') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
        <CheckCircle className="h-3 w-3" /> Connected
      </span>
    );
  }
  if (status === 'no_credentials') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
        <AlertCircle className="h-3 w-3" /> No credentials
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
      <XCircle className="h-3 w-3" /> {status}
    </span>
  );
}

// ── Bulk test result status badge ──────────────────────────────────────────

function ResultStatusBadge({ status, ok }: { status: string; ok: boolean }) {
  if (status === 'ok' || status === 'success' || ok) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
        <CheckCircle className="h-3 w-3" /> Connected
      </span>
    );
  }
  if (status === 'skipped') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
        <AlertCircle className="h-3 w-3" /> Skipped
      </span>
    );
  }
  if (status === 'no_credentials') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
        <AlertCircle className="h-3 w-3" /> No credentials
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
      <XCircle className="h-3 w-3" /> {status}
    </span>
  );
}

// ── Health summary ─────────────────────────────────────────────────────────

function HealthSummary({ integrations }: { integrations: Integration[] }) {
  const enabled = integrations.filter((i) => i.is_enabled).length;
  const ok = integrations.filter((i) => i.last_test_status === 'ok').length;
  const failed = integrations.filter((i) => i.last_test_status === 'failed').length;
  const noCreds = integrations.filter((i) => i.last_test_status === 'no_credentials').length;

  const enabledFailed = integrations.some((i) => i.is_enabled && i.last_test_status === 'failed');
  const statusLabel = enabledFailed ? 'Needs attention' : 'Healthy';
  const statusClass = enabledFailed
    ? 'text-red-600 bg-red-50 border-red-200'
    : 'text-green-600 bg-green-50 border-green-200';

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-white px-4 py-3">
      <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusClass}`}>
        {statusLabel}
      </span>
      <span className="text-xs text-slate-400">|</span>
      <span className="text-xs text-slate-600"><strong>{enabled}</strong> enabled</span>
      <span className="text-xs text-green-600"><strong>{ok}</strong> connected</span>
      {failed > 0 && <span className="text-xs text-red-600"><strong>{failed}</strong> failed</span>}
      {noCreds > 0 && <span className="text-xs text-amber-600"><strong>{noCreds}</strong> no credentials</span>}
    </div>
  );
}

// ── Integration card ───────────────────────────────────────────────────────

function IntegrationCard({
  integration,
  onSetup,
}: {
  integration: Integration;
  onSetup: (integration: Integration) => void;
}) {
  const updateIntegration = useUpdateIntegration();
  const testIntegration = useTestIntegration();
  const { showToast } = useToast();
  const [showDisableConfirm, setShowDisableConfirm] = useState(false);

  const handleToggle = async () => {
    if (integration.is_enabled) {
      setShowDisableConfirm(true);
      return;
    }
    try {
      await updateIntegration.mutateAsync({
        id: integration.id,
        input: { is_enabled: true },
      });
      showToast(`${integration.display_name} enabled.`, 'success');
    } catch {
      showToast('Failed to enable integration.', 'error');
    }
  };

  const confirmDisable = async () => {
    setShowDisableConfirm(false);
    try {
      await updateIntegration.mutateAsync({
        id: integration.id,
        input: { is_enabled: false },
      });
      showToast(`${integration.display_name} disabled.`, 'success');
    } catch {
      showToast('Failed to disable integration.', 'error');
    }
  };

  const handleTest = async () => {
    try {
      const result = await testIntegration.mutateAsync(integration.id);
      showToast(result.message, result.ok ? 'success' : 'error');
    } catch {
      showToast('Connection test failed.', 'error');
    }
  };

  const description = INTEGRATION_DESCRIPTIONS[integration.name];

  return (
    <>
      <Card className="hover:shadow-md transition-shadow">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <Link2 className="h-4 w-4 text-slate-400 shrink-0" />
              <div>
                <CardTitle className="text-base">{integration.display_name}</CardTitle>
                {description && (
                  <CardDescription className="text-xs mt-0.5">{description}</CardDescription>
                )}
              </div>
            </div>
            <StatusBadge status={integration.last_test_status} />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {integration.last_tested_at && (
            <p className="text-xs text-slate-400">
              Tested {timeAgo(integration.last_tested_at)}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={integration.is_enabled ? 'default' : 'outline'}
              onClick={handleToggle}
              disabled={updateIntegration.isPending}
              className="h-7 text-xs"
            >
              {integration.is_enabled ? 'Enabled' : 'Disabled'}
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={handleTest}
              disabled={testIntegration.isPending}
              className="h-7 text-xs"
            >
              <RefreshCw className={`mr-1 h-3 w-3 ${testIntegration.isPending ? 'animate-spin' : ''}`} />
              Test
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => onSetup(integration)}
              className="h-7 text-xs"
            >
              Configure
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog
        open={showDisableConfirm}
        title={`Disable ${integration.display_name}?`}
        description="This will stop all automated outreach through this integration. Active campaigns may be affected."
        confirmLabel="Disable"
        cancelLabel="Keep enabled"
        variant="destructive"
        onConfirm={confirmDisable}
        onCancel={() => setShowDisableConfirm(false)}
      />
    </>
  );
}

// ── Bulk test results dialog ───────────────────────────────────────────────

function BulkTestResultsDialog({
  result,
  onClose,
}: {
  result: BulkTestResult;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-test-results-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
    >
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 id="bulk-test-results-title" className="text-lg font-semibold text-slate-900">
              Connection Test Results
            </h2>
            <p className="text-xs text-slate-500">
              {result.total} providers tested · {result.passed} passed · {result.failed} failed ·{' '}
              {result.skipped} skipped
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {result.results.length === 0 ? (
            <p className="text-sm text-slate-500">No providers were tested.</p>
          ) : (
            <ul className="space-y-3">
              {result.results.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900">{item.name}</p>
                    {item.message && (
                      <p className="mt-1 break-words text-xs text-slate-600">{item.message}</p>
                    )}
                    <p className="mt-1 text-xs text-slate-400">
                      Tested {timeAgo(item.tested_at)}
                    </p>
                  </div>
                  <div className="shrink-0">
                    <ResultStatusBadge status={item.status} ok={item.ok} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end border-t px-6 py-4">
          <Button size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export function IntegrationsPage() {
  const { data: integrations, isLoading, error } = useIntegrations();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [bulkResult, setBulkResult] = useState<BulkTestResult | null>(null);
  const [isBulkTesting, setIsBulkTesting] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardIntegration, setWizardIntegration] = useState<Integration | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('All');

  const list = useMemo(() => integrations ?? [], [integrations]);

  const filteredList = useMemo(() => {
    let result = list;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (i) =>
          i.display_name.toLowerCase().includes(q) ||
          i.name.toLowerCase().includes(q) ||
          (INTEGRATION_DESCRIPTIONS[i.name] ?? '').toLowerCase().includes(q),
      );
    }
    if (activeCategory !== 'All') {
      result = result.filter((i) => getCategory(i.name) === activeCategory);
    }
    return result;
  }, [list, searchQuery, activeCategory]);

  const grouped = groupByCategory(filteredList);
  const categories = CATEGORY_ORDER.filter((category) => grouped[category]?.length > 0);

  const availableCategories = useMemo(() => {
    const cats = new Set(list.map((i) => getCategory(i.name)));
    return ['All', ...CATEGORY_ORDER.filter((c) => cats.has(c))];
  }, [list]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Integrations" description="Connect and validate outbound channels and lead sources." />
        <LoadingTable rows={6} cols={2} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Integrations" description="Connect and validate outbound channels and lead sources." />
        <ErrorState message="Failed to load integrations. Please try again." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations"
        description="Connect and validate outbound channels and lead sources."
        actions={
          <Button
            size="sm"
            onClick={async () => {
              setIsBulkTesting(true);
              try {
                const result = await bulkTestIntegrations();
                setBulkResult(result);
                queryClient.invalidateQueries({ queryKey: ['integrations'] });
              } catch (err) {
                const message = err instanceof Error ? err.message : 'Bulk connection test failed.';
                showToast(message, 'error');
              } finally {
                setIsBulkTesting(false);
              }
            }}
            disabled={isBulkTesting}
          >
            {isBulkTesting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Test All
          </Button>
        }
      />

      {list.length === 0 ? (
        <EmptyState
          icon={<Link2 className="h-6 w-6" />}
          title="No integrations found"
          description="Provider records are created by the backend seed/configuration layer."
        />
      ) : (
        <div className="space-y-4">
          <HealthSummary integrations={list} />

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-xs">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search integrations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 pl-9 text-sm"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {availableCategories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveCategory(cat)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    activeCategory === cat
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {categories.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-slate-500">
              No integrations match your search.
            </div>
          ) : (
            <div className="space-y-6">
              {categories.map((category) => (
                <section key={category} className="space-y-3">
                  <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">{category}</h2>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {grouped[category].map((integration) => (
                      <IntegrationCard
                        key={integration.id}
                        integration={integration}
                        onSetup={(i) => {
                          setWizardIntegration(i);
                          setWizardOpen(true);
                        }}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      )}

      {bulkResult && (
        <BulkTestResultsDialog result={bulkResult} onClose={() => setBulkResult(null)} />
      )}

      <IntegrationSetupWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        integration={wizardIntegration}
      />
    </div>
  );
}

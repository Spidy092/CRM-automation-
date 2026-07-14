import { useState } from 'react';
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
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingTable } from '@/components/ui/LoadingTable';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useToast } from '@/components/ui/Toast';
import { IntegrationSetupWizard } from '@/components/IntegrationSetupWizard';
import {
  CheckCircle,
  XCircle,
  AlertCircle,
  RefreshCw,
  Settings,
  Link2,
  X,
  Loader2,
} from 'lucide-react';

// ── Credential field schemas per provider ──────────────────────────────────

interface FieldDef {
  key: string;
  label: string;
  type?: 'text' | 'password' | 'secret' | 'number' | 'list';
  placeholder?: string;
  required?: boolean;
  helpText?: string;
}

const CREDENTIAL_FIELDS: Record<string, FieldDef[]> = {
  whatsapp: [
    { key: 'phoneNumberId', label: 'Phone Number ID', placeholder: '12345678901234' },
    { key: 'apiToken', label: 'API Token', type: 'password', placeholder: 'EAAG...' },
    { key: 'apiVersion', label: 'API Version', placeholder: 'v20.0' },
    { key: 'appSecret', label: 'App Secret (for webhook verification)', type: 'password' },
  ],
  twilio: [
    { key: 'accountSid', label: 'Account SID', placeholder: 'ACxxxxxxxxxxxxxxxx' },
    { key: 'authToken', label: 'Auth Token', type: 'password' },
    { key: 'fromNumber', label: 'From Number (E.164)', placeholder: '+12025551234' },
  ],
  sendgrid: [
    { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'SG.xxxxx' },
    { key: 'fromEmail', label: 'From Email', placeholder: 'outreach@example.com' },
    { key: 'fromName', label: 'From Name', placeholder: 'My Company' },
  ],
  smtp: [
    { key: 'host', label: 'SMTP Host', placeholder: 'smtp.example.com' },
    { key: 'port', label: 'Port', type: 'number', placeholder: '587' },
    { key: 'user', label: 'Username' },
    { key: 'pass', label: 'Password', type: 'password' },
    { key: 'fromEmail', label: 'From Email', placeholder: 'outreach@example.com' },
    { key: 'fromName', label: 'From Name', placeholder: 'My Company' },
  ],
  google_ads: [
    { key: 'developerToken', label: 'Developer Token', type: 'password' },
    { key: 'clientId', label: 'Client ID' },
    { key: 'clientSecret', label: 'Client Secret', type: 'password' },
    { key: 'refreshToken', label: 'Refresh Token', type: 'password' },
    { key: 'loginCustomerId', label: 'MCC Customer ID (optional)', placeholder: '1234567890' },
  ],
  facebook: [
    { key: 'appId', label: 'App ID' },
    { key: 'appSecret', label: 'App Secret', type: 'password' },
    { key: 'accessToken', label: 'Access Token', type: 'password' },
    { key: 'pageId', label: 'Page ID (optional)' },
    { key: 'formId', label: 'Lead Form ID (optional)' },
  ],
  openwa: [
    { key: 'baseUrl', label: 'OpenWA Base URL', type: 'text', required: true, placeholder: 'https://openwa.example.com', helpText: 'The root URL of your external OpenWA HTTP server.' },
    { key: 'apiKey', label: 'API Key', type: 'secret', required: true, helpText: 'OpenWA API key used in the x-api-key header.' },
    { key: 'sessionId', label: 'Session ID', type: 'text', required: true, helpText: 'WhatsApp session identifier managed by the OpenWA server.' },
    { key: 'numbers', label: 'Phone Numbers', type: 'list', required: true, helpText: 'One or more WhatsApp sender numbers for rotation (E.164 format).' },
  ],
  slack: [
    { key: 'webhookUrl', label: 'Slack Webhook URL', placeholder: 'https://hooks.slack.com/...' },
  ],
  teams: [
    { key: 'webhookUrl', label: 'Teams Webhook URL', placeholder: 'https://...webhook.office.com/...' },
  ],
  google_sheets: [
    { key: 'clientId', label: 'Client ID' },
    { key: 'clientSecret', label: 'Client Secret', type: 'password' },
    { key: 'refreshToken', label: 'Refresh Token', type: 'password' },
    { key: 'spreadsheetId', label: 'Spreadsheet ID (optional)' },
  ],
  google_calendar: [
    { key: 'clientId', label: 'Client ID' },
    { key: 'clientSecret', label: 'Client Secret', type: 'password' },
    { key: 'refreshToken', label: 'Refresh Token', type: 'password' },
    { key: 'calendarId', label: 'Calendar ID', placeholder: 'primary' },
  ],
  outlook: [
    { key: 'tenantId', label: 'Tenant ID' },
    { key: 'clientId', label: 'Client ID' },
    { key: 'clientSecret', label: 'Client Secret', type: 'password' },
    { key: 'fromEmail', label: 'From Email' },
  ],
  hunter: [
    { key: 'api_key', label: 'Hunter.io API Key', type: 'password', required: true, helpText: 'Get your free API key at hunter.io' },
  ],
};

// ── Category mapping ───────────────────────────────────────────────────────

const CATEGORY_MAP: Record<string, string> = {
  whatsapp: 'Messaging',
  twilio: 'Messaging',
  sendgrid: 'Messaging',
  smtp: 'Messaging',
  openwa: 'Messaging',
  google_sheets: 'Productivity',
  google_calendar: 'Productivity',
  outlook: 'Productivity',
  google_ads: 'Advertising',
  facebook: 'Advertising',
  google_drive: 'Storage',
  hunter: 'Data Enrichment',
};

const CATEGORY_ORDER = ['Messaging', 'Productivity', 'Advertising', 'Data Enrichment', 'Storage', 'Other'];

function getCategory(name: string): string {
  return CATEGORY_MAP[name] ?? 'Other';
}

function groupByCategory(integrations: Integration[]): Record<string, Integration[]> {
  return integrations.reduce<Record<string, Integration[]>>((acc, integration) => {
    const category = getCategory(integration.name);
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(integration);
    return acc;
  }, {});
}

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

// ── Credential form ────────────────────────────────────────────────────────

function CredentialForm({
  integration,
  onClose,
}: {
  integration: Integration;
  onClose: () => void;
}) {
  const fields = CREDENTIAL_FIELDS[integration.name] ?? [];
  const updateIntegration = useUpdateIntegration();
  const { showToast } = useToast();
  const [values, setValues] = useState<Record<string, string>>({});

  const handleSave = async () => {
    if (fields.length === 0) {
      showToast('No credential fields defined for this integration.', 'success');
      onClose();
      return;
    }

    const credentials: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = values[f.key];
      if (raw === undefined || raw === '') continue;
      if (f.type === 'list') {
        credentials[f.key] = raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      } else if (f.type === 'number') {
        credentials[f.key] = Number(raw);
      } else {
        credentials[f.key] = raw;
      }
    }

    try {
      await updateIntegration.mutateAsync({ id: integration.id, input: { credentials } });
      showToast('Credentials saved.', 'success');
      onClose();
    } catch {
      showToast('Failed to save credentials.', 'error');
    }
  };

  if (fields.length === 0) {
    return (
      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
        No credential configuration available for this integration yet.
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm font-medium text-slate-700">Configure credentials</p>
      {fields.map((f) => {
        const inputType =
          f.type === 'number' ? 'number' : f.type === 'password' || f.type === 'secret' ? 'password' : 'text';
        return (
          <div key={f.key} className="space-y-1">
            <Label htmlFor={`cred-${integration.id}-${f.key}`} className="text-xs">
              {f.label}
              {f.required && <span className="ml-0.5 text-red-500">*</span>}
            </Label>
            {f.helpText && (
              <p className="text-xs text-muted-foreground">{f.helpText}</p>
            )}
            <Input
              id={`cred-${integration.id}-${f.key}`}
              type={inputType}
              placeholder={f.placeholder}
              value={values[f.key] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              className="h-8 text-sm"
            />
          </div>
        );
      })}
      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={updateIntegration.isPending}
        >
          {updateIntegration.isPending ? 'Saving…' : 'Save Credentials'}
        </Button>
        <Button size="sm" variant="outline" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ── Health summary ─────────────────────────────────────────────────────────

interface HealthSummaryProps {
  integrations: Integration[];
}

function HealthSummary({ integrations }: HealthSummaryProps) {
  const total = integrations.length;
  const enabled = integrations.filter((i) => i.is_enabled).length;
  const ok = integrations.filter((i) => i.last_test_status === 'ok').length;
  const failed = integrations.filter((i) => i.last_test_status === 'failed').length;
  const noCredentials = integrations.filter((i) => i.last_test_status === 'no_credentials').length;
  const untested = integrations.filter((i) => !i.last_test_status).length;

  const enabledFailed = integrations.some((i) => i.is_enabled && i.last_test_status === 'failed');
  const statusLabel = enabledFailed ? 'Needs attention' : total > 0 ? 'Healthy' : 'No integrations';
  const statusClass = enabledFailed
    ? 'text-red-600 bg-red-50 border-red-200'
    : total > 0
      ? 'text-green-600 bg-green-50 border-green-200'
      : 'text-slate-600 bg-slate-50 border-slate-200';

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Integration health summary</CardTitle>
            <CardDescription className="text-xs">Overview of provider status and readiness</CardDescription>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs font-medium ${statusClass}`}>
            {statusLabel}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-slate-500">Total</p>
            <p className="text-xl font-semibold">{total}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-slate-500">Enabled</p>
            <p className="text-xl font-semibold text-green-600">{enabled}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-slate-500">Connected</p>
            <p className="text-xl font-semibold text-green-600">{ok}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-slate-500">Failed</p>
            <p className="text-xl font-semibold text-red-600">{failed}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-slate-500">No credentials</p>
            <p className="text-xl font-semibold text-amber-600">{noCredentials}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-slate-500">Untested</p>
            <p className="text-xl font-semibold text-slate-600">{untested}</p>
          </div>
        </div>
      </CardContent>
    </Card>
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
  const [showForm, setShowForm] = useState(false);

  const handleToggle = async () => {
    try {
      await updateIntegration.mutateAsync({
        id: integration.id,
        input: { is_enabled: !integration.is_enabled },
      });
      showToast(`${integration.display_name} ${integration.is_enabled ? 'disabled' : 'enabled'}.`, 'success');
    } catch {
      showToast('Failed to update integration.', 'error');
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

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-slate-400 shrink-0" />
            <div>
              <CardTitle className="text-base">{integration.display_name}</CardTitle>
              <CardDescription className="text-xs mt-0.5 font-mono text-slate-400">
                {integration.name}
              </CardDescription>
            </div>
          </div>
          <StatusBadge status={integration.last_test_status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {integration.last_tested_at && (
          <p className="text-xs text-slate-400">
            Tested {new Date(integration.last_tested_at).toLocaleString()}
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
            onClick={() => setShowForm((v) => !v)}
            className="h-7 text-xs"
          >
            <Settings className="mr-1 h-3 w-3" />
            Credentials
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => onSetup(integration)}
            className="h-7 text-xs"
          >
            Setup
          </Button>
        </div>

        {showForm && (
          <CredentialForm integration={integration} onClose={() => setShowForm(false)} />
        )}
      </CardContent>
    </Card>
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
                      Tested {new Date(item.tested_at).toLocaleString()}
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

  const list = integrations ?? [];
  const grouped = groupByCategory(list);
  const categories = CATEGORY_ORDER.filter((category) => grouped[category]?.length > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Channel readiness"
        title="Integrations"
        description="Enable providers, save credentials, and test each connection before running automation."
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setWizardIntegration(undefined);
                setWizardOpen(true);
              }}
            >
              Add Integration
            </Button>
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
              Test Connections
            </Button>
          </div>
        }
      />

      {list.length === 0 ? (
        <EmptyState
          icon={<Link2 className="h-6 w-6" />}
          title="No integrations found"
          description="Provider records are created by the backend seed/configuration layer."
        />
      ) : (
        <div className="space-y-8">
          <HealthSummary integrations={list} />

          {categories.map((category) => (
            <section key={category} className="space-y-3">
              <h2 className="text-lg font-semibold text-slate-900">{category}</h2>
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

      {bulkResult && (
        <BulkTestResultsDialog result={bulkResult} onClose={() => setBulkResult(null)} />
      )}

      <IntegrationSetupWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        integration={wizardIntegration}
        onComplete={() => {
          // query invalidation already handled inside the wizard
        }}
      />
    </div>
  );
}

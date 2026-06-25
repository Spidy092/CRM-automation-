import { useState } from 'react';
import { useIntegrations, useUpdateIntegration, useTestIntegration } from '@/api/integrations';
import type { Integration } from '@/api/integrations';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingTable } from '@/components/ui/LoadingTable';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import {
  CheckCircle,
  XCircle,
  AlertCircle,
  RefreshCw,
  Settings,
  Link2,
} from 'lucide-react';

// ── Credential field schemas per provider ──────────────────────────────────

interface FieldDef {
  key: string;
  label: string;
  type?: 'text' | 'password' | 'number';
  placeholder?: string;
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
};

// ── Status badge ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string | null }) {
  if (!status) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
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
      if (values[f.key] !== undefined && values[f.key] !== '') {
        credentials[f.key] = f.type === 'number' ? Number(values[f.key]) : values[f.key];
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
    <div className="mt-4 space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <p className="text-sm font-medium text-gray-700">Configure credentials</p>
      {fields.map((f) => (
        <div key={f.key} className="space-y-1">
          <Label htmlFor={`cred-${integration.id}-${f.key}`} className="text-xs">
            {f.label}
          </Label>
          <Input
            id={`cred-${integration.id}-${f.key}`}
            type={f.type ?? 'text'}
            placeholder={f.placeholder}
            value={values[f.key] ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            className="h-8 text-sm"
          />
        </div>
      ))}
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

// ── Integration card ───────────────────────────────────────────────────────

function IntegrationCard({ integration }: { integration: Integration }) {
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
            <Link2 className="h-4 w-4 text-gray-400 shrink-0" />
            <div>
              <CardTitle className="text-base">{integration.display_name}</CardTitle>
              <CardDescription className="text-xs mt-0.5 font-mono text-gray-400">
                {integration.name}
              </CardDescription>
            </div>
          </div>
          <StatusBadge status={integration.last_test_status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {integration.last_tested_at && (
          <p className="text-xs text-gray-400">
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
        </div>

        {showForm && (
          <CredentialForm integration={integration} onClose={() => setShowForm(false)} />
        )}
      </CardContent>
    </Card>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export function IntegrationsPage() {
  const { data: integrations, isLoading, error } = useIntegrations();

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
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          <XCircle className="h-4 w-4 shrink-0" />
          <span className="text-sm">Failed to load integrations. Please try again.</span>
        </div>
      </div>
    );
  }

  const list = integrations ?? [];
  const enabledCount = list.filter((i) => i.is_enabled).length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Channel readiness"
        title="Integrations"
        description="Enable providers, save credentials, and test each connection before running automation."
        metrics={[
          { label: 'Providers', value: list.length },
          { label: 'Enabled', value: enabledCount, tone: 'success' },
          { label: 'Needs setup', value: list.filter((i) => !i.last_test_status || i.last_test_status === 'no_credentials').length, tone: 'warning' },
          { label: 'Errors', value: list.filter((i) => i.last_test_status && !['ok', 'no_credentials'].includes(i.last_test_status)).length, tone: 'danger' },
        ]}
      />

      {list.length === 0 ? (
        <EmptyState
          icon={<Link2 className="h-6 w-6" />}
          title="No integrations found"
          description="Provider records are created by the backend seed/configuration layer."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((integration) => (
            <IntegrationCard key={integration.id} integration={integration} />
          ))}
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/client';
import type { ApiResponse } from '@/api/client';
import {
  useIntegrations,
  useUpdateIntegration,
  type Integration,
  type TestIntegrationResult,
} from '@/api/integrations';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import {
  AlertCircle,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Link2,
  Loader2,
  RefreshCw,
  X,
  XCircle,
} from 'lucide-react';

interface FieldDef {
  key: string;
  label: string;
  type?: 'text' | 'password' | 'secret' | 'number' | 'list' | 'boolean';
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
    {
      key: 'baseUrl',
      label: 'OpenWA Base URL',
      type: 'text',
      required: true,
      placeholder: 'https://openwa.example.com',
      helpText: 'The root URL of your external OpenWA HTTP server.',
    },
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'secret',
      required: true,
      helpText: 'OpenWA API key used in the x-api-key header.',
    },
    {
      key: 'sessionId',
      label: 'Session ID',
      type: 'text',
      required: true,
      helpText: 'WhatsApp session identifier managed by the OpenWA server.',
    },
    {
      key: 'numbers',
      label: 'Phone Numbers',
      type: 'list',
      required: true,
      helpText: 'One or more WhatsApp sender numbers for rotation (E.164 format).',
    },
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
};

const CATEGORY_ORDER = ['Messaging', 'Productivity', 'Advertising', 'Storage', 'Other'];

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

export interface IntegrationSetupWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  integration?: Integration;
  providerOptions?: Integration[];
  onComplete?: () => void;
}

type WizardStep = 'provider' | 'credentials' | 'test' | 'enable';

function getInitialStep(integration: Integration | undefined): WizardStep {
  return integration ? 'credentials' : 'provider';
}

function normalizeCredentials(
  fields: FieldDef[],
  values: Record<string, string | boolean>,
): Record<string, unknown> {
  const credentials: Record<string, unknown> = {};

  for (const field of fields) {
    const raw = values[field.key];
    if (raw === undefined || raw === '') continue;

    if (field.type === 'boolean') {
      credentials[field.key] = Boolean(raw);
    } else if (field.type === 'list') {
      credentials[field.key] = String(raw)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (field.type === 'number') {
      const num = Number(raw);
      if (!Number.isNaN(num)) {
        credentials[field.key] = num;
      }
    } else {
      credentials[field.key] = String(raw);
    }
  }

  return credentials;
}

function isStepValid(
  step: WizardStep,
  integration: Integration | null,
  values: Record<string, string | boolean>,
  testResult: TestIntegrationResult | null,
  isEnabled: boolean,
): boolean {
  if (!integration) return false;
  const fields = CREDENTIAL_FIELDS[integration.name] ?? [];

  switch (step) {
    case 'provider':
      return true;
    case 'credentials': {
      for (const field of fields) {
        if (field.required) {
          const value = values[field.key];
          if (value === undefined || value === '' || value === false) {
            return false;
          }
        }
      }
      return true;
    }
    case 'test':
      return testResult?.ok ?? false;
    case 'enable':
      return isEnabled;
    default:
      return false;
  }
}

export function IntegrationSetupWizard({
  open,
  onOpenChange,
  integration,
  providerOptions,
  onComplete,
}: IntegrationSetupWizardProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { data: allIntegrations, isLoading: isLoadingIntegrations } = useIntegrations();
  const updateIntegration = useUpdateIntegration();

  const [selectedIntegration, setSelectedIntegration] = useState<Integration | null>(
    integration ?? null,
  );
  const [step, setStep] = useState<WizardStep>(getInitialStep(integration));
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [testResult, setTestResult] = useState<TestIntegrationResult | null>(null);
  const [isEnabled, setIsEnabled] = useState(integration?.is_enabled ?? false);

  useEffect(() => {
    if (open) {
      setSelectedIntegration(integration ?? null);
      setStep(getInitialStep(integration));
      setValues({});
      setTestResult(null);
      setIsEnabled(integration?.is_enabled ?? false);
    }
  }, [open, integration]);

  const availableProviders = useMemo(() => {
    if (providerOptions) return providerOptions;
    return allIntegrations ?? [];
  }, [providerOptions, allIntegrations]);

  const groupedProviders = useMemo(
    () => groupByCategory(availableProviders),
    [availableProviders],
  );
  const categories = useMemo(
    () => CATEGORY_ORDER.filter((category) => (groupedProviders[category]?.length ?? 0) > 0),
    [groupedProviders],
  );

  const fields = useMemo(
    () => (selectedIntegration ? CREDENTIAL_FIELDS[selectedIntegration.name] ?? [] : []),
    [selectedIntegration],
  );

  const draftCredentials = useMemo(
    () => normalizeCredentials(fields, values),
    [fields, values],
  );

  const testMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiClient.post<ApiResponse<TestIntegrationResult>>(
        `/integrations/${id}/test`,
        { credentials: draftCredentials },
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
    },
  });

  const handleClose = () => {
    onOpenChange(false);
  };

  const handleSelectProvider = (provider: Integration) => {
    setSelectedIntegration(provider);
    setStep('credentials');
  };

  const handleNext = () => {
    if (step === 'credentials') {
      setStep('test');
    } else if (step === 'test') {
      setStep('enable');
    }
  };

  const handleBack = () => {
    if (step === 'credentials') {
      if (integration) {
        handleClose();
      } else {
        setSelectedIntegration(null);
        setStep('provider');
      }
    } else if (step === 'test') {
      setStep('credentials');
    } else if (step === 'enable') {
      setStep('test');
    }
  };

  const handleTest = async () => {
    if (!selectedIntegration) return;
    setTestResult(null);
    try {
      const result = await testMutation.mutateAsync(selectedIntegration.id);
      setTestResult(result);
      if (!result.ok) {
        showToast(result.message, 'error');
      }
    } catch {
      showToast('Connection test failed. Please check your credentials and try again.', 'error');
    }
  };

  const handleFinish = async () => {
    if (!selectedIntegration) return;
    try {
      await updateIntegration.mutateAsync({
        id: selectedIntegration.id,
        input: { is_enabled: true, credentials: draftCredentials },
      });
      showToast(`${selectedIntegration.display_name} enabled successfully.`, 'success');
      onComplete?.();
      handleClose();
    } catch {
      showToast('Failed to enable integration.', 'error');
    }
  };

  const handleValueChange = (key: string, value: string | boolean) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setTestResult(null);
  };

  const renderStepIndicator = () => {
    const steps: { key: WizardStep; label: string }[] = [
      { key: 'provider', label: 'Provider' },
      { key: 'credentials', label: 'Credentials' },
      { key: 'test', label: 'Test' },
      { key: 'enable', label: 'Enable' },
    ];
    const visibleSteps = integration
      ? steps.filter((s) => s.key !== 'provider')
      : steps;
    const currentIndex = visibleSteps.findIndex((s) => s.key === step);

    return (
      <div className="mb-6 flex items-center justify-between">
        {visibleSteps.map((s, index) => {
          const isActive = index <= currentIndex;
          const isCurrent = s.key === step;
          return (
            <div key={s.key} className="flex flex-1 items-center">
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium',
                    isCurrent
                      ? 'bg-primary text-primary-foreground'
                      : isActive
                        ? 'bg-primary/20 text-primary'
                        : 'bg-muted text-muted-foreground',
                  )}
                >
                  {index + 1}
                </div>
                <span
                  className={cn(
                    'mt-1 text-xs',
                    isCurrent ? 'text-foreground font-medium' : 'text-muted-foreground',
                  )}
                >
                  {s.label}
                </span>
              </div>
              {index < visibleSteps.length - 1 && (
                <div
                  className={cn(
                    'mx-2 h-0.5 flex-1',
                    index < currentIndex ? 'bg-primary' : 'bg-muted',
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderProviderSelection = () => {
    if (isLoadingIntegrations && !providerOptions) {
      return (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      );
    }

    if (availableProviders.length === 0) {
      return (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No providers available to configure.
        </div>
      );
    }

    return (
      <div className="space-y-6 max-h-[50vh] overflow-y-auto pr-1">
        {categories.map((category) => (
          <div key={category}>
            <h3 className="mb-3 text-sm font-semibold text-foreground">{category}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {groupedProviders[category]?.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => handleSelectProvider(provider)}
                  className="flex items-start gap-3 rounded-lg border border-slate-200 bg-card p-4 text-left transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <Link2 className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-card-foreground">
                      {provider.display_name}
                    </p>
                    <p className="mt-0.5 text-xs font-mono text-muted-foreground truncate">
                      {provider.name}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderCredentialsForm = () => {
    if (!selectedIntegration) return null;

    if (fields.length === 0) {
      return (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
          No credential configuration available for this integration yet.
        </div>
      );
    }

    return (
      <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-1">
        <div className="flex items-center gap-3 rounded-lg border bg-muted/50 p-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <Link2 className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium">{selectedIntegration.display_name}</p>
            <p className="text-xs font-mono text-muted-foreground">{selectedIntegration.name}</p>
          </div>
        </div>

        {fields.map((field) => {
          const value = values[field.key] ?? '';
          const inputId = `wizard-cred-${selectedIntegration.id}-${field.key}`;

          if (field.type === 'boolean') {
            return (
              <div key={field.key} className="flex items-start justify-between gap-4 rounded-lg border p-3">
                <div className="space-y-0.5">
                  <Label htmlFor={inputId} className="text-sm">
                    {field.label}
                    {field.required && <span className="ml-0.5 text-red-500">*</span>}
                  </Label>
                  {field.helpText && (
                    <p className="text-xs text-muted-foreground">{field.helpText}</p>
                  )}
                </div>
                <Switch
                  id={inputId}
                  checked={Boolean(value)}
                  onCheckedChange={(checked) => handleValueChange(field.key, checked)}
                />
              </div>
            );
          }

          const inputType =
            field.type === 'number'
              ? 'number'
              : field.type === 'password' || field.type === 'secret'
                ? 'password'
                : 'text';

          return (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={inputId} className="text-sm">
                {field.label}
                {field.required && <span className="ml-0.5 text-red-500">*</span>}
              </Label>
              {field.helpText && (
                <p className="text-xs text-muted-foreground">{field.helpText}</p>
              )}
              <Input
                id={inputId}
                type={inputType}
                placeholder={field.placeholder}
                value={String(value)}
                onChange={(e) => handleValueChange(field.key, e.target.value)}
                className="h-10 text-sm"
              />
            </div>
          );
        })}
      </div>
    );
  };

  const renderTestStep = () => {
    if (!selectedIntegration) return null;

    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Test the connection to <span className="font-medium text-foreground">{selectedIntegration.display_name}</span>{' '}
          before enabling it.
        </p>

        <Button
          onClick={handleTest}
          disabled={testMutation.isPending}
          className="w-full"
        >
          {testMutation.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Testing…
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              Test Connection
            </>
          )}
        </Button>

        {testResult && (
          <div
            className={cn(
              'rounded-lg border p-4',
              testResult.ok
                ? 'border-green-200 bg-green-50 text-green-700'
                : 'border-red-200 bg-red-50 text-red-700',
            )}
          >
            <div className="flex items-start gap-3">
              {testResult.ok ? (
                <CheckCircle className="mt-0.5 h-5 w-5 shrink-0" />
              ) : (
                <XCircle className="mt-0.5 h-5 w-5 shrink-0" />
              )}
              <div>
                <p className="text-sm font-medium">
                  {testResult.ok ? 'Connection successful' : 'Connection failed'}
                </p>
                {testResult.message && (
                  <p className="mt-1 text-sm">{testResult.message}</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderEnableStep = () => {
    if (!selectedIntegration) return null;

    return (
      <div className="space-y-6">
        <div
          className={cn(
            'rounded-lg border p-4',
            testResult?.ok
              ? 'border-green-200 bg-green-50 text-green-700'
              : 'border-amber-200 bg-amber-50 text-amber-700',
          )}
        >
          <div className="flex items-start gap-3">
            {testResult?.ok ? (
              <CheckCircle className="mt-0.5 h-5 w-5 shrink-0" />
            ) : (
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            )}
            <div>
              <p className="text-sm font-medium">
                {testResult?.ok ? 'Ready to enable' : 'Test not completed'}
              </p>
              <p className="mt-1 text-sm">
                {testResult?.ok
                  ? 'The connection test passed. You can now enable this integration.'
                  : 'Please complete a successful connection test before enabling.'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-0.5">
            <Label htmlFor="enable-integration" className="text-sm font-medium">
              Enable {selectedIntegration.display_name}
            </Label>
            <p className="text-xs text-muted-foreground">
              Turn on this integration for active use.
            </p>
          </div>
          <Switch
            id="enable-integration"
            checked={isEnabled}
            onCheckedChange={setIsEnabled}
          />
        </div>
      </div>
    );
  };

  const renderStepContent = () => {
    switch (step) {
      case 'provider':
        return renderProviderSelection();
      case 'credentials':
        return renderCredentialsForm();
      case 'test':
        return renderTestStep();
      case 'enable':
        return renderEnableStep();
      default:
        return null;
    }
  };

  const canGoNext = isStepValid(step, selectedIntegration, values, testResult, isEnabled);
  const isLastStep = step === 'enable';

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="integration-wizard-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
    >
      <Card className="flex max-h-[90vh] w-full max-w-xl flex-col shadow-xl">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b pb-4">
          <div>
            <CardTitle id="integration-wizard-title" className="text-lg">
              {isLastStep ? 'Enable Integration' : 'Integration Setup'}
            </CardTitle>
            <CardDescription className="text-xs">
              {selectedIntegration
                ? `Configure ${selectedIntegration.display_name}`
                : 'Select a provider to configure'}
            </CardDescription>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </CardHeader>

        <CardContent className="flex-1 overflow-y-auto py-5">
          {renderStepIndicator()}
          {renderStepContent()}
        </CardContent>

        <div className="flex items-center justify-between border-t p-5">
          <Button
            variant="outline"
            onClick={handleBack}
            disabled={step === 'provider'}
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back
          </Button>

          {isLastStep ? (
            <Button
              onClick={handleFinish}
              disabled={!canGoNext || updateIntegration.isPending}
            >
              {updateIntegration.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Enabling…
                </>
              ) : (
                'Finish'
              )}
            </Button>
          ) : step === 'test' ? (
            <Button
              onClick={handleNext}
              disabled={!canGoNext}
            >
              Next
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          ) : (
            <Button
              onClick={handleNext}
              disabled={!canGoNext}
            >
              Next
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

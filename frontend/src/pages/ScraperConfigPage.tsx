import { useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
import { Search, Globe, Video, Facebook, Plus, Play, Trash2, Eye, X, Loader2, Sparkles } from 'lucide-react';
import {
  useScraperConfigs,
  useCreateScraperConfig,
  useUpdateScraperConfig,
  useDeleteScraperConfig,
  useTriggerScrape,
  useScraperLogs,
  useDetectSelectors,
} from '@/api/scraper';
import type { ScraperSourceType, ScraperConfig } from '@/types';

const sourceIcons: Record<ScraperSourceType, React.ReactNode> = {
  google_places: <Search className="h-4 w-4" />,
  facebook: <Facebook className="h-4 w-4" />,
  youtube: <Video className="h-4 w-4" />,
  web_scrape: <Globe className="h-4 w-4" />,
};

const sourceLabels: Record<ScraperSourceType, string> = {
  google_places: 'Google Places',
  facebook: 'Facebook',
  youtube: 'YouTube',
  web_scrape: 'Web Scrape',
};

const sourceColors: Record<ScraperSourceType, string> = {
  google_places: 'bg-blue-100 text-blue-700',
  facebook: 'bg-indigo-100 text-indigo-700',
  youtube: 'bg-red-100 text-red-700',
  web_scrape: 'bg-emerald-100 text-emerald-700',
};

interface ConfigForm {
  name: string;
  source_type: ScraperSourceType;
  config: Record<string, unknown>;
  schedule_cron: string;
}

const emptyForm: ConfigForm = {
  name: '',
  source_type: 'google_places',
  config: {},
  schedule_cron: '',
};

function getPlaceholderConfig(sourceType: ScraperSourceType): Record<string, unknown> {
  switch (sourceType) {
    case 'google_places':
      return { query: '', location: '', radius: 5000, maxResults: 20, apiKeyRef: 'GOOGLE_PLACES_API_KEY' };
    case 'facebook':
      return { pageId: '', accessTokenRef: 'FACEBOOK_ACCESS_TOKEN', fields: 'name,about,phone,website,emails,location', maxPosts: 25 };
    case 'youtube':
      return { query: '', channelId: '', maxResults: 10, apiKeyRef: 'YOUTUBE_API_KEY' };
    case 'web_scrape':
      return { url: '', mode: 'smart', selectors: {}, maxPages: 1 };
  }
}

interface WebScrapeExtras {
  onAutoDetect: () => void;
  detecting: boolean;
}

function getConfigFields(
  sourceType: ScraperSourceType,
  config: Record<string, unknown>,
  onChange: (key: string, value: unknown) => void,
  web?: WebScrapeExtras,
) {
  switch (sourceType) {
    case 'google_places':
      return (
        <>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Search Queries * <span className="text-slate-300">— one per line</span>
            </label>
            <textarea
              value={
                Array.isArray(config.query)
                  ? (config.query as string[]).join('\n')
                  : ((config.query as string) ?? '')
              }
              onChange={(e) => {
                const lines = e.target.value.split('\n').map((l) => l.trimStart());
                const terms = lines.filter((l) => l.trim().length > 0);
                // Send an array when there are multiple terms, a string for one.
                onChange('query', terms.length > 1 ? terms : (lines[0] ?? ''));
              }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              rows={3}
              placeholder={'restaurants\ncafes\nbakeries'}
            />
            <p className="mt-1 text-xs text-slate-400">
              Each line runs as a separate search; results are merged and de-duplicated.
            </p>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Location <span className="text-slate-300">— place name or lat,lng</span>
            </label>
            <input
              type="text"
              value={(config.location as string) ?? ''}
              onChange={(e) => onChange('location', e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Yelahanka, Bangalore  (or 13.10,77.59)"
            />
            <p className="mt-1 text-xs text-slate-400">
              A place name is auto-converted to coordinates. Leave blank to search everywhere.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Radius (meters)</label>
            <input
              type="number"
              value={(config.radius as number) ?? 5000}
              onChange={(e) => onChange('radius', parseInt(e.target.value) || 5000)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              min={1}
              max={50000}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Max Results</label>
            <input
              type="number"
              value={(config.maxResults as number) ?? 20}
              onChange={(e) => onChange('maxResults', parseInt(e.target.value) || 20)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              min={1}
              max={50}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">API Key Env Ref</label>
            <input
              type="text"
              value={(config.apiKeyRef as string) ?? ''}
              onChange={(e) => onChange('apiKeyRef', e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="GOOGLE_PLACES_API_KEY"
            />
          </div>
        </>
      );
    case 'facebook':
      return (
        <>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Page ID *</label>
            <input
              type="text"
              value={(config.pageId as string) ?? ''}
              onChange={(e) => onChange('pageId', e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="123456789"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Access Token Env Ref</label>
            <input
              type="text"
              value={(config.accessTokenRef as string) ?? ''}
              onChange={(e) => onChange('accessTokenRef', e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="FACEBOOK_ACCESS_TOKEN"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Max Posts</label>
            <input
              type="number"
              value={(config.maxPosts as number) ?? 25}
              onChange={(e) => onChange('maxPosts', parseInt(e.target.value) || 25)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              min={1}
              max={100}
            />
          </div>
        </>
      );
    case 'youtube':
      return (
        <>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Search Query *</label>
            <input
              type="text"
              value={(config.query as string) ?? ''}
              onChange={(e) => onChange('query', e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="real estate agent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Channel ID (optional)</label>
            <input
              type="text"
              value={(config.channelId as string) ?? ''}
              onChange={(e) => onChange('channelId', e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="UC..."
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Max Results</label>
            <input
              type="number"
              value={(config.maxResults as number) ?? 10}
              onChange={(e) => onChange('maxResults', parseInt(e.target.value) || 10)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              min={1}
              max={50}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">API Key Env Ref</label>
            <input
              type="text"
              value={(config.apiKeyRef as string) ?? ''}
              onChange={(e) => onChange('apiKeyRef', e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="YOUTUBE_API_KEY"
            />
          </div>
        </>
      );
    case 'web_scrape': {
      const mode = (config.mode as string) ?? 'smart';
      return (
        <>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-500 mb-1">Extraction Mode</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onChange('mode', 'smart')}
                className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                  mode === 'smart'
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
              >
                ✨ Smart (no setup)
              </button>
              <button
                type="button"
                onClick={() => onChange('mode', 'selectors')}
                className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                  mode === 'selectors'
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
              >
                Custom selectors
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              {mode === 'smart'
                ? 'Auto-grabs emails & phone numbers from the page — no CSS selectors needed. Best for a single contact / about page.'
                : 'Precisely target each field with CSS selectors. Best for directory pages with many listings.'}
            </p>
          </div>

          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-500 mb-1">URL *</label>
            <input
              type="url"
              value={(config.url as string) ?? ''}
              onChange={(e) => onChange('url', e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="https://example.com/businesses"
            />
          </div>

          {mode === 'selectors' && (
            <>
              <div className="col-span-2 flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  Don&apos;t know the selectors? Let AI read the page and fill them in.
                </span>
                <button
                  type="button"
                  onClick={() => web?.onAutoDetect()}
                  disabled={web?.detecting}
                  className="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                >
                  {web?.detecting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  Auto-detect with AI
                </button>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-500 mb-1">CSS Selectors (JSON)</label>
                <textarea
                  value={config.selectors ? JSON.stringify(config.selectors, null, 2) : ''}
                  onChange={(e) => {
                    try {
                      onChange('selectors', JSON.parse(e.target.value));
                    } catch {
                      // Allow typing
                    }
                  }}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  rows={4}
                  placeholder='{"business_name": ".business-name", "phone": ".phone", "email": ".email"}'
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Container Selector</label>
                <input
                  type="text"
                  value={(config.containerSelector as string) ?? ''}
                  onChange={(e) => onChange('containerSelector', e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder=".listing-card"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Max Pages</label>
            <input
              type="number"
              value={(config.maxPages as number) ?? 1}
              onChange={(e) => onChange('maxPages', parseInt(e.target.value) || 1)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              min={1}
              max={10}
            />
          </div>

          {mode === 'smart' && (
            <div className="col-span-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Heads up: this reads the page&apos;s raw HTML and doesn&apos;t run JavaScript. If a site renders
              its content with JS, few or no results may come back.
            </div>
          )}
        </>
      );
    }
  }
}

export function ScraperConfigPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';
  const { showToast } = useToast();

  const { data: configs, isLoading, error } = useScraperConfigs();
  const createMutation = useCreateScraperConfig();
  const updateMutation = useUpdateScraperConfig();
  const deleteMutation = useDeleteScraperConfig();
  const triggerMutation = useTriggerScrape();
  const detectMutation = useDetectSelectors();

  const [showAddForm, setShowAddForm] = useState(false);
  const [showLogs, setShowLogs] = useState<string | null>(null);
  const [editConfig, setEditConfig] = useState<{ id: string; form: ConfigForm } | null>(null);
  const [form, setForm] = useState<ConfigForm>(emptyForm);

  const { data: logsData } = useScraperLogs(showLogs ?? '');

  function resetForm() {
    setForm(emptyForm);
    setShowAddForm(false);
    setEditConfig(null);
  }

  function openAddForm() {
    // Seed the form with the default source type AND its placeholder config so
    // required fields (e.g. apiKeyRef, radius) are pre-filled — otherwise the
    // create request is rejected by backend validation.
    setForm({ ...emptyForm, config: getPlaceholderConfig(emptyForm.source_type) });
    setShowAddForm(true);
  }

  function handleSourceChange(sourceType: ScraperSourceType) {
    setForm((prev) => ({
      ...prev,
      source_type: sourceType,
      config: getPlaceholderConfig(sourceType),
    }));
  }

  function handleConfigChange(key: string, value: unknown) {
    setForm((prev) => ({
      ...prev,
      config: { ...prev.config, [key]: value },
    }));
  }

  function handleAutoDetect(
    currentConfig: Record<string, unknown>,
    applyChange: (key: string, value: unknown) => void,
  ) {
    const url = (currentConfig.url as string) || '';
    if (!url) {
      showToast('Enter the page URL first.', 'error');
      return;
    }
    detectMutation.mutate(url, {
      onSuccess: (res) => {
        applyChange('selectors', res.selectors ?? {});
        if (res.containerSelector) applyChange('containerSelector', res.containerSelector);
        const count = Object.keys(res.selectors ?? {}).length;
        showToast(
          count > 0
            ? `Detected ${count} field selector(s). Review them and Save.`
            : 'No selectors detected. Try Smart mode or enter them manually.',
          count > 0 ? 'success' : 'error',
        );
      },
      onError: (error) => showToast(getApiErrorMessage(error, 'Auto-detect failed.'), 'error'),
    });
  }

  async function handleCreate() {
    try {
      await createMutation.mutateAsync({
        name: form.name,
        source_type: form.source_type,
        config: form.config,
        schedule_cron: form.schedule_cron || null,
      });
      showToast('Scraper source created.', 'success');
      resetForm();
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to create scraper source.'), 'error');
    }
  }

  async function handleEdit(id: string) {
    if (!editConfig) return;
    try {
      await updateMutation.mutateAsync({
        id,
        name: editConfig.form.name,
        config: editConfig.form.config,
        schedule_cron: editConfig.form.schedule_cron || null,
      });
      showToast('Scraper source updated.', 'success');
      setEditConfig(null);
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to update scraper source.'), 'error');
    }
  }

  function handleDelete(config: ScraperConfig) {
    if (!window.confirm(`Delete "${config.name}"? This cannot be undone.`)) return;
    deleteMutation.mutate(config.id, {
      onSuccess: () => showToast('Scraper source deleted.', 'success'),
      onError: (error) =>
        showToast(getApiErrorMessage(error, 'Failed to delete scraper source.'), 'error'),
    });
  }

  function handleRun(config: ScraperConfig) {
    triggerMutation.mutate(config.id, {
      onSuccess: (res) => {
        if (res.status === 'failed') {
          showToast(res.errorMessage || 'Scrape failed. Open the run logs for details.', 'error');
        } else if (res.recordsFound === 0) {
          showToast(
            'Scrape finished, but no results matched. Try a broader query or location.',
            'success',
          );
        } else {
          showToast(
            `Scrape complete: imported ${res.recordsImported} of ${res.recordsFound} found.`,
            'success',
          );
        }
        // Reveal the run history for this source so the user sees the new entry.
        setShowLogs(config.id);
      },
      onError: () => {
        showToast('Could not start the scrape. Please try again.', 'error');
      },
    });
  }

  function startEdit(config: ScraperConfig) {
    setEditConfig({
      id: config.id,
      form: {
        name: config.name,
        source_type: config.source_type,
        config: config.config,
        schedule_cron: config.schedule_cron ?? '',
      },
    });
  }

  const logs = logsData ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Scraper Sources</h1>
          <p className="mt-1 text-sm text-slate-500">
            Configure and run lead scrapers for Google Places, Facebook, YouTube, and websites.
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={openAddForm}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" />
            Add Source
          </button>
        )}
      </div>

      {/* Add Form Modal */}
      {(showAddForm || editConfig) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900">
                {editConfig ? 'Edit Source' : 'Add New Source'}
              </h2>
              <button onClick={resetForm} className="rounded-lg p-1 text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Source Type Selector (only on create) */}
            {!editConfig && (
              <div className="mb-4">
                <label className="block text-xs font-medium text-slate-500 mb-2">Source Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.entries(sourceLabels) as [ScraperSourceType, string][]).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => handleSourceChange(key)}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                        form.source_type === key
                          ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                          : 'border-slate-200 text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      <span className={sourceColors[key].split(' ')[0] + ' p-0.5 rounded'}>{sourceIcons[key]}</span>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Name *</label>
                <input
                  type="text"
                  value={editConfig ? editConfig.form.name : form.name}
                  onChange={(e) => {
                    if (editConfig) {
                      setEditConfig((prev) => prev ? { ...prev, form: { ...prev.form, name: e.target.value } } : null);
                    } else {
                      setForm((prev) => ({ ...prev, name: e.target.value }));
                    }
                  }}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder={editConfig ? '' : 'My Google Places Scraper'}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                {(() => {
                  const currentSourceType = editConfig
                    ? editConfig.form.source_type
                    : form.source_type;
                  const currentConfig = editConfig ? editConfig.form.config : form.config;
                  const applyChange = (key: string, value: unknown) => {
                    if (editConfig) {
                      setEditConfig((prev) =>
                        prev
                          ? {
                              ...prev,
                              form: { ...prev.form, config: { ...prev.form.config, [key]: value } },
                            }
                          : null,
                      );
                    } else {
                      handleConfigChange(key, value);
                    }
                  };
                  return getConfigFields(currentSourceType, currentConfig, applyChange, {
                    onAutoDetect: () => handleAutoDetect(currentConfig, applyChange),
                    detecting: detectMutation.isPending,
                  });
                })()}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Schedule (cron) <span className="text-slate-300">— optional</span>
                </label>
                <input
                  type="text"
                  value={editConfig ? editConfig.form.schedule_cron : form.schedule_cron}
                  onChange={(e) => {
                    if (editConfig) {
                      setEditConfig((prev) => prev ? { ...prev, form: { ...prev.form, schedule_cron: e.target.value } } : null);
                    } else {
                      setForm((prev) => ({ ...prev, schedule_cron: e.target.value }));
                    }
                  }}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="0 6 * * 1 (every Monday at 6 AM)"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button onClick={resetForm} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button
                onClick={() => editConfig ? handleEdit(editConfig.id) : handleCreate()}
                disabled={createMutation.isPending || updateMutation.isPending}
                className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="h-4 w-4 animate-spin" />}
                {editConfig ? 'Save Changes' : 'Create Source'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading / Error / Empty States */}
      {isLoading && (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-indigo-500" />
          <p className="mt-3 text-sm text-slate-500">Loading scraper sources...</p>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm text-red-700">Failed to load scraper sources. Please try again.</p>
        </div>
      )}

      {!isLoading && !error && (!configs || configs.length === 0) && (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
          <Search className="mx-auto h-10 w-10 text-slate-300" />
          <h3 className="mt-4 text-lg font-semibold text-slate-900">No scraper sources yet</h3>
          <p className="mt-1 text-sm text-slate-500">
            Create your first scraper source to start importing leads automatically.
          </p>
          {isAdmin && (
            <button
              onClick={openAddForm}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              <Plus className="h-4 w-4" />
              Add Source
            </button>
          )}
        </div>
      )}

      {/* Config List */}
      {!isLoading && !error && configs && configs.length > 0 && (
        <div className="space-y-3">
          {configs.map((config) => (
            <div key={config.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`rounded-lg p-1.5 ${sourceColors[config.source_type].split(' ')[0]}`}>
                    <span className={sourceColors[config.source_type].split(' ').slice(1).join(' ')}>
                      {sourceIcons[config.source_type]}
                    </span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-slate-900">{config.name}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${sourceColors[config.source_type]}`}>
                        {sourceLabels[config.source_type]}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {config.is_active ? 'Active' : 'Inactive'}
                      {config.last_run_at ? ` · Last run: ${new Date(config.last_run_at).toLocaleDateString()}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isAdmin && (
                    <>
                      <button
                        onClick={() => startEdit(config)}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleRun(config)}
                        disabled={triggerMutation.isPending}
                        className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {triggerMutation.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Play className="h-3 w-3" />
                        )}
                        Run Now
                      </button>
                      <button
                        onClick={() => setShowLogs(showLogs === config.id ? null : config.id)}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                          showLogs === config.id
                            ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                            : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(config)}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Logs Section */}
              {showLogs === config.id && (
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">Recent Runs</h4>
                  {logs.length === 0 ? (
                    <p className="text-sm text-slate-400">No runs yet. Click "Run Now" to start.</p>
                  ) : (
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {(Array.isArray(logs) ? logs : []).map((log) => (
                        <div key={log.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span className={`h-2 w-2 rounded-full ${
                                log.status === 'completed' ? 'bg-emerald-500' :
                                log.status === 'failed' ? 'bg-red-500' :
                                log.status === 'running' ? 'bg-amber-500 animate-pulse' :
                                'bg-slate-400'
                              }`} />
                              <span className="text-slate-600">{new Date(log.created_at).toLocaleString()}</span>
                            </div>
                            <div className="flex items-center gap-4 text-xs text-slate-500">
                              <span>Found: {log.records_found}</span>
                              <span>Imported: {log.records_imported}</span>
                              <span className={log.records_failed > 0 ? 'text-red-500' : ''}>
                                Failed: {log.records_failed}
                              </span>
                            </div>
                          </div>
                          {log.status === 'failed' && log.error_message ? (
                            <p className="mt-1.5 pl-5 text-xs text-red-600">{log.error_message}</p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

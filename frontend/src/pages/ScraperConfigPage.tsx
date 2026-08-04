import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
import { PageHeader } from '@/components/ui/PageHeader';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge';
import { LoadingTable } from '@/components/ui/LoadingTable';
import {
  Search,
  Globe,
  Video,
  Facebook,
  Plus,
  Play,
  Trash2,
  Eye,
  X,
  Loader2,
  Sparkles,
  Bot,
  Chrome,
  AlertTriangle,
  RotateCcw,
  Users,
  Compass,
  Copy,
  Megaphone,
  Linkedin,
  FileText,
  FileDown,
} from 'lucide-react';
import {
  useScraperConfigs,
  useCreateScraperConfig,
  useUpdateScraperConfig,
  useDeleteScraperConfig,
  useTriggerScrape,
  useScraperLogs,
  useDetectSelectors,
  useScraperStatsSummary,
  useScraperRunLeads,
  useRetryFailedScrape,
  useDiscoverPages,
  useScraperGroups,
  useScraperTrends,
  exportRunLeadsCsv,
} from '@/api/scraper';
import { MultiLineChart, type SeriesDef } from '@/components/reports/AnalyticsCharts';
import type { ScraperSourceType, ScraperConfig } from '@/types';
import { ROLE_PERMISSIONS } from '@/types/account';

/* ─── Source Metadata ─── */

const sourceIcons: Record<ScraperSourceType, React.ReactNode> = {
  google_places: <Search className="h-4 w-4" />,
  facebook: <Facebook className="h-4 w-4" />,
  youtube: <Video className="h-4 w-4" />,
  web_scrape: <Globe className="h-4 w-4" />,
  meta_lead_forms: <Megaphone className="h-4 w-4" />,
  google_ads_lead_forms: <FileText className="h-4 w-4" />,
  linkedin_lead_forms: <Linkedin className="h-4 w-4" />,
  apify_actor: <Bot className="h-4 w-4" />,
  browser_scrape: <Chrome className="h-4 w-4" />,
};

const sourceLabels: Record<ScraperSourceType, string> = {
  google_places: 'Google Places',
  facebook: 'Facebook',
  youtube: 'YouTube',
  web_scrape: 'Web Scrape',
  meta_lead_forms: 'Meta Lead Forms',
  google_ads_lead_forms: 'Google Ads Forms',
  linkedin_lead_forms: 'LinkedIn Lead Forms',
  apify_actor: 'Apify Actor',
  browser_scrape: 'Browser Scrape (JS sites)',
};

const sourceColors: Record<ScraperSourceType, string> = {
  google_places: 'bg-blue-100 text-blue-700',
  facebook: 'bg-indigo-100 text-indigo-700',
  youtube: 'bg-red-100 text-red-700',
  web_scrape: 'bg-emerald-100 text-emerald-700',
  meta_lead_forms: 'bg-sky-100 text-sky-700',
  google_ads_lead_forms: 'bg-yellow-100 text-yellow-700',
  linkedin_lead_forms: 'bg-blue-100 text-blue-800',
  apify_actor: 'bg-purple-100 text-purple-700',
  browser_scrape: 'bg-orange-100 text-orange-700',
};

/* ─── Form Types ─── */

interface ConfigForm {
  name: string;
  source_type: ScraperSourceType;
  config: Record<string, unknown>;
  schedule_cron: string;
  webhook_url: string;
  group_name: string;
}

const emptyForm: ConfigForm = {
  name: '',
  source_type: 'google_places',
  config: {},
  schedule_cron: '',
  webhook_url: '',
  group_name: '',
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
    case 'meta_lead_forms':
      return { integrationId: '', formId: '', sinceHours: 24, maxResults: 100 };
    case 'google_ads_lead_forms':
      return { webhookSecretRef: 'GOOGLE_ADS_WEBHOOK_SECRET' };
    case 'linkedin_lead_forms':
      return { mode: 'manual_import' };
    case 'apify_actor':
      return { actorId: '', input: {}, maxResults: 100 };
    case 'browser_scrape':
      return { url: '', mode: 'smart', selectors: {}, waitForSelector: '', waitMs: 0, maxPages: 1 };
  }
}

/* ─── Helpers ─── */

function getRunStatusTone(status: string): StatusTone {
  switch (status) {
    case 'completed': return 'green';
    case 'failed': return 'red';
    case 'running': return 'amber';
    case 'partially_completed': return 'amber';
    default: return 'gray';
  }
}

/* ─── Sub-Components ─── */

interface WebScrapeExtras {
  onAutoDetect: () => void;
  detecting: boolean;
}

function UrlListField({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  const { showToast } = useToast();
  const discoverMutation = useDiscoverPages();
  const [showDiscovered, setShowDiscovered] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const currentUrls = Array.isArray(config.url)
    ? (config.url as string[])
    : config.url
      ? [config.url as string]
      : [];

  function handleDiscover() {
    const rootUrl = currentUrls[0];
    if (!rootUrl) {
      showToast('Enter at least one URL first, then click Discover Pages.', 'error');
      return;
    }
    discoverMutation.mutate(rootUrl, {
      onSuccess: (pages) => {
        setShowDiscovered(true);
        setSelected(new Set(pages.filter((p) => !currentUrls.includes(p.url)).map((p) => p.url)));
        if (pages.length === 0) {
          showToast('No other pages found — the site may only have this one page.', 'success');
        }
      },
      onError: (error) => showToast(getApiErrorMessage(error, 'Could not discover pages.'), 'error'),
    });
  }

  function toggleSelected(url: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  function handleAddSelected() {
    const merged = Array.from(new Set([...currentUrls, ...selected]));
    onChange('url', merged.length > 1 ? merged : (merged[0] ?? ''));
    setShowDiscovered(false);
    setSelected(new Set());
  }

  return (
    <div className="col-span-2">
      <div className="mb-1 flex items-center justify-between">
        <label className="block text-xs font-medium text-slate-500">
          URL(s) <span className="text-red-500">*</span> <span className="text-slate-300">— one per line</span>
        </label>
        <button
          type="button"
          onClick={handleDiscover}
          disabled={discoverMutation.isPending}
          className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
        >
          {discoverMutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Compass className="h-3 w-3" />
          )}
          Discover Pages
        </button>
      </div>
      <textarea
        value={currentUrls.join('\n')}
        onChange={(e) => {
          const lines = e.target.value.split('\n').map((l) => l.trimStart());
          const urls = lines.filter((l) => l.trim().length > 0);
          // Take the first NON-EMPTY line, not lines[0]: if the user leaves
          // line 1 blank and types on line 2, lines[0] is '' and the typed
          // URL gets thrown away as they type.
          onChange('url', urls.length > 1 ? urls : (urls[0] ?? ''));
        }}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
        rows={3}
        placeholder={'https://example.com/businesses\nhttps://example.org/contact'}
      />
      <p className="mt-1 text-xs text-slate-400">
        Each line is scraped separately and results are merged into one run. Discover Pages
        renders the first URL above and lists its other pages so you can pick which to add.
      </p>

      {showDiscovered && discoverMutation.data && discoverMutation.data.length > 0 && (
        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="mb-2 text-xs font-medium text-slate-600">
            Found {discoverMutation.data.length} page(s) — check the ones to add:
          </p>
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {discoverMutation.data.map((p) => {
              const alreadyAdded = currentUrls.includes(p.url);
              return (
                <label key={p.url} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={selected.has(p.url)}
                    onChange={() => toggleSelected(p.url)}
                    disabled={alreadyAdded}
                  />
                  <span className={alreadyAdded ? 'text-slate-400' : 'text-slate-700'}>
                    {p.label}
                    {alreadyAdded ? ' (already added)' : ''}
                  </span>
                  <span className="truncate text-slate-400">{p.url}</span>
                </label>
              );
            })}
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowDiscovered(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleAddSelected} disabled={selected.size === 0}>
              Add Selected ({selected.size})
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function JsonField({
  value,
  onChange,
  placeholder,
  rows = 4,
  onValidityChange,
}: {
  value: Record<string, unknown> | undefined;
  onChange: (val: Record<string, unknown> | undefined) => void;
  placeholder?: string;
  rows?: number;
  /** Lets the parent block submit while the JSON in this field is unparseable. */
  onValidityChange?: (valid: boolean) => void;
}) {
  const [localValue, setLocalValue] = useState(
    value && Object.keys(value).length > 0 ? JSON.stringify(value, null, 2) : ''
  );

  useEffect(() => {
    try {
      const parsed = localValue ? JSON.parse(localValue) : undefined;
      if (JSON.stringify(parsed) !== JSON.stringify(value)) {
        setLocalValue(value && Object.keys(value).length > 0 ? JSON.stringify(value, null, 2) : '');
      }
    } catch {
      // Do nothing, let user keep typing invalid JSON
    }
  }, [value]);

  // Invalid JSON used to be swallowed silently: the textarea kept showing the
  // user's text while the parent state held the last valid value, so Save
  // persisted something different from what was on screen. Track the parse
  // error and show it instead.
  const [parseError, setParseError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newVal = e.target.value;
    setLocalValue(newVal);
    try {
      if (!newVal.trim()) {
        onChange(undefined);
      } else {
        const parsed = JSON.parse(newVal) as Record<string, unknown>;
        onChange(parsed);
      }
      setParseError(null);
      onValidityChange?.(true);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Invalid JSON');
      onValidityChange?.(false);
    }
  };

  return (
    <>
      <textarea
        value={localValue}
        onChange={handleChange}
        aria-invalid={parseError ? true : undefined}
        className={`w-full rounded-lg border px-3 py-2 text-sm font-mono ${
          parseError ? 'border-red-300' : 'border-slate-300'
        }`}
        rows={rows}
        placeholder={placeholder}
      />
      {parseError && (
        <p className="mt-1 text-xs text-red-500">
          Invalid JSON — changes are not being saved. {parseError}
        </p>
      )}
    </>
  );
}

function DeepCrawlFields({
  config,
  onChange,
  maxPagesCap,
}: {
  config: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  maxPagesCap: number;
}) {
  const enabled = config.followLinks === true;

  function patternsValue(key: 'includePatterns' | 'excludePatterns'): string {
    const raw = config[key];
    return Array.isArray(raw) ? (raw as string[]).join(', ') : '';
  }

  function onPatternsChange(key: 'includePatterns' | 'excludePatterns', value: string) {
    const patterns = value
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    onChange(key, patterns.length > 0 ? patterns : undefined);
  }

  return (
    <div className="col-span-2 rounded-lg border border-slate-200 p-3">
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange('followLinks', e.target.checked)}
          className="h-4 w-4 rounded border-slate-300"
        />
        <span className="font-medium">Deep crawl</span>
        <span className="text-xs text-slate-400">
          — automatically follow links on the site, like a crawler
        </span>
      </label>

      {enabled && (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Link Depth</label>
            <Input
              type="number"
              value={(config.maxDepth as number) ?? 2}
              onChange={(e) => onChange('maxDepth', parseInt(e.target.value) || 2)}
              min={1}
              max={5}
            />
            <p className="mt-1 text-xs text-slate-400">
              1 = only pages linked from your URLs, 2 = their links too, and so on.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Page Budget</label>
            <Input
              type="number"
              value={(config.maxPages as number) ?? 1}
              onChange={(e) => onChange('maxPages', parseInt(e.target.value) || 1)}
              min={1}
              max={maxPagesCap}
            />
            <p className="mt-1 text-xs text-slate-400">
              Total pages crawled in one run (max {maxPagesCap}).
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Include Patterns <span className="text-slate-300">— optional, comma-separated</span>
            </label>
            <Input
              type="text"
              value={patternsValue('includePatterns')}
              onChange={(e) => onPatternsChange('includePatterns', e.target.value)}
              placeholder="/contact, /about, /team"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Exclude Patterns <span className="text-slate-300">— optional, comma-separated</span>
            </label>
            <Input
              type="text"
              value={patternsValue('excludePatterns')}
              onChange={(e) => onPatternsChange('excludePatterns', e.target.value)}
              placeholder="/blog, /careers, ?sort="
            />
          </div>
          <p className="col-span-2 text-xs text-slate-400">
            Only followed links containing an include pattern (when set) and no exclude pattern
            are crawled. Stays on the same site and respects robots.txt.
          </p>
        </div>
      )}
    </div>
  );
}

/* ─── Config Fields Per Source Type ─── */

function getConfigFields(
  sourceType: ScraperSourceType,
  config: Record<string, unknown>,
  onChange: (key: string, value: unknown) => void,
  web?: WebScrapeExtras,
  onJsonValidityChange?: (valid: boolean) => void,
) {
  switch (sourceType) {
    case 'google_places':
      return (
        <>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Search Queries <span className="text-red-500">*</span> <span className="text-slate-300">— one per line</span>
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
                // First non-empty line — see the URL field above for why.
                onChange('query', terms.length > 1 ? terms : (terms[0] ?? ''));
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
            <Input
              type="text"
              value={(config.location as string) ?? ''}
              onChange={(e) => onChange('location', e.target.value)}
              placeholder="Yelahanka, Bangalore  (or 13.10,77.59)"
            />
            <p className="mt-1 text-xs text-slate-400">
              A place name is auto-converted to coordinates. Leave blank to search everywhere.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Radius (meters)</label>
            <Input
              type="number"
              value={(config.radius as number) ?? 5000}
              onChange={(e) => onChange('radius', parseInt(e.target.value) || 5000)}
              min={1}
              max={50000}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Max Results</label>
            <Input
              type="number"
              value={(config.maxResults as number) ?? 20}
              onChange={(e) => onChange('maxResults', parseInt(e.target.value) || 20)}
              min={1}
              max={50}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">API Key Env Ref</label>
            <Input
              type="text"
              value={(config.apiKeyRef as string) ?? ''}
              onChange={(e) => onChange('apiKeyRef', e.target.value)}
              placeholder="GOOGLE_PLACES_API_KEY"
            />
          </div>
        </>
      );
    case 'facebook':
      return (
        <>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Page ID <span className="text-red-500">*</span></label>
            <Input
              type="text"
              value={(config.pageId as string) ?? ''}
              onChange={(e) => onChange('pageId', e.target.value)}
              placeholder="123456789"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Access Token Env Ref</label>
            <Input
              type="text"
              value={(config.accessTokenRef as string) ?? ''}
              onChange={(e) => onChange('accessTokenRef', e.target.value)}
              placeholder="FACEBOOK_ACCESS_TOKEN"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Max Posts</label>
            <Input
              type="number"
              value={(config.maxPosts as number) ?? 25}
              onChange={(e) => onChange('maxPosts', parseInt(e.target.value) || 25)}
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
            <label className="block text-xs font-medium text-slate-500 mb-1">Search Query <span className="text-red-500">*</span></label>
            <Input
              type="text"
              value={(config.query as string) ?? ''}
              onChange={(e) => onChange('query', e.target.value)}
              placeholder="real estate agent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Channel ID (optional)</label>
            <Input
              type="text"
              value={(config.channelId as string) ?? ''}
              onChange={(e) => onChange('channelId', e.target.value)}
              placeholder="UC..."
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Max Results</label>
            <Input
              type="number"
              value={(config.maxResults as number) ?? 10}
              onChange={(e) => onChange('maxResults', parseInt(e.target.value) || 10)}
              min={1}
              max={50}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">API Key Env Ref</label>
            <Input
              type="text"
              value={(config.apiKeyRef as string) ?? ''}
              onChange={(e) => onChange('apiKeyRef', e.target.value)}
              placeholder="YOUTUBE_API_KEY"
            />
          </div>
        </>
      );
    case 'meta_lead_forms':
      return (
        <>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Integration ID <span className="text-red-500">*</span></label>
            <Input
              type="text"
              value={(config.integrationId as string) ?? ''}
              onChange={(e) => onChange('integrationId', e.target.value)}
              placeholder="Meta integration UUID"
            />
            <p className="mt-1 text-xs text-slate-400">
              The ID of a configured Facebook/Meta integration under Integrations.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Form ID <span className="text-red-500">*</span></label>
            <Input
              type="text"
              value={(config.formId as string) ?? ''}
              onChange={(e) => onChange('formId', e.target.value)}
              placeholder="1234567890123456"
            />
            <p className="mt-1 text-xs text-slate-400">
              The lead form ID from your Facebook page or Ads Manager.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Lookback (hours)</label>
            <Input
              type="number"
              value={(config.sinceHours as number) ?? 24}
              onChange={(e) => onChange('sinceHours', parseInt(e.target.value) || 24)}
              min={1}
              max={720}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Max Results</label>
            <Input
              type="number"
              value={(config.maxResults as number) ?? 100}
              onChange={(e) => onChange('maxResults', parseInt(e.target.value) || 100)}
              min={1}
              max={1000}
            />
          </div>
          <div className="col-span-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
            Pulls leads from a Meta/Facebook lead form via the Graph API. Requires a configured
            Facebook integration with an access token. Leads are imported into your CRM automatically.
          </div>
        </>
      );
    case 'google_ads_lead_forms':
      return (
        <>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-500 mb-1">Webhook Secret Env Ref</label>
            <Input
              type="text"
              value={(config.webhookSecretRef as string) ?? ''}
              onChange={(e) => onChange('webhookSecretRef', e.target.value)}
              placeholder="GOOGLE_ADS_WEBHOOK_SECRET"
            />
            <p className="mt-1 text-xs text-slate-400">
              Environment variable name holding the webhook secret for verifying Google Ads payloads.
            </p>
          </div>
          <div className="col-span-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Google Ads lead forms are ingested via webhook (<code>POST /webhooks/google-ads</code>).
            This source type registers the webhook config. Leads arrive in real-time when a user
            submits a Google Ads lead form.
          </div>
        </>
      );
    case 'linkedin_lead_forms':
      return (
        <>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-500 mb-1">Import Mode</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onChange('mode', 'manual_import')}
                className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                  (config.mode ?? 'manual_import') === 'manual_import'
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
              >
                Manual Import
              </button>
              <button
                type="button"
                onClick={() => onChange('mode', 'api')}
                className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                  config.mode === 'api'
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
              >
                API (coming soon)
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Manual import: upload leads via CSV from LinkedIn Campaign Manager. API mode will
              pull leads automatically when the LinkedIn integration is configured.
            </p>
          </div>
          <div className="col-span-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
            LinkedIn Lead Gen Forms require a LinkedIn Marketing integration. Export your leads
            as CSV from LinkedIn Campaign Manager and import them into your CRM.
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
                Smart (no setup)
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
                ? 'Auto-grabs emails & phone numbers from the page — no CSS selectors needed.'
                : 'Precisely target each field with CSS selectors. Best for directory pages.'}
            </p>
          </div>

          <UrlListField config={config} onChange={onChange} />

          {mode === 'selectors' && (
            <>
              <div className="col-span-2 flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  Don&apos;t know the selectors? Let AI read the page and fill them in.
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => web?.onAutoDetect()}
                  disabled={web?.detecting}
                >
                  {web?.detecting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5 mr-1" />
                  )}
                  Auto-detect with AI
                </Button>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-500 mb-1">CSS Selectors (JSON)</label>
                <JsonField
                  value={config.selectors as Record<string, unknown> | undefined}
                  onChange={(val) => onChange('selectors', val)}
                  onValidityChange={onJsonValidityChange}
                  rows={4}
                  placeholder='{"business_name": ".business-name", "phone": ".phone", "email": ".email"}'
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Container Selector</label>
                <Input
                  type="text"
                  value={(config.containerSelector as string) ?? ''}
                  onChange={(e) => onChange('containerSelector', e.target.value)}
                  placeholder=".listing-card"
                />
              </div>
            </>
          )}

          <DeepCrawlFields config={config} onChange={onChange} maxPagesCap={100} />

          {config.followLinks !== true && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Pages per URL <span className="text-slate-300">— pagination, not URL count</span>
              </label>
              <Input
                type="number"
                value={(config.maxPages as number) ?? 1}
                onChange={(e) => onChange('maxPages', parseInt(e.target.value) || 1)}
                min={1}
                max={100}
              />
              <p className="mt-1 text-xs text-slate-400">
                Only for paginated listings. Leave at 1 unless a single URL has multiple pages.
              </p>
            </div>
          )}

          {mode === 'smart' && (
            <div className="col-span-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Heads up: this reads the page&apos;s raw HTML and doesn&apos;t run JavaScript. If a site renders
              its content with JS, few or no results may come back.
            </div>
          )}
        </>
      );
    }
    case 'apify_actor':
      return (
        <>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-500 mb-1">Actor ID <span className="text-red-500">*</span></label>
            <Input
              type="text"
              value={(config.actorId as string) ?? ''}
              onChange={(e) => onChange('actorId', e.target.value)}
              placeholder="compass/crawler-google-places"
            />
            <p className="mt-1 text-xs text-slate-400">
              From the Apify Store URL — e.g. <code>apify.com/compass/crawler-google-places</code> →{' '}
              <code>compass/crawler-google-places</code>.
            </p>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Actor Input (JSON) <span className="text-slate-300">— passed as-is to the Actor</span>
            </label>
            <JsonField
              value={config.input as Record<string, unknown> | undefined}
              onChange={(val) => onChange('input', val)}
              onValidityChange={onJsonValidityChange}
              rows={5}
              placeholder='{"searchStringsArray": ["restaurants"], "locationQuery": "Bangalore"}'
            />
            <p className="mt-1 text-xs text-slate-400">
              Field names are actor-specific — check the actor&apos;s Input tab in the Apify Console.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Max Results</label>
            <Input
              type="number"
              value={(config.maxResults as number) ?? 100}
              onChange={(e) => onChange('maxResults', parseInt(e.target.value) || 100)}
              min={1}
              max={1000}
            />
          </div>
          <div className="col-span-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Requires the Apify integration to be configured with an API token under Integrations.
            Results are pulled back into leads when the run completes.
          </div>
        </>
      );
    case 'browser_scrape': {
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
                Smart (no setup)
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
          </div>

          <UrlListField config={config} onChange={onChange} />

          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Wait For Selector <span className="text-slate-300">— optional</span>
            </label>
            <Input
              type="text"
              value={(config.waitForSelector as string) ?? ''}
              onChange={(e) => onChange('waitForSelector', e.target.value)}
              placeholder=".listing-card"
            />
            <p className="mt-1 text-xs text-slate-400">
              CSS selector to wait for before reading the page — use this for content that loads
              after the initial page render.
            </p>
          </div>

          {mode === 'selectors' && (
            <>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-500 mb-1">CSS Selectors (JSON)</label>
                <JsonField
                  value={config.selectors as Record<string, unknown> | undefined}
                  onChange={(val) => onChange('selectors', val)}
                  onValidityChange={onJsonValidityChange}
                  rows={4}
                  placeholder='{"business_name": ".business-name", "phone": ".phone", "email": ".email"}'
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Container Selector</label>
                <Input
                  type="text"
                  value={(config.containerSelector as string) ?? ''}
                  onChange={(e) => onChange('containerSelector', e.target.value)}
                  placeholder=".listing-card"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Extra Wait (ms)</label>
            <Input
              type="number"
              value={(config.waitMs as number) ?? 0}
              onChange={(e) => onChange('waitMs', parseInt(e.target.value) || 0)}
              min={0}
              max={15000}
            />
          </div>
          <DeepCrawlFields config={config} onChange={onChange} maxPagesCap={30} />

          {config.followLinks !== true && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Pages per URL <span className="text-slate-300">— pagination, not URL count</span>
              </label>
              <Input
                type="number"
                value={(config.maxPages as number) ?? 1}
                onChange={(e) => onChange('maxPages', parseInt(e.target.value) || 1)}
                min={1}
                max={30}
              />
            </div>
          )}

          <div className="col-span-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Renders the page with a real headless Chrome before extracting. Requires
            PUPPETEER_EXECUTABLE_PATH to be configured on the server.
          </div>
        </>
      );
    }
  }
}

/* ─── Main Page ─── */

export function ScraperConfigPage() {
  const { user } = useAuthStore();
  const { showToast } = useToast();

  const perms = user?.role ? ROLE_PERMISSIONS[user.role]?.Integrations : undefined;
  const canRead = perms?.read ?? user?.role === 'admin';
  const canWrite = perms?.write ?? user?.role === 'admin';

  const { data: configs, isLoading, error } = useScraperConfigs();
  const createMutation = useCreateScraperConfig();
  const updateMutation = useUpdateScraperConfig();
  const deleteMutation = useDeleteScraperConfig();
  const triggerMutation = useTriggerScrape();
  const detectMutation = useDetectSelectors();
  const { data: statsSummary } = useScraperStatsSummary(24);
  const retryMutation = useRetryFailedScrape();

  const [showAddForm, setShowAddForm] = useState(false);
  const [showLogs, setShowLogs] = useState<string | null>(null);
  const [showRunLeads, setShowRunLeads] = useState<string | null>(null);
  const [editConfig, setEditConfig] = useState<{ id: string; form: ConfigForm } | null>(null);
  const [form, setForm] = useState<ConfigForm>(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<ScraperConfig | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSource, setFilterSource] = useState<ScraperSourceType | ''>('');
  const [filterGroup, setFilterGroup] = useState<string>('');
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  // False while a JSON config field (selectors / actor input) holds unparseable
  // text, so Save can't silently persist the last valid value instead.
  const [jsonValid, setJsonValid] = useState(true);
  const [exportingLogId, setExportingLogId] = useState<string | null>(null);

  const { data: logsData } = useScraperLogs(showLogs ?? '');
  const { data: runLeadsData, isLoading: runLeadsLoading } = useScraperRunLeads(showRunLeads ?? '');
  const { data: groups } = useScraperGroups();
  const { data: trends } = useScraperTrends(14);

  const trendSeries: SeriesDef[] = [
    { key: 'leads_imported', label: 'New Leads', color: '#10b981' },
    { key: 'leads_failed', label: 'Failed', color: '#ef4444' },
    { key: 'runs', label: 'Runs', color: '#6366f1' },
  ];
  const rateSeries: SeriesDef[] = [
    { key: 'success_rate', label: 'Import Rate %', color: '#6366f1' },
  ];

  /* ── Filtered configs ── */
  const filteredConfigs = useMemo(() => {
    if (!configs) return [];
    return configs.filter((c) => {
      if (searchQuery && !c.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (filterSource && c.source_type !== filterSource) return false;
      if (filterGroup && (c.group_name ?? '') !== filterGroup) return false;
      return true;
    });
  }, [configs, searchQuery, filterSource, filterGroup]);

  /* ── Grouped configs for display ── */
  const groupedConfigs = useMemo(() => {
    if (!filterGroup && (!groups || groups.length === 0)) return null;
    const map = new Map<string, typeof filteredConfigs>();
    for (const c of filteredConfigs) {
      const key = c.group_name ?? '';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return map;
  }, [filteredConfigs, groups, filterGroup]);

  async function handleExportCsv(logId: string) {
    setExportingLogId(logId);
    try {
      await exportRunLeadsCsv(logId);
      showToast('CSV downloaded.', 'success');
    } catch {
      showToast('Failed to export CSV.', 'error');
    } finally {
      setExportingLogId(null);
    }
  }

  /* ── Form helpers ── */

  function resetForm() {
    setForm(emptyForm);
    setShowAddForm(false);
    setEditConfig(null);
    setFormErrors({});
    setJsonValid(true);
  }

  function openAddForm() {
    setForm({ ...emptyForm, config: getPlaceholderConfig(emptyForm.source_type) });
    setShowAddForm(true);
    setFormErrors({});
    setJsonValid(true);
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

  function validateForm(isEdit: boolean): boolean {
    const errors: Record<string, string> = {};
    const name = isEdit ? editConfig?.form.name ?? '' : form.name;
    if (!name.trim()) errors.name = 'Name is required';

    const src = isEdit ? editConfig?.form.source_type ?? '' : form.source_type;
    const cfg = isEdit ? editConfig?.form.config ?? {} : form.config;

    if (src === 'google_places' && !cfg.query) errors.query = 'Search query is required';
    if (src === 'facebook' && !cfg.pageId) errors.pageId = 'Page ID is required';
    if (src === 'youtube' && !cfg.query) errors.query = 'Search query is required';
    if (src === 'meta_lead_forms') {
      if (!cfg.integrationId) errors.integrationId = 'Integration ID is required';
      if (!cfg.formId) errors.formId = 'Form ID is required';
    }
    if (src === 'apify_actor' && !cfg.actorId) errors.actorId = 'Actor ID is required';
    if ((src === 'web_scrape' || src === 'browser_scrape') && !cfg.url) errors.url = 'URL is required';

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function handleAutoDetect(
    currentConfig: Record<string, unknown>,
    applyChange: (key: string, value: unknown) => void,
  ) {
    const url = Array.isArray(currentConfig.url)
      ? currentConfig.url[0]
      : (currentConfig.url as string) || '';
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
    if (!validateForm(false)) return;
    try {
      await createMutation.mutateAsync({
        name: form.name,
        source_type: form.source_type,
        config: form.config,
        schedule_cron: form.schedule_cron || null,
        webhook_url: form.webhook_url || null,
        group_name: form.group_name || null,
      });
      showToast('Scraper source created.', 'success');
      resetForm();
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to create scraper source.'), 'error');
    }
  }

  async function handleEdit(id: string) {
    if (!editConfig || !validateForm(true)) return;
    try {
      await updateMutation.mutateAsync({
        id,
        name: editConfig.form.name,
        config: editConfig.form.config,
        schedule_cron: editConfig.form.schedule_cron || null,
        webhook_url: editConfig.form.webhook_url || null,
        group_name: editConfig.form.group_name || null,
      });
      showToast('Scraper source updated.', 'success');
      setEditConfig(null);
      setFormErrors({});
      setJsonValid(true);
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to update scraper source.'), 'error');
    }
  }

  function handleToggleActive(config: ScraperConfig) {
    updateMutation.mutate(
      { id: config.id, is_active: !config.is_active },
      {
        onSuccess: () =>
          showToast(config.is_active ? 'Source paused.' : 'Source resumed.', 'success'),
        onError: (error) =>
          showToast(getApiErrorMessage(error, 'Failed to update source.'), 'error'),
      },
    );
  }

  function handleDelete() {
    if (!deleteTarget) return;
    deleteMutation.mutate(deleteTarget.id, {
      onSuccess: () => {
        showToast('Scraper source deleted.', 'success');
        setDeleteTarget(null);
      },
      onError: (error) =>
        showToast(getApiErrorMessage(error, 'Failed to delete scraper source.'), 'error'),
    });
  }

  function handleRun(config: ScraperConfig) {
    triggerMutation.mutate(config.id, {
      onSuccess: (res) => {
        if (res.status === 'failed') {
          showToast(res.errorMessage || 'Scrape failed. Open the run logs for details.', 'error');
        } else {
          showToast('Scrape started — watch Recent Runs for progress.', 'success');
        }
        setShowLogs(config.id);
      },
      onError: () => {
        showToast('Could not start the scrape. Please try again.', 'error');
      },
    });
  }

  function handleRetryFailed(logId: string) {
    retryMutation.mutate(logId, {
      onSuccess: (res) => {
        if (res.status === 'failed') {
          showToast(res.errorMessage || 'Retry failed. Open the run logs for details.', 'error');
        } else {
          showToast(
            `Retry complete: ${res.recordsImported} of ${res.recordsFound} previously-failed record(s) imported.`,
            'success',
          );
        }
      },
      onError: () => showToast('Could not retry the failed records. Please try again.', 'error'),
    });
  }

  function handleClone(config: ScraperConfig) {
    setForm({
      name: `${config.name} (copy)`,
      source_type: config.source_type,
      config: { ...config.config },
      schedule_cron: config.schedule_cron ?? '',
      webhook_url: config.webhook_url ?? '',
      group_name: config.group_name ?? '',
    });
    setShowAddForm(true);
    setFormErrors({});
    setJsonValid(true);
  }

  function startEdit(config: ScraperConfig) {
    setEditConfig({
      id: config.id,
      form: {
        name: config.name,
        source_type: config.source_type,
        config: config.config,
        schedule_cron: config.schedule_cron ?? '',
        webhook_url: config.webhook_url ?? '',
        group_name: config.group_name ?? '',
      },
    });
    setFormErrors({});
    setJsonValid(true);
  }

  /* ── Escape key for modals ── */
  const handleEscape = useCallback(() => {
    if (showAddForm || editConfig) resetForm();
    if (deleteTarget) setDeleteTarget(null);
  }, [showAddForm, editConfig, deleteTarget]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') handleEscape();
    }
    if (showAddForm || editConfig || deleteTarget) {
      document.addEventListener('keydown', onKeyDown);
      return () => document.removeEventListener('keydown', onKeyDown);
    }
  }, [showAddForm, editConfig, deleteTarget, handleEscape]);

  const logs = logsData ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Scraper Sources"
        description="Configure and run lead scrapers for Google Places, Facebook, YouTube, websites, and more."
        eyebrow="Intelligence"
        actions={
          canWrite ? (
            <Button onClick={openAddForm}>
              <Plus className="h-4 w-4 mr-2" />
              Add Source
            </Button>
          ) : undefined
        }
      />

      {/* 24h Dashboard Summary */}
      {statsSummary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Runs (24h)</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{statsSummary.totalRuns}</p>
              <p className="mt-0.5 text-xs text-slate-400">
                {statsSummary.activeSources} source{statsSummary.activeSources === 1 ? '' : 's'}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">New Leads (24h)</p>
              <p className="mt-1 text-2xl font-semibold text-emerald-600">{statsSummary.recordsImported}</p>
              <p className="mt-0.5 text-xs text-slate-400">of {statsSummary.recordsFound} found</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Duplicates (24h)</p>
              <p className="mt-1 text-2xl font-semibold text-amber-600">{statsSummary.recordsDuplicate}</p>
              <p className="mt-0.5 text-xs text-slate-400">already existed</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Failed (24h)</p>
              <p className={`mt-1 text-2xl font-semibold ${statsSummary.recordsFailed > 0 ? 'text-red-600' : 'text-slate-900'}`}>
                {statsSummary.recordsFailed}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">records</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Trend Charts */}
      {trends && trends.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardContent className="p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Leads & Runs (14 days)</h3>
              <MultiLineChart data={trends as unknown as Record<string, string | number>[]} xKey="date" series={trendSeries} height={220} />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Import Rate % (14 days)</h3>
              <MultiLineChart data={trends as unknown as Record<string, string | number>[]} xKey="date" series={rateSeries} height={220} />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Search & Filter Bar */}
      {configs && configs.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  type="text"
                  placeholder="Search sources..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <select
                value={filterSource}
                onChange={(e) => setFilterSource(e.target.value as ScraperSourceType | '')}
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"
              >
                <option value="">All source types</option>
                {(Object.entries(sourceLabels) as [ScraperSourceType, string][]).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
              {groups && groups.length > 0 && (
                <select
                  value={filterGroup}
                  onChange={(e) => setFilterGroup(e.target.value)}
                  className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"
                >
                  <option value="">All groups</option>
                  {groups.map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Add/Edit Form Modal */}
      {(showAddForm || editConfig) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === e.currentTarget) resetForm(); }}
        >
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
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
                <label className="block text-xs font-medium text-slate-500 mb-1">Name <span className="text-red-500">*</span></label>
                <Input
                  type="text"
                  value={editConfig ? editConfig.form.name : form.name}
                  onChange={(e) => {
                    if (editConfig) {
                      setEditConfig((prev) => prev ? { ...prev, form: { ...prev.form, name: e.target.value } } : null);
                    } else {
                      setForm((prev) => ({ ...prev, name: e.target.value }));
                    }
                    if (formErrors.name) setFormErrors((prev) => ({ ...prev, name: '' }));
                  }}
                  placeholder={editConfig ? '' : 'My Google Places Scraper'}
                  className={formErrors.name ? 'border-red-300' : ''}
                />
                {formErrors.name && <p className="mt-1 text-xs text-red-500">{formErrors.name}</p>}
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
                    if (formErrors[key]) setFormErrors((prev) => ({ ...prev, [key]: '' }));
                  };
                  return getConfigFields(
                    currentSourceType,
                    currentConfig,
                    applyChange,
                    {
                      onAutoDetect: () => handleAutoDetect(currentConfig, applyChange),
                      detecting: detectMutation.isPending,
                    },
                    setJsonValid,
                  );
                })()}
              </div>

              {/* Show form-level config errors */}
              {Object.entries(formErrors).filter(([k]) => k !== 'name').map(([key, msg]) => (
                <p key={key} className="text-xs text-red-500">{msg}</p>
              ))}

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Schedule (cron) <span className="text-slate-300">— optional</span>
                </label>
                <Input
                  type="text"
                  value={editConfig ? editConfig.form.schedule_cron : form.schedule_cron}
                  onChange={(e) => {
                    if (editConfig) {
                      setEditConfig((prev) => prev ? { ...prev, form: { ...prev.form, schedule_cron: e.target.value } } : null);
                    } else {
                      setForm((prev) => ({ ...prev, schedule_cron: e.target.value }));
                    }
                  }}
                  placeholder="0 6 * * 1 (every Monday at 6 AM)"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Group / Folder <span className="text-slate-300">— optional</span>
                </label>
                <Input
                  type="text"
                  value={editConfig ? editConfig.form.group_name : form.group_name}
                  onChange={(e) => {
                    if (editConfig) {
                      setEditConfig((prev) => prev ? { ...prev, form: { ...prev.form, group_name: e.target.value } } : null);
                    } else {
                      setForm((prev) => ({ ...prev, group_name: e.target.value }));
                    }
                  }}
                  placeholder="e.g. Bangalore, Client-A, Competitors"
                  list="scraper-group-suggestions"
                />
                <datalist id="scraper-group-suggestions">
                  {(groups ?? []).map((g) => <option key={g} value={g} />)}
                </datalist>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Webhook URL <span className="text-slate-300">— optional, POST on completion</span>
                </label>
                <Input
                  type="url"
                  value={editConfig ? editConfig.form.webhook_url : form.webhook_url}
                  onChange={(e) => {
                    if (editConfig) {
                      setEditConfig((prev) => prev ? { ...prev, form: { ...prev.form, webhook_url: e.target.value } } : null);
                    } else {
                      setForm((prev) => ({ ...prev, webhook_url: e.target.value }));
                    }
                  }}
                  placeholder="https://hooks.slack.com/services/... or your endpoint"
                />
                <p className="mt-1 text-xs text-slate-400">
                  Receives a POST with run stats when a scrape finishes. Works with Slack, Discord, Zapier, or any HTTP endpoint.
                </p>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <Button variant="outline" onClick={resetForm}>Cancel</Button>
              <Button
                onClick={() => editConfig ? handleEdit(editConfig.id) : handleCreate()}
                disabled={createMutation.isPending || updateMutation.isPending || !jsonValid}
              >
                {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {editConfig ? 'Save Changes' : 'Create Source'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!deleteTarget}
        title="Delete Scraper Source"
        description={`Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Loading / Error / Empty States */}
      {isLoading && <LoadingTable rows={4} cols={4} />}

      {error && (
        <ErrorState message="Failed to load scraper sources. Please try again." />
      )}

      {!isLoading && !error && (!configs || configs.length === 0) && (
        <EmptyState
          icon={<Search className="h-6 w-6" />}
          title="No scraper sources yet"
          description="Create your first scraper source to start importing leads automatically."
          action={
            canWrite ? (
              <Button onClick={openAddForm}>
                <Plus className="h-4 w-4 mr-2" />
                Add Source
              </Button>
            ) : undefined
          }
        />
      )}

      {/* Config List */}
      {!isLoading && !error && configs && configs.length > 0 && (
        <div className="space-y-3">
          {filteredConfigs.length === 0 && (
            <EmptyState
              icon={<Search className="h-6 w-6" />}
              title="No matching sources"
              description="Try adjusting your search or filter."
            />
          )}
          {filteredConfigs.map((config, idx) => {
            const showGroupHeader =
              groupedConfigs &&
              (idx === 0 || config.group_name !== filteredConfigs[idx - 1]?.group_name);
            return (
              <div key={config.id}>
                {showGroupHeader && (
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 px-1 mb-2">
                    {config.group_name || 'Ungrouped'}
                  </h3>
                )}
                <Card>
                  <CardContent className="p-4">
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
                            <StatusBadge tone={sourceColors[config.source_type].includes('blue') ? 'blue' : sourceColors[config.source_type].includes('red') ? 'red' : sourceColors[config.source_type].includes('emerald') ? 'green' : sourceColors[config.source_type].includes('purple') ? 'violet' : sourceColors[config.source_type].includes('amber') ? 'amber' : 'gray'}>
                              {sourceLabels[config.source_type]}
                            </StatusBadge>
                            {config.health === 'failing' && (
                              <StatusBadge tone="red">
                                <AlertTriangle className="h-3 w-3" />
                                Failing
                              </StatusBadge>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {config.is_active ? 'Active' : 'Inactive'}
                            {config.group_name ? ` · ${config.group_name}` : ''}
                            {config.schedule_cron ? ` · Cron: ${config.schedule_cron}` : ''}
                            {config.webhook_url ? ' · Webhook' : ''}
                            {config.last_run_at ? ` · Last run: ${new Date(config.last_run_at).toLocaleDateString()}` : ''}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {canWrite && (
                          <>
                            <Button variant="outline" size="sm" onClick={() => handleToggleActive(config)} disabled={updateMutation.isPending && updateMutation.variables?.id === config.id}>
                              {config.is_active ? 'Pause' : 'Resume'}
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => startEdit(config)}>Edit</Button>
                            <Button variant="outline" size="sm" onClick={() => handleClone(config)} title="Clone this source">
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" onClick={() => handleRun(config)} disabled={triggerMutation.isPending && triggerMutation.variables === config.id}>
                              {triggerMutation.isPending && triggerMutation.variables === config.id ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Play className="h-3 w-3 mr-1" />}
                              Run Now
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => setShowLogs(showLogs === config.id ? null : config.id)} className={showLogs === config.id ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : ''}>
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => setDeleteTarget(config)} className="text-red-600 hover:bg-red-50 hover:text-red-700">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                        {canRead && !canWrite && (
                          <Button variant="outline" size="sm" onClick={() => setShowLogs(showLogs === config.id ? null : config.id)}>
                            <Eye className="h-3.5 w-3.5 mr-1" /> Logs
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Logs Section */}
                    {showLogs === config.id && canRead && (
                      <div className="mt-4 border-t border-slate-100 pt-4">
                        <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">Recent Runs</h4>
                        {logs.length === 0 ? (
                          <p className="text-sm text-slate-400">No runs yet. Click &quot;Run Now&quot; to start.</p>
                        ) : (
                          <div className="space-y-2 max-h-60 overflow-y-auto">
                            {(Array.isArray(logs) ? logs : []).map((log) => (
                              <div key={log.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-3">
                                    <StatusBadge tone={getRunStatusTone(log.status)}>
                                      {log.status === 'running' && <Loader2 className="h-3 w-3 animate-spin" />}
                                      {log.status}
                                    </StatusBadge>
                                    <span className="text-slate-600">{new Date(log.created_at).toLocaleString()}</span>
                                  </div>
                                  <div className="flex items-center gap-3 text-xs">
                                    <span className="text-slate-500">Found {log.records_found}</span>
                                    <StatusBadge tone="green">+{log.records_imported} new</StatusBadge>
                                    {log.records_duplicate > 0 && <StatusBadge tone="amber">{log.records_duplicate} dup</StatusBadge>}
                                    {log.records_failed > 0 && <StatusBadge tone="red">{log.records_failed} failed</StatusBadge>}
                                  </div>
                                </div>
                                {log.status === 'failed' && log.error_message && (
                                  <p className="mt-1.5 pl-5 text-xs text-red-600">{log.error_message}</p>
                                )}
                                {(log.records_imported > 0 || log.records_duplicate > 0 || log.records_failed > 0) && (
                                  <div className="mt-1.5 pl-5 flex items-center gap-3 text-xs">
                                    {(log.records_imported > 0 || log.records_duplicate > 0) && (
                                      <button onClick={() => setShowRunLeads(showRunLeads === log.id ? null : log.id)} className="flex items-center gap-1 text-indigo-600 hover:text-indigo-700">
                                        <Users className="h-3 w-3" />
                                        {showRunLeads === log.id ? 'Hide leads' : 'View leads'}
                                      </button>
                                    )}
                                    {log.records_failed > 0 && canWrite && (
                                      <button onClick={() => handleRetryFailed(log.id)} disabled={retryMutation.isPending && retryMutation.variables === log.id} className="flex items-center gap-1 text-amber-600 hover:text-amber-700 disabled:opacity-50">
                                        {retryMutation.isPending && retryMutation.variables === log.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                                        Retry failed
                                      </button>
                                    )}
                                    {(log.records_imported > 0 || log.records_duplicate > 0) && (
                                      <button onClick={() => handleExportCsv(log.id)} disabled={exportingLogId === log.id} className="flex items-center gap-1 text-emerald-600 hover:text-emerald-700 disabled:opacity-50">
                                        {exportingLogId === log.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileDown className="h-3 w-3" />}
                                        Export CSV
                                      </button>
                                    )}
                                  </div>
                                )}
                                {showRunLeads === log.id && (
                                  <div className="mt-2 pl-5 border-t border-slate-200 pt-2 space-y-3">
                                    {runLeadsLoading ? (
                                      <p className="text-xs text-slate-400">Loading leads...</p>
                                    ) : runLeadsData && (runLeadsData.newLeads.length > 0 || runLeadsData.duplicateLeads.length > 0) ? (
                                      <>
                                        {runLeadsData.newLeads.length > 0 && (
                                          <div>
                                            <p className="mb-1 text-xs font-medium text-emerald-700">New ({runLeadsData.newLeads.length})</p>
                                            <ul className="space-y-1">
                                              {runLeadsData.newLeads.map((lead) => (
                                                <li key={lead.id} className="flex items-center justify-between text-xs">
                                                  <span className="text-slate-700">{lead.business_name}</span>
                                                  <span className="text-slate-400">{lead.email}</span>
                                                </li>
                                              ))}
                                            </ul>
                                          </div>
                                        )}
                                        {runLeadsData.duplicateLeads.length > 0 && (
                                          <div>
                                            <p className="mb-1 text-xs font-medium text-amber-700">Already existed ({runLeadsData.duplicateLeads.length})</p>
                                            <ul className="space-y-1">
                                              {runLeadsData.duplicateLeads.map((lead) => (
                                                <li key={lead.id} className="flex items-center justify-between text-xs">
                                                  <span className="text-slate-700">{lead.business_name}</span>
                                                  <span className="text-slate-400">{lead.email}</span>
                                                </li>
                                              ))}
                                            </ul>
                                          </div>
                                        )}
                                      </>
                                    ) : (
                                      <p className="text-xs text-slate-400">No leads found for this run.</p>
                                    )}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

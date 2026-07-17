import { useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
import { PageHeader } from '@/components/ui/PageHeader';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
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
} from '@/api/scraper';
import type { ScraperSourceType, ScraperConfig } from '@/types';

const sourceIcons: Record<ScraperSourceType, React.ReactNode> = {
  google_places: <Search className="h-4 w-4" />,
  facebook: <Facebook className="h-4 w-4" />,
  youtube: <Video className="h-4 w-4" />,
  web_scrape: <Globe className="h-4 w-4" />,
  apify_actor: <Bot className="h-4 w-4" />,
  browser_scrape: <Chrome className="h-4 w-4" />,
};

const sourceLabels: Record<ScraperSourceType, string> = {
  google_places: 'Google Places',
  facebook: 'Facebook',
  youtube: 'YouTube',
  web_scrape: 'Web Scrape',
  apify_actor: 'Apify Actor',
  browser_scrape: 'Browser Scrape (JS sites)',
};

const sourceColors: Record<ScraperSourceType, string> = {
  google_places: 'bg-blue-100 text-blue-700',
  facebook: 'bg-indigo-100 text-indigo-700',
  youtube: 'bg-red-100 text-red-700',
  web_scrape: 'bg-emerald-100 text-emerald-700',
  apify_actor: 'bg-purple-100 text-purple-700',
  browser_scrape: 'bg-orange-100 text-orange-700',
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
    case 'apify_actor':
      return { actorId: '', input: {}, maxResults: 100 };
    case 'browser_scrape':
      return { url: '', mode: 'smart', selectors: {}, waitForSelector: '', waitMs: 0, maxPages: 1 };
  }
}

interface WebScrapeExtras {
  onAutoDetect: () => void;
  detecting: boolean;
}

/**
 * URL field shared by web_scrape and browser_scrape: accepts one URL per
 * line so a single source can scrape many sites in one run instead of
 * needing a separate config per URL — same pattern as the Google Places
 * multi-query field above. Also offers "Discover Pages", which renders the
 * first URL and lists its nav links so the user can see what pages exist
 * before deciding which ones to scrape, instead of guessing URLs by hand.
 */
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
          URL(s) * <span className="text-slate-300">— one per line</span>
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
          onChange('url', urls.length > 1 ? urls : (lines[0] ?? ''));
        }}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
        rows={3}
        placeholder={'https://example.com/businesses\nhttps://example.org/contact'}
      />
      <p className="mt-1 text-xs text-slate-400">
        Each line is scraped separately and results are merged into one run. Discover Pages
        renders the first URL above and lists its other pages so you can pick which to add —
        useful for single-page apps where you can&apos;t just guess the URLs.
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
            <button
              type="button"
              onClick={() => setShowDiscovered(false)}
              className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAddSelected}
              disabled={selected.size === 0}
              className="rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Add Selected ({selected.size})
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Deep-crawl options shared by web_scrape and browser_scrape. When enabled,
 * the scraper follows same-site links from the listed URLs (BFS up to the
 * chosen depth) and maxPages becomes the total page budget for the run, so
 * the separate "Pages per URL" pagination field is hidden by the callers.
 */
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
            <input
              type="number"
              value={(config.maxDepth as number) ?? 2}
              onChange={(e) => onChange('maxDepth', parseInt(e.target.value) || 2)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              min={1}
              max={5}
            />
            <p className="mt-1 text-xs text-slate-400">
              1 = only pages linked from your URLs, 2 = their links too, and so on.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Page Budget</label>
            <input
              type="number"
              value={(config.maxPages as number) ?? 1}
              onChange={(e) => onChange('maxPages', parseInt(e.target.value) || 1)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
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
            <input
              type="text"
              value={patternsValue('includePatterns')}
              onChange={(e) => onPatternsChange('includePatterns', e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="/contact, /about, /team"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Exclude Patterns <span className="text-slate-300">— optional, comma-separated</span>
            </label>
            <input
              type="text"
              value={patternsValue('excludePatterns')}
              onChange={(e) => onPatternsChange('excludePatterns', e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
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

          <UrlListField config={config} onChange={onChange} />

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

          <DeepCrawlFields config={config} onChange={onChange} maxPagesCap={100} />

          {config.followLinks !== true && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Pages per URL <span className="text-slate-300">— pagination, not URL count</span>
              </label>
              <input
                type="number"
                value={(config.maxPages as number) ?? 1}
                onChange={(e) => onChange('maxPages', parseInt(e.target.value) || 1)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                min={1}
                max={100}
              />
              <p className="mt-1 text-xs text-slate-400">
                Only for paginated listings (tries <code>?page=2</code>, <code>?page=3</code>...
                after each URL above). Leave at 1 unless a single URL has multiple pages of
                results — every URL you listed above is scraped regardless of this setting.
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
            <label className="block text-xs font-medium text-slate-500 mb-1">Actor ID *</label>
            <input
              type="text"
              value={(config.actorId as string) ?? ''}
              onChange={(e) => onChange('actorId', e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
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
            <textarea
              value={config.input ? JSON.stringify(config.input, null, 2) : '{}'}
              onChange={(e) => {
                try {
                  onChange('input', JSON.parse(e.target.value));
                } catch {
                  // Allow typing invalid JSON mid-edit
                }
              }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
              rows={5}
              placeholder='{"searchStringsArray": ["restaurants"], "locationQuery": "Bangalore"}'
            />
            <p className="mt-1 text-xs text-slate-400">
              Field names are actor-specific — check the actor&apos;s Input tab in the Apify Console.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Max Results</label>
            <input
              type="number"
              value={(config.maxResults as number) ?? 100}
              onChange={(e) => onChange('maxResults', parseInt(e.target.value) || 100)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              min={1}
              max={1000}
            />
          </div>
          <div className="col-span-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Requires the Apify integration to be configured with an API token under Integrations.
            The actor runs on Apify&apos;s infrastructure — results are pulled back into leads when the run
            completes (synchronous runs are capped at 5 minutes by Apify).
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
          </div>

          <UrlListField config={config} onChange={onChange} />

          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Wait For Selector <span className="text-slate-300">— optional</span>
            </label>
            <input
              type="text"
              value={(config.waitForSelector as string) ?? ''}
              onChange={(e) => onChange('waitForSelector', e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder=".listing-card"
            />
            <p className="mt-1 text-xs text-slate-400">
              CSS selector to wait for before reading the page — use this for content that loads
              after the initial page render (most single-page apps).
            </p>
          </div>

          {mode === 'selectors' && (
            <>
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
            <label className="block text-xs font-medium text-slate-500 mb-1">Extra Wait (ms)</label>
            <input
              type="number"
              value={(config.waitMs as number) ?? 0}
              onChange={(e) => onChange('waitMs', parseInt(e.target.value) || 0)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
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
              <input
                type="number"
                value={(config.maxPages as number) ?? 1}
                onChange={(e) => onChange('maxPages', parseInt(e.target.value) || 1)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                min={1}
                max={30}
              />
              <p className="mt-1 text-xs text-slate-400">
                Only for paginated listings (tries <code>?page=2</code>, <code>?page=3</code>...
                after each URL above). Leave at 1 unless a single URL has multiple pages of
                results — every URL you listed above is scraped regardless of this setting.
              </p>
            </div>
          )}

          <div className="col-span-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Renders the page with a real headless Chrome before extracting — use this instead of
            Web Scrape when the site loads its content with JavaScript. Requires
            PUPPETEER_EXECUTABLE_PATH to be configured on the server.
          </div>
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
  const { data: statsSummary } = useScraperStatsSummary(24);
  const retryMutation = useRetryFailedScrape();

  const [showAddForm, setShowAddForm] = useState(false);
  const [showLogs, setShowLogs] = useState<string | null>(null);
  const [showRunLeads, setShowRunLeads] = useState<string | null>(null);
  const [editConfig, setEditConfig] = useState<{ id: string; form: ConfigForm } | null>(null);
  const [form, setForm] = useState<ConfigForm>(emptyForm);

  const { data: logsData } = useScraperLogs(showLogs ?? '');
  const { data: runLeadsData, isLoading: runLeadsLoading } = useScraperRunLeads(showRunLeads ?? '');

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
          const duplicateNote =
            res.recordsDuplicate > 0 ? `, ${res.recordsDuplicate} already existed` : '';
          showToast(
            `Scrape complete: ${res.recordsImported} new lead${res.recordsImported === 1 ? '' : 's'}${duplicateNote} (${res.recordsFound} found).`,
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
      <PageHeader
        title="Scraper Sources"
        description="Configure and run lead scrapers for Google Places, Facebook, YouTube, and websites."
        eyebrow="Intelligence"
        actions={
          isAdmin ? (
            <button
              onClick={openAddForm}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              <Plus className="h-4 w-4" />
              Add Source
            </button>
          ) : undefined
        }
      />

      {/* 24h Dashboard Summary */}
      {statsSummary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Runs (24h)
            </p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{statsSummary.totalRuns}</p>
            <p className="mt-0.5 text-xs text-slate-400">
              {statsSummary.activeSources} source{statsSummary.activeSources === 1 ? '' : 's'}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              New Leads (24h)
            </p>
            <p className="mt-1 text-2xl font-semibold text-emerald-600">
              {statsSummary.recordsImported}
            </p>
            <p className="mt-0.5 text-xs text-slate-400">of {statsSummary.recordsFound} found</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Duplicates (24h)
            </p>
            <p className="mt-1 text-2xl font-semibold text-amber-600">
              {statsSummary.recordsDuplicate}
            </p>
            <p className="mt-0.5 text-xs text-slate-400">already existed</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Failed (24h)
            </p>
            <p
              className={`mt-1 text-2xl font-semibold ${statsSummary.recordsFailed > 0 ? 'text-red-600' : 'text-slate-900'}`}
            >
              {statsSummary.recordsFailed}
            </p>
            <p className="mt-0.5 text-xs text-slate-400">records</p>
          </div>
        </div>
      )}

      {/* Add Form Modal */}
      {(showAddForm || editConfig) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
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
        <ErrorState message="Failed to load scraper sources. Please try again." />
      )}

      {!isLoading && !error && (!configs || configs.length === 0) && (
        <EmptyState
          icon={<Search className="h-6 w-6" />}
          title="No scraper sources yet"
          description="Create your first scraper source to start importing leads automatically."
          action={
            isAdmin ? (
              <button
                onClick={openAddForm}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                <Plus className="h-4 w-4" />
                Add Source
              </button>
            ) : undefined
          }
        />
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
                      {config.health === 'failing' && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600"
                          title="The last 3 runs all failed — this source needs attention."
                        >
                          <AlertTriangle className="h-3 w-3" />
                          Failing
                        </span>
                      )}
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
                        onClick={() => handleToggleActive(config)}
                        disabled={updateMutation.isPending && updateMutation.variables?.id === config.id}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
                          config.is_active
                            ? 'border-slate-200 text-slate-600 hover:bg-slate-50'
                            : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
                        }`}
                      >
                        {config.is_active ? 'Pause' : 'Resume'}
                      </button>
                      <button
                        onClick={() => startEdit(config)}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleRun(config)}
                        disabled={triggerMutation.isPending && triggerMutation.variables === config.id}
                        className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {triggerMutation.isPending && triggerMutation.variables === config.id ? (
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
                            <div className="flex items-center gap-3 text-xs">
                              <span
                                className="text-slate-500"
                                title="Total records the scraper found on the source, before dedup."
                              >
                                Found {log.records_found}
                              </span>
                              <span
                                className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700"
                                title="New leads created in your CRM."
                              >
                                +{log.records_imported} new
                              </span>
                              {log.records_duplicate > 0 && (
                                <span
                                  className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700"
                                  title="Already existed in your CRM (matched by email or phone) — skipped, not re-created."
                                >
                                  {log.records_duplicate} duplicate{log.records_duplicate === 1 ? '' : 's'}
                                </span>
                              )}
                              {log.records_failed > 0 && (
                                <span
                                  className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-600"
                                  title="Records that errored while importing — see the error below."
                                >
                                  {log.records_failed} failed
                                </span>
                              )}
                            </div>
                          </div>
                          {log.status === 'failed' && log.error_message ? (
                            <p className="mt-1.5 pl-5 text-xs text-red-600">{log.error_message}</p>
                          ) : null}

                          {(log.records_imported > 0 ||
                            log.records_duplicate > 0 ||
                            log.records_failed > 0) && (
                            <div className="mt-1.5 pl-5 flex items-center gap-3 text-xs">
                              {(log.records_imported > 0 || log.records_duplicate > 0) && (
                                <button
                                  onClick={() =>
                                    setShowRunLeads(showRunLeads === log.id ? null : log.id)
                                  }
                                  className="flex items-center gap-1 text-indigo-600 hover:text-indigo-700"
                                >
                                  <Users className="h-3 w-3" />
                                  {showRunLeads === log.id ? 'Hide leads' : 'View leads'}
                                </button>
                              )}
                              {log.records_failed > 0 && (
                                <button
                                  onClick={() => handleRetryFailed(log.id)}
                                  disabled={
                                    retryMutation.isPending && retryMutation.variables === log.id
                                  }
                                  className="flex items-center gap-1 text-amber-600 hover:text-amber-700 disabled:opacity-50"
                                >
                                  {retryMutation.isPending && retryMutation.variables === log.id ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <RotateCcw className="h-3 w-3" />
                                  )}
                                  Retry failed
                                </button>
                              )}
                            </div>
                          )}

                          {showRunLeads === log.id && (
                            <div className="mt-2 pl-5 border-t border-slate-200 pt-2 space-y-3">
                              {runLeadsLoading ? (
                                <p className="text-xs text-slate-400">Loading leads...</p>
                              ) : runLeadsData &&
                                (runLeadsData.newLeads.length > 0 ||
                                  runLeadsData.duplicateLeads.length > 0) ? (
                                <>
                                  {runLeadsData.newLeads.length > 0 && (
                                    <div>
                                      <p className="mb-1 text-xs font-medium text-emerald-700">
                                        New ({runLeadsData.newLeads.length})
                                      </p>
                                      <ul className="space-y-1">
                                        {runLeadsData.newLeads.map((lead) => (
                                          <li
                                            key={lead.id}
                                            className="flex items-center justify-between text-xs"
                                          >
                                            <span className="text-slate-700">
                                              {lead.business_name}
                                            </span>
                                            <span className="text-slate-400">{lead.email}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                  {runLeadsData.duplicateLeads.length > 0 && (
                                    <div>
                                      <p className="mb-1 text-xs font-medium text-amber-700">
                                        Already existed ({runLeadsData.duplicateLeads.length})
                                      </p>
                                      <ul className="space-y-1">
                                        {runLeadsData.duplicateLeads.map((lead) => (
                                          <li
                                            key={lead.id}
                                            className="flex items-center justify-between text-xs"
                                          >
                                            <span className="text-slate-700">
                                              {lead.business_name}
                                            </span>
                                            <span className="text-slate-400">{lead.email}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                </>
                              ) : (
                                <p className="text-xs text-slate-400">
                                  No leads found for this run.
                                </p>
                              )}
                            </div>
                          )}
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

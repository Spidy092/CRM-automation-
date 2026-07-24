import {
  getConfigById,
  createConfig,
  updateConfig,
  removeConfig,
  runScrape,
  runScrapeForJob,
  queueScrapeRun,
  listConfigs,
  getLogsByConfig,
  detectSelectors,
  discoverPages,
  getLeadsForRun,
  retryFailedItems,
  getStatsSummary,
} from './scraper.service';
import * as repo from './scraper.repository';
import { getAiConfig } from '../ai-settings/ai-settings.service';
import { AppError } from '../../shared/middleware/errorHandler';
import { syncSchedule, removeSchedule } from './scraper.scheduler';
import { enqueueScraperRun } from '../../workers/queue';

jest.mock('./scraper.repository');
jest.mock('./scraper.scheduler', () => ({
  syncSchedule: jest.fn(),
  removeSchedule: jest.fn(),
}));
jest.mock('../../workers/queue', () => ({
  enqueueScraperRun: jest.fn(),
}));
jest.mock('../ai-settings/ai-settings.service', () => ({
  getAiConfig: jest.fn(),
}));
jest.mock('../../shared/utils/audit', () => ({
  writeAuditLog: jest.fn(),
}));
jest.mock('../../shared/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

// Mock the dynamically-imported leads service so importLeads never touches the DB.
const createLeadMock = jest.fn();
const getLeadsByScraperLogIdMock = jest.fn();
const getLeadsByIdsMock = jest.fn();
jest.mock('../leads/leads.service', () => ({
  createLead: (...args: unknown[]) => createLeadMock(...args),
  getLeadsByScraperLogId: (...args: unknown[]) => getLeadsByScraperLogIdMock(...args),
  getLeadsByIds: (...args: unknown[]) => getLeadsByIdsMock(...args),
}));

const loadApifyCredentialsMock = jest.fn();
const runActorSyncMock = jest.fn();
jest.mock('../integrations/apify/apify.connector', () => ({
  loadCredentials: (...args: unknown[]) => loadApifyCredentialsMock(...args),
  runActorSync: (...args: unknown[]) => runActorSyncMock(...args),
}));

// puppeteer-core is mocked wholesale — scrapeBrowser is exercised against a
// fake browser/page pair so tests never launch a real Chrome process.
const puppeteerPageMock = {
  setUserAgent: jest.fn(),
  goto: jest.fn(),
  waitForSelector: jest.fn(),
  content: jest.fn(),
  $$eval: jest.fn(),
};
const puppeteerBrowserMock = {
  newPage: jest.fn(() => Promise.resolve(puppeteerPageMock)),
  close: jest.fn(() => Promise.resolve()),
};
const puppeteerLaunchMock = jest.fn((_opts?: unknown) => Promise.resolve(puppeteerBrowserMock));
jest.mock('puppeteer-core', () => ({
  launch: (opts: unknown) => puppeteerLaunchMock(opts),
}));

const mockActor = { id: 'admin-id', role: 'admin' as const, ipAddress: '127.0.0.1' };

/** Build a fetch Response-like object. */
function jsonResponse(body: unknown, ok = true, status = 200, statusText = 'OK') {
  return {
    ok,
    status,
    statusText,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function htmlResponse(html: string, ok = true, status = 200, statusText = 'OK') {
  return {
    ok,
    status,
    statusText,
    json: async () => ({}),
    text: async () => html,
  };
}

function activeConfig(source_type: string, config: Record<string, unknown>) {
  return {
    id: '1',
    name: 'cfg',
    is_active: true,
    source_type,
    config,
  };
}

describe('Scraper Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    createLeadMock.mockResolvedValue({ id: 'lead-1' });
    (repo.insertScraperLog as jest.Mock).mockResolvedValue({ id: 'log-1' });
    (repo.updateScraperLog as jest.Mock).mockResolvedValue({ id: 'log-1' });
    (repo.updateScraperConfigLastRun as jest.Mock).mockResolvedValue(undefined);
    process.env.GOOGLE_PLACES_API_KEY = 'test-key';
    process.env.FB_TOKEN = 'fb-token';
    process.env.YT_KEY = 'yt-key';
  });

  // ── CRUD ──────────────────────────────────────────────────────────────────

  describe('listConfigs', () => {
    it('lists configs with health', async () => {
      (repo.findScraperConfigsWithHealth as jest.Mock).mockResolvedValue([
        { id: '1', health: 'healthy' },
      ]);
      const result = await listConfigs();
      expect(result).toHaveLength(1);
      expect(result[0].health).toBe('healthy');
    });
  });

  describe('getConfigById', () => {
    it('returns config if found', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue({ id: '1' });
      const result = await getConfigById('1');
      expect(result.id).toBe('1');
    });

    it('throws 404 if not found', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(null);
      await expect(getConfigById('1')).rejects.toThrow(AppError);
    });
  });

  describe('createConfig', () => {
    it('creates google_places config (validates apiKeyRef)', async () => {
      (repo.insertScraperConfig as jest.Mock).mockResolvedValue({
        id: '1',
        name: 'Test',
        source_type: 'google_places',
      });
      const result = await createConfig(
        {
          name: 'Test',
          source_type: 'google_places',
          config: { apiKeyRef: 'GOOGLE_PLACES_API_KEY' },
        },
        mockActor,
      );
      expect(result.id).toBe('1');
      expect(syncSchedule).toHaveBeenCalledWith('1', undefined, undefined);
    });

    it('creates youtube config (apiKeyRef path)', async () => {
      (repo.insertScraperConfig as jest.Mock).mockResolvedValue({
        id: '2',
        name: 'YT',
        source_type: 'youtube',
      });
      const result = await createConfig(
        { name: 'YT', source_type: 'youtube', config: { apiKeyRef: 'YT_KEY' } },
        mockActor,
      );
      expect(result.id).toBe('2');
    });

    it('creates facebook config (accessTokenRef path)', async () => {
      (repo.insertScraperConfig as jest.Mock).mockResolvedValue({
        id: '3',
        name: 'FB',
        source_type: 'facebook',
      });
      const result = await createConfig(
        { name: 'FB', source_type: 'facebook', config: { accessTokenRef: 'FB_TOKEN' } },
        mockActor,
      );
      expect(result.id).toBe('3');
    });

    it('creates web_scrape config (no env validation needed)', async () => {
      (repo.insertScraperConfig as jest.Mock).mockResolvedValue({
        id: '4',
        name: 'Web',
        source_type: 'web_scrape',
      });
      const result = await createConfig(
        { name: 'Web', source_type: 'web_scrape', config: { url: 'http://x' } },
        mockActor,
      );
      expect(result.id).toBe('4');
    });

    it('throws if apiKeyRef is missing entirely', async () => {
      await expect(
        createConfig(
          { name: 'Test', source_type: 'google_places', config: {} },
          mockActor,
        ),
      ).rejects.toThrow(AppError);
    });

    it('throws if api key env var is not set', async () => {
      delete process.env.MISSING_KEY;
      await expect(
        createConfig(
          {
            name: 'Test',
            source_type: 'google_places',
            config: { apiKeyRef: 'MISSING_KEY' },
          },
          mockActor,
        ),
      ).rejects.toThrow(AppError);
    });
  });

  describe('updateConfig', () => {
    it('updates config and validates env when config blob changes', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue({
        id: '1',
        name: 'Old',
        source_type: 'google_places',
      });
      (repo.updateScraperConfig as jest.Mock).mockResolvedValue({
        id: '1',
        name: 'New',
        source_type: 'google_places',
        is_active: true,
      });
      const result = await updateConfig(
        '1',
        { name: 'New', config: { apiKeyRef: 'GOOGLE_PLACES_API_KEY' } },
        mockActor,
      );
      expect(result.name).toBe('New');
      expect(syncSchedule).toHaveBeenCalledWith('1', undefined, true);
    });

    it('updates config without config blob (skips env validation)', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue({
        id: '1',
        name: 'Old',
        source_type: 'google_places',
      });
      (repo.updateScraperConfig as jest.Mock).mockResolvedValue({
        id: '1',
        name: 'Renamed',
        source_type: 'google_places',
        is_active: false,
      });
      const result = await updateConfig('1', { name: 'Renamed' }, mockActor);
      expect(result.name).toBe('Renamed');
    });

    it('throws 404 when updateScraperConfig returns null', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue({
        id: '1',
        name: 'Old',
        source_type: 'web_scrape',
      });
      (repo.updateScraperConfig as jest.Mock).mockResolvedValue(null);
      await expect(updateConfig('1', { name: 'X' }, mockActor)).rejects.toThrow(AppError);
    });

    it('throws 404 when the config to update does not exist', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(null);
      await expect(updateConfig('1', { name: 'X' }, mockActor)).rejects.toThrow(AppError);
    });
  });

  describe('removeConfig', () => {
    it('removes a config that exists', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue({ id: '1', name: 'X' });
      (repo.deleteScraperConfig as jest.Mock).mockResolvedValue(undefined);
      await removeConfig('1', mockActor);
      expect(repo.deleteScraperConfig).toHaveBeenCalledWith('1');
      expect(removeSchedule).toHaveBeenCalledWith('1');
    });

    it('throws 404 when config to remove does not exist', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(null);
      await expect(removeConfig('1', mockActor)).rejects.toThrow(AppError);
    });
  });

  describe('getLogsByConfig', () => {
    it('returns items and total', async () => {
      (repo.findScraperLogsByConfig as jest.Mock).mockResolvedValue([{ id: 'log-1' }]);
      (repo.countScraperLogsByConfig as jest.Mock).mockResolvedValue(1);
      const result = await getLogsByConfig('1', 10, 0);
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  // ── runScrape orchestration ────────────────────────────────────────────────

  describe('runScrape orchestration', () => {
    it('throws if config is inactive', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue({ id: '1', is_active: false });
      await expect(runScrape('1', mockActor)).rejects.toThrow(AppError);
    });

    it('returns failed result when scraper throws (unknown source type)', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('unknown_type', {}),
      );
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('Unknown scraper source type');
    });

    it('returns failed result and surfaces non-Error throw as Unknown error', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('google_places', { apiKeyRef: 'GOOGLE_PLACES_API_KEY', query: 'x' }),
      );
      global.fetch = jest.fn().mockRejectedValue('string failure');
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toBe('Unknown error');
    });
  });

  // ── Background run (queueScrapeRun / runScrapeForJob) ──────────────────────

  describe('queueScrapeRun', () => {
    it('throws if config is inactive', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue({ id: '1', is_active: false });
      await expect(queueScrapeRun('1', mockActor)).rejects.toThrow(AppError);
      expect(enqueueScraperRun).not.toHaveBeenCalled();
    });

    it('creates a running log row and enqueues the job without waiting for it', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('google_places', { apiKeyRef: 'GOOGLE_PLACES_API_KEY' }),
      );
      (repo.insertScraperLog as jest.Mock).mockResolvedValue({ id: 'log-9' });

      const result = await queueScrapeRun('1', mockActor);

      expect(repo.insertScraperLog).toHaveBeenCalledWith({ config_id: '1', status: 'running' });
      expect(enqueueScraperRun).toHaveBeenCalledWith({
        configId: '1',
        logId: 'log-9',
        triggeredBy: mockActor.id,
      });
      expect(result).toEqual({
        logId: 'log-9',
        recordsFound: 0,
        recordsImported: 0,
        recordsDuplicate: 0,
        recordsFailed: 0,
        status: 'running',
      });
    });
  });

  describe('runScrapeForJob', () => {
    it('reuses the given logId instead of creating a new one', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('google_places', { apiKeyRef: 'GOOGLE_PLACES_API_KEY', query: 'x' }),
      );
      global.fetch = jest.fn().mockRejectedValue(new Error('boom'));

      const result = await runScrapeForJob('1', 'log-9');

      expect(repo.insertScraperLog).not.toHaveBeenCalled();
      expect(repo.updateScraperLog).toHaveBeenCalledWith(
        'log-9',
        expect.objectContaining({ status: 'failed', error_message: 'boom' }),
      );
      expect(result.logId).toBe('log-9');
      expect(result.status).toBe('failed');
    });
  });

  // ── Google Places ───────────────────────────────────────────────────────────

  describe('runScrape google_places', () => {
    function gpConfig(extra: Record<string, unknown> = {}) {
      return activeConfig('google_places', {
        apiKeyRef: 'GOOGLE_PLACES_API_KEY',
        query: 'restaurants',
        ...extra,
      });
    }

    it('completes with zero results', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(gpConfig());
      global.fetch = jest.fn().mockResolvedValue(jsonResponse({ status: 'ZERO_RESULTS', results: [] }));
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('completed');
      expect(result.recordsFound).toBe(0);
    });

    it('fails fast when query is empty', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('google_places', { apiKeyRef: 'GOOGLE_PLACES_API_KEY', query: '   ' }),
      );
      global.fetch = jest.fn();
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('search query is required');
    });

    it('imports a place with details (phone + website + rating)', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        gpConfig({ location: '13.10,77.59', radius: 1000, maxResults: 5 }),
      );
      const fetchMock = jest
        .fn()
        // Text search
        .mockResolvedValueOnce(
          jsonResponse({
            status: 'OK',
            results: [
              {
                place_id: 'p1',
                name: 'Cafe One',
                formatted_address: 'Addr 1',
                rating: 4.5,
                user_ratings_total: 120,
              },
            ],
          }),
        )
        // Place details
        .mockResolvedValueOnce(
          jsonResponse({
            result: { formatted_phone_number: '+919999999999', website: 'https://www.cafeone.com' },
          }),
        );
      global.fetch = fetchMock;
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('completed');
      expect(result.recordsFound).toBe(1);
      expect(createLeadMock).toHaveBeenCalledTimes(1);
      // website domain used for email
      expect(createLeadMock.mock.calls[0][0].email).toBe('no-reply@cafeone.com');
    });

    it('uses placeholders when details call fails / returns no contact info', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(gpConfig({ maxResults: 5 }));
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            status: 'OK',
            results: [{ place_id: 'p2', name: 'NoContact Biz' }],
          }),
        )
        // details fetch throws -> caught, placeholders used
        .mockRejectedValueOnce(new Error('network down'));
      global.fetch = fetchMock;
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('completed');
      expect(createLeadMock).toHaveBeenCalledTimes(1);
      const lead = createLeadMock.mock.calls[0][0];
      expect(lead.phone).toMatch(/^\+0\d{10}$/);
      expect(lead.email).toContain('@google-scraped.local');
    });

    it('handles details non-ok response and malformed website URL', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(gpConfig({ maxResults: 5 }));
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            status: 'OK',
            results: [{ place_id: 'p9', name: 'Biz With Bad Site' }],
          }),
        )
        // details returns a website that is not a valid URL
        .mockResolvedValueOnce(jsonResponse({ result: { website: 'not a url' } }));
      global.fetch = fetchMock;
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('completed');
      const lead = createLeadMock.mock.calls[0][0];
      expect(lead.email).toContain('@google-scraped.local');
    });

    it('dedups places by place_id and skips entries beyond maxResults', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        gpConfig({ query: ['a', 'b'], maxResults: 1 }),
      );
      const fetchMock = jest
        .fn()
        // first query returns p1
        .mockResolvedValueOnce(
          jsonResponse({ status: 'OK', results: [{ place_id: 'dup', name: 'Dup Biz' }] }),
        )
        // details for the single imported place
        .mockResolvedValueOnce(jsonResponse({ result: {} }));
      global.fetch = fetchMock;
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('completed');
      // maxResults=1, so only one place imported even though two queries configured
      expect(result.recordsFound).toBe(1);
    });

    it('geocodes a free-text location then runs the search', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        gpConfig({ location: 'Bangalore', maxResults: 5 }),
      );
      const fetchMock = jest
        .fn()
        // geocode
        .mockResolvedValueOnce(
          jsonResponse({ status: 'OK', results: [{ geometry: { location: { lat: 12.9, lng: 77.6 } } }] }),
        )
        // text search
        .mockResolvedValueOnce(jsonResponse({ status: 'ZERO_RESULTS', results: [] }));
      global.fetch = fetchMock;
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('completed');
    });

    it('runs without bias when geocoding returns ZERO_RESULTS', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        gpConfig({ location: 'Nowhereville', maxResults: 5 }),
      );
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce(jsonResponse({ status: 'ZERO_RESULTS', results: [] }))
        .mockResolvedValueOnce(jsonResponse({ status: 'ZERO_RESULTS', results: [] }));
      global.fetch = fetchMock;
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('completed');
    });

    it('runs without bias when geocoding returns HTTP error', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        gpConfig({ location: 'Bangalore', maxResults: 5 }),
      );
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce(jsonResponse({}, false, 500, 'Server Error'))
        .mockResolvedValueOnce(jsonResponse({ status: 'ZERO_RESULTS', results: [] }));
      global.fetch = fetchMock;
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('completed');
    });

    it('throws when geocoding returns REQUEST_DENIED', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        gpConfig({ location: 'Bangalore' }),
      );
      global.fetch = jest.fn().mockResolvedValue(jsonResponse({ status: 'REQUEST_DENIED' }));
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('REQUEST_DENIED');
    });

    it('throws when geocoding returns OVER_QUERY_LIMIT', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        gpConfig({ location: 'Bangalore' }),
      );
      global.fetch = jest.fn().mockResolvedValue(jsonResponse({ status: 'OVER_QUERY_LIMIT' }));
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('OVER_QUERY_LIMIT');
    });

    it('text-search HTTP error -> failed', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(gpConfig());
      global.fetch = jest.fn().mockResolvedValue(jsonResponse({}, false, 502, 'Bad Gateway'));
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('HTTP error');
    });

    it('text-search REQUEST_DENIED -> failed', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(gpConfig());
      global.fetch = jest.fn().mockResolvedValue(jsonResponse({ status: 'REQUEST_DENIED' }));
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('REQUEST_DENIED');
    });

    it('text-search INVALID_REQUEST -> failed', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(gpConfig());
      global.fetch = jest.fn().mockResolvedValue(jsonResponse({ status: 'INVALID_REQUEST' }));
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('INVALID_REQUEST');
    });

    it('text-search OVER_QUERY_LIMIT -> failed', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(gpConfig());
      global.fetch = jest.fn().mockResolvedValue(jsonResponse({ status: 'OVER_QUERY_LIMIT' }));
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('OVER_QUERY_LIMIT');
    });
  });

  // ── Facebook ────────────────────────────────────────────────────────────────

  describe('runScrape facebook', () => {
    function fbConfig(extra: Record<string, unknown> = {}) {
      return activeConfig('facebook', { accessTokenRef: 'FB_TOKEN', pageId: '123', ...extra });
    }

    it('imports page info with location, posts and custom fields', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        fbConfig({ fields: ['name', 'phone'], maxPosts: 5 }),
      );
      const fetchMock = jest
        .fn()
        // page info
        .mockResolvedValueOnce(
          jsonResponse({
            name: 'My Page',
            phone: '+11111111111',
            emails: ['hi@page.com'],
            website: 'https://page.com',
            location: { city: 'NYC', state: 'NY', country: 'USA' },
          }),
        )
        // posts
        .mockResolvedValueOnce(jsonResponse({ data: [{ message: 'hello' }] }));
      global.fetch = fetchMock;
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('completed');
      expect(result.recordsFound).toBe(1);
      const lead = createLeadMock.mock.calls[0][0];
      expect(lead.location).toBe('NYC, NY, USA');
      expect(lead.email).toBe('hi@page.com');
    });

    it('imports page with no location/email/phone (default fields, posts fetch fails)', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(fbConfig());
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce(jsonResponse({ name: 'Bare Page' }))
        // posts fetch fails -> warn branch, fall back to { data: [] }
        .mockResolvedValueOnce(jsonResponse({}, false, 403, 'Forbidden'));
      global.fetch = fetchMock;
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('completed');
      const lead = createLeadMock.mock.calls[0][0];
      expect(lead.location).toBe('Unknown');
    });

    it('fails when page info HTTP error', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(fbConfig());
      global.fetch = jest.fn().mockResolvedValue(jsonResponse({}, false, 500, 'Server Error'));
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('HTTP error');
    });

    it('fails when API returns an error object', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(fbConfig());
      global.fetch = jest
        .fn()
        .mockResolvedValue(jsonResponse({ error: { message: 'bad token' } }));
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('bad token');
    });
  });

  // ── YouTube ──────────────────────────────────────────────────────────────────

  describe('runScrape youtube', () => {
    function ytConfig(extra: Record<string, unknown> = {}) {
      return activeConfig('youtube', { apiKeyRef: 'YT_KEY', query: 'marketing', ...extra });
    }

    it('imports channels from search results', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(ytConfig({ maxResults: 3 }));
      global.fetch = jest.fn().mockResolvedValue(
        jsonResponse({
          items: [
            { snippet: { channelTitle: 'Chan A', country: 'US' } },
            { snippet: { title: 'Chan B' } },
            { snippet: {} },
          ],
        }),
      );
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('completed');
      expect(result.recordsFound).toBe(3);
    });

    it('completes with empty items', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(ytConfig());
      global.fetch = jest.fn().mockResolvedValue(jsonResponse({}));
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('completed');
      expect(result.recordsFound).toBe(0);
    });

    it('fails on HTTP error', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(ytConfig());
      global.fetch = jest.fn().mockResolvedValue(jsonResponse({}, false, 503, 'Unavailable'));
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('HTTP error');
    });

    it('fails when API returns an error object', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(ytConfig());
      global.fetch = jest.fn().mockResolvedValue(jsonResponse({ error: { message: 'quota' } }));
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('quota');
    });
  });

  // ── Web Scrape (cheerio runs for real) ───────────────────────────────────────

  describe('runScrape web_scrape', () => {
    function webConfig(extra: Record<string, unknown> = {}) {
      return activeConfig('web_scrape', {
        url: 'http://example.com/list',
        selectors: { business_name: '.name', phone: '.phone', email: '.email' },
        ...extra,
      });
    }

    it('parses HTML and imports leads via containerSelector', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        webConfig({ containerSelector: '.card' }),
      );
      const html = `
        <div>
          <div class="card"><span class="name">Acme</span><span class="phone">+15550001111</span><span class="email">a@acme.com</span></div>
          <div class="card"><span class="name">Beta</span><span class="phone">+15550002222</span></div>
        </div>`;
      global.fetch = jest.fn().mockResolvedValue(htmlResponse(html));
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('completed');
      expect(result.recordsFound).toBe(2);
    });

    it('parses HTML using default parent().parent() container path', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(webConfig());
      const html = `
        <ul>
          <li><div><span class="name">Gamma</span><span class="phone">+15550003333</span></div></li>
        </ul>`;
      global.fetch = jest.fn().mockResolvedValue(htmlResponse(html));
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('completed');
    });

    it('completes with no matching elements (empty page)', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(webConfig());
      global.fetch = jest.fn().mockResolvedValue(htmlResponse('<html><body></body></html>'));
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('completed');
      expect(result.recordsFound).toBe(0);
    });

    it('scrapes multiple URLs given as an array and merges results', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        webConfig({ url: ['http://a.example.com', 'http://b.example.com'] }),
      );
      const htmlA = `<div class="card"><span class="name">Acme</span><span class="phone">+15550001111</span></div>`;
      const htmlB = `<div class="card"><span class="name">Beta</span><span class="phone">+15550002222</span></div>`;
      // robots.txt is fetched once per URL as well as the page itself —
      // route by URL rather than call order.
      const fetchMock = jest.fn((url: string) => {
        if (url.includes('robots.txt')) return Promise.resolve(htmlResponse(''));
        if (url.startsWith('http://a.example.com')) return Promise.resolve(htmlResponse(htmlA));
        return Promise.resolve(htmlResponse(htmlB));
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await runScrape('1', mockActor);

      expect(result.status).toBe('completed');
      expect(result.recordsFound).toBe(2);
      expect(fetchMock).toHaveBeenCalledWith('http://a.example.com', expect.anything());
      expect(fetchMock).toHaveBeenCalledWith('http://b.example.com', expect.anything());
    });

    it('dedupes the same contact found more than once in one run before importing', async () => {
      jest.useFakeTimers();
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        webConfig({ maxPages: 3, mode: 'smart', selectors: undefined }),
      );
      const html = `<html><body><a href="mailto:hi@acme.com">Email</a></body></html>`;
      global.fetch = jest.fn().mockResolvedValue(htmlResponse(html));

      const promise = runScrape('1', mockActor);
      await jest.runAllTimersAsync();
      const result = await promise;

      // Same page content repeated across 3 "pages" (no real pagination) —
      // should collapse to a single lead, not 3.
      expect(result.status).toBe('completed');
      expect(result.recordsFound).toBe(1);
      expect(createLeadMock).toHaveBeenCalledTimes(1);
      jest.useRealTimers();
    });

    it('fails when url is missing', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('web_scrape', { selectors: { business_name: '.n' } }),
      );
      global.fetch = jest.fn();
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('URL is required');
    });

    it('fails when selectors are missing', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('web_scrape', { url: 'http://x' }),
      );
      global.fetch = jest.fn();
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('selectors are required');
    });

    it('stops paginating when a page fetch fails', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(webConfig({ maxPages: 3 }));
      const html = `<div class="card"><span class="name">Solo</span><span class="phone">+15550009999</span></div>`;
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce(htmlResponse(html))
        .mockResolvedValueOnce(htmlResponse('', false, 404, 'Not Found'));
      global.fetch = fetchMock;
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('completed');
    });

    it('paginates with a present pagination selector and custom headers', async () => {
      jest.useFakeTimers();
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        webConfig({
          maxPages: 2,
          paginationSelector: '.next',
          headers: { 'User-Agent': 'test' },
        }),
      );
      const html = `<div><div class="card"><span class="name">P1</span><span class="phone">+15550001234</span></div><a class="next">Next</a></div>`;
      global.fetch = jest.fn().mockResolvedValue(htmlResponse(html));
      const promise = runScrape('1', mockActor);
      await jest.runAllTimersAsync();
      const result = await promise;
      expect(result.status).toBe('completed');
      jest.useRealTimers();
    });

    it('stops paginating when pagination selector is absent', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        webConfig({ maxPages: 3, paginationSelector: '.next' }),
      );
      const html = `<div class="card"><span class="name">P1</span><span class="phone">+15550001234</span></div>`;
      global.fetch = jest.fn().mockResolvedValue(htmlResponse(html));
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('completed');
    });
  });

  // ── importLeads stats / dedup / failure ──────────────────────────────────────

  describe('runScrape import outcomes', () => {
    it('counts a 409 conflict as a duplicate, not a new import (idempotent re-run)', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('youtube', { apiKeyRef: 'YT_KEY', query: 'x' }),
      );
      global.fetch = jest.fn().mockResolvedValue(
        jsonResponse({ items: [{ snippet: { channelTitle: 'Dup Chan' } }] }),
      );
      createLeadMock.mockRejectedValueOnce(new AppError('exists', 409));
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('completed');
      expect(result.recordsImported).toBe(0);
      expect(result.recordsDuplicate).toBe(1);
      expect(result.recordsFailed).toBe(0);
    });

    it('counts a non-409 failure (single lead -> partially_completed since recordsFound>0)', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('youtube', { apiKeyRef: 'YT_KEY', query: 'x' }),
      );
      global.fetch = jest.fn().mockResolvedValue(
        jsonResponse({ items: [{ snippet: { channelTitle: 'Bad Chan' } }] }),
      );
      createLeadMock.mockRejectedValueOnce(new Error('db error'));
      const result = await runScrape('1', mockActor);
      expect(result.recordsFailed).toBe(1);
      // recordsFound (1) > 0 and recordsFailed (1) > 0 -> partially_completed
      expect(result.status).toBe('partially_completed');
    });

    it('returns partially_completed when some succeed and some fail', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('youtube', { apiKeyRef: 'YT_KEY', query: 'x', maxResults: 2 }),
      );
      global.fetch = jest.fn().mockResolvedValue(
        jsonResponse({
          items: [
            { snippet: { channelTitle: 'Good' } },
            { snippet: { channelTitle: 'Bad' } },
          ],
        }),
      );
      createLeadMock
        .mockResolvedValueOnce({ id: 'ok' })
        .mockRejectedValueOnce(new Error('boom'));
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('partially_completed');
      expect(result.recordsImported).toBe(1);
      expect(result.recordsFailed).toBe(1);
    });
  });

  describe('runScrape apify_actor', () => {
    it('runs the actor and imports mapped leads', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('apify_actor', { actorId: 'compass~crawler-google-places', maxResults: 10 }),
      );
      loadApifyCredentialsMock.mockResolvedValue({ apiToken: 'token' });
      runActorSyncMock.mockResolvedValue({
        ok: true,
        items: [{ title: 'Acme Cafe', phone: '+15550001111', address: 'Bangalore' }],
        latencyMs: 120,
      });

      const result = await runScrape('1', mockActor);

      expect(result.status).toBe('completed');
      expect(result.recordsFound).toBe(1);
      expect(runActorSyncMock).toHaveBeenCalledWith(
        { apiToken: 'token' },
        'compass~crawler-google-places',
        {},
        10,
      );
    });

    it('fails when actorId is missing', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('apify_actor', {}),
      );
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('actorId is required');
    });

    it('fails when the Apify run errors', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('apify_actor', { actorId: 'a~b' }),
      );
      loadApifyCredentialsMock.mockResolvedValue({ apiToken: 'token' });
      runActorSyncMock.mockResolvedValue({ ok: false, items: [], error: 'HTTP 404', latencyMs: 10 });

      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('Apify run failed');
    });
  });

  describe('runScrape web_scrape deep crawl', () => {
    const ROOT = 'http://site.example.com';

    function crawlConfig(extra: Record<string, unknown> = {}) {
      return activeConfig('web_scrape', {
        url: ROOT,
        mode: 'smart',
        followLinks: true,
        maxDepth: 2,
        maxPages: 10,
        crawlDelayMs: 1,
        ...extra,
      });
    }

    const rootHtml = `<html><body>
      <a href="/contact">Contact</a>
      <a href="/about">About</a>
      <a href="http://other.example.org/page">External</a>
      <a href="mailto:root@site.example.com">Mail</a>
    </body></html>`;
    const contactHtml =
      '<html><body><a href="mailto:contact@site.example.com">C</a></body></html>';
    const aboutHtml = '<html><body><a href="mailto:about@site.example.com">A</a></body></html>';

    function routedFetch() {
      return jest.fn((url: string) => {
        if (url.includes('robots.txt')) return Promise.resolve(htmlResponse(''));
        if (url.includes('/contact')) return Promise.resolve(htmlResponse(contactHtml));
        if (url.includes('/about')) return Promise.resolve(htmlResponse(aboutHtml));
        if (url.startsWith('http://other.example.org')) {
          return Promise.resolve(htmlResponse('<html></html>'));
        }
        return Promise.resolve(htmlResponse(rootHtml));
      });
    }

    it('follows same-site links and imports leads from every crawled page', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(crawlConfig());
      const fetchMock = routedFetch();
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await runScrape('1', mockActor);

      expect(result.status).toBe('completed');
      expect(result.recordsFound).toBe(3);
      expect(fetchMock).toHaveBeenCalledWith('http://site.example.com/contact', expect.anything());
      expect(fetchMock).toHaveBeenCalledWith('http://site.example.com/about', expect.anything());
      // Cross-origin links are never followed.
      expect(fetchMock).not.toHaveBeenCalledWith(
        'http://other.example.org/page',
        expect.anything(),
      );
    });

    it('fetches robots.txt only once per origin via the per-run cache', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(crawlConfig());
      const fetchMock = routedFetch();
      global.fetch = fetchMock as unknown as typeof fetch;

      await runScrape('1', mockActor);

      const robotsCalls = fetchMock.mock.calls.filter((c) =>
        String(c[0]).includes('robots.txt'),
      );
      expect(robotsCalls).toHaveLength(1);
    });

    it('stops when the total page budget is reached', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(crawlConfig({ maxPages: 2 }));
      const fetchMock = routedFetch();
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await runScrape('1', mockActor);

      expect(result.status).toBe('completed');
      expect(result.recordsFound).toBe(2);
      expect(fetchMock).not.toHaveBeenCalledWith(
        'http://site.example.com/about',
        expect.anything(),
      );
    });

    it('skips links matching excludePatterns', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        crawlConfig({ excludePatterns: ['/about'] }),
      );
      const fetchMock = routedFetch();
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await runScrape('1', mockActor);

      expect(result.recordsFound).toBe(2);
      expect(fetchMock).not.toHaveBeenCalledWith(
        'http://site.example.com/about',
        expect.anything(),
      );
    });

    it('only follows links matching includePatterns when set', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        crawlConfig({ includePatterns: ['/contact'] }),
      );
      const fetchMock = routedFetch();
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await runScrape('1', mockActor);

      expect(result.recordsFound).toBe(2);
      expect(fetchMock).not.toHaveBeenCalledWith(
        'http://site.example.com/about',
        expect.anything(),
      );
    });

    it('continues the crawl when a single page fails', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(crawlConfig());
      const fetchMock = jest.fn((url: string) => {
        if (url.includes('robots.txt')) return Promise.resolve(htmlResponse(''));
        if (url.includes('/contact')) {
          return Promise.resolve(htmlResponse('', false, 500, 'Server Error'));
        }
        if (url.includes('/about')) return Promise.resolve(htmlResponse(aboutHtml));
        return Promise.resolve(htmlResponse(rootHtml));
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await runScrape('1', mockActor);

      expect(result.status).toBe('completed');
      expect(result.recordsFound).toBe(2);
    });

    it('fails the run when nothing could be crawled at all', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(crawlConfig());
      const fetchMock = jest.fn((url: string) => {
        if (url.includes('robots.txt')) return Promise.resolve(htmlResponse(''));
        return Promise.resolve(htmlResponse('', false, 500, 'Server Error'));
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await runScrape('1', mockActor);

      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('HTTP 500');
    });
  });

  describe('runScrape browser_scrape', () => {
    function browserConfig(extra: Record<string, unknown> = {}) {
      return activeConfig('browser_scrape', {
        url: 'http://example.com/list',
        mode: 'smart',
        ...extra,
      });
    }

    beforeEach(() => {
      process.env.PUPPETEER_EXECUTABLE_PATH = '/usr/bin/google-chrome';
      // Robots.txt is fetched via global.fetch — an empty body has no
      // Disallow rules, so the crawl is allowed.
      global.fetch = jest.fn().mockResolvedValue(htmlResponse(''));
      puppeteerPageMock.goto.mockResolvedValue({ status: () => 200 });
      puppeteerPageMock.waitForSelector.mockResolvedValue(undefined);
      puppeteerPageMock.content.mockResolvedValue(
        '<html><body><a href="mailto:hi@acme.com">Email</a></body></html>',
      );
    });

    it('renders the page and imports leads found in the rendered DOM', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(browserConfig());
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('completed');
      expect(result.recordsFound).toBe(1);
      expect(puppeteerLaunchMock).toHaveBeenCalled();
      expect(puppeteerBrowserMock.close).toHaveBeenCalled();
    });

    it('deep crawl follows links found in the rendered DOM', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        browserConfig({ followLinks: true, maxDepth: 1, maxPages: 5 }),
      );
      let currentUrl = 'http://example.com/list';
      puppeteerPageMock.goto.mockImplementation((url: string) => {
        currentUrl = url;
        return Promise.resolve({ status: () => 200 });
      });
      puppeteerPageMock.content.mockImplementation(() =>
        Promise.resolve(
          currentUrl.includes('/contact')
            ? '<html><body><a href="mailto:contact@example.com">C</a></body></html>'
            : '<html><body><a href="/contact">Contact</a><a href="mailto:hi@example.com">M</a></body></html>',
        ),
      );

      const result = await runScrape('1', mockActor);

      expect(result.status).toBe('completed');
      expect(result.recordsFound).toBe(2);
      expect(puppeteerPageMock.goto).toHaveBeenCalledWith(
        'http://example.com/contact',
        expect.anything(),
      );
    });

    it('tags imported leads with source_platform "browser_scrape", not "web_scrape"', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(browserConfig());
      await runScrape('1', mockActor);
      expect(createLeadMock).toHaveBeenCalledWith(
        expect.objectContaining({ source_platform: 'browser_scrape' }),
        expect.anything(),
      );
    });

    it('gives distinct placeholder phones to multiple emails found on one page', async () => {
      // Same business_name/location for both (single page) and no tel: link,
      // so only the email differs — this used to collide on the same
      // generated placeholder phone and silently drop the second lead.
      puppeteerPageMock.content.mockResolvedValue(
        '<html><body><a href="mailto:sales@acme.com">Sales</a><a href="mailto:support@acme.com">Support</a></body></html>',
      );
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(browserConfig());

      const result = await runScrape('1', mockActor);

      expect(result.recordsFound).toBe(2);
      expect(createLeadMock).toHaveBeenCalledTimes(2);
      const phones = createLeadMock.mock.calls.map(([input]) => (input as { phone: string }).phone);
      expect(new Set(phones).size).toBe(2);
    });

    it('extracts leads via selectors mode', async () => {
      puppeteerPageMock.content.mockResolvedValue(
        '<div class="card"><span class="name">Acme</span><span class="phone">+15550001111</span></div>',
      );
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        browserConfig({
          mode: 'selectors',
          selectors: { business_name: '.name', phone: '.phone' },
          containerSelector: '.card',
        }),
      );
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('completed');
      expect(result.recordsFound).toBe(1);
    });

    it('fails when url is missing', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('browser_scrape', {}),
      );
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('URL is required');
    });

    it('fails when selectors mode has no selectors', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        browserConfig({ mode: 'selectors' }),
      );
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('selectors are required');
    });

    it('fails with a blocked-response error on 403', async () => {
      puppeteerPageMock.goto.mockResolvedValue({ status: () => 403 });
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(browserConfig());
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('blocked');
      expect(puppeteerBrowserMock.close).toHaveBeenCalled();
    });

    it('closes the browser even when extraction throws', async () => {
      puppeteerPageMock.content.mockResolvedValue('<html>CAPTCHA challenge</html>');
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(browserConfig());
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('failed');
      expect(puppeteerBrowserMock.close).toHaveBeenCalled();
    });

    it('scrapes multiple URLs given as an array and merges results', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        browserConfig({ url: ['http://a.example.com', 'http://b.example.com'] }),
      );
      puppeteerPageMock.content
        .mockResolvedValueOnce('<html><body><a href="mailto:a@acme.com">A</a></body></html>')
        .mockResolvedValueOnce('<html><body><a href="mailto:b@acme.com">B</a></body></html>');

      const result = await runScrape('1', mockActor);

      expect(result.status).toBe('completed');
      expect(result.recordsFound).toBe(2);
      expect(puppeteerPageMock.goto).toHaveBeenCalledWith(
        'http://a.example.com',
        expect.anything(),
      );
      expect(puppeteerPageMock.goto).toHaveBeenCalledWith(
        'http://b.example.com',
        expect.anything(),
      );
    });

    it('dedupes the same contact found more than once in one run before importing', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(browserConfig({ maxPages: 3 }));
      // Same content on every "page" — no real pagination on the target site.
      puppeteerPageMock.content.mockResolvedValue(
        '<html><body><a href="mailto:hi@acme.com">Email</a></body></html>',
      );

      const result = await runScrape('1', mockActor);

      expect(result.status).toBe('completed');
      expect(result.recordsFound).toBe(1);
      expect(createLeadMock).toHaveBeenCalledTimes(1);
    });

    it('merges duplicate contacts instead of dropping data — keeps the phone from a later page', async () => {
      // Regression: a portfolio site repeats the same mailto: link on every
      // page (Home, Projects, Experience) but the phone number only exists
      // on /contact. The first-scraped page has no phone; a later page does.
      // Deduping must not throw away the page that actually had the phone.
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        browserConfig({ url: ['http://site.example.com/', 'http://site.example.com/contact'] }),
      );
      puppeteerPageMock.content
        .mockResolvedValueOnce(
          '<html><body><a href="mailto:hi@acme.com">Email</a></body></html>',
        )
        .mockResolvedValueOnce(
          '<html><body><a href="mailto:hi@acme.com">Email</a><a href="tel:+919880699054">Call</a></body></html>',
        );
      createLeadMock.mockResolvedValue({ id: 'lead-1' });

      const result = await runScrape('1', mockActor);

      expect(result.status).toBe('completed');
      expect(result.recordsFound).toBe(1);
      expect(createLeadMock).toHaveBeenCalledTimes(1);
      const passedLead = createLeadMock.mock.calls[0][0] as { phone: string };
      expect(passedLead.phone).toBe('+919880699054');
    });

    it('fails with a clear message when PUPPETEER_EXECUTABLE_PATH is unset', async () => {
      delete process.env.PUPPETEER_EXECUTABLE_PATH;
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(browserConfig());
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('PUPPETEER_EXECUTABLE_PATH');
    });
  });

  describe('getLeadsForRun', () => {
    it('returns new leads and resolved duplicate leads for the run', async () => {
      (repo.findScraperLogById as jest.Mock).mockResolvedValue({
        id: 'log-1',
        duplicate_lead_ids: ['dup-1'],
      });
      getLeadsByScraperLogIdMock.mockResolvedValue([{ id: 'lead-1' }]);
      getLeadsByIdsMock.mockResolvedValue([{ id: 'dup-1' }]);

      const result = await getLeadsForRun('log-1');

      expect(result).toEqual({ newLeads: [{ id: 'lead-1' }], duplicateLeads: [{ id: 'dup-1' }] });
      expect(getLeadsByScraperLogIdMock).toHaveBeenCalledWith('log-1');
      expect(getLeadsByIdsMock).toHaveBeenCalledWith(['dup-1']);
    });

    it('throws 404 when the log does not exist', async () => {
      (repo.findScraperLogById as jest.Mock).mockResolvedValue(null);
      await expect(getLeadsForRun('missing')).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('retryFailedItems', () => {
    it('throws 404 when the log does not exist', async () => {
      (repo.findScraperLogById as jest.Mock).mockResolvedValue(null);
      await expect(retryFailedItems('missing', mockActor)).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it('throws 400 when there are no failed items to retry', async () => {
      (repo.findScraperLogById as jest.Mock).mockResolvedValue({
        id: 'log-1',
        config_id: 'cfg-1',
        failed_items: [],
      });
      await expect(retryFailedItems('log-1', mockActor)).rejects.toMatchObject({
        statusCode: 400,
      });
    });

    it('re-imports only the failed leads into a new log row', async () => {
      (repo.findScraperLogById as jest.Mock).mockResolvedValue({
        id: 'log-1',
        config_id: 'cfg-1',
        failed_items: [
          { lead: { business_name: 'Retry Co', source_platform: 'web_scrape' }, error: 'db error' },
        ],
      });
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue({
        id: 'cfg-1',
        source_type: 'web_scrape',
      });
      (repo.insertScraperLog as jest.Mock).mockResolvedValue({ id: 'retry-log-1' });
      (repo.updateScraperLog as jest.Mock).mockResolvedValue({ id: 'retry-log-1' });
      (repo.updateScraperConfigLastRun as jest.Mock).mockResolvedValue(undefined);
      createLeadMock.mockResolvedValue({ id: 'lead-2' });

      const result = await retryFailedItems('log-1', mockActor);

      expect(result.logId).toBe('retry-log-1');
      expect(result.status).toBe('completed');
      expect(result.recordsImported).toBe(1);
      expect(repo.insertScraperLog).toHaveBeenCalledWith({ config_id: 'cfg-1', status: 'running' });
    });

    it('marks the retry log failed when persisting the result throws', async () => {
      (repo.findScraperLogById as jest.Mock).mockResolvedValue({
        id: 'log-1',
        config_id: 'cfg-1',
        failed_items: [
          { lead: { business_name: 'Retry Co', source_platform: 'web_scrape' }, error: 'db error' },
        ],
      });
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue({
        id: 'cfg-1',
        source_type: 'web_scrape',
      });
      (repo.insertScraperLog as jest.Mock).mockResolvedValue({ id: 'retry-log-1' });
      createLeadMock.mockResolvedValue({ id: 'lead-2' });
      (repo.updateScraperLog as jest.Mock)
        .mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValueOnce({ id: 'retry-log-1' });

      const result = await retryFailedItems('log-1', mockActor);

      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('db down');
    });
  });

  describe('getStatsSummary', () => {
    it('returns aggregated stats with the requested window', async () => {
      (repo.sumScraperLogsSince as jest.Mock).mockResolvedValue({
        totalRuns: 5,
        activeSources: 2,
        recordsFound: 20,
        recordsImported: 10,
        recordsDuplicate: 5,
        recordsFailed: 5,
      });

      const result = await getStatsSummary(48);

      expect(result).toEqual({
        windowHours: 48,
        totalRuns: 5,
        activeSources: 2,
        recordsFound: 20,
        recordsImported: 10,
        recordsDuplicate: 5,
        recordsFailed: 5,
      });
    });

    it('defaults to a 24 hour window', async () => {
      (repo.sumScraperLogsSince as jest.Mock).mockResolvedValue({
        totalRuns: 0,
        activeSources: 0,
        recordsFound: 0,
        recordsImported: 0,
        recordsDuplicate: 0,
        recordsFailed: 0,
      });

      const result = await getStatsSummary();

      expect(result.windowHours).toBe(24);
    });
  });

  describe('discoverPages', () => {
    beforeEach(() => {
      process.env.PUPPETEER_EXECUTABLE_PATH = '/usr/bin/google-chrome';
      // Robots.txt is fetched via global.fetch — an empty body has no
      // Disallow rules, so the crawl is allowed.
      global.fetch = jest.fn().mockResolvedValue(htmlResponse(''));
      puppeteerPageMock.goto.mockResolvedValue({ status: () => 200 });
    });

    it('returns same-origin discovered pages including the root, filtering external and non-http links', async () => {
      puppeteerPageMock.$$eval.mockResolvedValue([
        { href: 'https://example.com/contact', text: 'Contact' },
        { href: 'https://example.com/about', text: 'About' },
        { href: 'https://other.com/x', text: 'External' },
        { href: 'mailto:hi@example.com', text: 'Email' },
      ]);

      const result = await discoverPages('https://example.com/');

      expect(result).toEqual([
        { url: 'https://example.com/', label: 'Home' },
        { url: 'https://example.com/contact', label: 'Contact' },
        { url: 'https://example.com/about', label: 'About' },
      ]);
      expect(puppeteerBrowserMock.close).toHaveBeenCalled();
    });

    it('dedupes links that normalize to the same URL (hash fragments, trailing slash)', async () => {
      puppeteerPageMock.$$eval.mockResolvedValue([
        { href: 'https://example.com/contact', text: 'Contact' },
        { href: 'https://example.com/contact#top', text: 'Contact (top)' },
        { href: 'https://example.com/contact/', text: 'Contact slash' },
      ]);

      const result = await discoverPages('https://example.com/');

      expect(result.filter((p) => p.label !== 'Home')).toHaveLength(1);
    });

    it('falls back to the path as the label when a link has no text', async () => {
      puppeteerPageMock.$$eval.mockResolvedValue([{ href: 'https://example.com/pricing', text: '' }]);

      const result = await discoverPages('https://example.com/');

      expect(result.find((p) => p.url === 'https://example.com/pricing')?.label).toBe('/pricing');
    });

    it('fails with a clear message when PUPPETEER_EXECUTABLE_PATH is unset', async () => {
      delete process.env.PUPPETEER_EXECUTABLE_PATH;
      await expect(discoverPages('https://example.com/')).rejects.toThrow(
        'PUPPETEER_EXECUTABLE_PATH',
      );
    });

    it('closes the browser even when link extraction throws', async () => {
      puppeteerPageMock.$$eval.mockRejectedValue(new Error('boom'));
      await expect(discoverPages('https://example.com/')).rejects.toThrow('boom');
      expect(puppeteerBrowserMock.close).toHaveBeenCalled();
    });
  });
});

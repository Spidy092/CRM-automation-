import {
  getConfigById,
  createConfig,
  updateConfig,
  removeConfig,
  runScrape,
  listConfigs,
  getLogsByConfig,
  detectSelectors,
} from './scraper.service';
import * as repo from './scraper.repository';
import { getAiConfig } from '../ai-settings/ai-settings.service';
import { AppError } from '../../shared/middleware/errorHandler';

jest.mock('./scraper.repository');
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
jest.mock('../leads/leads.service', () => ({
  createLead: (...args: unknown[]) => createLeadMock(...args),
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
    it('lists configs', async () => {
      (repo.findScraperConfigs as jest.Mock).mockResolvedValue([{ id: '1' }]);
      const result = await listConfigs();
      expect(result).toHaveLength(1);
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
    it('counts a 409 conflict as imported (idempotent re-run)', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('youtube', { apiKeyRef: 'YT_KEY', query: 'x' }),
      );
      global.fetch = jest.fn().mockResolvedValue(
        jsonResponse({ items: [{ snippet: { channelTitle: 'Dup Chan' } }] }),
      );
      createLeadMock.mockRejectedValueOnce(new AppError('exists', 409));
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('completed');
      expect(result.recordsImported).toBe(1);
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
});

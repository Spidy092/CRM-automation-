import { runConfiguredGoogleAgent } from './google-agent.service';
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
  importSelectedCandidates,
  getStatsSummary,
  isRetryableScrapeError,
  installBrowserEgressPolicy,
  assertBrowserLandingUrl,
  classifyFacebookError,
  classifyMetaLeadsError,
  apifyStableId,
} from './scraper.service';
import * as repo from './scraper.repository';
import { getAiConfig } from '../ai-settings/ai-settings.service';
import { AppError } from '../../shared/middleware/errorHandler';
import { syncSchedule, removeSchedule } from './scraper.scheduler';
import { enqueueScraperRun } from '../../workers/queue';
import dns from 'dns/promises';
import { EventEmitter } from 'events';

// The guarded page fetch now uses Node's HTTP clients so it can pin the DNS
// answer. Bridge those requests to the suite's existing fetch fakes.
jest.mock('http', () => ({
  request: (url: URL, _options: unknown, onResponse: (response: unknown) => void) => {
    const request = new EventEmitter() as EventEmitter & {
      end: () => void;
      destroy: (error?: Error) => void;
    };
    request.end = () => {
      void Promise.resolve(global.fetch(url.toString(), { redirect: 'manual' }))
        .then(async (response) => {
          const incoming = new EventEmitter() as EventEmitter & {
            statusCode: number;
            statusMessage: string;
            headers: Record<string, string>;
            destroy: (error?: Error) => void;
          };
          incoming.statusCode = response.status;
          incoming.statusMessage = response.statusText;
          const location = response.headers?.get?.('location');
          const contentLength = response.headers?.get?.('content-length');
          incoming.headers = {
            ...(location ? { location } : {}),
            ...(contentLength ? { 'content-length': contentLength } : {}),
          };
          incoming.destroy = (error?: Error) => {
            if (error) incoming.emit('error', error);
          };
          onResponse(incoming);
          const text = await response.text();
          if (text) incoming.emit('data', Buffer.from(text));
          incoming.emit('end');
          request.emit('close');
        })
        .catch((error: unknown) => {
          request.emit('error', error);
          request.emit('close');
        });
    };
    request.destroy = (error?: Error) => {
      if (error) request.emit('error', error);
      request.emit('close');
    };
    return request;
  },
}));
jest.mock('https', () => ({
  request: (url: URL, options: unknown, onResponse: (response: unknown) => void) =>
    jest.requireMock('http').request(url, options, onResponse),
}));

// Keep URL validation active, but isolate unit tests from real DNS latency.
// Otherwise DNS can settle after runWithFakeTimers drains its timers, leaving
// a subsequently scheduled crawl delay pending until the test times out.
jest.mock('dns/promises', () => ({
  __esModule: true,
  default: {
    lookup: jest.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
  },
}));

jest.mock('../../shared/utils/db', () => ({
  pool: {},
  query: jest.fn(),
  queryOne: jest.fn(),
}));
jest.mock('./scraper.repository');
jest.mock('./google-agent.service', () => ({ runConfiguredGoogleAgent: jest.fn() }));
jest.mock('./scraper.scheduler', () => ({
  syncSchedule: jest.fn(),
  removeSchedule: jest.fn(),
}));
jest.mock('../../workers/queue', () => ({
  enqueueScraperRun: jest.fn(),
}));
jest.mock('../notifications/notifications.emitter', () => ({
  pushToUser: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../notifications/notifications.service', () => ({
  createNotification: jest.fn().mockResolvedValue({ ok: true }),
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
jest.mock('../../shared/utils/email', () => ({
  ...jest.requireActual<typeof import('../../shared/utils/email')>('../../shared/utils/email'),
  verifyEmail: jest.fn().mockResolvedValue({ valid: true, normalized: 'test@example.com' }),
  isEmailSyntaxValid: jest.fn((e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)),
}));

// Mock the dynamically-imported leads service so importLeads never touches the DB.
const createLeadMock = jest.fn();
const getLeadsByScraperLogIdMock = jest.fn();
const getLeadsByIdsMock = jest.fn();
jest.mock('../leads/leads.service', () => ({
  createLead: (...args: unknown[]) => createLeadMock(...args),
  findScrapedLeadDuplicate: jest.fn().mockResolvedValue(null),
  getLeadsByScraperLogId: (...args: unknown[]) => getLeadsByScraperLogIdMock(...args),
  getLeadsByIds: (...args: unknown[]) => getLeadsByIdsMock(...args),
}));

const loadApifyCredentialsMock = jest.fn();
const runActorSyncMock = jest.fn();
jest.mock('../integrations/apify/apify.connector', () => ({
  loadCredentials: (...args: unknown[]) => loadApifyCredentialsMock(...args),
  runActorSync: (...args: unknown[]) => runActorSyncMock(...args),
}));

// LinkedIn connector is loaded dynamically by the scraper — mock it so API-mode
// entitlement branches never touch the DB or network.
const loadLinkedInCredentialsMock = jest.fn();
jest.mock('../integrations/linkedin/linkedin.connector', () => ({
  loadCredentials: (...args: unknown[]) => loadLinkedInCredentialsMock(...args),
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

// OpenAI is mocked so detectSelectors success paths never call a live model.
const openAiCreateMock = jest.fn();
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: (...args: unknown[]) => openAiCreateMock(...args) } },
  })),
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

/**
 * Runs an async operation under fake timers, repeatedly draining pending
 * timers until it settles.
 *
 * A single `runAllTimersAsync()` is not enough for the crawler: it awaits
 * network calls between pages, so the next crawl-delay timer is only
 * scheduled after some microtasks have flushed. If that happens *after*
 * `runAllTimersAsync()` has drained, the awaited promise never settles and
 * the test hangs until Jest's timeout. Looping until settled removes the
 * dependency on exactly how many microtask ticks the implementation takes.
 */
async function runWithFakeTimers<T>(op: () => Promise<T>): Promise<T> {
  const promise = op();
  let settled = false;
  const tracked = promise.then(
    (v) => {
      settled = true;
      return v;
    },
    (e) => {
      settled = true;
      throw e;
    },
  );
  // Bounded so a genuine hang still fails the test rather than looping forever.
  for (let i = 0; i < 100 && !settled; i++) {
    await jest.runAllTimersAsync();
  }
  return tracked;
}

describe('Scraper Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    createLeadMock.mockResolvedValue({ id: 'lead-1' });
    (repo.insertScraperLog as jest.Mock).mockResolvedValue({ id: 'log-1' });
    (repo.updateScraperLog as jest.Mock).mockResolvedValue({ id: 'log-1' });
    (repo.updateScraperConfigLastRun as jest.Mock).mockResolvedValue(undefined);
    (repo.findScraperLogById as jest.Mock).mockResolvedValue(null);
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
          config: { query: 'cafes', apiKeyRef: 'GOOGLE_PLACES_API_KEY' },
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
        { name: 'YT', source_type: 'youtube', config: { query: 'agencies', apiKeyRef: 'YT_KEY' } },
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
        {
          name: 'FB',
          source_type: 'facebook',
          config: { pageId: '123', accessTokenRef: 'FB_TOKEN' },
        },
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
        createConfig({ name: 'Test', source_type: 'google_places', config: {} }, mockActor),
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
        { name: 'New', config: { query: 'cafes', apiKeyRef: 'GOOGLE_PLACES_API_KEY' } },
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
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(activeConfig('unknown_type', {}));
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

    it('throws error when notification persistence fails so BullMQ retries the run', async () => {
      const { createNotification } = require('../notifications/notifications.service');
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('google_places', { apiKeyRef: 'GOOGLE_PLACES_API_KEY', query: 'dentists' }),
      );
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] }),
      });
      (createNotification as jest.Mock).mockResolvedValueOnce({
        ok: false,
        error: new Error('Notification persistence failed'),
      });

      await expect(runScrape('1', mockActor)).rejects.toThrow('Notification persistence failed');
    });

    it('skips re-crawling on retry if log row is already completed, retrying notification directly', async () => {
      const { createNotification } = require('../notifications/notifications.service');
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('google_places', { apiKeyRef: 'GOOGLE_PLACES_API_KEY', query: 'dentists' }),
      );
      (repo.findScraperLogById as jest.Mock).mockResolvedValueOnce({
        id: 'log-retry',
        config_id: '1',
        status: 'completed',
        completed_at: '2026-10-10T10:00:00Z',
        records_found: 10,
        records_imported: 8,
        records_duplicate: 2,
        records_failed: 0,
      });
      global.fetch = jest.fn();
      (createNotification as jest.Mock).mockResolvedValueOnce({ ok: true });

      const result = await runScrapeForJob('1', 'log-retry');
      expect(result.status).toBe('completed');
      expect(result.recordsImported).toBe(8);
      expect(global.fetch).not.toHaveBeenCalled();
      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          occurrenceKey: 'scraper:complete:log-retry',
        }),
      );
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

  describe('Google Places AI agent integration', () => {
    const config = (): ReturnType<typeof activeConfig> =>
      activeConfig('google_places', {
        query: 'dental clinics',
        location: '13,77',
        apiKeyRef: 'GOOGLE_PLACES_API_KEY',
        agentEnabled: true,
        // Explicit automatic import: legacy agent configs keep importing.
        // Without this, agent runs stage for review (see next test).
        research: { importMode: 'automatic' },
      });
    it('imports only candidates returned by a successfully finished agent and preserves provenance', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(config());
      (getAiConfig as jest.Mock).mockResolvedValue({ apiKey: 'model-key', model: 'gpt-4o' });
      (runConfiguredGoogleAgent as jest.Mock).mockResolvedValue({
        candidates: [
          {
            placeId: 'observed-one',
            name: 'Clinic',
            address: 'Bangalore',
            phone: '+919999999999',
            email: 'hello@clinic.test',
            emailSource: 'https://clinic.test/contact',
            website: 'https://clinic.test',
            rating: 4,
            reviewCount: 20,
          },
        ],
        summary: 'Matched clinic based on observed website.',
        rounds: 4,
        toolCalls: 5,
        decisions: [{ placeId: 'observed-one', reason: 'Observed booking' }],
      });
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('completed');
      expect(createLeadMock).toHaveBeenCalledWith(
        expect.objectContaining({
          google_place_id: 'observed-one',
          email: 'hello@clinic.test',
          google_contact_provenance: { email: 'website', phone: 'google_places' },
        }),
        expect.anything(),
      );
      expect(repo.updateScraperLog).toHaveBeenCalledWith(
        'log-1',
        expect.objectContaining({
          raw_response: expect.objectContaining({ agent: expect.objectContaining({ rounds: 4 }) }),
        }),
      );
    });
    it('does not keep a no-MX email because the generated phone is only a placeholder', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(config());
      (getAiConfig as jest.Mock).mockResolvedValue({ apiKey: 'model-key', model: 'gpt-4o' });
      (runConfiguredGoogleAgent as jest.Mock).mockResolvedValue({
        candidates: [
          {
            placeId: 'observed-without-phone',
            name: 'No Phone Clinic',
            address: 'Bangalore',
            email: 'hello@clinic.test',
            emailSource: 'https://clinic.test/contact',
            website: 'https://clinic.test',
            rating: 4,
            reviewCount: 20,
          },
        ],
        summary: 'Matched clinic.',
        rounds: 1,
        toolCalls: 1,
        decisions: [{ placeId: 'observed-without-phone', reason: 'Observed' }],
      });
      const verifyEmailMock = jest.requireMock('../../shared/utils/email').verifyEmail as jest.Mock;
      verifyEmailMock.mockResolvedValueOnce({ valid: false, reason: 'no_mx_record' });

      const result = await runScrape('1', mockActor);

      expect(result.recordsFailed).toBe(1);
      expect(createLeadMock).not.toHaveBeenCalled();
    });
    it('does not import partial results when the agent fails', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(config());
      (getAiConfig as jest.Mock).mockResolvedValue({ apiKey: 'model-key', model: 'gpt-4o' });
      (runConfiguredGoogleAgent as jest.Mock).mockRejectedValueOnce(
        new AppError('Agent failed before finish', 502),
      );
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('failed');
      expect(createLeadMock).not.toHaveBeenCalled();
    });
    it('requires AI settings and a geographic boundary before execution', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(config());
      (getAiConfig as jest.Mock).mockResolvedValue(null);
      expect((await runScrape('1', mockActor)).status).toBe('failed');
      expect(runConfiguredGoogleAgent).not.toHaveBeenCalled();
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue({
        ...config(),
        config: { ...config().config, location: '' },
      });
      expect((await runScrape('1', mockActor)).errorMessage).toContain('requires a location');
      expect(createLeadMock).not.toHaveBeenCalled();
    });
    it('sanitizes credential-bearing geocoding failures', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue({
        ...config(),
        config: { ...config().config, location: 'Bangalore' },
      });
      (getAiConfig as jest.Mock).mockResolvedValue({ apiKey: 'model-key', model: 'gpt-4o' });
      global.fetch = jest.fn().mockRejectedValue(new Error('Failed request key=test-key'));
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).not.toContain('test-key');
      expect(createLeadMock).not.toHaveBeenCalled();
    });
    it('stages agent results for review by default instead of importing', async () => {
      // No explicit research options: agent runs default to review mode.
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('google_places', {
          query: 'dental clinics',
          location: '13,77',
          apiKeyRef: 'GOOGLE_PLACES_API_KEY',
          agentEnabled: true,
        }),
      );
      (getAiConfig as jest.Mock).mockResolvedValue({ apiKey: 'model-key', model: 'gpt-4o' });
      (runConfiguredGoogleAgent as jest.Mock).mockResolvedValue({
        candidates: [
          {
            placeId: 'observed-one',
            name: 'Clinic',
            address: 'Bangalore',
            email: 'hello@clinic.com',
            rating: 4,
            reviewCount: 20,
          },
        ],
        summary: 'Matched clinic.',
        rounds: 2,
        toolCalls: 3,
        decisions: [{ placeId: 'observed-one', reason: 'Observed' }],
      });
      const result = await runScrape('1', mockActor);
      expect(result.errorMessage).toBeNull();
      expect(result.status).toBe('completed');
      expect(result.recordsFound).toBe(1);
      expect(result.recordsImported).toBe(0);
      expect(createLeadMock).not.toHaveBeenCalled();
      const log = (repo.updateScraperLog as jest.Mock).mock.calls[0][1] as {
        raw_response: {
          import_mode: string;
          review_pending: number;
          candidates: Array<{ provider: { id: string }; eligibility: string; contacts: Array<{ state: string }> }>;
        };
      };
      expect(log.raw_response.import_mode).toBe('review');
      expect(log.raw_response.review_pending).toBe(1);
      expect(log.raw_response.candidates[0].provider.id).toBe('observed-one');
      expect(log.raw_response.candidates[0].contacts[0].state).toBe('dns_supported');
      expect(log.raw_response.candidates[0].eligibility).toBe('eligible');
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
      global.fetch = jest
        .fn()
        .mockResolvedValue(jsonResponse({ status: 'ZERO_RESULTS', results: [] }));
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
      // A website is not evidence of an email address.
      const lead = createLeadMock.mock.calls[0][0];
      expect(lead.email).toMatch(/^no-reply-[a-f0-9]{40}@google-scraped\.local$/);
      expect(lead.google_place_id).toBe('p1');
      expect(lead.google_contact_provenance).toEqual({
        email: 'placeholder',
        phone: 'google_places',
      });
    });

    it('keeps branches sharing a website and phone as distinct identified businesses', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(gpConfig());
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            status: 'OK',
            results: [
              { place_id: 'branch-a', name: 'Chain A' },
              { place_id: 'branch-b', name: 'Chain B' },
            ],
          }),
        )
        .mockResolvedValue(
          jsonResponse({
            result: {
              formatted_phone_number: '+15551234567',
              website: 'https://chain.test',
            },
          }),
        );
      const result = await runScrape('1', mockActor);
      expect(result.recordsImported).toBe(2);
      const [first, second] = createLeadMock.mock.calls.map(([lead]) => lead);
      expect(first.phone).toBe(second.phone);
      expect(first.email).not.toBe(second.email);
      expect(first.google_place_id).toBe('branch-a');
      expect(second.google_place_id).toBe('branch-b');
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
      expect(lead.google_contact_provenance).toEqual({
        email: 'placeholder',
        phone: 'placeholder',
      });
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
          jsonResponse({
            status: 'OK',
            results: [{ geometry: { location: { lat: 12.9, lng: 77.6 } } }],
          }),
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
      global.fetch = jest.fn().mockResolvedValue(jsonResponse({ error: { message: 'bad token' } }));
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
      expect(fetchMock).toHaveBeenCalledWith('http://a.example.com/', expect.anything());
      expect(fetchMock).toHaveBeenCalledWith('http://b.example.com/', expect.anything());
    });

    it('dedupes the same contact found more than once in one run before importing', async () => {
      jest.useFakeTimers();
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        webConfig({ maxPages: 3, mode: 'smart', selectors: undefined }),
      );
      const html = `<html><body><a href="mailto:hi@acme.com">Email</a></body></html>`;
      global.fetch = jest.fn().mockResolvedValue(htmlResponse(html));

      const result = await runWithFakeTimers(() => runScrape('1', mockActor));

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

    it('paginates through an actual pagination link and custom headers', async () => {
      jest.useFakeTimers();
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        webConfig({
          maxPages: 2,
          paginationSelector: '.next',
          headers: { 'User-Agent': 'test' },
        }),
      );
      const html = `<div><div class="card"><span class="name">P1</span><span class="phone">+15550001234</span></div><a class="next" href="http://example.com/list?page=2">Next</a></div>`;
      global.fetch = jest.fn().mockResolvedValue(htmlResponse(html));
      const result = await runWithFakeTimers(() => runScrape('1', mockActor));
      expect(result.status).toBe('completed');
      expect(global.fetch).toHaveBeenCalledWith(
        'http://example.com/list?page=2',
        expect.anything(),
      );
      jest.useRealTimers();
    });

    it('does not invent ?page=N URLs when the pagination selector has no link', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        webConfig({ maxPages: 3, paginationSelector: '.next' }),
      );
      const html = `<div><div class="card"><span class="name">P1</span><span class="phone">+15550001234</span></div><a class="next">Next</a></div>`;
      global.fetch = jest.fn().mockResolvedValue(htmlResponse(html));
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('completed');
      // Seed URL (+ robots.txt) only — no fabricated ?page=N URLs.
      const fetchedUrls = (global.fetch as jest.Mock).mock.calls.map((c) => String(c[0]));
      expect(fetchedUrls).not.toContain('http://example.com/list?page=2');
      expect(fetchedUrls).not.toContain('http://example.com/list?page=3');
    });

    it('paginates through an explicit paginationUrlPattern', async () => {
      jest.useFakeTimers();
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        webConfig({ maxPages: 2, paginationUrlPattern: 'http://example.com/list?p={n}' }),
      );
      const html = `<div class="card"><span class="name">P1</span><span class="phone">+15550001234</span></div>`;
      global.fetch = jest.fn().mockResolvedValue(htmlResponse(html));
      const result = await runWithFakeTimers(() => runScrape('1', mockActor));
      expect(result.status).toBe('completed');
      expect(global.fetch).toHaveBeenCalledWith(
        'http://example.com/list?p=2',
        expect.anything(),
      );
      jest.useRealTimers();
    });

    it('keeps page-one leads when the discovered next page fails SSRF validation', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        webConfig({ maxPages: 2, paginationSelector: '.next' }),
      );
      const html = `<div class="card"><span class="name">P1</span><span class="phone">+15550001234</span></div><a class="next" href="http://127.0.0.1/private">Next</a>`;
      global.fetch = jest.fn().mockResolvedValue(htmlResponse(html));
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('completed');
      expect(result.recordsFound).toBe(1);
      expect(createLeadMock).toHaveBeenCalledTimes(1);
    });

    it('still fails for a pagination URL pattern without a page placeholder', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        webConfig({ maxPages: 2, paginationUrlPattern: 'https://example.com/list' }),
      );
      global.fetch = jest.fn().mockResolvedValue(
        htmlResponse('<div class="card"><span class="name">P1</span></div>'),
      );
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('paginationUrlPattern must contain');
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
      global.fetch = jest
        .fn()
        .mockResolvedValue(jsonResponse({ items: [{ snippet: { channelTitle: 'Dup Chan' } }] }));
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
      global.fetch = jest
        .fn()
        .mockResolvedValue(jsonResponse({ items: [{ snippet: { channelTitle: 'Bad Chan' } }] }));
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
          items: [{ snippet: { channelTitle: 'Good' } }, { snippet: { channelTitle: 'Bad' } }],
        }),
      );
      createLeadMock.mockResolvedValueOnce({ id: 'ok' }).mockRejectedValueOnce(new Error('boom'));
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
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(activeConfig('apify_actor', {}));
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('actorId is required');
    });

    it('fails when the Apify run errors', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('apify_actor', { actorId: 'a~b' }),
      );
      loadApifyCredentialsMock.mockResolvedValue({ apiToken: 'token' });
      runActorSyncMock.mockResolvedValue({
        ok: false,
        items: [],
        error: 'HTTP 404',
        latencyMs: 10,
      });

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
    const contactHtml = '<html><body><a href="mailto:contact@site.example.com">C</a></body></html>';
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

      const robotsCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('robots.txt'));
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

    it('produces one business lead from a page with multiple emails, not inflating leads', async () => {
      // Multiple emails from the same page represent multiple contacts at the same
      // business, not separate businesses — creating multiple leads would inflate
      // one business into many records.
      puppeteerPageMock.content.mockResolvedValue(
        '<html><body><a href="mailto:sales@acme.com">Sales</a><a href="mailto:support@acme.com">Support</a></body></html>',
      );
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(browserConfig());

      const result = await runScrape('1', mockActor);

      expect(result.recordsFound).toBe(1);
      expect(createLeadMock).toHaveBeenCalledTimes(1);
      const lead = createLeadMock.mock.calls[0][0] as { email: string };
      expect(lead.email).toBe('sales@acme.com');
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

    it('keeps rendered page-one leads when a pagination link fails SSRF validation', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        browserConfig({ maxPages: 2, paginationSelector: '.next' }),
      );
      puppeteerPageMock.content.mockResolvedValue(
        '<html><body><a href="mailto:hi@acme.com">Email</a><a class="next" href="http://127.0.0.1/private">Next</a></body></html>',
      );

      const result = await runScrape('1', mockActor);

      expect(result.status).toBe('completed');
      expect(result.recordsFound).toBe(1);
      expect(puppeteerPageMock.goto).toHaveBeenCalledTimes(1);
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
        .mockResolvedValueOnce('<html><body><a href="mailto:hi@acme.com">Email</a></body></html>')
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
        reviewPending: 0,
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
      puppeteerPageMock.$$eval.mockResolvedValue([
        { href: 'https://example.com/pricing', text: '' },
      ]);

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

    it('excludes hostname-prefix lookalikes from same-origin results', async () => {
      puppeteerPageMock.$$eval.mockResolvedValue([
        { href: 'https://example.com/contact', text: 'Contact' },
        { href: 'https://example.com.evil.com/phish', text: 'Phish' },
        { href: 'https://notexample.com/', text: 'Other' },
      ]);

      const result = await discoverPages('https://example.com/');

      expect(result.map((p) => p.url)).toEqual([
        'https://example.com/',
        'https://example.com/contact',
      ]);
    });
  });

  // ── Website and browser correctness (§2) ───────────────────────────────────

  describe('contact scoping and footer isolation', () => {
    function smartConfig(extra: Record<string, unknown> = {}) {
      return activeConfig('web_scrape', {
        url: 'http://example.com/team',
        mode: 'smart',
        ...extra,
      });
    }

    it('keeps contacts within their container across two businesses', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        smartConfig({ containerSelector: '.biz' }),
      );
      const html = `<html><head><title>Directory</title></head><body>
        <div class="biz"><h2>Acme</h2><a href="mailto:sales@acme.com">Sales</a></div>
        <div class="biz"><h2>Beta</h2><a href="mailto:hi@beta.com">Hi</a></div>
        <footer><a href="mailto:directory@example.com">Directory</a></footer>
      </body></html>`;
      global.fetch = jest.fn().mockResolvedValue(htmlResponse(html));
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('completed');
      expect(result.recordsFound).toBe(2);
      const emails = createLeadMock.mock.calls.map((c) => (c[0] as { email: string }).email);
      expect(emails).toContain('sales@acme.com');
      expect(emails).toContain('hi@beta.com');
      expect(emails).not.toContain('directory@example.com');
    });

    it('does not attach a footer contact to a listing page without containers', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(smartConfig());
      const html = `<html><head><title>Directory</title></head><body>
        <h2>Acme</h2><h2>Beta</h2><h2>Gamma</h2>
        <footer><a href="mailto:directory@example.com">Directory</a></footer>
      </body></html>`;
      global.fetch = jest.fn().mockResolvedValue(htmlResponse(html));
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('completed');
      expect(result.recordsFound).toBe(0);
    });

    it('uses a footer contact on a single-business page as a last resort', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(smartConfig());
      const html = `<html><head><title>Acme Plumbing</title></head><body>
        <main><p>Family-run plumbing since 1998.</p></main>
        <footer><a href="mailto:office@acmeplumbing.com">Contact</a></footer>
      </body></html>`;
      global.fetch = jest.fn().mockResolvedValue(htmlResponse(html));
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('completed');
      expect(result.recordsFound).toBe(1);
      expect((createLeadMock.mock.calls[0][0] as { email: string }).email).toBe(
        'office@acmeplumbing.com',
      );
    });

    it('prefers JSON-LD business identity and contacts over page chrome', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(smartConfig());
      const html = `<html><head><title>Acme</title>
        <script type="application/ld+json">{"@type":"LocalBusiness","name":"Acme Bakery","email":"hello@acmebakery.com"}</script>
      </head><body><main><p>Welcome</p></main></body></html>`;
      global.fetch = jest.fn().mockResolvedValue(htmlResponse(html));
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('completed');
      expect(result.recordsFound).toBe(1);
      const lead = createLeadMock.mock.calls[0][0] as { business_name: string; email: string };
      expect(lead.business_name).toBe('Acme Bakery');
      expect(lead.email).toBe('hello@acmebakery.com');
    });
  });

  describe('safe fetch guards', () => {
    function redirectResponse(location: string) {
      return {
        ok: false,
        status: 302,
        statusText: 'Found',
        headers: { get: (name: string) => (name.toLowerCase() === 'location' ? location : null) },
        text: async () => '',
        json: async () => ({}),
      };
    }

    it('follows safe redirects hop by hop', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('web_scrape', {
          url: 'http://example.com/old',
          mode: 'smart',
        }),
      );
      const html = `<html><head><title>New</title></head><body><main><a href="mailto:n@new.com">N</a></main></body></html>`;
      global.fetch = jest.fn((url: unknown) => {
        if (String(url).includes('robots.txt')) return Promise.resolve(htmlResponse(''));
        if (String(url).includes('/old')) return Promise.resolve(redirectResponse('http://example.com/new'));
        return Promise.resolve(htmlResponse(html));
      }) as unknown as typeof fetch;
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('completed');
      expect(result.recordsFound).toBe(1);
      expect(global.fetch).toHaveBeenCalledWith('http://example.com/new', expect.anything());
    });

    it('blocks redirects to private hosts instead of following them', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('web_scrape', {
          url: 'http://example.com/old',
          mode: 'smart',
        }),
      );
      global.fetch = jest.fn((url: unknown) => {
        if (String(url).includes('robots.txt')) return Promise.resolve(htmlResponse(''));
        return Promise.resolve(redirectResponse('http://127.0.0.1/admin'));
      }) as unknown as typeof fetch;
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toMatch(/SSRF|forbidden|private/i);
    });

    it('rejects oversized pages with 413 instead of mining them', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('web_scrape', {
          url: 'http://example.com/huge',
          mode: 'smart',
        }),
      );
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => null },
        text: async () => `x${'y'.repeat(2_000_001)}`,
        json: async () => ({}),
      });
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('cap');
      expect(result.retryable).toBe(false);
    });
  });

  describe('detectSelectors evidence', () => {
    beforeEach(() => {
      (getAiConfig as jest.Mock).mockResolvedValue({
        apiKey: 'k',
        model: 'gpt-4o',
        baseUrl: null,
      });
    });

    it('returns bounded match counts and samples for valid suggestions', async () => {
      const html = `<html><body>
        <div class="card"><span class="name">Acme</span></div>
        <div class="card"><span class="name">Beta</span></div>
      </body></html>`;
      global.fetch = jest.fn().mockResolvedValue(htmlResponse(html));
      openAiCreateMock.mockResolvedValue({
        choices: [
          {
            message: {
              content: '{"containerSelector":".card","selectors":{"business_name":".name"}}',
            },
          },
        ],
        usage: { total_tokens: 10 },
      });
      const result = await detectSelectors('http://example.com/list');
      expect(result.selectors).toEqual({ business_name: '.name' });
      expect(result.matchCounts).toEqual({ business_name: 1 });
      expect(result.samples.business_name).toEqual(['Acme']);
    });

    it('rejects suggestions that match nothing instead of returning empties', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(htmlResponse('<html><body><p>No cards here</p></body></html>'));
      openAiCreateMock.mockResolvedValue({
        choices: [
          {
            message: {
              content: '{"containerSelector":".missing","selectors":{"business_name":".nope"}}',
            },
          },
        ],
        usage: { total_tokens: 10 },
      });
      await expect(detectSelectors('http://example.com/list')).rejects.toThrow(
        'matched no usable page content',
      );
    });
  });

  describe('browser landing validation', () => {
    it('accepts same-origin landings without extra DNS work', async () => {
      const page = { url: () => 'https://example.com/new' };
      await expect(assertBrowserLandingUrl(page, 'https://example.com/old')).resolves.toBeUndefined();
    });

    it('blocks cross-origin landings on private hosts', async () => {
      const page = { url: () => 'http://127.0.0.1/admin' };
      await expect(assertBrowserLandingUrl(page, 'https://example.com/old')).rejects.toThrow(
        /SSRF|forbidden/i,
      );
    });

    it('skips validation when the page exposes no URL', async () => {
      await expect(assertBrowserLandingUrl({}, 'https://example.com/old')).resolves.toBeUndefined();
    });
  });

  describe('importSelectedCandidates', () => {
    function stagedLog(candidates: unknown[]) {
      return {
        id: 'log-1',
        config_id: '1',
        raw_response: { import_mode: 'review', candidates },
      };
    }

    function candidate(id: string, email?: string, phone?: string) {
      return {
        provider: { kind: 'youtube_channel', id },
        source: { sourceType: 'youtube', collectedAt: new Date().toISOString() },
        business: { name: 'Biz', website: null, sourceUrls: [], location: '', industry: '' },
        contacts: [
          ...(email
            ? [{ channel: 'email', value: email, provenance: 'youtube_description', state: 'dns_supported' }]
            : []),
          ...(phone
            ? [{ channel: 'phone', value: phone, provenance: 'youtube_description', state: 'observed' }]
            : []),
        ],
        evidence: [],
        observedOpportunities: [],
        modelSuggestions: [],
        targetFit: 50,
        contactQuality: 70,
        eligibility: 'eligible',
        rejectionReasons: [],
        suggestedService: 'none',
      };
    }

    it('imports a selection and links the import run to the staged run', async () => {
      (repo.findScraperLogById as jest.Mock).mockResolvedValue(
        stagedLog([candidate('UC1', 'a@b.com')]),
      );
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('youtube', { apiKeyRef: 'YT_KEY', query: 'x' }),
      );
      (repo.insertScraperLog as jest.Mock).mockResolvedValue({ id: 'log-2' });
      createLeadMock.mockResolvedValue({ id: 'lead-9' });

      const result = await importSelectedCandidates('log-1', ['UC1'], mockActor);

      expect(result.status).toBe('completed');
      expect(result.recordsImported).toBe(1);
      expect(createLeadMock).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'a@b.com' }),
        expect.anything(),
      );
      const log = (repo.updateScraperLog as jest.Mock).mock.calls[0][1] as {
        raw_response: { import_of: string };
      };
      expect(log.raw_response.import_of).toBe('log-1');
    });

    it('preserves Google Place identity through selected import', async () => {
      const place = {
        ...candidate('CaseSensitivePlace', undefined, '+14155552671'),
        provider: { kind: 'google_place', id: 'CaseSensitivePlace' },
        source: { sourceType: 'google_places', collectedAt: new Date().toISOString() },
      };
      (repo.findScraperLogById as jest.Mock).mockResolvedValue(stagedLog([place]));
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(activeConfig('google_places', {}));
      (repo.insertScraperLog as jest.Mock).mockResolvedValue({ id: 'log-2' });
      createLeadMock.mockResolvedValue({ id: 'lead-9' });

      await importSelectedCandidates('log-1', ['CaseSensitivePlace'], mockActor);

      expect(createLeadMock).toHaveBeenCalledWith(
        expect.objectContaining({ google_place_id: 'CaseSensitivePlace' }),
        expect.anything(),
      );
    });

    it('reassesses an unknown-only email despite a stored eligible flag', async () => {
      const unknownEmail = {
        ...candidate('UC1', 'hi@acme.com'),
        contacts: [{ channel: 'email', value: 'hi@acme.com', provenance: 'youtube_description', state: 'unknown' }],
      };
      (repo.findScraperLogById as jest.Mock).mockResolvedValue(stagedLog([unknownEmail]));
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(activeConfig('youtube', {}));
      (repo.insertScraperLog as jest.Mock).mockResolvedValue({ id: 'log-2' });

      const result = await importSelectedCandidates('log-1', ['UC1'], mockActor);

      expect(result.recordsImported).toBe(0);
      expect(result.recordsFailed).toBe(1);
      expect(createLeadMock).not.toHaveBeenCalled();
    });

    it('matches provider IDs with their original casing', async () => {
      (repo.findScraperLogById as jest.Mock).mockResolvedValue(stagedLog([candidate('UC1', 'a@b.com')]));
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(activeConfig('youtube', {}));
      (repo.insertScraperLog as jest.Mock).mockResolvedValue({ id: 'log-2' });

      await expect(importSelectedCandidates('log-1', ['uc1'], mockActor)).rejects.toThrow('No staged candidates matched');
      expect(createLeadMock).not.toHaveBeenCalled();
    });

    it('is idempotent: re-importing the same selection dedupes', async () => {
      (repo.findScraperLogById as jest.Mock).mockResolvedValue(
        stagedLog([candidate('UC1', 'a@b.com')]),
      );
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('youtube', { apiKeyRef: 'YT_KEY', query: 'x' }),
      );
      (repo.insertScraperLog as jest.Mock).mockResolvedValue({ id: 'log-3' });
      createLeadMock.mockRejectedValueOnce(new AppError('exists', 409));

      const result = await importSelectedCandidates('log-1', ['UC1'], mockActor);

      expect(result.recordsImported).toBe(0);
      expect(result.recordsDuplicate).toBe(1);
    });

    it('rejects selections with no match and runs with no staged candidates', async () => {
      (repo.findScraperLogById as jest.Mock).mockResolvedValue(
        stagedLog([candidate('UC1', 'a@b.com')]),
      );
      await expect(importSelectedCandidates('log-1', ['nope'], mockActor)).rejects.toThrow(
        'No staged candidates matched',
      );
      (repo.findScraperLogById as jest.Mock).mockResolvedValue({
        id: 'log-1',
        config_id: '1',
        raw_response: {},
      });
      await expect(importSelectedCandidates('log-1', ['UC1'], mockActor)).rejects.toThrow(
        'no staged candidates',
      );
      (repo.findScraperLogById as jest.Mock).mockResolvedValue(null);
      await expect(importSelectedCandidates('missing', ['UC1'], mockActor)).rejects.toThrow(
        'Scraper log not found',
      );
    });
  });

  // ── Source adapters (§3) ───────────────────────────────────────────────────

  describe('youtube adapter', () => {
    function ytConfig(extra: Record<string, unknown> = {}) {
      return activeConfig('youtube', { apiKeyRef: 'YT_KEY', query: 'marketing', ...extra });
    }

    it('pins to channelId and skips search', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        ytConfig({ query: undefined, channelId: 'UC123' }),
      );
      global.fetch = jest.fn().mockResolvedValue(
        jsonResponse({
          items: [
            {
              id: 'UC123',
              snippet: {
                title: 'Pinned',
                description: 'Mail us at pinned@biz.com',
                country: 'US',
                customUrl: '@pinned',
              },
            },
          ],
        }),
      );
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('completed');
      expect(result.recordsFound).toBe(1);
      const lead = createLeadMock.mock.calls[0][0] as { email: string };
      expect(lead.email).toBe('pinned@biz.com');
      // No search call — only channels.list.
      const urls = (global.fetch as jest.Mock).mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes('/search?'))).toBe(false);
      expect(urls.some((u) => u.includes('/channels?'))).toBe(true);
    });

    it('fails when neither query nor channelId is configured', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('youtube', { apiKeyRef: 'YT_KEY' }),
      );
      global.fetch = jest.fn();
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('query or channelId');
    });

    it('keeps stable identity and reports missing contacts honestly', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(ytConfig({ maxResults: 2 }));
      global.fetch = jest.fn().mockResolvedValue(
        jsonResponse({
          items: [
            { id: { channelId: 'UC1' }, snippet: { channelTitle: 'NoContact' } },
            { id: { channelId: 'UC2' }, snippet: { channelTitle: 'HasMail', description: 'x@y.com' } },
          ],
        }),
      );
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('completed');
      const log = (repo.updateScraperLog as jest.Mock).mock.calls[0][1] as {
        raw_response: { channels_without_observed_contact: number };
      };
      expect(log.raw_response.channels_without_observed_contact).toBe(1);
      // Both leads carry a channel-scoped stable seed (no cross-channel merge).
      const seeds = createLeadMock.mock.calls.map(
        (c) => (c[0] as { email: string }).email,
      );
      expect(seeds[1]).toBe('x@y.com');
    });
  });

  describe('facebook error classification', () => {
    it('maps token failures to 401 and permission failures to 403', () => {
      expect(classifyFacebookError({ message: 'expired', code: 190 }).statusCode).toBe(401);
      expect(classifyFacebookError({ message: 'missing permission', code: 200 }).statusCode).toBe(
        403,
      );
      expect(classifyFacebookError({ message: 'slow down', code: 4 }).statusCode).toBe(429);
      expect(classifyFacebookError({ message: 'weird' }).statusCode).toBe(400);
    });

    it('enriches only the configured page (single fetch, stable identity)', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('facebook', { accessTokenRef: 'FB_TOKEN', pageId: '123' }),
      );
      global.fetch = jest.fn().mockResolvedValue(
        jsonResponse({ name: 'P', website: 'https://p.com', location: { city: 'C' } }),
      );
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('completed');
      // Page info only — no speculative posts discovery.
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const log = (repo.updateScraperLog as jest.Mock).mock.calls[0][1] as {
        raw_response: { capability: string };
      };
      expect(log.raw_response.capability).toBe('configured_page_enrichment');
    });
  });

  describe('meta leads error classification', () => {
    it('keeps token, permission, rate-limit, missing-form, and provider failures distinct', () => {
      expect(classifyMetaLeadsError(401, 'invalid token').statusCode).toBe(401);
      expect(classifyMetaLeadsError(403, 'permission denied').statusCode).toBe(403);
      expect(classifyMetaLeadsError(200, 'error #200 requires permission').statusCode).toBe(403);
      expect(classifyMetaLeadsError(429, 'throttled').statusCode).toBe(429);
      expect(classifyMetaLeadsError(404, 'no such form').statusCode).toBe(404);
      expect(classifyMetaLeadsError(500, 'boom').statusCode).toBe(502);
      // Retryability flows through: 429/5xx retry, 401/403/404 do not.
      expect(isRetryableScrapeError(classifyMetaLeadsError(429, 'x'))).toBe(true);
      expect(isRetryableScrapeError(classifyMetaLeadsError(403, 'x'))).toBe(false);
    });
  });

  describe('apify adapter', () => {
    it('prefers explicit fieldMapping over name guessing', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('apify_actor', {
          actorId: 'a~b',
          fieldMapping: { businessName: 'company', email: 'contact_email' },
        }),
      );
      loadApifyCredentialsMock.mockResolvedValue({ apiToken: 'token' });
      runActorSyncMock.mockResolvedValue({
        ok: true,
        items: [{ company: 'Mapped Co', contact_email: 'm@mapped.co', title: 'Wrong Title' }],
        latencyMs: 5,
      });
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('completed');
      const lead = createLeadMock.mock.calls[0][0] as { business_name: string; email: string };
      expect(lead.business_name).toBe('Mapped Co');
      expect(lead.email).toBe('m@mapped.co');
    });

    it('isolates invalid items instead of importing Unknown Business', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('apify_actor', { actorId: 'a~b' }),
      );
      loadApifyCredentialsMock.mockResolvedValue({ apiToken: 'token' });
      runActorSyncMock.mockResolvedValue({
        ok: true,
        items: [{ title: 'Good', phone: '+15550001111' }, { scrapedAt: 'today', foo: 1 }, 'junk'],
        latencyMs: 5,
      });
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('partially_completed');
      expect(result.recordsFound).toBe(3);
      expect(result.recordsImported).toBe(1);
      expect(result.recordsFailed).toBe(2);
    });

    it('never reruns the paid actor on import retry', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('apify_actor', { actorId: 'a~b' }),
      );
      loadApifyCredentialsMock.mockResolvedValue({ apiToken: 'token' });
      runActorSyncMock.mockResolvedValue({
        ok: true,
        items: [{ title: 'Good', phone: '+15550001111' }],
        latencyMs: 5,
      });
      createLeadMock.mockRejectedValueOnce(new Error('db down'));
      const run = await runScrape('1', mockActor);
      expect(run.status).toBe('partially_completed');
      (repo.findScraperLogById as jest.Mock).mockResolvedValue({
        id: 'log-1',
        config_id: '1',
        failed_items: [{ lead: { business_name: 'Good', phone: '+15550001111' }, error: 'db down' }],
      });
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('apify_actor', { actorId: 'a~b' }),
      );
      createLeadMock.mockResolvedValue({ id: 'lead-2' });
      await retryFailedItems('log-1', mockActor);
      // Exactly one Actor run across the initial run and the retry.
      expect(runActorSyncMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('apifyStableId', () => {
    it('is stable despite cosmetic item changes', () => {
      const a = apifyStableId({ id: 'p1', title: 'Cafe', scrapedAt: '2026-01-01' });
      const b = apifyStableId({ id: 'p1', title: 'Cafe (updated)', scrapedAt: '2026-10-13' });
      expect(a).toBe(b);
    });

    it('honours an operator-configured idField', () => {
      expect(apifyStableId({ placeId: 'PX', id: 'other' }, 'placeId')).toBe('PX');
    });
  });

  describe('linkedin and google-ads outcomes', () => {
    it('reports manual import as a capability, not a scrape', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('linkedin_lead_forms', { mode: 'manual_import' }),
      );
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('completed');
      const log = (repo.updateScraperLog as jest.Mock).mock.calls[0][1] as {
        raw_response: { capability: string };
      };
      expect(log.raw_response.capability).toBe('manual_import');
    });

    it('returns unconfigured (404) when LinkedIn credentials are missing', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('linkedin_lead_forms', { mode: 'api' }),
      );
      loadLinkedInCredentialsMock.mockRejectedValue(new AppError('not configured', 404));
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('not configured');
    });

    it('returns unsupported (400) without an entitled organization', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('linkedin_lead_forms', { mode: 'api' }),
      );
      loadLinkedInCredentialsMock.mockResolvedValue({ accessToken: 't' });
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('not enabled');
    });

    it('reports google-ads webhook readiness without fake scraping', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('google_ads_lead_forms', {}),
      );
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('completed');
      expect(result.recordsFound).toBe(0);
      const log = (repo.updateScraperLog as jest.Mock).mock.calls[0][1] as {
        raw_response: { capability: string; configured: boolean };
      };
      expect(log.raw_response.capability).toBe('webhook_ingestion');
      expect(log.raw_response.configured).toBe(false);
    });
  });

  // ── Tier 1 audit fixes ──────────────────────────────────────────────────

  describe('isRetryableScrapeError (C1)', () => {
    it('treats network/unknown errors as retryable', () => {
      expect(isRetryableScrapeError(new Error('ECONNRESET'))).toBe(true);
      expect(isRetryableScrapeError('a string throw')).toBe(true);
    });

    it('treats upstream 429 and 5xx as retryable', () => {
      expect(isRetryableScrapeError(new AppError('rate limited', 429))).toBe(true);
      expect(isRetryableScrapeError(new AppError('bad gateway', 502))).toBe(true);
      expect(isRetryableScrapeError(new AppError('timed out', 504))).toBe(true);
    });

    it('treats 4xx configuration errors as permanent', () => {
      expect(isRetryableScrapeError(new AppError('selectors are required', 400))).toBe(false);
      expect(isRetryableScrapeError(new AppError('robots.txt disallows', 403))).toBe(false);
      expect(isRetryableScrapeError(new AppError('not found', 404))).toBe(false);
    });
  });

  describe('run failure classification (C1)', () => {
    it('marks a transient upstream failure retryable on the result', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('google_places', { apiKeyRef: 'GOOGLE_PLACES_API_KEY', query: 'cafes' }),
      );
      global.fetch = jest.fn().mockRejectedValue(new Error('socket hang up'));

      const result = await runScrape('1', mockActor);

      expect(result.status).toBe('failed');
      expect(result.retryable).toBe(true);
    });

    it('marks a misconfiguration NOT retryable so it is not re-run three times', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('web_scrape', { url: 'http://x' }), // selectors mode, none provided
      );
      global.fetch = jest.fn();

      const result = await runScrape('1', mockActor);

      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('selectors are required');
      expect(result.retryable).toBe(false);
    });
  });

  describe('runScrapeForJob honours a pause (R6)', () => {
    it('does not scrape when the config was paused after enqueue', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue({
        ...activeConfig('web_scrape', { url: 'http://x', selectors: { business_name: '.n' } }),
        is_active: false,
      });
      global.fetch = jest.fn();

      const result = await runScrapeForJob('1', 'log-1');

      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('paused');
      expect(global.fetch).not.toHaveBeenCalled();
      // The 'running' row created by queueScrapeRun must be closed out, or the
      // UI polls it forever.
      expect(repo.updateScraperLog).toHaveBeenCalledWith(
        'log-1',
        expect.objectContaining({ status: 'failed' }),
      );
    });

    it('is not retryable — pausing is a deliberate operator action', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue({
        ...activeConfig('web_scrape', { url: 'http://x' }),
        is_active: false,
      });
      const result = await runScrapeForJob('1', 'log-1');
      expect(result.retryable).toBeUndefined();
    });
  });

  describe('queueScrapeRun idempotency (C6)', () => {
    const cfg = () => activeConfig('web_scrape', { url: 'http://x', selectors: { n: '.n' } });

    it('attaches to an in-flight run instead of starting a second one', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(cfg());
      (repo.findRunningLogByConfig as jest.Mock).mockResolvedValue({ id: 'log-inflight' });

      const result = await queueScrapeRun('1', mockActor);

      expect(result.logId).toBe('log-inflight');
      expect(result.status).toBe('running');
      expect(repo.insertScraperLog).not.toHaveBeenCalled();
      expect(enqueueScraperRun).not.toHaveBeenCalled();
    });

    it('starts a run when nothing is in flight, and audits who triggered it', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(cfg());
      (repo.findRunningLogByConfig as jest.Mock).mockResolvedValue(null);
      const { writeAuditLog } = require('../../shared/utils/audit');

      const result = await queueScrapeRun('1', mockActor);

      expect(result.logId).toBe('log-1');
      expect(enqueueScraperRun).toHaveBeenCalledWith({
        configId: '1',
        logId: 'log-1',
        triggeredBy: mockActor.id,
      });
      expect(writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'scraper_run.triggered', userId: mockActor.id }),
      );
    });
  });

  describe('config validation is enforced at write time (C2)', () => {
    it('rejects a config whose values exceed the documented caps', async () => {
      await expect(
        createConfig(
          {
            name: 'Runaway',
            source_type: 'web_scrape',
            config: { url: 'https://example.com', maxPages: 100000 },
          },
          mockActor,
        ),
      ).rejects.toThrow();
      expect(repo.insertScraperConfig).not.toHaveBeenCalled();
    });

    it('rejects an update that would make the stored config invalid', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue({
        id: '1',
        name: 'Old',
        source_type: 'google_places',
      });
      await expect(
        updateConfig('1', { config: { apiKeyRef: 'GOOGLE_PLACES_API_KEY' } }, mockActor),
      ).rejects.toThrow();
      expect(repo.updateScraperConfig).not.toHaveBeenCalled();
    });

    it('persists schema defaults so run-time never has to guess', async () => {
      (repo.insertScraperConfig as jest.Mock).mockResolvedValue({ id: '9', name: 'W' });
      await createConfig(
        { name: 'W', source_type: 'web_scrape', config: { url: 'https://example.com' } },
        mockActor,
      );
      const written = (repo.insertScraperConfig as jest.Mock).mock.calls[0][0];
      expect(written.config.mode).toBe('smart');
      expect(written.config.maxPages).toBe(1);
    });
  });

  describe('createConfig rolls back when the schedule cannot be registered (C3)', () => {
    it('deletes the row rather than leaving a config with a phantom schedule', async () => {
      (repo.insertScraperConfig as jest.Mock).mockResolvedValue({
        id: 'cfg-9',
        name: 'W',
        source_type: 'web_scrape',
        schedule_cron: '0 3 * * *',
        is_active: true,
      });
      (syncSchedule as jest.Mock).mockRejectedValueOnce(new Error('redis down'));

      await expect(
        createConfig(
          {
            name: 'W',
            source_type: 'web_scrape',
            config: { url: 'https://example.com' },
            schedule_cron: '0 3 * * *',
          },
          mockActor,
        ),
      ).rejects.toThrow('Could not register the schedule');

      expect(repo.deleteScraperConfig).toHaveBeenCalledWith('cfg-9');
    });
  });

  describe('youtube run association (C4)', () => {
    it('tags imported leads with the run log id so the drilldown finds them', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('youtube', { apiKeyRef: 'YT_KEY', query: 'agencies' }),
      );
      global.fetch = jest
        .fn()
        .mockResolvedValue(
          jsonResponse({ items: [{ snippet: { channelTitle: 'Acme TV', country: 'IN' } }] }),
        );

      await runScrape('1', mockActor);

      expect(createLeadMock).toHaveBeenCalledWith(
        expect.objectContaining({ scraper_log_id: 'log-1' }),
        expect.anything(),
      );
    });
  });

  describe('google_places does not persist the API key (S1)', () => {
    it('stores opaque photo references, never a key-bearing photo URL', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('google_places', { apiKeyRef: 'GOOGLE_PLACES_API_KEY', query: 'cafes' }),
      );
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            status: 'OK',
            results: [{ place_id: 'p1', name: 'Acme Cafe', formatted_address: 'BLR' }],
          }),
        )
        .mockResolvedValue(
          jsonResponse({
            result: {
              formatted_phone_number: '+91 99999 11111',
              photos: [{ photo_reference: 'PHOTOREF123' }],
            },
          }),
        );

      await runScrape('1', mockActor);

      const logCall = (repo.updateScraperLog as jest.Mock).mock.calls.find(
        (c) => c[1]?.raw_response,
      );
      const serialised = JSON.stringify(logCall?.[1]?.raw_response ?? {});
      expect(serialised).toContain('PHOTOREF123');
      expect(serialised).not.toContain('test-key');
      expect(serialised).not.toContain('maps.googleapis.com/maps/api/place/photo');
    });
  });

  describe('SSRF guards (S2)', () => {
    beforeEach(() => {
      process.env.PUPPETEER_EXECUTABLE_PATH = '/usr/bin/chromium';
    });

    it('browser_scrape refuses a cloud-metadata address', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('browser_scrape', { url: 'http://169.254.169.254/latest/meta-data/' }),
      );

      const result = await runScrape('1', mockActor);

      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('SSRF');
      expect(puppeteerPageMock.goto).not.toHaveBeenCalled();
    });

    it('browser_scrape refuses loopback', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('browser_scrape', { url: 'http://localhost:5432/' }),
      );
      const result = await runScrape('1', mockActor);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('forbidden');
    });

    it('detectSelectors refuses an internal address before calling the LLM', async () => {
      (getAiConfig as jest.Mock).mockResolvedValue({ apiKey: 'k', model: 'gpt-4o', baseUrl: null });
      global.fetch = jest.fn();
      await expect(detectSelectors('http://127.0.0.1/admin')).rejects.toThrow('SSRF');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('discoverPages refuses an internal address before launching Chrome', async () => {
      await expect(discoverPages('http://169.254.169.254/')).rejects.toThrow('SSRF');
      expect(puppeteerLaunchMock).not.toHaveBeenCalled();
    });
  });

  describe('fetch timeouts (R1)', () => {
    it('surfaces a hung upstream as a retryable timeout instead of hanging forever', async () => {
      (repo.findScraperConfigById as jest.Mock).mockResolvedValue(
        activeConfig('google_places', { apiKeyRef: 'GOOGLE_PLACES_API_KEY', query: 'cafes' }),
      );
      // Simulate what fetch does when the abort signal fires.
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'TimeoutError';
      global.fetch = jest.fn().mockRejectedValue(abortErr);

      const result = await runScrape('1', mockActor);

      expect(result.status).toBe('failed');
      expect(result.errorMessage).toContain('timed out');
      expect(result.retryable).toBe(true);
    });
  });

  // ── Browser Egress Policy & Selector Validation ─────────────────────────────

  describe('installBrowserEgressPolicy', () => {
    it('intercepts requests and aborts requests to private, loopback, or metadata addresses', async () => {
      let requestHandler: ((req: any) => void) | undefined;
      const fakePage = {
        setRequestInterception: jest.fn().mockResolvedValue(undefined),
        on: jest.fn((event: string, handler: (req: any) => void) => {
          if (event === 'request') requestHandler = handler;
        }),
      };

      await installBrowserEgressPolicy(fakePage);

      expect(fakePage.setRequestInterception).toHaveBeenCalledWith(true);
      expect(fakePage.on).toHaveBeenCalledWith('request', expect.any(Function));
      expect(requestHandler).toBeDefined();

      const blockedUrls = [
        'http://127.0.0.1/admin',
        'http://localhost:8080/metrics',
        'http://169.254.169.254/latest/meta-data',
        'http://10.0.0.1/internal',
        'http://internal.service.local/api',
        'ftp://example.com/file',
      ];

      for (const url of blockedUrls) {
        const fakeReq = {
          url: () => url,
          abort: jest.fn(),
          continue: jest.fn(),
        };
        requestHandler!(fakeReq);
        expect(fakeReq.abort).toHaveBeenCalledWith('blockedbyclient');
        expect(fakeReq.continue).not.toHaveBeenCalled();
      }

      // Safe external URL should be allowed to continue
      const safeReq = {
        url: () => 'https://example.com/assets/logo.png',
        abort: jest.fn(),
        continue: jest.fn().mockResolvedValue(undefined),
      };
      requestHandler!(safeReq);
      await new Promise((resolve) => setImmediate(resolve));
      expect(safeReq.continue).toHaveBeenCalled();
      expect(safeReq.abort).not.toHaveBeenCalled();
    });

    it('aborts public hostnames whose DNS answers include a private address', async () => {
      (dns.lookup as jest.Mock).mockResolvedValueOnce([
        { address: '10.0.0.12', family: 4 },
      ]);
      let requestHandler: ((req: any) => void) | undefined;
      const fakePage = {
        setRequestInterception: jest.fn().mockResolvedValue(undefined),
        on: jest.fn((event: string, handler: (req: any) => void) => {
          if (event === 'request') requestHandler = handler;
        }),
      };
      await installBrowserEgressPolicy(fakePage);

      const fakeReq = {
        url: () => 'https://attacker.example/pixel.gif',
        abort: jest.fn().mockResolvedValue(undefined),
        continue: jest.fn(),
      };
      requestHandler!(fakeReq);
      await new Promise((resolve) => setImmediate(resolve));

      expect(fakeReq.abort).toHaveBeenCalledWith('blockedbyclient');
      expect(fakeReq.continue).not.toHaveBeenCalled();
    });
  });
});

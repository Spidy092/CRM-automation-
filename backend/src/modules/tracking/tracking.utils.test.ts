import { pool, queryOne } from '../../shared/utils/db';
import {
  recordOpen,
  recordClick,
  setClickUrl,
  buildTrackingPixel,
  rewriteLinksForTracking,
} from './tracking.utils';

jest.mock('../../shared/utils/db', () => ({
  pool: { query: jest.fn() },
  queryOne: jest.fn(),
}));
jest.mock('../../shared/utils/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

describe('tracking.utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('recordOpen updates outreach_logs and returns pixel buffer', async () => {
    (pool.query as jest.Mock).mockResolvedValue(undefined);
    const buf = await recordOpen('log-1');
    expect(buf).toBeInstanceOf(Buffer);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE outreach_logs'), ['log-1']);
  });

  it('recordOpen logs errors and still returns pixel', async () => {
    (pool.query as jest.Mock).mockRejectedValue(new Error('db down'));
    const buf = await recordOpen('log-1');
    expect(buf).toBeInstanceOf(Buffer);
  });

  it('recordClick returns click_url and updates log', async () => {
    (queryOne as jest.Mock).mockResolvedValue({ click_url: 'https://example.com' });
    (pool.query as jest.Mock).mockResolvedValue(undefined);
    const url = await recordClick('log-1');
    expect(url).toBe('https://example.com');
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE outreach_logs'), ['log-1']);
  });

  it('recordClick returns null when no click_url', async () => {
    (queryOne as jest.Mock).mockResolvedValue({ click_url: null });
    const url = await recordClick('log-1');
    expect(url).toBeNull();
  });

  it('recordClick returns null on error', async () => {
    (queryOne as jest.Mock).mockRejectedValue(new Error('db down'));
    const url = await recordClick('log-1');
    expect(url).toBeNull();
  });

  it('setClickUrl updates outreach_logs', async () => {
    (pool.query as jest.Mock).mockResolvedValue(undefined);
    await setClickUrl('log-1', 'https://example.com');
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE outreach_logs SET click_url'),
      ['https://example.com', 'log-1'],
    );
  });

  it('buildTrackingPixel returns img tag', () => {
    const html = buildTrackingPixel('log-1', 'https://host');
    expect(html).toContain('https://host/track/open/log-1');
  });

  it('rewriteLinksForTracking rewrites http links and ignores mailto', () => {
    const html = '<a href="https://example.com">link</a> <a href="mailto:a@b.com">email</a>';
    const { rewritten, links } = rewriteLinksForTracking(html, 'log-1', 'https://host');
    expect(links).toEqual(['https://example.com']);
    expect(rewritten).toContain('https://host/track/click/log-1');
    expect(rewritten).toContain('mailto:a@b.com');
  });
});

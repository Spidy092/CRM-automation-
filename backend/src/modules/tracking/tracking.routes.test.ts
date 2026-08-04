import request from 'supertest';
import express from 'express';
import { trackingRoutes } from './tracking.routes';
import { recordOpen, recordClick } from './tracking.utils';

jest.mock('./tracking.utils', () => ({
  recordOpen: jest.fn(),
  recordClick: jest.fn(),
}));
jest.mock('../../shared/utils/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

const mockRecordOpen = recordOpen as jest.Mock;
const mockRecordClick = recordClick as jest.Mock;

const app = express();
app.use('/track', trackingRoutes);

const FALLBACK_PIXEL_B64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

describe('GET /track/open/:logId', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the pixel from recordOpen with no-cache headers', async () => {
    mockRecordOpen.mockResolvedValue(Buffer.from('fake-gif-bytes'));
    const res = await request(app).get('/track/open/log-1');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/gif');
    expect(res.headers['cache-control']).toContain('no-store');
    expect(mockRecordOpen).toHaveBeenCalledWith('log-1');
    expect(res.body).toEqual(Buffer.from('fake-gif-bytes'));
  });

  it('still returns a fallback pixel when recordOpen throws', async () => {
    mockRecordOpen.mockRejectedValue(new Error('db down'));
    const res = await request(app).get('/track/open/log-2');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/gif');
    expect(res.body).toEqual(Buffer.from(FALLBACK_PIXEL_B64, 'base64'));
  });
});

describe('GET /track/click/:logId', () => {
  beforeEach(() => jest.clearAllMocks());

  it('redirects to the stored click URL when present', async () => {
    mockRecordClick.mockResolvedValue('https://example.com/landing');
    const res = await request(app).get('/track/click/log-1');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://example.com/landing');
  });

  it('falls back to the ?url= query param when no stored URL exists', async () => {
    mockRecordClick.mockResolvedValue(null);
    const res = await request(app)
      .get('/track/click/log-2')
      .query({ url: 'https://example.com/fallback' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://example.com/fallback');
  });

  it('returns a tracked-link page when neither URL is safe/present', async () => {
    mockRecordClick.mockResolvedValue(null);
    const res = await request(app).get('/track/click/log-3');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Link tracked.');
  });

  it('rejects a javascript: URL as unsafe and falls back to the tracked page', async () => {
    mockRecordClick.mockResolvedValue('javascript:alert(1)');
    const res = await request(app).get('/track/click/log-4');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Link tracked.');
  });

  it('falls back to the ?url= param and shows tracked page when recordClick throws', async () => {
    mockRecordClick.mockRejectedValue(new Error('db down'));
    const res = await request(app)
      .get('/track/click/log-5')
      .query({ url: 'https://example.com/on-error' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://example.com/on-error');
  });

  it('shows the tracked page when recordClick throws and no safe fallback URL exists', async () => {
    mockRecordClick.mockRejectedValue(new Error('db down'));
    const res = await request(app).get('/track/click/log-6');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Link tracked.');
  });
});

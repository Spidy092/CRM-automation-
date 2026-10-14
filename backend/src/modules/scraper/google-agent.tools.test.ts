import { createGoogleAgentAdapters } from './google-agent.tools';
import { readPublicWebsite } from './google-agent.network';
import { AppError } from '../../shared/middleware/errorHandler';
import type { GoogleAgentCandidate } from './google-agent.schema';
jest.mock('./google-agent.network');
const originalFetch = global.fetch;
const candidate: GoogleAgentCandidate = {
  placeId: 'p1',
  name: 'Clinic',
  address: 'Address',
  latitude: 13,
  longitude: 77,
  rating: 4,
  reviewCount: 10,
  detailsFetched: true,
  website: 'https://clinic.test/',
};
function network(maxRequests = 10, deadline = Date.now() + 10000) {
  return createGoogleAgentAdapters({
    apiKey: 'do-not-persist',
    center: [13, 77],
    radius: 5000,
    maxRequests,
    deadline,
  });
}
function response(data: unknown, status = 200): Response {
  return { ok: status === 200, status, json: async () => data } as Response;
}
beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});
afterAll(() => {
  global.fetch = originalFetch;
});

it('filters out-of-area results, malformed records, and caps search pages', async () => {
  (global.fetch as jest.Mock).mockResolvedValue(
    response({
      status: 'OK',
      results: [
        { place_id: 'p1', name: 'Clinic', geometry: { location: { lat: 13, lng: 77 } } },
        { place_id: 'far', name: 'Other city', geometry: { location: { lat: 25, lng: 80 } } },
        { place_id: 'missing-coordinates', name: 'Unknown area' },
      ],
    }),
  );
  const n = network();
  const results = await n.adapters.search('clinic');
  expect(results.map((p) => p.placeId)).toEqual(['p1']);
  expect(n.requestsUsed()).toBe(1);
  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining('location=13%2C77'),
    expect.anything(),
  );
});
it('returns an empty search and validates details contact fields', async () => {
  (global.fetch as jest.Mock)
    .mockResolvedValueOnce(response({ status: 'ZERO_RESULTS' }))
    .mockResolvedValueOnce(
      response({
        status: 'OK',
        result: { formatted_phone_number: ' +919999999999 ', website: 'https://clinic.test/' },
      }),
    );
  const n = network();
  expect(await n.adapters.search('clinic')).toEqual([]);
  expect(await n.adapters.details(candidate)).toMatchObject({
    phone: '+919999999999',
    website: 'https://clinic.test/',
    detailsFetched: true,
  });
});
it.each([
  [{ status: 'OVER_QUERY_LIMIT' }, 429],
  [{ status: 'REQUEST_DENIED' }, 400],
  [{ status: 'UNKNOWN_ERROR' }, 400],
])('surfaces Google status failures without API credentials', async (payload, code) => {
  (global.fetch as jest.Mock).mockResolvedValue(response(payload));
  await expect(network().adapters.search('clinic')).rejects.toMatchObject({ statusCode: code });
});
it('sanitizes network errors and rejects HTTP/malformed responses', async () => {
  (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('url includes do-not-persist'));
  await expect(network().adapters.search('clinic')).rejects.toThrow('request failed');
  (global.fetch as jest.Mock).mockResolvedValueOnce(response({}, 429));
  await expect(network().adapters.search('clinic')).rejects.toMatchObject({ statusCode: 429 });
  (global.fetch as jest.Mock).mockResolvedValueOnce(response(null));
  await expect(network().adapters.search('clinic')).rejects.toThrow('Malformed');
});
it('enforces request and time limits before making requests', async () => {
  (global.fetch as jest.Mock).mockResolvedValue(response({ status: 'ZERO_RESULTS' }));
  const n = network(1);
  await n.adapters.search('clinic');
  await expect(n.adapters.search('dentist')).rejects.toThrow('request budget');
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(() => network(5, Date.now() - 1).assertBudget()).toThrow('time budget');
});
it('extracts only observed website email and bounded visible evidence', async () => {
  (readPublicWebsite as jest.Mock)
    .mockResolvedValueOnce({ status: 404, text: '', contentType: 'text/plain' })
    .mockResolvedValueOnce({
      status: 200,
      contentType: 'text/html',
      text: '<html><body>Booking available <a href="mailto:hello@clinic.test">Email</a><script>invented@example.com</script></body></html>',
    })
    .mockResolvedValueOnce({ status: 404, contentType: 'text/html', text: '' });
  const n = network();
  const result = await n.adapters.website(candidate);
  expect(result.email).toBe('hello@clinic.test');
  expect(result.emailSource).toBe('https://clinic.test/');
  expect(result.evidence).toContain('Booking available');
  expect(result.evidence).not.toContain('invented@example.com');
  expect(n.requestsUsed()).toBe(3);
});
it('respects robots disallow and does not follow a website redirect', async () => {
  (readPublicWebsite as jest.Mock).mockResolvedValueOnce({
    status: 200,
    text: 'User-agent: *\nDisallow: /',
    contentType: 'text/plain',
  });
  const blocked = await network().adapters.website(candidate);
  expect(blocked.email).toBeUndefined();
  expect(readPublicWebsite).toHaveBeenCalledTimes(1);
  jest.clearAllMocks();
  (readPublicWebsite as jest.Mock)
    .mockResolvedValueOnce({ status: 404, text: '', contentType: 'text/plain' })
    .mockResolvedValue({
      status: 302,
      text: '',
      contentType: 'text/html',
      location: 'http://127.0.0.1/',
    });
  expect((await network().adapters.website(candidate)).email).toBeUndefined();
  expect(readPublicWebsite).not.toHaveBeenCalledWith(
    expect.stringContaining('127.0.0.1'),
    expect.anything(),
  );
});
it('reports unavailable evidence, but does not hide budget exhaustion', async () => {
  (readPublicWebsite as jest.Mock).mockRejectedValue(new Error('unsafe request'));
  expect((await network().adapters.website(candidate)).evidence).toContain(
    'could not be inspected safely',
  );
  (readPublicWebsite as jest.Mock).mockRejectedValue(new AppError('budget exhausted', 422));
  await expect(network().adapters.website(candidate)).rejects.toThrow('budget exhausted');
});
it('does not inspect absent or credential-bearing websites', async () => {
  expect(
    (await network().adapters.website({ ...candidate, website: undefined })).evidence,
  ).toContain('No website');
  await expect(
    network().adapters.website({ ...candidate, website: 'https://fixture@clinic.test' }),
  ).rejects.toThrow('credentials');
  expect(readPublicWebsite).not.toHaveBeenCalled();
});
it('blocks inspection when robots policy cannot be obtained', async () => {
  (readPublicWebsite as jest.Mock).mockResolvedValue({
    status: 403,
    contentType: 'text/plain',
    text: '',
  });
  expect((await network().adapters.website(candidate)).evidence).toContain(
    'robots policy unavailable',
  );
  expect(readPublicWebsite).toHaveBeenCalledTimes(1);
});

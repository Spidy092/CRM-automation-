import * as cheerio from 'cheerio';
import { z } from 'zod';
import { AppError } from '../../shared/middleware/errorHandler';
import { googleAgentCandidateSchema, type GoogleAgentCandidate } from './google-agent.schema';
import type { GoogleAgentAdapters } from './google-agent.service';
import { readPublicWebsite } from './google-agent.network';

const searchResultSchema = z.object({
  place_id: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
  formatted_address: z.string().max(500).optional().default(''),
  geometry: z.object({
    location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
  }),
  rating: z.number().min(0).max(5).optional(),
  user_ratings_total: z.number().int().nonnegative().optional(),
});

function distanceMeters(lat: number, lng: number, center: [number, number]): number {
  const radians = (degrees: number): number => (degrees * Math.PI) / 180;
  const dLat = radians(lat - center[0]);
  const dLng = radians(lng - center[1]);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(center[0])) * Math.cos(radians(lat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

export function createGoogleAgentAdapters(input: {
  apiKey: string;
  center: [number, number];
  radius: number;
  maxRequests: number;
  deadline: number;
}): { adapters: GoogleAgentAdapters; assertBudget: () => void; requestsUsed: () => number } {
  let requests = 0;
  const robotsCache = new Map<string, string>();
  function assertBudget(): void {
    if (Date.now() >= input.deadline)
      throw new AppError('AI scraper time budget exhausted; no leads imported.', 422);
  }
  function chargeRequest(): void {
    assertBudget();
    if (requests >= input.maxRequests)
      throw new AppError('AI scraper API request budget exhausted; no leads imported.', 422);
    requests++;
  }
  async function google(
    path: string,
    params: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    chargeRequest();
    const url = `https://maps.googleapis.com/maps/api/place/${path}/json?${new URLSearchParams({ ...params, key: input.apiKey }).toString()}`;
    let response: Response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(Math.max(1, Math.min(20000, input.deadline - Date.now()))),
      });
    } catch {
      throw new AppError('Google Places request failed or timed out; no leads imported.', 502);
    }
    if (!response.ok)
      throw new AppError(
        `Google Places HTTP error (${response.status})`,
        response.status === 429 ? 429 : 502,
      );
    let data: Record<string, unknown>;
    try {
      data = z.record(z.unknown()).parse(await response.json());
    } catch {
      throw new AppError('Malformed Google Places response', 502);
    }
    if (data.status === 'ZERO_RESULTS') return data;
    if (data.status === 'OVER_QUERY_LIMIT') throw new AppError('Google Places quota exceeded', 429);
    if (data.status !== 'OK')
      throw new AppError('Google Places rejected the request; check API configuration.', 400);
    return data;
  }
  async function page(url: string): Promise<Awaited<ReturnType<typeof readPublicWebsite>>> {
    chargeRequest();
    return readPublicWebsite(url, Math.max(1, Math.min(10000, input.deadline - Date.now())));
  }

  const adapters: GoogleAgentAdapters = {
    search: async (query): Promise<GoogleAgentCandidate[]> => {
      const data = await google('textsearch', {
        query,
        location: input.center.join(','),
        radius: String(input.radius),
      });
      const results: GoogleAgentCandidate[] = [];
      for (const raw of Array.isArray(data.results) ? data.results.slice(0, 20) : []) {
        const parsed = searchResultSchema.safeParse(raw);
        if (!parsed.success) continue;
        const p = parsed.data;
        if (
          distanceMeters(p.geometry.location.lat, p.geometry.location.lng, input.center) >
          input.radius
        )
          continue;
        results.push(
          googleAgentCandidateSchema.parse({
            placeId: p.place_id,
            name: p.name,
            address: p.formatted_address,
            latitude: p.geometry.location.lat,
            longitude: p.geometry.location.lng,
            rating: p.rating ?? null,
            reviewCount: p.user_ratings_total ?? null,
          }),
        );
      }
      return results;
    },
    details: async (candidate): Promise<GoogleAgentCandidate> => {
      const data = await google('details', {
        place_id: candidate.placeId,
        fields: 'formatted_phone_number,website',
      });
      const detail = z
        .object({
          formatted_phone_number: z.string().trim().max(50).optional(),
          website: z.string().url().optional(),
        })
        .parse(data.result);
      return {
        ...candidate,
        detailsFetched: true,
        phone: detail.formatted_phone_number || undefined,
        website: detail.website,
      };
    },
    website: async (candidate): Promise<GoogleAgentCandidate> => {
      if (!candidate.website) return { ...candidate, evidence: 'No website supplied by Google.' };
      const seed = new URL(candidate.website);
      if (seed.username || seed.password)
        throw new AppError('Business website credentials are forbidden', 400);
      seed.hash = '';
      seed.search = '';
      // Only the Google-observed origin and fixed public pages can be visited; the model cannot supply URLs.
      const pages = [seed.toString(), new URL('/contact', seed.origin).toString()];
      const evidence: string[] = [];
      let email: string | undefined;
      let emailSource: string | undefined;
      for (const url of [...new Set(pages)]) {
        assertBudget();
        try {
          if (!robotsCache.has(seed.origin)) {
            const robots = await page(new URL('/robots.txt', seed.origin).toString());
            if (robots.status !== 404 && robots.status !== 200) {
              evidence.push('Website robots policy unavailable; website was not inspected.');
              break;
            }
            robotsCache.set(seed.origin, robots.status === 404 ? '' : robots.text);
          }
          const robotsText = robotsCache.get(seed.origin) ?? '';
          // Conservative: any disallowing rule (for any bot) blocks the matching path.
          const disallowed = [...robotsText.matchAll(/^\s*Disallow:\s*([^\s#]*)/gim)]
            .map((match) => match[1])
            .filter(Boolean);
          if (
            disallowed.some(
              (rule) =>
                rule.includes('*') || new URL(url).pathname.startsWith(rule.replace(/\$$/, '')),
            )
          ) {
            evidence.push('Website path excluded by robots policy.');
            continue;
          }
          const response = await page(url);
          if (response.status !== 200 || !response.contentType.includes('text/html')) {
            evidence.push('Website page unavailable or redirects; not inspected.');
            continue;
          }
          const $ = cheerio.load(response.text);
          $('script,style,noscript,svg').remove();
          const text = $('body').text().replace(/\s+/g, ' ').trim();
          evidence.push(text.slice(0, 1300));
          if (!email) {
            const emails: string[] = [];
            $('a[href]').each((_i, element) => {
              const href = $(element).attr('href') ?? '';
              if (/^mailto:/i.test(href)) emails.push(href.slice(7).split('?')[0]);
            });
            emails.push(...(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []));
            email = emails
              .map((value) => value.trim().toLowerCase())
              .find(
                (value) =>
                  z.string().email().safeParse(value).success &&
                  !/\.(local|png|jpg|svg)$/i.test(value) &&
                  !/^no-reply@/i.test(value) &&
                  value.split('@')[0].length <= 64,
              );
            if (email) emailSource = url;
          }
        } catch (error) {
          if (error instanceof AppError && error.statusCode === 422) throw error;
          evidence.push('Website could not be inspected safely.');
        }
      }
      return { ...candidate, email, emailSource, evidence: evidence.join(' ').slice(0, 3000) };
    },
  };
  return { adapters, assertBudget, requestsUsed: () => requests };
}

import {
  capabilityForSourceType,
  normalizeResearchOptions,
  requirementsForConfig,
} from './research.schema';
import {
  assessStagedCandidates,
  buildStagedCandidates,
  scrapedLeadToCandidate,
  stagedCandidateToLead,
} from './candidate.bridge';

describe('normalizeResearchOptions', () => {
  it('keeps legacy blobs on automatic import with no targeting', () => {
    expect(normalizeResearchOptions({})).toEqual({
      importMode: 'automatic',
      targets: { industries: [], locations: [], requiredContactChannel: 'either', serviceCategories: [] },
    });
    expect(normalizeResearchOptions(null)).toEqual(normalizeResearchOptions({}));
    expect(normalizeResearchOptions(undefined)).toEqual(normalizeResearchOptions({}));
  });

  it('defaults agent runs to review unless explicitly automatic', () => {
    expect(normalizeResearchOptions({ agentEnabled: true }).importMode).toBe('review');
    expect(
      normalizeResearchOptions({ agentEnabled: true, research: { importMode: 'automatic' } })
        .importMode,
    ).toBe('automatic');
    expect(
      normalizeResearchOptions({ research: { importMode: 'review' } }).importMode,
    ).toBe('review');
  });

  it('passes operator targets through without inventing defaults', () => {
    const result = normalizeResearchOptions({
      research: { targets: { industries: ['Bakery'], requiredContactChannel: 'phone' } },
    });
    expect(result.targets.industries).toEqual(['Bakery']);
    expect(result.targets.locations).toEqual([]);
    expect(result.targets.requiredContactChannel).toBe('phone');
  });

  it('fails closed to review when persisted research options are malformed', () => {
    expect(
      normalizeResearchOptions({
        research: { importMode: 'review', targets: { industries: ['x'.repeat(101)] } },
      }).importMode,
    ).toBe('review');
  });
});

describe('capabilityForSourceType', () => {
  it('labels every source honestly', () => {
    expect(capabilityForSourceType('google_places')).toBe('discovery');
    expect(capabilityForSourceType('youtube')).toBe('discovery');
    expect(capabilityForSourceType('web_scrape')).toBe('discovery');
    expect(capabilityForSourceType('browser_scrape')).toBe('discovery');
    expect(capabilityForSourceType('facebook')).toBe('configured_page_enrichment');
    expect(capabilityForSourceType('google_ads_lead_forms')).toBe('webhook_ingestion');
    expect(capabilityForSourceType('linkedin_lead_forms')).toBe('manual_import');
    expect(capabilityForSourceType('apify_actor')).toBe('actor_retrieval');
  });
});

describe('requirementsForConfig', () => {
  const isSet = (ref: string) => ref === 'SET_KEY';
  it('reports presence without values', () => {
    const reqs = requirementsForConfig('youtube', { apiKeyRef: 'SET_KEY' }, isSet);
    expect(reqs).toEqual([{ ref: 'SET_KEY', label: 'API key', met: true }]);
    const missing = requirementsForConfig('youtube', { apiKeyRef: 'MISSING' }, isSet);
    expect(missing[0].met).toBe(false);
    expect(JSON.stringify(missing)).not.toContain('secret-value');
  });
});

describe('candidate bridge', () => {
  const ctx = { sourceType: 'youtube' as const, configId: 'c1', runId: 'r1' };

  it('marks placeholders synthetic and stages stable provider identity', () => {
    const candidate = scrapedLeadToCandidate(
      {
        business_name: 'Chan',
        email: 'x@youtube-scraped.local',
        phone: '+0123456789',
        fallback_id: 'channel:UC1',
      },
      { ...ctx, providerKind: 'youtube_channel' },
    );
    expect(candidate.provider).toEqual({ kind: 'youtube_channel', id: 'channel:UC1' });
    expect(candidate.contacts.map((c) => c.state)).toEqual(['synthetic', 'synthetic']);
  });

  it('always yields an addressable staged id, even without provider identity', () => {
    const candidate = scrapedLeadToCandidate({ business_name: 'Web Co' }, ctx);
    expect(candidate.provider.id).toMatch(/^staged:/);
  });

  it('stages every fetched provider result instead of dropping records after fifty', () => {
    const leads = Array.from({ length: 60 }, (_, index) => ({
      business_name: `Business ${index}`,
      phone: `+1415555${String(index).padStart(4, '0')}`,
      fallback_id: `provider:${index}`,
    }));
    const staged = buildStagedCandidates(leads, ctx, {
      importMode: 'review',
      targets: {
        industries: [],
        locations: [],
        requiredContactChannel: 'either',
        serviceCategories: [],
      },
    });
    expect(staged).toHaveLength(60);
  });

  it('assesses staged candidates against operator targets', () => {
    const assessed = assessStagedCandidates(
      [
        scrapedLeadToCandidate(
          { business_name: 'Bakery', phone: '+14155552671', location: 'Bangalore' },
          ctx,
        ),
      ],
      {
        importMode: 'review',
        targets: {
          industries: [],
          locations: [],
          requiredContactChannel: 'either' as const,
          serviceCategories: [],
        },
      },
    );
    expect(assessed[0].eligibility).toBe('eligible');
    expect(buildStagedCandidates([], ctx, { importMode: 'review', targets: { industries: [], locations: [], requiredContactChannel: 'either' as const, serviceCategories: [] } })).toEqual([]);
  });

  it('reverse bridge drops synthetic contacts and refuses synthetic-only', () => {
    const assessed = assessStagedCandidates(
      [
        scrapedLeadToCandidate(
          { business_name: 'Synth', email: 'a@x-scraped.local', phone: '+0123456789' },
          ctx,
        ),
      ],
      {
        importMode: 'review',
        targets: { industries: [], locations: [], requiredContactChannel: 'either' as const, serviceCategories: [] },
      },
    );
    expect(stagedCandidateToLead(assessed[0]).ok).toBe(false);

    const real = assessStagedCandidates(
      [scrapedLeadToCandidate({ business_name: 'Real', phone: '+14155552671' }, ctx)],
      {
        importMode: 'review',
        targets: { industries: [], locations: [], requiredContactChannel: 'either' as const, serviceCategories: [] },
      },
    );
    const converted = stagedCandidateToLead(real[0]);
    expect(converted.ok).toBe(true);
    expect(converted.lead?.phone).toBe('+14155552671');
  });
});

import {
  assessedCandidateSchema,
  candidateTargetsSchema,
  researchCandidateSchema,
} from './candidate.schema';

function baseCandidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provider: { kind: 'google_place', id: 'place-123' },
    source: {
      sourceType: 'google_places',
      configId: '00000000-0000-0000-0000-000000000001',
      runId: '00000000-0000-0000-0000-000000000002',
      collectedAt: new Date().toISOString(),
    },
    business: {
      name: 'Acme Bakery',
      website: 'https://acme.example.com',
      sourceUrls: ['https://acme.example.com'],
      location: 'Bangalore',
      industry: 'Bakery',
    },
    contacts: [],
    evidence: [],
    observedOpportunities: [],
    modelSuggestions: [],
    ...overrides,
  };
}

describe('research candidate schema', () => {
  it('accepts a minimal candidate with no contacts (rejected later by quality, not schema)', () => {
    const parsed = researchCandidateSchema.parse(baseCandidate());
    expect(parsed.business.name).toBe('Acme Bakery');
    expect(parsed.contacts).toEqual([]);
  });

  it('rejects unbounded evidence and contact lists', () => {
    const tooMuch = baseCandidate({
      contacts: Array.from({ length: 11 }, () => ({
        channel: 'email',
        value: 'a@example.com',
        provenance: 'website_text',
        state: 'unknown',
      })),
    });
    expect(() => researchCandidateSchema.parse(tooMuch)).toThrow();

    const tooMuchEvidence = baseCandidate({
      evidence: Array.from({ length: 11 }, (_, i) => ({
        snippet: `snippet ${i}`,
        kind: 'observed_fact',
      })),
    });
    expect(() => researchCandidateSchema.parse(tooMuchEvidence)).toThrow();
  });

  it('bounds evidence snippets to 500 chars and urls to valid URLs', () => {
    const long = baseCandidate({
      evidence: [{ snippet: 'x'.repeat(501), kind: 'observed_fact' }],
    });
    expect(() => researchCandidateSchema.parse(long)).toThrow();

    const badUrl = baseCandidate({
      evidence: [{ snippet: 'ok', url: 'not-a-url', kind: 'observed_fact' }],
    });
    expect(() => researchCandidateSchema.parse(badUrl)).toThrow();
  });

  it('keeps observed opportunities and model suggestions in separate fields', () => {
    const parsed = researchCandidateSchema.parse(
      baseCandidate({
        observedOpportunities: [{ fact: 'No website linked from profile' }],
        modelSuggestions: [{ suggestion: 'Might need AI chatbot' }],
      }),
    );
    expect(parsed.observedOpportunities).toHaveLength(1);
    expect(parsed.modelSuggestions).toHaveLength(1);
    expect(parsed.observedOpportunities[0].fact).not.toContain('chatbot');
  });

  it('requires eligibility and scores on assessed candidates', () => {
    const raw = baseCandidate();
    expect(() => assessedCandidateSchema.parse(raw)).toThrow();
    const parsed = assessedCandidateSchema.parse({
      ...raw,
      targetFit: 50,
      contactQuality: 70,
      eligibility: 'eligible',
      rejectionReasons: [],
      suggestedService: 'website',
    });
    expect(parsed.eligibility).toBe('eligible');
  });

  it('operator targets have no invented defaults (empty means no filter)', () => {
    const targets = candidateTargetsSchema.parse({});
    expect(targets.industries).toEqual([]);
    expect(targets.locations).toEqual([]);
    expect(targets.requiredContactChannel).toBe('either');
  });

  it('public scraper config schemas do not accept provenance or trust flags', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const scraperSchema = require('./scraper.schema') as Record<string, unknown>;
    const sourceSchemas = scraperSchema['SOURCE_CONFIG_SCHEMAS'] as Record<
      string,
      { shape?: Record<string, unknown> }
    >;
    for (const schema of Object.values(sourceSchemas)) {
      const shape = schema.shape ?? {};
      for (const key of Object.keys(shape)) {
        expect(key.toLowerCase()).not.toContain('provenance');
        expect(key.toLowerCase()).not.toContain('trust');
      }
    }
  });
});

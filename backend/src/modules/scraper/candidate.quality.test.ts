import {
  assessCandidate,
  classifyEmailContact,
  classifyPhoneContact,
  dedupeCandidates,
  makeEmailContact,
  makePhoneContact,
  scoreContactQuality,
  scoreTargetFit,
  suggestServiceCategory,
  toAssessedCandidate,
} from './candidate.quality';
import { ResearchCandidate } from './candidate.schema';

function candidate(overrides: Partial<ResearchCandidate> = {}): ResearchCandidate {
  return {
    provider: { kind: 'google_place', id: 'place-1' },
    source: {
      sourceType: 'google_places',
      collectedAt: new Date().toISOString(),
    },
    business: {
      name: 'Acme Bakery',
      website: null,
      sourceUrls: [],
      location: 'Bangalore',
      industry: 'Bakery',
    },
    contacts: [],
    evidence: [],
    observedOpportunities: [],
    modelSuggestions: [],
    ...overrides,
  } as ResearchCandidate;
}

describe('contact classification', () => {
  it('marks placeholders as synthetic even with valid syntax', () => {
    expect(
      classifyEmailContact({
        value: 'acme-bangalore-place1@google_business-scraped.local',
        provenance: 'placeholder_synthetic',
        dns: 'not_checked',
      }),
    ).toBe('synthetic');
    expect(
      classifyPhoneContact({ value: '+0123456789', provenance: 'placeholder_synthetic' }),
    ).toBe('synthetic');
  });

  it('rejects malformed email syntax', () => {
    expect(
      classifyEmailContact({ value: 'not-an-email', provenance: 'website_text', dns: 'not_checked' }),
    ).toBe('malformed');
  });

  it('flags disposable domains separately from malformed', () => {
    expect(
      classifyEmailContact({
        value: 'user@mailinator.com',
        provenance: 'website_text',
        dns: 'not_checked',
      }),
    ).toBe('disposable');
  });

  it('reports MX success as dns_supported (never mailbox proof)', () => {
    const state = classifyEmailContact({
      value: 'hello@acme.com',
      provenance: 'website_mailto',
      dns: 'valid_mx',
    });
    expect(state).toBe('dns_supported');
    expect(state).not.toBe('observed');
  });

  it('treats DNS failure and unchecked domains as unknown', () => {
    for (const dns of ['no_mx', 'dns_failed', 'not_checked'] as const) {
      expect(
        classifyEmailContact({ value: 'hello@acme.com', provenance: 'website_text', dns }),
      ).toBe('unknown');
    }
  });

  it('marks E.164 phones observed and junk phones malformed', () => {
    expect(classifyPhoneContact({ value: '+14155552671', provenance: 'google_places_observed' })).toBe(
      'observed',
    );
    expect(classifyPhoneContact({ value: 'abc', provenance: 'website_text' })).toBe('malformed');
  });
});

describe('eligibility', () => {
  it('marks synthetic-only records as research-only (never eligible)', () => {
    const c = candidate({
      contacts: [
        makeEmailContact('a-b-c@google_business-scraped.local', 'placeholder_synthetic', 'not_checked'),
        makePhoneContact('+0123456789', 'placeholder_synthetic'),
      ],
    });
    const result = assessCandidate({ candidate: c, targets: { industries: [], locations: [], requiredContactChannel: 'either', serviceCategories: [] } });
    expect(result.eligibility).toBe('research_only');
    expect(result.rejectionReasons).toContain('synthetic_only');
    expect(result.contactQuality).toBe(0);
  });

  it('keeps phone-only candidates eligible when email DNS is negative or unknown', () => {
    const phone = makePhoneContact('+14155552671', 'google_places_observed');
    for (const dns of ['no_mx', 'dns_failed', 'not_checked'] as const) {
      const c = candidate({
        contacts: [makeEmailContact('hello@acme.com', 'website_text', dns), phone],
      });
      const result = assessCandidate({
        candidate: c,
        targets: { industries: [], locations: [], requiredContactChannel: 'either', serviceCategories: [] },
      });
      expect(result.eligibility).toBe('eligible');
    }
  });

  it('rejects malformed-email-only candidates with no usable phone', () => {
    const c = candidate({
      contacts: [makeEmailContact('not-an-email', 'website_text', 'not_checked')],
    });
    const result = assessCandidate({
      candidate: c,
      targets: { industries: [], locations: [], requiredContactChannel: 'either', serviceCategories: [] },
    });
    expect(result.eligibility).toBe('rejected');
    expect(result.rejectionReasons).toContain('email_malformed_or_disposable');
  });

  it('keeps disposable-email + real-phone candidates usable via phone', () => {
    const c = candidate({
      contacts: [
        makeEmailContact('user@mailinator.com', 'website_text', 'not_checked'),
        makePhoneContact('+14155552671', 'google_places_observed'),
      ],
    });
    const result = assessCandidate({
      candidate: c,
      targets: { industries: [], locations: [], requiredContactChannel: 'either', serviceCategories: [] },
    });
    expect(result.eligibility).toBe('eligible');
  });

  it('rejects candidates with no contacts at all', () => {
    const result = assessCandidate({
      candidate: candidate(),
      targets: { industries: [], locations: [], requiredContactChannel: 'either', serviceCategories: [] },
    });
    expect(result.eligibility).toBe('rejected');
    expect(result.rejectionReasons).toContain('no_contact');
  });

  it('marks unknown-email-only candidates as research-only (not lost, not imported)', () => {
    const c = candidate({
      contacts: [makeEmailContact('hello@acme.com', 'website_text', 'dns_failed')],
    });
    const result = assessCandidate({
      candidate: c,
      targets: { industries: [], locations: [], requiredContactChannel: 'either', serviceCategories: [] },
    });
    expect(result.eligibility).toBe('research_only');
  });

  it('enforces the operator-required contact channel', () => {
    const phoneOnly = candidate({
      contacts: [makePhoneContact('+14155552671', 'google_places_observed')],
    });
    const emailRequired = assessCandidate({
      candidate: phoneOnly,
      targets: { industries: [], locations: [], requiredContactChannel: 'email', serviceCategories: [] },
    });
    // Keep the phone for research, while respecting the requested email channel.
    expect(emailRequired.eligibility).toBe('research_only');
    expect(emailRequired.rejectionReasons).toContain('required_channel_unmet_phone_available');
  });
});

describe('scoring', () => {
  it('scores contact quality: phone+email > email > phone > unknown > synthetic', () => {
    const both = scoreContactQuality([
      makeEmailContact('h@acme.com', 'website_mailto', 'valid_mx'),
      makePhoneContact('+14155552671', 'google_places_observed'),
    ]);
    const emailOnly = scoreContactQuality([
      makeEmailContact('h@acme.com', 'website_mailto', 'valid_mx'),
    ]);
    const phoneOnly = scoreContactQuality([makePhoneContact('+14155552671', 'google_places_observed')]);
    const unknownOnly = scoreContactQuality([
      makeEmailContact('h@acme.com', 'website_text', 'dns_failed'),
    ]);
    const synthetic = scoreContactQuality([
      makeEmailContact('a@x-scraped.local', 'placeholder_synthetic', 'not_checked'),
    ]);
    expect(both).toBeGreaterThan(emailOnly);
    expect(emailOnly).toBeGreaterThan(phoneOnly);
    expect(phoneOnly).toBeGreaterThan(unknownOnly);
    expect(unknownOnly).toBeGreaterThan(synthetic);
    expect(synthetic).toBe(0);
  });

  it('does not invent target defaults: empty targets score neutral', () => {
    const fit = scoreTargetFit(candidate(), {
      industries: [],
      locations: [],
      requiredContactChannel: 'either',
      serviceCategories: [],
    });
    expect(fit).toBe(50);
  });

  it('rewards configured industry/location matches without guessing', () => {
    const match = scoreTargetFit(candidate(), {
      industries: ['bakery'],
      locations: ['bangalore'],
      requiredContactChannel: 'either',
      serviceCategories: [],
    });
    const mismatch = scoreTargetFit(candidate(), {
      industries: ['dentist'],
      locations: ['mumbai'],
      requiredContactChannel: 'either',
      serviceCategories: [],
    });
    expect(match).toBeGreaterThan(50);
    expect(mismatch).toBeLessThan(50);
  });

  it('derives service category from observed facts only, not model guesses', () => {
    const fromFacts = suggestServiceCategory(
      candidate({ observedOpportunities: [{ fact: 'Business has no website linked from profile' }] }),
    );
    expect(fromFacts).toBe('website');
    const fromGuessesOnly = suggestServiceCategory(
      candidate({ modelSuggestions: [{ suggestion: 'Might need an AI chatbot' }] }),
    );
    expect(fromGuessesOnly).toBe('none');
  });
});

describe('deduplication', () => {
  it('dedupes by provider identity first', () => {
    const a = candidate({ provider: { kind: 'google_place', id: 'place-same' } });
    const b = candidate({
      provider: { kind: 'google_place', id: 'place-same' },
      business: { name: 'Different Name', website: null, sourceUrls: [], location: 'Elsewhere', industry: '' },
    });
    const result = dedupeCandidates([a, b]);
    expect(result.unique).toHaveLength(1);
    expect(result.providerDuplicates).toEqual([1]);
  });

  it('keeps two businesses with different provider ids separate (no merge on shared phone)', () => {
    const phone = makePhoneContact('+14155552671', 'google_places_observed');
    const a = candidate({
      provider: { kind: 'google_place', id: 'place-a' },
      business: { name: 'Shop A', website: null, sourceUrls: [], location: 'Bangalore', industry: '' },
      contacts: [phone],
    });
    const b = candidate({
      provider: { kind: 'google_place', id: 'place-b' },
      business: { name: 'Shop B', website: null, sourceUrls: [], location: 'Bangalore', industry: '' },
      contacts: [phone],
    });
    const result = dedupeCandidates([a, b]);
    expect(result.unique).toHaveLength(2);
    expect(result.providerDuplicates).toEqual([]);
  });

  it('groups ambiguous cross-source matches for review instead of merging', () => {
    const a = candidate({
      provider: { kind: 'google_place', id: 'place-a' },
      business: { name: 'Acme Bakery', website: null, sourceUrls: [], location: 'Bangalore', industry: '' },
    });
    const b = candidate({
      provider: { kind: 'youtube_channel', id: 'channel-b' },
      business: { name: 'Acme Bakery!', website: null, sourceUrls: [], location: 'Bangalore', industry: '' },
    });
    const result = dedupeCandidates([a, b]);
    expect(result.unique).toHaveLength(2);
    expect(result.reviewGroups).toHaveLength(1);
    expect(result.reviewGroups[0]).toHaveLength(2);
  });

  it('assesses end-to-end into a staged review shape', () => {
    const c = candidate({
      contacts: [makePhoneContact('+14155552671', 'google_places_observed')],
      observedOpportunities: [{ fact: 'No website linked from profile' }],
    });
    const assessed = toAssessedCandidate({
      candidate: c,
      targets: { industries: [], locations: [], requiredContactChannel: 'either', serviceCategories: [] },
    });
    expect(assessed.eligibility).toBe('eligible');
    expect(assessed.suggestedService).toBe('website');
    expect(assessed.contactQuality).toBeGreaterThan(0);
  });
});

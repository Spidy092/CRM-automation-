import { localDateTimeInZoneToUtc } from './newsletter.timezone';

describe('localDateTimeInZoneToUtc', () => {
  it('converts Asia/Kolkata wall time (+5:30, no DST) to the correct UTC instant', () => {
    // 09:00 in Kolkata is 03:30 UTC — the zone must affect the instant.
    const r = localDateTimeInZoneToUtc('2026-05-01T09:00', 'Asia/Kolkata');
    expect(r.utcIso).toBe('2026-05-01T03:30:00.000Z');
    expect(r.ambiguous).toBe(false);
  });

  it('treats the same wall time in UTC as a different instant', () => {
    const kolkata = localDateTimeInZoneToUtc('2026-05-01T09:00', 'Asia/Kolkata');
    const utc = localDateTimeInZoneToUtc('2026-05-01T09:00', 'UTC');
    expect(utc.utcIso).toBe('2026-05-01T09:00:00.000Z');
    expect(kolkata.utcIso).not.toBe(utc.utcIso);
  });

  it('rejects a nonexistent local time in a DST spring-forward gap', () => {
    // America/New_York springs forward 2026-03-08 02:00 -> 03:00; 02:30 never occurs.
    expect(() => localDateTimeInZoneToUtc('2026-03-08T02:30', 'America/New_York')).toThrow(
      /does not exist/,
    );
  });

  it('resolves an ambiguous fall-back local time to the earlier occurrence', () => {
    // 2026-11-01 01:30 in New York occurs twice (EDT then EST); earlier = EDT = 05:30Z.
    const r = localDateTimeInZoneToUtc('2026-11-01T01:30', 'America/New_York');
    expect(r.utcIso).toBe('2026-11-01T05:30:00.000Z');
    expect(r.ambiguous).toBe(true);
  });

  it('converts an unambiguous DST-zone winter time normally', () => {
    // EST (-5): 09:00 wall = 14:00Z.
    const r = localDateTimeInZoneToUtc('2026-01-15T09:00', 'America/New_York');
    expect(r.utcIso).toBe('2026-01-15T14:00:00.000Z');
    expect(r.ambiguous).toBe(false);
  });

  it('rejects unknown timezones with 422', () => {
    try {
      localDateTimeInZoneToUtc('2026-05-01T09:00', 'Mars/Olympus');
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as { statusCode?: number }).statusCode).toBe(422);
    }
  });

  it('rejects malformed wall-time input with 422', () => {
    for (const bad of ['2026-05-01 09:00', '09:00', '2026-13-01T09:00', '2026-05-01T25:00', '']) {
      try {
        localDateTimeInZoneToUtc(bad, 'UTC');
        throw new Error(`should have thrown for ${bad}`);
      } catch (err) {
        if ((err as Error).message.startsWith('should have thrown')) throw err;
        expect((err as { statusCode?: number }).statusCode).toBe(422);
      }
    }
  });
});
